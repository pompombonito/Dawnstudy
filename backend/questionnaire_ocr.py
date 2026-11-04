"""Recover questionnaire structure and yellow answer keys from image OCR."""
import csv
import re
from collections import defaultdict
from io import StringIO
from PIL import Image, ImageChops


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


def questionnaire_text_from_tsv(tsv, highlight_mask):
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
    ordered = sorted(lines.values(), key=lambda words: (min(word["top"] for word in words), min(word["left"] for word in words)))
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
