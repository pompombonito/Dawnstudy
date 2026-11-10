"""Recover questionnaire structure and yellow answer keys from image OCR."""
import csv
import base64
import re
from collections import defaultdict
from io import StringIO, BytesIO
from contextvars import ContextVar
from PIL import Image, ImageChops, ImageDraw, ImageFilter
from typhoon_ocr import extract_image_text, TyphoonOcrUnavailable


ocr_cancellation = ContextVar("ocr_cancellation", default=None)


def prepare_questionnaire_image(image):
    image = image.convert("RGB")
    scale = min(2, 2600 / max(image.size))
    if scale > 1:
        image = image.resize(tuple(round(value * scale) for value in image.size), Image.Resampling.LANCZOS)
    red, green, blue = image.split()
    yellow = ImageChops.darker(red, green)
    bright = yellow.point(lambda value: 255 if value >= 140 else 0)
    saturated = ImageChops.subtract(yellow, blue).point(lambda value: 255 if value >= 45 else 0)
    mask = ImageChops.multiply(bright, saturated)
    # Preserve dark text; remove only the bright highlighter pixels around it.
    clean = Image.composite(Image.new("RGB", image.size, "white"), image, mask)
    return clean, mask


def _label(text, allow_bare=True):
    # Copyright-shaped 'c' is a common OCR confusion in lower-case option labels.
    text = text.replace("©.", "c.")
    text = re.sub(r"^([bB])[hH]([.)])", r"\1\2", text)
    match = re.match(r"^(?:\(([A-Ha-h])\)|([A-Ha-h])[.,)])\s*(.*)$", text)
    if match:
        return (match[1] or match[2]).upper(), match[3]
    if allow_bare and re.fullmatch(r"[A-Ha-h]", text):
        return text.upper(), ""
    return None


def _repair_option_glyphs(lines):
    """Repair label OCR only at measured choice margins and within a sequence.

    This does not supply option text. A digit resembling an A, or a cent sign
    resembling C, must occupy the same margin as other printed choices and
    agree with neighboring labels before it can become a choice boundary.
    """
    lines = [[dict(word) for word in sorted(words, key=lambda word: word["left"])] for words in lines]
    # A faint label can be split into a tiny orphan block and its punctuation
    # beside the actual option text. The orphan is label artwork, not prose
    # continuing a later question in Tesseract's block order.
    lines = [words for words in lines if not (len(words) == 1
             and re.fullmatch(r"[nN][.,)]", words[0]["text"])
             and any(other is not words and other[0]["text"] in {".", "·"}
                     and 0 <= other[0]["left"] - words[0]["left"] <= 24
                     and abs(min(word["top"] for word in other) - words[0]["top"]) <= max(20, words[0]["height"])
                     for other in lines))]
    margins = [words[0]["left"] for words in lines if words and _label(words[0]["text"], allow_bare=False)]

    def aligned(words):
        return words and any(abs(words[0]["left"] - margin) <= max(18, words[0]["height"] * .7) for margin in margins)

    active, previous = False, None
    for index, words in enumerate(lines):
        if not words:
            continue
        token = words[0]["text"]
        if re.fullmatch(r"\d+[.)]", token) and not aligned(words):
            active, previous = True, None
            continue
        if not active:
            continue
        explicit = _label(token, allow_bare=False)
        if explicit:
            previous = explicit[0]
            continue
        if not aligned(words):
            continue
        expected = chr(ord(previous) + 1) if previous else "A"
        if expected > "H":
            continue
        upcoming = []
        for following in lines[index + 1:]:
            next_token = following[0]["text"]
            if re.fullmatch(r"\d+[.)]", next_token) and not aligned(following):
                break
            if aligned(following):
                label = _label(next_token, allow_bare=False)
                if label:
                    upcoming.append(label[0])
                    break
                if re.fullmatch(r"[.·]|[1-8][.,)]?|[nN][.,)]", next_token):
                    upcoming.append(None)
        c_shape = bool(re.fullmatch(r"[<¢€©(oO][.,)]?", token))
        a_shape = bool(re.fullmatch(r"[aA][0o]", token))
        number_or_dot = bool(re.fullmatch(r"[.·]|[1-8][.,)]?|[nN][.,)]", token))
        bare = _label(token)
        confirmed = (c_shape and expected == "C" and (not upcoming or upcoming[-1] == "D"))
        confirmed = confirmed or (a_shape and expected == "A" and upcoming[:1] == ["B"])
        confirmed = confirmed or (number_or_dot and (
            (expected == "A" and upcoming[:1] == ["B"])
            or (expected == "C" and (upcoming[:1] == ["D"] or upcoming == [None]))
            or (expected == "D" and not upcoming)))
        confirmed = confirmed or (bare and bare[0] == expected
                                   and upcoming[:1] == [chr(ord(expected) + 1)])
        if confirmed:
            words[0]["text"] = expected + "."
            previous = expected
    return lines


def _recover_missing_choice_rows(tsv, source):
    """Re-read one measured missing choice line instead of inventing its text.

    A full-page pass can miss a short highlighted option. Only a single-label
    gap between two aligned, recognized neighboring choices is eligible. The
    green channel removes yellow/green highlighter contrast while retaining
    the printed dark text. Local OCR results keep original page coordinates.
    """
    import tessdata
    import tesserocr

    if not tsv.startswith("level\t"):
        tsv = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n" + tsv

    lines = _repair_option_glyphs(_tsv_lines(tsv))
    additions = []
    for index, words in enumerate(lines):
        first = _label(words[0]["text"], allow_bare=False)
        if not first:
            continue
        following = None
        for candidate in lines[index + 1:]:
            if re.fullmatch(r"\d+[.)]", candidate[0]["text"]):
                break
            label = _label(candidate[0]["text"], allow_bare=False)
            if label:
                following = candidate, label[0]
                break
        if not following or ord(following[1]) - ord(first[0]) != 2:
            continue
        after, _label_after = following
        if abs(words[0]["left"] - after[0]["left"]) > 20:
            continue
        top = max(word["top"] + word["height"] for word in words) + 1
        bottom = min(word["top"] for word in after) - 1
        if not 12 <= bottom - top <= min(120, source.height * .05):
            continue
        left = max(0, min(words[0]["left"], after[0]["left"]) - 8)
        other_margins = [row[0]["left"] for row in lines
                         if _label(row[0]["text"], allow_bare=False) and row[0]["left"] > left + source.width * .15]
        right = min(other_margins) - 20 if other_margins else source.width - 10
        if right <= left:
            continue
        with source.getchannel("G") as channel, channel.crop((left, top, right, bottom)) as crop:
            with tesserocr.PyTessBaseAPI(path=tessdata.data_path(), lang="eng", psm=tesserocr.PSM.SINGLE_LINE) as ocr:
                ocr.SetImage(crop)
                ocr.Recognize()
                recognized = _tsv_lines(ocr.GetTSVText(0))
        if len(recognized) != 1 or len(recognized[0]) < 2:
            continue
        recovered = sorted(recognized[0], key=lambda word: word["left"])
        expected = chr(ord(first[0]) + 1)
        recognized_label = _label(recovered[0]["text"], allow_bare=False)
        c_shape = expected == "C" and re.fullmatch(r"[<¢€©(oO][.,)]?", recovered[0]["text"])
        if not ((recognized_label and recognized_label[0] == expected) or c_shape):
            continue
        recovered[0]["text"] = expected + "."
        additions.append((after[0]["left"], after[0]["top"], [
            {**word, "left": word["left"] + left, "top": word["top"] + top}
            for word in recovered]))
        if len(additions) >= 8:
            break
    if not additions:
        return tsv
    rows = list(csv.DictReader(StringIO(tsv), delimiter="\t", quoting=csv.QUOTE_NONE))
    header = list(rows[0])
    result = StringIO()
    writer = csv.DictWriter(result, fieldnames=header, delimiter="\t", lineterminator="\n")
    writer.writeheader()
    pending = list(enumerate(additions, 1))
    for row in rows:
        for ordinal, (left, top, recovered) in list(pending):
            if row.get("level") == "5" and int(row.get("left", -1)) == left and int(row.get("top", -1)) == top:
                for number, word in enumerate(recovered, 1):
                    writer.writerow({**row, **word, "block_num": f"recovered-{ordinal}",
                                     "par_num": 1, "line_num": 1, "word_num": number, "conf": 90})
                pending.remove((ordinal, (left, top, recovered)))
        writer.writerow(row)
    return result.getvalue()


def _tsv_lines(tsv):
    """Keep page rows and explicit choice labels, even in two-column layouts."""
    if not tsv.startswith("level\t"):
        tsv = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n" + tsv
    lines = defaultdict(list)
    for row in csv.DictReader(StringIO(tsv), delimiter="\t", quoting=csv.QUOTE_NONE):
        if row.get("level") != "5" or not (row.get("text") or "").strip():
            continue
        try:
            word = {key: int(row[key]) for key in ("left", "top", "width", "height")}
        except (KeyError, ValueError, TypeError):
            continue
        word["text"] = row["text"].strip()
        lines[tuple(row.get(key) for key in ("page_num", "block_num", "par_num", "line_num"))].append(word)
    return list(lines.values())


def questionnaire_text_from_tsv(tsv, highlight_mask, reading_order="rows"):
    """Keep page rows/choice labels; AUTO OCR can preserve detected column blocks."""
    lines = _repair_option_glyphs(_tsv_lines(tsv))
    ordered = lines if reading_order == "blocks" else sorted(lines, key=lambda words: (min(word["top"] for word in words), min(word["left"] for word in words)))
    output, pending_keys = [], []
    in_question = False
    def flush_keys():
        if pending_keys:
            output.append("Answer: " + " | ".join(dict.fromkeys(pending_keys)))
            pending_keys.clear()
    for words in ordered:
        words.sort(key=lambda word: word["left"])
        raw = " ".join(word["text"] for word in words)
        if re.match(r"\s*(?:Q(?:uestion)?\s*)?\d+[.)]\s+\S", raw, re.I):
            flush_keys()
            in_question = True
        if re.match(r"\s*FIGURE\s+\d+(?:[-.]\d+)*\b", raw, re.I):
            continue
        first_label = _label(words[0]["text"], allow_bare=False)
        if not first_label:
            output.append(raw)
            continue
        segments, segment = [], []
        for word in words:
            gap = word["left"] - (segment[-1]["left"] + segment[-1]["width"]) if segment else 0
            if segment and _label(word["text"], allow_bare=False) and gap >= max(12, word["height"]):
                segments.append(segment)
                segment = []
            segment.append(word)
        if segment:
            segments.append(segment)
        for segment in segments:
            label, remainder = _label(segment[0]["text"])
            text = " ".join([remainder, *[word["text"] for word in segment[1:]]]).strip()
            output.append(f"{label}. {text}")
            left = max(0, min(word["left"] for word in segment))
            top = max(0, min(word["top"] for word in segment))
            right = min(highlight_mask.width, max(word["left"] + word["width"] for word in segment))
            bottom = min(highlight_mask.height, max(word["top"] + word["height"] for word in segment))
            if right <= left or bottom <= top:
                continue
            histogram = highlight_mask.crop((left, top, right, bottom)).histogram()
            fraction = histogram[255] / ((right - left) * (bottom - top))
            if in_question and fraction >= .18:
                pending_keys.append(label)
    flush_keys()
    return "\n".join(output)


def image_data_url(image):
    """Bound stored figure size independently of a scanned page's resolution."""
    for dimensions, quality in (((840, 840), 76), ((640, 640), 68), ((420, 420), 58), ((280, 280), 50)):
        with image.copy() as candidate:
            candidate.thumbnail(dimensions, Image.Resampling.LANCZOS)
            output = BytesIO()
            candidate.convert("RGB").save(output, format="WEBP", quality=quality, method=5)
            payload = output.getvalue()
        if len(payload) <= 60_000:
            return "data:image/webp;base64," + base64.b64encode(payload).decode("ascii")
    return None


def scanned_figure_regions(image, tsv):
    """Find substantial non-text image areas after masking recognized words.

    Keep conservative size/density limits: page borders, text, and whole-page
    screenshots are not useful per-question figures.
    """
    work = image.convert("RGB")
    draw = ImageDraw.Draw(work)
    for words in _tsv_lines(tsv):
        for word in words:
            draw.rectangle((word["left"] - 3, word["top"] - 3,
                            word["left"] + word["width"] + 3, word["top"] + word["height"] + 3), fill="white")
    scale = min(1, 180 / max(image.size))
    reduced = work.convert("L").resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))))
    binary = reduced.point(lambda value: 255 if value < 218 else 0).filter(ImageFilter.MaxFilter(3))
    width, height = binary.size
    pixels = list(binary.getdata())
    # Scanner/page separator rules can connect an unrelated header to a photo.
    # Break very long solid horizontal rules before finding image components.
    for y in range(height):
        if sum(bool(value) for value in pixels[y*width:(y+1)*width]) > width*.72:
            for row in range(max(0, y-1), min(height, y+2)):
                pixels[row*width:(row+1)*width] = [0]*width
    visited, regions = set(), []
    for index, pixel in enumerate(pixels):
        if not pixel or index in visited:
            continue
        pending, component = [index], []
        visited.add(index)
        while pending:
            current = pending.pop()
            component.append(current)
            x, y = current % width, current // width
            for nx, ny in ((x-1, y), (x+1, y), (x, y-1), (x, y+1)):
                other = ny * width + nx
                if 0 <= nx < width and 0 <= ny < height and other not in visited and pixels[other]:
                    visited.add(other)
                    pending.append(other)
        left, right = min(i % width for i in component), max(i % width for i in component) + 1
        top, bottom = min(i // width for i in component), max(i // width for i in component) + 1
        region_width, region_height = (right-left) / scale, (bottom-top) / scale
        fraction = (right-left) * (bottom-top) / (width * height)
        density = len(component) / ((right-left) * (bottom-top))
        aspect = region_width / max(1, region_height)
        if region_width >= 55 and region_height >= max(55, image.height*.045) and .002 <= fraction <= .35 and density >= .2 and .22 <= aspect <= 4.5:
            regions.append((max(0, int(left/scale)-4), max(0, int(top/scale)-4),
                            min(image.width, int(right/scale)+4), min(image.height, int(bottom/scale)+4)))
    work.close()
    return sorted(regions, key=lambda bounds: (bounds[1], bounds[0]))[:12]


def _ocr_questionnaire_image_local(image, include_images=True):
    """OCR a page/image locally, retain visible answer highlights and figure crops."""
    import tessdata
    import tesserocr

    clean, mask = prepare_questionnaire_image(image)
    try:
        with tesserocr.PyTessBaseAPI(path=tessdata.data_path(), lang="eng", psm=tesserocr.PSM.AUTO) as ocr:
            ocr.SetImage(clean)
            ocr.Recognize()
            tsv = ocr.GetTSVText(0)
    except (ImportError, RuntimeError):
        clean.close()
        mask.close()
        raise
    source = image.convert("RGB").resize(clean.size, Image.Resampling.LANCZOS)
    tsv = _recover_missing_choice_rows(tsv, source)
    text = questionnaire_text_from_tsv(tsv, mask, reading_order="blocks")
    if not include_images:
        clean.close()
        mask.close()
        source.close()
        return text

    anchors, captions = [], []
    for words in _repair_option_glyphs(_tsv_lines(tsv)):
        words.sort(key=lambda word: word["left"])
        line = " ".join(word["text"] for word in words)
        number = re.match(r"\s*(\d+)[.)]\s+\S", line)
        if number:
            anchors.append({"number": number[1], "x": min(word["left"] for word in words),
                            "y": min(word["top"] for word in words), "text": line,
                            "ordinal": len(anchors)})
        caption = re.match(r"\s*(FIGURE\s+\d+(?:[-.]\d+)*)\b", line, re.I)
        if caption and anchors:
            captions.append({"label": caption[1].capitalize(), "owner": anchors[-1],
                             "left": min(word["left"] for word in words),
                             "right": max(word["left"] + word["width"] for word in words),
                             "top": min(word["top"] for word in words)})
    attached = defaultdict(list)
    # clean and mask can be resized versions of the source image. Use the
    # identical geometry for detected word masks and figure crop coordinates.
    for bounds in scanned_figure_regions(source, tsv):
        center_x, center_y = (bounds[0]+bounds[2])/2, (bounds[1]+bounds[3])/2
        candidates = [anchor for anchor in anchors if anchor["y"] <= bounds[1] + 20]
        if not candidates:
            continue
        nearby = [caption for caption in captions
                  if min(bounds[2], caption["right"]) > max(bounds[0], caption["left"])
                  and abs(caption["top"] - bounds[3]) <= source.height * .05]
        caption = min(nearby, key=lambda item: abs(item["top"] - bounds[3])) if nearby else None
        anchor = caption["owner"] if caption else min(candidates, key=lambda item: (abs(item["x"]-center_x) / source.width + abs(item["y"]-center_y) / source.height))
        if not caption and abs(anchor["y"]-center_y) > source.height * .45:
            continue
        with source.crop(bounds) as figure:
            data = image_data_url(figure)
        if data:
            attached[anchor["ordinal"]].append((data, caption["label"] if caption else None))
    starts = list(re.finditer(r"(?m)^\s*\d+[.)]\s+[^\n]+", text))
    for ordinal in reversed(range(len(starts))):
        markers = []
        for data, caption in attached.get(ordinal, []):
            markers.append(f"[PDF_IMAGE: {data}]")
            if caption:
                markers.append(f"[PDF_IMAGE_CAPTION: {caption}]")
        if markers:
            end = starts[ordinal].end()
            text = text[:end] + "\n" + "\n".join(markers) + text[end:]
    clean.close()
    mask.close()
    source.close()
    return text


def _ocr_learning_image_local(image, include_images=False):
    """Return ordinary study text and optional non-text figure crops from a scan."""
    import tessdata
    import tesserocr

    clean, mask = prepare_questionnaire_image(image)
    try:
        with tesserocr.PyTessBaseAPI(path=tessdata.data_path(), lang="eng", psm=tesserocr.PSM.AUTO) as ocr:
            ocr.SetImage(clean)
            ocr.Recognize()
            text = ocr.GetUTF8Text().strip()
            tsv = ocr.GetTSVText(0) if include_images else ""
        figures = []
        if include_images:
            source = image.convert("RGB").resize(clean.size, Image.Resampling.LANCZOS)
            try:
                lines = _tsv_lines(tsv)
                for bounds in scanned_figure_regions(source, tsv):
                    def distance(words):
                        left, right = min(word["left"] for word in words), max(word["left"]+word["width"] for word in words)
                        top, bottom = min(word["top"] for word in words), max(word["top"]+word["height"] for word in words)
                        dx = max(0, left-bounds[2], bounds[0]-right)
                        dy = max(0, top-bounds[3], bounds[1]-bottom)
                        return dx*dx + dy*dy
                    context = "\n".join(" ".join(word["text"] for word in words) for words in sorted(lines, key=distance)[:8])
                    with source.crop(bounds) as figure:
                        data = image_data_url(figure)
                    if data:
                        figures.append({"data_url": data, "context": context[:1800]})
            finally:
                source.close()
        return text, figures
    finally:
        clean.close()
        mask.close()


def _readable_questionnaire(text):
    from questionnaire import parse_questionnaire, QuestionnaireError
    try:
        return bool(text.strip()) and bool(parse_questionnaire([text]))
    except QuestionnaireError:
        return False


def _question_blocks(text):
    starts = list(re.finditer(r"(?m)^\s*(\d+)[.)]\s+(.+)$", text))
    return [(match[1], match[2], text[match.start():starts[index+1].start() if index+1 < len(starts) else len(text)])
            for index, match in enumerate(starts)]


def _protect_local_evidence(local, recovered, include_images):
    """Move only exactly matched local evidence, not model-created figure links."""
    from questionnaire import parse_questionnaire
    local_blocks = {}
    for number, stem, block in _question_blocks(local):
        local_blocks.setdefault(number, []).append((stem, block))
    recovered_blocks = _question_blocks(recovered)
    recovered_numbers = {number for number, _, _ in recovered_blocks}
    if set(local_blocks) - recovered_numbers:
        raise RuntimeError("The recovered page is missing a source question. Upload a clearer copy.")
    output = []
    for number, stem, block in recovered_blocks:
        candidates = local_blocks.get(number, [])
        matches_source = len(candidates) == 1 and " ".join(candidates[0][0].split()).casefold() == " ".join(stem.split()).casefold()
        if not matches_source and any(re.search(r"(?im)^\s*Answer:\s*\S", old) for _, old in candidates):
            raise RuntimeError("A recovered question could not be matched to its verified source answer.")
        if matches_source:
            old = candidates[0][1]
            keys = re.findall(r"(?im)^\s*Answer:\s*(\S[^\n]*)", old)
            if keys:
                for key in keys:
                    if re.fullmatch(r"[A-Ha-h]", key):
                        option = re.search(r"(?im)^\s*" + re.escape(key) + r"[.)]\s+([^\n]+)", old)
                        new_option = re.search(r"(?im)^\s*" + re.escape(key) + r"[.)]\s+([^\n]+)", block)
                        if not option or not new_option or option[1].strip() != new_option[1].strip():
                            raise RuntimeError("A recovered choice could not be matched to its verified source answer.")
                block = re.sub(r"(?im)^\s*Answer:[^\n]*\n?", "", block).rstrip() + "\n" + "\n".join("Answer: " + key for key in keys) + "\n"
            if include_images:
                markers = re.findall(r"(?m)^\[PDF_IMAGE(?:_CAPTION)?:[^\n]+\]$", old)
                if markers:
                    first, separator, rest = block.partition("\n")
                    block = first + "\n" + "\n".join(markers) + separator + rest
        output.append(block.strip())
    result = "\n".join(output)
    if not output:
        result = recovered
    if include_images:
        for record in parse_questionnaire([result]):
            if (re.search(r"\b(?:image|figure|shown|pictured|photograph|diagram|micrograph)\b", record["question"], re.I)
                    and not record.get("images")):
                raise RuntimeError("This page's text was recovered, but its question figure could not be positioned reliably. Upload a clearer copy of this page.")
    return result


def ocr_questionnaire_image(image, include_images=True, check_cancel=None):
    """Use remote transcription only when local scan structure cannot be read."""
    check_cancel = check_cancel or ocr_cancellation.get()
    if check_cancel:
        check_cancel()
    local, error = "", None
    try:
        local = _ocr_questionnaire_image_local(image, include_images)
    except (ImportError, RuntimeError) as exc:
        error = exc
    if check_cancel:
        check_cancel()
    if _readable_questionnaire(local):
        return local
    try:
        recovered = extract_image_text(image, check_cancel=check_cancel)
    except TyphoonOcrUnavailable:
        recovered = None
    if recovered and _readable_questionnaire(recovered):
        return _protect_local_evidence(local, recovered, include_images)
    if error:
        raise RuntimeError("Local OCR is unavailable and the optional Typhoon reader could not recover this page.") from error
    return local


def ocr_learning_image(image, include_images=False, check_cancel=None):
    """Recover scan text while retaining only locally measured figure crops."""
    check_cancel = check_cancel or ocr_cancellation.get()
    if check_cancel:
        check_cancel()
    local, figures, error = "", [], None
    try:
        local, figures = _ocr_learning_image_local(image, include_images)
    except (ImportError, RuntimeError) as exc:
        error = exc
    if check_cancel:
        check_cancel()
    if len("".join(local.split())) >= 40:
        return local, figures
    try:
        recovered = extract_image_text(image, check_cancel=check_cancel)
    except TyphoonOcrUnavailable:
        recovered = None
    if recovered:
        return recovered, figures
    if error:
        raise RuntimeError("Local OCR is unavailable and the optional Typhoon reader could not recover this page.") from error
    return local, figures
