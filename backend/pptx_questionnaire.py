"""Keep slide questions, supplied rationales and their native pictures together."""
import re
from io import BytesIO

from PIL import Image
from questionnaire import QuestionnaireError
from questionnaire_ocr import image_data_url

QUESTION_START = re.compile(r"(?im)^\s*(?:(?:Question|Q)\s*:\s*|(?:Q(?:uestion)?\s*)?\d+[.)]\s*)\S")
VISUAL = re.compile(r"\b(?:image|figure|shown|diagram|photograph|picture|above|below)\b", re.I)


def _table_text(table):
    rows = [[cell.text.strip() for cell in row.cells] for row in table.rows]
    if not rows:
        return ""
    headers = [value.casefold().rstrip('.:') for value in rows[0]]
    question = next((i for i, value in enumerate(headers) if value in {"question", "questions", "prompt", "stem"}), None)
    if question is None:
        return "\n".join(value for row in rows for value in row if value)
    output = []
    for row in rows[1:]:
        if not any(row):
            continue
        if not row[question]:
            raise QuestionnaireError("A questionnaire slide table contains choices without a question.")
        output.append(row[question] if QUESTION_START.match(row[question]) else "Q: " + row[question])
        for i, header in enumerate(headers):
            if header in "abcdefgh" and len(header) == 1 and row[i]:
                output.append(header.upper() + ". " + row[i])
        for i, header in enumerate(headers):
            if header in {"answer", "correct answer", "key"} and row[i]:
                output.append("Answer: " + row[i])
        for i, header in enumerate(headers):
            if header in {"explanation", "rationale", "reason", "side notes", "solution"} and row[i]:
                output.append("Explanation: " + row[i])
    return "\n".join(output)


def _slide_shapes(shapes, transform=(0, 0, 1, 1)):
    ox, oy, sx, sy = transform
    for shape in shapes:
        left, top = ox + shape.left * sx, oy + shape.top * sy
        width, height = shape.width * sx, shape.height * sy
        if hasattr(shape, "shapes"):
            xfrm = shape._element.grpSpPr.xfrm
            child_x = xfrm.chOff.x if xfrm.chOff is not None else 0
            child_y = xfrm.chOff.y if xfrm.chOff is not None else 0
            child_w = xfrm.chExt.cx if xfrm.chExt is not None and xfrm.chExt.cx else shape.width
            child_h = xfrm.chExt.cy if xfrm.chExt is not None and xfrm.chExt.cy else shape.height
            scale_x, scale_y = width / max(1, child_w), height / max(1, child_h)
            yield from _slide_shapes(shape.shapes, (left - child_x * scale_x, top - child_y * scale_y, scale_x, scale_y))
        else:
            yield shape, (left, top, width, height)


def extract_pptx_questionnaire(presentation, page_indices):
    pages = []
    for index in page_indices:
        texts, pictures = [], []
        for shape, (left, top, width, height) in _slide_shapes(presentation.slides[index].shapes):
            value = _table_text(shape.table) if getattr(shape, "has_table", False) else shape.text.replace("\v", "\n").strip() if getattr(shape, "has_text_frame", False) else ""
            if value:
                texts.append({"text": value, "left": left, "top": top, "width": width, "height": height, "pictures": []})
            if hasattr(shape, "image") and width > presentation.slide_width * .035 and height > presentation.slide_height * .035:
                pictures.append((shape, (left, top, width, height)))
        anchors = [item for item in texts if QUESTION_START.search(item["text"])]
        columns = []
        for left in sorted(item["left"] for item in anchors):
            if not columns or left - columns[-1] > presentation.slide_width * .18:
                columns.append(left)

        def column(left):
            return max((i for i, start in enumerate(columns) if left >= start - presentation.slide_width * .04), default=0)

        for shape, (left, top, width, height) in pictures:
            same_column = [anchor for anchor in anchors if column(anchor["left"]) == column(left)]
            above = [anchor for anchor in same_column if anchor["top"] <= top + height * .15]
            owner = max(above, key=lambda anchor: anchor["top"], default=None)
            if owner is None:
                # A picture preceding its question needs an explicit visual
                # reference; page decorations are never given to every item.
                below = [anchor for anchor in same_column if VISUAL.search(anchor["text"])
                         and anchor["top"] >= top and anchor["top"] - top - height < presentation.slide_height * .15]
                owner = min(below, key=lambda anchor: anchor["top"], default=None)
            if owner is None:
                continue
            if len(QUESTION_START.findall(owner["text"])) > 1:
                if VISUAL.search(owner["text"]):
                    raise QuestionnaireError("A slide image could belong to several questions in one text box. Put each image question in its own text box or export the slide as a PDF.")
                continue
            # Small brand marks below a finished text-only question are not
            # evidence. Pictures in the question area, or explicitly referenced
            # by the stem, remain attached to that question alone.
            if not VISUAL.search(owner["text"]) and top > owner["top"] + owner["height"] and width * height < presentation.slide_width * presentation.slide_height * .035:
                continue
            try:
                with Image.open(BytesIO(shape.image.blob)) as image:
                    data = image_data_url(image)
            except Exception as exc:
                raise QuestionnaireError("A questionnaire slide picture could not be read. Export that slide as a PDF or PNG.") from exc
            if data:
                owner["pictures"].append(data)
        parts = []
        for item in sorted(texts, key=lambda value: (column(value["left"]), value["top"], value["left"])):
            value = item["text"]
            if item["pictures"]:
                first, separator, rest = value.partition("\n")
                value = first + "\n" + "\n".join("[PDF_IMAGE: " + data + "]" for data in item["pictures"]) + separator + rest
            parts.append(value)
        if parts:
            pages.append((f"PowerPoint slide {index + 1}", "\n".join(parts)))
    return "\n\n".join(f"[SOURCE: {label}]\n{text}" for label, text in pages), [label for label, _ in pages]
