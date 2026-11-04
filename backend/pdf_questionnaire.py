"""Extract questionnaire text, highlighted keys, and question figures from PDFs."""
import base64
import re
import threading
from io import BytesIO

from PIL import Image

from questionnaire import OPTION, QuestionnaireError

# PDFium is not thread-safe. Generation workers may import PDFs concurrently.
_pdfium_lock = threading.RLock()
_QUESTION_START = re.compile(r"(?m)^[ \t]*(?:Q(?:uestion)?\s*)?(\d+)[.)]\s*\S", re.I)
_OPTION_START = re.compile(r"(?m)^[ \t]*(?:\([A-Ha-h]\)|[A-Ha-h][.)])\s+\S")
_OPTION_TOKEN = re.compile(r"(?i)(?<![A-Za-z])(?:\(([A-H])\)|([A-H])[.)])\s+\S")
_FIGURE = re.compile(r"\bFIGURE\s+\d+(?:[-.]\d+)*\b", re.I)


def _line_bounds(textpage, text, start):
    boxes = []
    for offset, character in enumerate(text):
        if character.isspace():
            continue
        try:
            box = textpage.get_charbox(start + offset)
        except Exception:
            continue
        if box:
            boxes.append(box)
    if not boxes:
        return None
    return (min(box[0] for box in boxes), min(box[1] for box in boxes),
            max(box[2] for box in boxes), max(box[3] for box in boxes))


def _flattened_highlight_keys(page, textpage, text):
    """Read visible yellow/green answer marks that are flattened into page art.

    Many exported study PDFs paint highlights into the page instead of saving
    PDF /Highlight annotations. Only infer a key when one option has a clear
    highlighter-color fill; ambiguous or unmarked questions stay unanswered.
    """
    questions = list(_QUESTION_START.finditer(text))
    if not questions:
        return {}

    scale = 1.5
    bitmap = page.render(scale=scale)
    image = bitmap.to_pil().convert("RGB")
    bitmap.close()
    _page_width, page_height = page.get_size()

    def highlight_fraction(line, start):
        bounds = _line_bounds(textpage, line, start)
        if not bounds:
            return 0.0
        pad = 1.0
        left, bottom, right, top = bounds
        crop = image.crop((
            max(0, int((left - pad) * scale)),
            max(0, int((page_height - top - pad) * scale)),
            min(image.width, int((right + pad) * scale)),
            min(image.height, int((page_height - bottom + pad) * scale)),
        ))
        pixels = list(crop.getdata())
        if not pixels:
            return 0.0
        colored = sum(
            (red >= 180 and green >= 140 and blue <= 215 and red - blue >= 30 and green - blue >= 15)
            or (green >= 165 and red >= 100 and blue <= 205 and green - red >= 20 and green - blue >= 20)
            for red, green, blue in pixels
        )
        return colored / len(pixels)

    lines = []
    for match in re.finditer(r"[^\n]*(?:\n|$)", text):
        value = match.group(0).rstrip("\r\n")
        if value.strip():
            lines.append((match.start(), value))

    result, occurrences = {}, {}
    for question_index, question in enumerate(questions):
        number = question[1]
        occurrences[number] = occurrences.get(number, 0) + 1
        block_end = questions[question_index + 1].start() if question_index + 1 < len(questions) else len(text)
        candidates = []
        for line_start, line in lines:
            if line_start < question.end() or line_start >= block_end:
                continue
            tokens = list(_OPTION_TOKEN.finditer(line))
            if tokens:
                candidates.extend((line_start, line, token) for token in tokens)

        # Ignore question-stem abbreviations such as "C. difficile" by only
        # considering options after the first A label in the question block.
        first_a = next((index for index, (_start, _line, token) in enumerate(candidates)
                        if (token.group(1) or token.group(2)).upper() == "A"), None)
        if first_a is None:
            continue
        candidates = candidates[first_a:]

        # A scientific name like "C. difficile" can resemble a choice label.
        # If that letter is repeated as a standalone option later, keep the
        # containing source line intact and discard the abbreviation boundary.
        standalone_later = {}
        for index, (line_start, line, token) in enumerate(candidates):
            label = (token.group(1) or token.group(2)).upper()
            if _OPTION_START.match(line):
                standalone_later.setdefault(label, []).append(index)
        filtered = []
        for index, candidate in enumerate(candidates):
            line_start, line, token = candidate
            label = (token.group(1) or token.group(2)).upper()
            token_is_line_start = not line[:token.start()].strip()
            if not token_is_line_start and any(later > index for later in standalone_later.get(label, [])):
                continue
            filtered.append(candidate)
        labels = [(token.group(1) or token.group(2)).upper() for _start, _line, token in filtered]
        if not labels or len(labels) != len(set(labels)) or set(labels) != set("ABCDEFGH"[:len(labels)]):
            continue

        fractions = []
        for index, (line_start, line, token) in enumerate(filtered):
            end = filtered[index + 1][2].start() if index + 1 < len(filtered) and filtered[index + 1][0] == line_start else len(line)
            segment = line[token.start():end]
            fractions.append((labels[index], highlight_fraction(segment, line_start + token.start())))
        marked = [label for label, fraction in fractions if fraction >= 0.18]
        if len(marked) == 1:
            result[(number, occurrences[number])] = marked[0]

    image.close()
    return result


def _rect_distance(first, second):
    dx = max(0, first[0] - second[2], second[0] - first[2])
    dy = max(0, first[1] - second[3], second[1] - first[3])
    return (dx * dx + dy * dy) ** 0.5


def _image_data_url(image_object, bounds, page_area):
    width, height = bounds[2] - bounds[0], bounds[3] - bounds[1]
    # Ignore tiny decorative images and full-page scans; those are not figures.
    if width < 38 or height < 38 or width * height > page_area * 0.4:
        return None
    bitmap = image_object.get_bitmap()
    image = bitmap.to_pil().convert("RGB")

    for dimensions, quality in (((420, 420), 68), ((360, 360), 58), ((280, 280), 50)):
        candidate = image.copy()
        candidate.thumbnail(dimensions, Image.Resampling.LANCZOS)
        output = BytesIO()
        try:
            candidate.save(output, format="WEBP", quality=quality, method=5)
            mime = "image/webp"
        except (OSError, ValueError):
            output = BytesIO()
            candidate.save(output, format="JPEG", quality=quality, optimize=True)
            mime = "image/jpeg"
        payload = output.getvalue()
        if len(payload) <= 30_000:
            return f"data:{mime};base64,{base64.b64encode(payload).decode('ascii')}"
    raise QuestionnaireError("A PDF figure is too large to attach. Select fewer pages or upload a smaller copy.")


def _read_page_images(page, textpage, text, has_previous_question=False):
    import pypdfium2 as pdfium

    page_width, page_height = page.get_size()
    image_objects = []
    for image_object in page.get_objects(filter=[pdfium.raw.FPDF_PAGEOBJ_IMAGE]):
        bounds = image_object.get_bounds()
        data_url = _image_data_url(image_object, bounds, page_width * page_height)
        if data_url:
            image_objects.append({"bounds": bounds, "data": data_url})

    lines = []
    for match in re.finditer(r"[^\n]*(?:\n|$)", text):
        line = match.group(0).rstrip("\r\n")
        if not line.strip():
            continue
        figure = _FIGURE.search(line)
        lines.append({
            "start": match.start(), "text": line,
            "bounds": _line_bounds(textpage, line, match.start()),
            "figure_bounds": _line_bounds(textpage, line[figure.start():figure.end()], match.start() + figure.start()) if figure else None,
        })

    question_anchors = []
    matches = list(_QUESTION_START.finditer(text))
    for position, match in enumerate(matches):
        try:
            box = textpage.get_charbox(match.start(1))
        except Exception:
            box = None
        if not box:
            continue
        end = matches[position + 1].start() if position + 1 < len(matches) else len(text)
        block = text[match.start():end]
        stem = re.split(r"(?m)^\s*(?:\([A-Ha-h]\)|[A-Ha-h][.)])\s+", block, maxsplit=1)[0]
        question_anchors.append({
            "line_start": text.rfind("\n", 0, match.start()) + 1,
            "x": (box[0] + box[2]) / 2,
            "y": (box[1] + box[3]) / 2,
            "references_image": bool(re.search(r"\b(?:image|figure|shown|pictured|smear|slide|photograph)\b", stem, re.I)),
        })

    markers_after_question = {}
    leading_markers = []
    for image_object in image_objects:
        if not question_anchors:
            if has_previous_question:
                leading_markers.append(image_object["data"])
            else:
                leading_markers.append(image_object["data"])
            continue
        center_x = (image_object["bounds"][0] + image_object["bounds"][2]) / 2
        closest_x = min(abs(anchor["x"] - center_x) for anchor in question_anchors)
        same_column = [anchor for anchor in question_anchors if abs(anchor["x"] - center_x) <= closest_x + 18]
        image_top, image_bottom = image_object["bounds"][3], image_object["bounds"][1]
        above = [anchor for anchor in same_column if anchor["y"] >= image_top]
        below = [anchor for anchor in same_column if anchor["y"] <= image_bottom]
        if above:
            anchor = min(above, key=lambda item: item["y"] - image_top)
            markers_after_question.setdefault(anchor["line_start"], []).append(image_object["data"])
            continue
        if below and not (has_previous_question and not below[0]["references_image"]):
            anchor = min(below, key=lambda item: image_bottom - item["y"])
            markers_after_question.setdefault(anchor["line_start"], []).append(image_object["data"])
            continue
        if has_previous_question:
            leading_markers.append(image_object["data"])
            continue
        anchor = min(same_column or question_anchors, key=lambda item: abs(item["y"] - ((image_top + image_bottom) / 2)))
        markers_after_question.setdefault(anchor["line_start"], []).append(image_object["data"])

    output, skipping_caption = [], False
    for line in lines:
        value = line["text"]
        figure = _FIGURE.search(value)
        if figure:
            # Keep a choice that PDF text extraction placed after its figure
            # caption on the same line, while removing the caption itself.
            trailing = value[figure.end():]
            option = re.search(r"(?i)(?<![A-Za-z])(?:\([A-H]\)|[A-H][.)])\s+\S", trailing)
            if option:
                output.append(trailing[option.start():].strip())
            skipping_caption = True
            continue

        if skipping_caption:
            if not (_QUESTION_START.match(value) or _OPTION_START.match(value) or re.match(r"(?i)^\s*(?:Answer|Ans)\s*[:=]", value)):
                continue
            skipping_caption = False

        bounds = line["bounds"]
        if bounds and not (_QUESTION_START.match(value) or _OPTION_START.match(value)):
            characters = [character for character in value if not character.isspace()]
            inside = 0
            for offset, character in enumerate(value):
                if character.isspace():
                    continue
                try:
                    box = textpage.get_charbox(line["start"] + offset)
                except Exception:
                    continue
                if not box:
                    continue
                x = (box[0] + box[2]) / 2
                y = (box[1] + box[3]) / 2
                if any(image["bounds"][0] <= x <= image["bounds"][2] and image["bounds"][1] <= y <= image["bounds"][3] for image in image_objects):
                    inside += 1
            if characters and inside / len(characters) >= 0.65:
                continue
        output.append(value)
        if line["start"] in markers_after_question:
            output.extend(f"[PDF_IMAGE: {data}]" for data in markers_after_question[line["start"]])

    return "\n".join(output), leading_markers


def extract_pdf_questionnaire(raw, reader, page_indices, include_skipped=False):
    import pypdfium2 as pdfium

    segments = []
    skipped_pages = []
    has_previous_question = False
    with _pdfium_lock:
        document = pdfium.PdfDocument(raw)
        try:
            for index in page_indices:
                page = document[index]
                textpage = page.get_textpage()
                try:
                    original = textpage.get_text_bounded()
                    page_width, page_height = page.get_size()
                    has_page_scan = any(
                        (bounds := image.get_bounds()) and (bounds[2] - bounds[0]) * (bounds[3] - bounds[1]) > page_width * page_height * .4
                        for image in page.get_objects(filter=[pdfium.raw.FPDF_PAGEOBJ_IMAGE])
                    )
                    if has_page_scan and not _QUESTION_START.search(original):
                        skipped_pages.append(f"PDF page {index + 1}")
                        continue
                    text, leading_markers = _read_page_images(page, textpage, original, has_previous_question)
                    if leading_markers:
                        text = "\n".join(f"[PDF_IMAGE: {data}]" for data in leading_markers) + "\n" + text
                    label = f"PDF page {index + 1}"
                    keys = _flattened_highlight_keys(page, textpage, original)
                    for reference in reader.pages[index].get("/Annots", []):
                        annotation = reference.get_object()
                        if annotation.get("/Subtype") != "/Highlight":
                            continue
                        points = list(annotation.get("/QuadPoints", []))
                        if len(points) < 8 or len(points) % 8:
                            continue
                        selected, first_index = [], None
                        for offset in range(0, len(points), 8):
                            quad = [float(value) for value in points[offset:offset + 8]]
                            left, right = min(quad[::2]), max(quad[::2])
                            bottom, top = min(quad[1::2]), max(quad[1::2])
                            selected.append(textpage.get_text_bounded(left, bottom, right, top).strip())
                            if first_index is None:
                                first_index = textpage.get_index(left + min(2, (right - left) / 2), (top + bottom) / 2, 4, 4)
                        if first_index is None:
                            continue
                        prefix = original[:first_index]
                        starts = list(_QUESTION_START.finditer(prefix))
                        if not starts:
                            continue
                        question = starts[-1]
                        value = " ".join(part for part in selected if part)
                        labeled = OPTION.match(value)
                        if not labeled and not any(_OPTION_START.match(line.strip()) for line in prefix[question.start():].splitlines()[1:]):
                            continue
                        key = (labeled[1] or labeled[2]).upper() if labeled else value
                        if not key:
                            raise QuestionnaireError("A highlighted PDF answer could not be read. Add a written answer key for that question.")
                        number = question[1]
                        occurrence = (number, sum(match[1] == number for match in starts))
                        if occurrence in keys and keys[occurrence] != key:
                            raise QuestionnaireError(f"Question {number} has multiple highlighted answers. Use one clear correct answer or supply a written key.")
                        keys[occurrence] = key

                    starts = list(_QUESTION_START.finditer(text))
                    seen, insertions = {}, []
                    for position, match in enumerate(starts):
                        number = match[1]
                        seen[number] = seen.get(number, 0) + 1
                        key = keys.get((number, seen[number]))
                        if not key:
                            continue
                        end = starts[position + 1].start() if position + 1 < len(starts) else len(text)
                        # Put the verified key after the whole question block so
                        # wrapped choice text (for example the second line of C)
                        # remains attached to its option instead of the answer.
                        insertions.append((end, f"\nAnswer: {key}\n"))
                    for insertion, value in reversed(insertions):
                        text = text[:insertion] + value + text[insertion:]
                    if text.strip():
                        segments.append((label, text))
                    if _QUESTION_START.search(original):
                        has_previous_question = True
                finally:
                    textpage.close()
                    page.close()
        finally:
            document.close()
    text = "\n\n".join(f"[SOURCE: {label}]\n{content}" for label, content in segments)
    result = (text, [label for label, _ in segments])
    return (*result, skipped_pages) if include_skipped else result
