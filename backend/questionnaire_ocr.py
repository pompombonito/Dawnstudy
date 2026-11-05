"""Recover questionnaire structure and yellow answer keys from image OCR."""
import csv
import base64
import re
from collections import defaultdict
from io import StringIO, BytesIO
from PIL import Image, ImageChops, ImageDraw, ImageFilter


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


def _label(text):
    # Copyright-shaped 'c' is a common OCR confusion in lower-case option labels.
    text = text.replace("©.", "c.")
    text = re.sub(r"^([bB])[hH]([.)])", r"\1\2", text)
    match = re.match(r"^(?:\(([A-Ha-h])\)|([A-Ha-h])[.)])\s*(.*)$", text)
    if match:
        return (match[1] or match[2]).upper(), match[3]
    if re.fullmatch(r"[A-Ha-h]", text):
        return text.upper(), ""
    return None


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
    lines = _tsv_lines(tsv)
    ordered = lines if reading_order == "blocks" else sorted(lines, key=lambda words: (min(word["top"] for word in words), min(word["left"] for word in words)))
    output = []
    for words in ordered:
        words.sort(key=lambda word: word["left"])
        first_label = _label(words[0]["text"])
        if not first_label:
            output.append(" ".join(word["text"] for word in words))
            continue
        segments, segment = [], []
        for word in words:
            gap = word["left"] - (segment[-1]["left"] + segment[-1]["width"]) if segment else 0
            if segment and _label(word["text"]) and gap >= max(12, word["height"]):
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
            if fraction >= .18:
                output.append(f"Answer: {label}")
    return "\n".join(output)


def image_data_url(image):
    """Bound stored figure size independently of a scanned page's resolution."""
    for dimensions, quality in (((420, 420), 68), ((360, 360), 58), ((280, 280), 50)):
        with image.copy() as candidate:
            candidate.thumbnail(dimensions, Image.Resampling.LANCZOS)
            output = BytesIO()
            candidate.convert("RGB").save(output, format="WEBP", quality=quality, method=5)
            payload = output.getvalue()
        if len(payload) <= 30_000:
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


def ocr_questionnaire_image(image, include_images=True):
    """OCR a page/image locally, retain visible answer highlights and figure crops."""
    import tessdata
    import tesserocr

    clean, mask = prepare_questionnaire_image(image)
    with tesserocr.PyTessBaseAPI(path=tessdata.data_path(), lang="eng", psm=tesserocr.PSM.AUTO) as ocr:
        ocr.SetImage(clean)
        ocr.Recognize()
        tsv = ocr.GetTSVText(0)
    text = questionnaire_text_from_tsv(tsv, mask, reading_order="blocks")
    if not include_images:
        clean.close()
        mask.close()
        return text

    anchors = []
    for words in _tsv_lines(tsv):
        words.sort(key=lambda word: word["left"])
        line = " ".join(word["text"] for word in words)
        number = re.match(r"\s*(\d+)[.)]\s+\S", line)
        if number:
            anchors.append({"number": number[1], "x": min(word["left"] for word in words),
                            "y": min(word["top"] for word in words), "text": line})
    attached = defaultdict(list)
    # clean and mask can be resized versions of the source image. Use the
    # identical geometry for detected word masks and figure crop coordinates.
    source = image.convert("RGB").resize(clean.size, Image.Resampling.LANCZOS)
    for bounds in scanned_figure_regions(source, tsv):
        center_x, center_y = (bounds[0]+bounds[2])/2, (bounds[1]+bounds[3])/2
        candidates = [anchor for anchor in anchors if anchor["y"] <= bounds[1] + 20]
        if not candidates:
            continue
        anchor = min(candidates, key=lambda item: (abs(item["x"]-center_x) / source.width + abs(item["y"]-center_y) / source.height))
        if abs(anchor["y"]-center_y) > source.height * .45:
            continue
        with source.crop(bounds) as figure:
            data = image_data_url(figure)
        if data:
            attached[anchor["number"]].append(data)
    for number, images in attached.items():
        pattern = re.compile(r"(?m)^(\s*" + re.escape(number) + r"[.)]\s+[^\n]+)$")
        text = pattern.sub(lambda match: match[0] + "\n" + "\n".join(f"[PDF_IMAGE: {data}]" for data in images), text, count=1)
    clean.close()
    mask.close()
    source.close()
    return text


def ocr_learning_image(image, include_images=False):
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
