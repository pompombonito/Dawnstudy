"""Extract bounded learning-material figures with source-specific context."""
from io import BytesIO

from PIL import Image, ImageOps

from questionnaire_ocr import image_data_url

_MIN_DISPLAY_EMU = 411480  # 0.45 inches: exclude tiny logos/bullets.


def _figure_data(blob, displayed_width, displayed_height, crop=(0, 0, 0, 0)):
    if min(displayed_width, displayed_height) < _MIN_DISPLAY_EMU:
        return None
    try:
        with Image.open(BytesIO(blob)) as original:
            image = ImageOps.exif_transpose(original).convert("RGB")
            try:
                width, height = image.size
                left, top, right, bottom = crop
                bounds = (max(0, round(width*left)), max(0, round(height*top)),
                          min(width, round(width*(1-right))), min(height, round(height*(1-bottom))))
                if min(bounds[2]-bounds[0], bounds[3]-bounds[1]) < 48:
                    return None
                with image.crop(bounds) as cropped:
                    return image_data_url(cropped)
            finally:
                image.close()
    except (OSError, ValueError):
        # Unsupported embedded vectors still contribute their surrounding text.
        return None


def _pptx_figures(raw, page_indices=None):
    from pptx import Presentation
    from pptx.enum.shapes import MSO_SHAPE_TYPE

    presentation = Presentation(BytesIO(raw))
    figures = []

    def flattened(shapes):
        for shape in shapes:
            if shape.shape_type == MSO_SHAPE_TYPE.GROUP:
                yield from flattened(shape.shapes)
            else:
                yield shape

    selected = set(page_indices) if page_indices is not None else None
    for number, slide in enumerate(presentation.slides, 1):
        if selected is not None and number - 1 not in selected:
            continue
        shapes = list(flattened(slide.shapes))
        text_shapes = [shape for shape in shapes if getattr(shape, "has_text_frame", False) and shape.text.strip()]
        ordinal = 0
        for shape in shapes:
            if not hasattr(shape, "image"):
                continue
            data = _figure_data(shape.image.blob, shape.width, shape.height,
                                (shape.crop_left, shape.crop_top, shape.crop_right, shape.crop_bottom))
            if not data:
                continue
            ordinal += 1
            def distance(other):
                dx = max(0, other.left-(shape.left+shape.width), shape.left-(other.left+other.width))
                dy = max(0, other.top-(shape.top+shape.height), shape.top-(other.top+other.height))
                return dx*dx + dy*dy
            nearby = sorted(text_shapes, key=distance)[:6]
            context = "\n".join(other.text.strip() for other in nearby)
            figures.append({"id": f"pptx-slide-{number}-figure-{ordinal}", "source_ref": f"PowerPoint slide {number}",
                            "context": context[:1800], "data_url": data})
            if len(figures) >= 24:
                return figures
    return figures


def _docx_figures(raw):
    from docx import Document
    from docx.oxml.ns import qn

    document = Document(BytesIO(raw))
    paragraphs = list(document.element.body.iter(qn("w:p")))
    texts = ["".join(node.text or "" for node in paragraph.iter(qn("w:t"))).strip() for paragraph in paragraphs]
    figures = []
    for position, paragraph in enumerate(paragraphs):
        for blip in paragraph.iter(qn("a:blip")):
            relationship = blip.get(qn("r:embed"))
            if not relationship or relationship not in document.part.related_parts:
                continue
            drawing = blip
            while drawing is not None and drawing.tag not in {qn("wp:inline"), qn("wp:anchor")}:
                drawing = drawing.getparent()
            if drawing is None:
                continue
            extent = drawing.find(qn("wp:extent"))
            if extent is None:
                continue
            rect = next(drawing.iter(qn("a:srcRect")), None)
            crop = tuple(float(rect.get(key, 0))/100000 for key in ("l", "t", "r", "b")) if rect is not None else (0, 0, 0, 0)
            data = _figure_data(document.part.related_parts[relationship].blob,
                                int(extent.get("cx", 0)), int(extent.get("cy", 0)), crop)
            if not data:
                continue
            context = "\n".join(value for value in texts[max(0, position-2):position+3] if value)
            figures.append({"id": f"docx-figure-{len(figures)+1}", "source_ref": "Document", "context": context[:1800], "data_url": data})
            if len(figures) >= 24:
                return figures
    return figures


def extract_embedded_figures(filename, raw, page_indices=None):
    """Return IDs/context separately from bounded raster data for model selection."""
    suffix = filename.rsplit(".", 1)[-1].casefold()
    if suffix == "pptx":
        return _pptx_figures(raw, page_indices)
    if suffix == "docx":
        return _docx_figures(raw)
    return []
