"""Extract questionnaire text, highlighted keys, and question figures from PDFs."""
import re
import threading
import hashlib
import random

from PIL import Image

from questionnaire import OPTION, QuestionnaireError, parse_questionnaire
from questionnaire_ocr import image_data_url, ocr_questionnaire_image, ocr_learning_image, ocr_cancellation

# PDFium is not thread-safe. Generation workers may import PDFs concurrently.
_pdfium_lock = threading.RLock()
_QUESTION_START = re.compile(r"(?m)^[ \t]*(?:Q(?:uestion)?\s*)?(\d+)[.)]\s*\S", re.I)
_OPTION_START = re.compile(r"(?m)^[ \t]*(?:\([A-Ha-h]\)|[A-Ha-h][.)])\s+\S")
_OPTION_TOKEN = re.compile(r"(?i)(?<![A-Za-z])(?:\(([A-H])\)|([A-H])[.)])\s+\S")
_FIGURE = re.compile(r"\bFIGURE\s+\d+(?:[-.]\d+)*\b", re.I)


def _clean_pdf_text(text):
    """Remove extraction-only soft-wrap/control glyphs before saving question text."""
    text = text.replace("\x02", "").replace("\u00ad", "").replace("\ufffd", "")
    text = text.replace("\u200b", "").replace("\u2060", "").replace("\ufeff", "")
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)


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


def _image_data_url(image_object, bounds, page_area, maximum_area=.4):
    width, height = bounds[2] - bounds[0], bounds[3] - bounds[1]
    # Ignore tiny decorative images and full-page scans; those are not figures.
    if width < 38 or height < 38 or width * height > page_area * maximum_area:
        return None
    bitmap = image_object.get_bitmap()
    # get_bitmap exposes a PDFium-owned buffer. Conversion copies its pixels;
    # let its buffer finalizer release the foreign bitmap instead of explicitly
    # closing a handle that PIL may still reference.
    image = bitmap.to_pil().convert("RGB")
    try:
        result = image_data_url(image)
    finally:
        image.close()
    if result:
        return result
    raise QuestionnaireError("A PDF figure is too large to attach. Select fewer pages or upload a smaller copy.")


def extract_pdf_figures(raw, page_indices, limit=96):
    """Return bounded native figures with stable IDs and nearby source context.

    Caller supplies IDs/context to the model and attaches data_url only when the
    generated question explicitly selects that figure ID. This prevents every
    figure on a source page from being attached to every question on that page.
    """
    import pypdfium2 as pdfium

    figures = []
    seen_images = set()
    seen_count = 0
    sampling = random.Random(0)

    def keep(figure):
        nonlocal seen_count
        digest = hashlib.sha256(figure["data_url"].encode()).digest()
        if digest in seen_images:
            return
        seen_images.add(digest)
        seen_count += 1
        if len(figures) < limit:
            figures.append(figure)
        else:
            position = sampling.randrange(seen_count)
            if position < limit:
                figures[position] = figure
    with _pdfium_lock:
        document = pdfium.PdfDocument(raw)
        try:
            for index in page_indices:
                if ocr_cancellation.get():
                    ocr_cancellation.get()()
                page = document[index]
                textpage = page.get_textpage()
                try:
                    text = textpage.get_text_bounded()
                    lines = [(match[0].strip(), _line_bounds(textpage, match[0], match.start()))
                             for match in re.finditer(r"[^\n]+", text) if match[0].strip()]
                    page_width, page_height = page.get_size()
                    number = 0
                    has_scan = False
                    for obj in page.get_objects(filter=[pdfium.raw.FPDF_PAGEOBJ_IMAGE]):
                        bounds = obj.get_bounds()
                        has_scan = has_scan or ((bounds[2]-bounds[0])*(bounds[3]-bounds[1]) > page_width*page_height*.4)
                        data = _image_data_url(obj, bounds, page_width * page_height, maximum_area=.98)
                        if not data:
                            continue
                        number += 1
                        nearby = sorted(((value, box) for value, box in lines if box), key=lambda item: _rect_distance(item[1], bounds))[:10]
                        keep({"id": f"pdf-p{index + 1}-figure-{number}", "page": index + 1,
                                        "source_ref": f"PDF page {index + 1}",
                                        "context": _clean_pdf_text("\n".join(value for value, _box in nearby))[:1800],
                                        "data_url": data})
                        if number >= 3:
                            break
                    if (has_scan or number == 0) and len(text.strip()) < 150:
                        bitmap = page.render(scale=min(2.5, 2600/max(page_width, page_height)))
                        image = bitmap.to_pil().convert("RGB")
                        bitmap.close()
                        scanned = []
                        try:
                            _text, scanned = ocr_learning_image(image, include_images=True)
                            for ordinal, figure in enumerate(scanned, 1):
                                keep({**figure, "id": f"pdf-p{index+1}-scan-figure-{ordinal}",
                                                "page": index+1, "source_ref": f"PDF page {index+1}"})
                        except (ImportError, RuntimeError):
                            pass
                        finally:
                            if number == 0 and not scanned:
                                data = image_data_url(image)
                                if data:
                                    keep({"id": f"pdf-p{index+1}-visual-page", "page": index+1,
                                          "source_ref": f"PDF page {index+1}", "context": _clean_pdf_text(text)[:1800], "data_url": data})
                            image.close()
                finally:
                    textpage.close()
                    page.close()
        finally:
            document.close()
    return sorted(figures, key=lambda figure: (figure.get("page", 0), figure["id"]))


def extract_pdf_learning_material(raw, reader, page_indices, include_skipped=False):
    """Read native PDF study text first and OCR image-only pages when needed."""
    import pypdfium2 as pdfium

    segments, skipped = [], []
    with _pdfium_lock:
        document = None
        try:
            for index in page_indices:
                text = _clean_pdf_text(reader.pages[index].extract_text() or "")
                if len(re.sub(r"\s+", "", text)) >= 40:
                    segments.append((f"PDF page {index+1}", text))
                    continue
                if document is None:
                    document = pdfium.PdfDocument(raw)
                page = document[index]
                try:
                    width, height = page.get_size()
                    bitmap = page.render(scale=min(2.5, 2600/max(width, height)))
                    image = bitmap.to_pil().convert("RGB")
                    bitmap.close()
                    try:
                        recognized, _figures = ocr_learning_image(image)
                        text = _clean_pdf_text(recognized)
                    except (ImportError, RuntimeError):
                        text = ""
                    finally:
                        image.close()
                    if len(re.sub(r"\s+", "", text)) < 20:
                        skipped.append(f"PDF page {index+1}")
                    else:
                        segments.append((f"PDF page {index+1}", text))
                finally:
                    page.close()
        finally:
            if document is not None:
                document.close()
    result = ("\n\n".join(f"[SOURCE: {label}]\n{text}" for label, text in segments), [label for label, _ in segments])
    return (*result, skipped) if include_skipped else result


def _image_question_context(stem):
    # Native PDF object order can place every figure caption after the final
    # question. Those captions are not references made by that question.
    stem = re.split(r"(?im)^\s*(?:FIGURE\s+\d+(?:[-.]\d+)*\b)", stem, maxsplit=1)[0]
    stem = re.split(r"(?m)^\s*(?:\([A-Ha-h]\)|[A-Ha-h][.)])\s+", stem, maxsplit=1)[0]
    above = bool(re.search(r"\babove\b|\bpreceding\s+(?:image|figure|picture|photograph)\b", stem, re.I))
    below = bool(re.search(r"\bbelow\b|\bfollowing\s+(?:image|figure|picture|photograph)\b", stem, re.I))
    deictic_visual = bool(re.search(r"\b(?:this|these)\b[^?]{1,100}\b(?:describ\w*|identif\w*|appear\w*|look\w*)\b", stem, re.I))
    observed_visual = bool(re.search(r"\bfollowing\s+(?:is|are|was|were)\s+observed\b", stem, re.I))
    return {
        "references_image": deictic_visual or observed_visual or bool(re.search(r"\b(?:image|figure|shown|pictured|depicted|illustrated|demonstrated|smear|slide|photograph|micrograph|diagram|plate|gram[- ]stain)\b", stem, re.I)),
        "image_position": "above" if above and not below else "below" if below and not above else None,
        "figure_labels": {re.sub(r"\s+", " ", match.group()).casefold() for match in _FIGURE.finditer(stem)},
    }


def _last_image_question(text):
    matches = list(_QUESTION_START.finditer(text))
    return _image_question_context(text[matches[-1].start():]) if matches else None


def _image_markers(image):
    markers = [f"[PDF_IMAGE: {image['data']}]"]
    if image.get("caption"):
        markers.append(f"[PDF_IMAGE_CAPTION: {image['caption']}]")
    return markers


def _attach_continuation_images(segments, images, source):
    """Bind a next-page figure inside the owning previous question's block.

    Putting it before the next page's first question is insufficient: a printed
    chapter heading/footer may have ended the parser's current question. Insert
    after the actual question anchor instead, retaining the figure's real page.
    """
    if not segments:
        return False
    owner = next(((index, label, content, questions)
                  for index in range(len(segments)-1, -1, -1)
                  for label, content in [segments[index]]
                  if (questions := list(_QUESTION_START.finditer(content)))), None)
    if owner is None:
        return False
    index, label, content, questions = owner
    end = content.find("\n", questions[-1].start())
    if end < 0:
        end = len(content)
    markers = "\n".join(marker for image in images for marker in _image_markers(image))
    insertion = f"\n[SOURCE: {source}]\n{markers}\n[SOURCE: {label}]"
    segments[index] = (label, content[:end] + insertion + content[end:])
    return True


def _read_page_images(page, textpage, text, has_previous_question=False, previous_question=None):
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
            "figure_label": re.sub(r"\s+", " ", figure.group()).capitalize() if figure and _FIGURE.match(line.lstrip()) else None,
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
        question_anchors.append({
            "line_start": text.rfind("\n", 0, match.start()) + 1,
            "x": (box[0] + box[2]) / 2,
            "y": (box[1] + box[3]) / 2,
            **_image_question_context(block),
        })

    # PDFium can merge two independent captions on a shared horizontal line.
    # Keep each label's own glyph bounds so columns do not share one caption.
    caption_labels = []
    for line in lines:
        if not line["figure_label"]:
            continue
        for figure in _FIGURE.finditer(line["text"]):
            box = _line_bounds(textpage, figure.group(), line["start"] + figure.start())
            if box:
                caption_labels.append({"label": re.sub(r"\s+", " ", figure.group()).capitalize(),
                                       "bounds": box})

    markers_after_question = {}
    leading_markers = []
    for image_object in image_objects:
        # Captions are located geometrically: PDF object/text order often puts
        # all captions at the end of the page, in a different order than images.
        bounds = image_object["bounds"]
        captions = [caption for caption in caption_labels
                    if min(bounds[2], caption["bounds"][2]) > max(bounds[0], caption["bounds"][0])
                    and _rect_distance(bounds, caption["bounds"]) <= 45]
        if captions:
            caption = min(captions, key=lambda item: _rect_distance(bounds, item["bounds"]))
            image_object["caption"] = caption["label"]
        label = image_object.get("caption", "").casefold()
        explicit = [anchor for anchor in question_anchors if label and label in anchor["figure_labels"]]
        if explicit:
            for anchor in explicit:
                markers_after_question.setdefault(anchor["line_start"], []).append(image_object)
            if previous_question and label in previous_question["figure_labels"]:
                leading_markers.append(image_object)
            continue
        if previous_question and label and label in previous_question["figure_labels"]:
            leading_markers.append(image_object)
            continue
        if not question_anchors:
            if previous_question and previous_question["references_image"]:
                leading_markers.append(image_object)
            continue
        center_x = (image_object["bounds"][0] + image_object["bounds"][2]) / 2
        closest_x = min(abs(anchor["x"] - center_x) for anchor in question_anchors)
        same_column = [anchor for anchor in question_anchors if abs(anchor["x"] - center_x) <= closest_x + 18]
        image_top, image_bottom = image_object["bounds"][3], image_object["bounds"][1]
        above = [anchor for anchor in same_column if anchor["y"] >= image_top]
        below = [anchor for anchor in same_column if anchor["y"] <= image_bottom]
        preceding = min(above, key=lambda item: item["y"] - image_top) if above else None
        following = min(below, key=lambda item: image_bottom - item["y"]) if below else None
        # "Shown above" explicitly identifies a preceding illustration even
        # when an unrelated earlier question shares that column.
        if following and following["image_position"] == "above":
            markers_after_question.setdefault(following["line_start"], []).append(image_object)
            continue
        if preceding and preceding["references_image"] and preceding["image_position"] != "above":
            markers_after_question.setdefault(preceding["line_start"], []).append(image_object)
            continue
        # A figure at the top of a continuation page belongs to the pending
        # image question from the previous page. A new question saying "below"
        # cannot own a figure positioned above its stem.
        if (not preceding and previous_question and previous_question["references_image"]
                and previous_question["image_position"] != "above"):
            leading_markers.append(image_object)
            continue
        if following and following["references_image"] and following["image_position"] != "below":
            markers_after_question.setdefault(following["line_start"], []).append(image_object)
        # Orphan figures (for example when the source question was outside the
        # selected page range) are omitted rather than attached to a wrong card.

    output, skipping_caption = [], False
    for line in lines:
        value = line["text"]
        bounds = line["bounds"]
        at_page_edge = bounds and (bounds[3] >= page_height * .93 or bounds[1] <= page_height * .07)
        numbered_chapter_header = re.match(
            r"(?i)^\s*(?:\d+\s+(?:CHAPTER|UNIT|SECTION)\s+\d+\b|(?:CHAPTER|UNIT|SECTION)\s+\d+\b.*\s\d+\s*$)", value)
        if at_page_edge and numbered_chapter_header:
            continue
        # Figure references are part of question wording. Only a standalone
        # caption beginning with "Figure N" should be removed.
        figure = _FIGURE.match(value.lstrip())
        if figure:
            # Keep a choice that PDF text extraction placed after its figure
            # caption on the same line, while removing the caption itself.
            trailing = value.lstrip()[figure.end():]
            option = re.search(r"(?i)(?<![A-Za-z])(?:\([A-H]\)|[A-H][.)])\s+\S", trailing)
            if option:
                output.append(trailing[option.start():].strip())
            skipping_caption = True
            continue

        if skipping_caption:
            if not (_QUESTION_START.match(value) or _OPTION_START.match(value) or re.match(r"(?i)^\s*(?:Answer|Ans)\s*[:=]", value)):
                continue
            skipping_caption = False

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
            for image in markers_after_question[line["start"]]:
                output.extend(_image_markers(image))

    return "\n".join(output), leading_markers


def extract_pdf_questionnaire(raw, reader, page_indices, include_skipped=False):
    import pypdfium2 as pdfium

    segments = []
    skipped_pages = []
    has_previous_question = False
    previous_question, previous_index = None, None
    with _pdfium_lock:
        document = pdfium.PdfDocument(raw)
        try:
            for index in page_indices:
                if previous_index is not None and index != previous_index + 1:
                    has_previous_question, previous_question = False, None
                previous_index = index
                page = document[index]
                textpage = page.get_textpage()
                try:
                    original = textpage.get_text_bounded()
                    page_width, page_height = page.get_size()
                    image_bounds = [image.get_bounds() for image in page.get_objects(filter=[pdfium.raw.FPDF_PAGEOBJ_IMAGE])]
                    has_page_scan = any((box[2]-box[0])*(box[3]-box[1]) > page_width*page_height*.4 for box in image_bounds)
                    has_native_figure = any(box[2]-box[0] >= 38 and box[3]-box[1] >= 38
                                            and (box[2]-box[0])*(box[3]-box[1]) <= page_width*page_height*.4
                                            for box in image_bounds)
                    if not _QUESTION_START.search(original) and (has_page_scan or (len(original.strip()) < 50 and not has_native_figure)):
                        # Native extraction cannot read image-only pages. OCR
                        # locally, keeping the source page and visible keys.
                        scale = min(2.5, 2600 / max(page_width, page_height))
                        bitmap = page.render(scale=scale)
                        image = bitmap.to_pil().convert("RGB")
                        bitmap.close()
                        try:
                            text = _clean_pdf_text(ocr_questionnaire_image(image))
                            if _QUESTION_START.search(text):
                                # Reject structurally damaged OCR instead of
                                # guessing missing choices into a quiz.
                                parse_questionnaire([text])
                            elif not (has_previous_question and _OPTION_START.search(text)):
                                raise QuestionnaireError("No readable questionnaire items on this scanned page.")
                            segments.append((f"PDF page {index + 1}", text))
                            has_previous_question = has_previous_question or bool(_QUESTION_START.search(text))
                            previous_question = _last_image_question(text) or previous_question
                        except (ImportError, RuntimeError, QuestionnaireError):
                            skipped_pages.append(f"PDF page {index + 1}")
                            previous_question = None
                        finally:
                            image.close()
                        continue
                    text, leading_markers = _read_page_images(page, textpage, original, has_previous_question, previous_question)
                    label = f"PDF page {index + 1}"
                    if leading_markers:
                        _attach_continuation_images(segments, leading_markers, label)
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
                        # Keep the original string intact until text-position
                        # based highlight and figure extraction is complete.
                        # Then strip PDFium's soft-wrap marker so mid-word boxes
                        # such as "laborato▤ry" become readable text.
                        segments.append((label, _clean_pdf_text(text)))
                    if _QUESTION_START.search(original):
                        has_previous_question = True
                        previous_question = _last_image_question(original)
                finally:
                    textpage.close()
                    page.close()
        finally:
            document.close()
    text = "\n\n".join(f"[SOURCE: {label}]\n{content}" for label, content in segments)
    result = (text, [label for label, _ in segments])
    return (*result, skipped_pages) if include_skipped else result
