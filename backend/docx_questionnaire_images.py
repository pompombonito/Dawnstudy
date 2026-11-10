"""Read Word paragraph text and native pictures in their original XML order."""
from io import BytesIO

from docx.oxml.ns import qn
from PIL import Image


def paragraph_questionnaire_text(paragraph):
    # Import lazily: questionnaire parsing is also used by OCR validation.
    from questionnaire import QuestionnaireError
    from questionnaire_ocr import image_data_url

    output = []
    for node in paragraph._p.iter():
        if node.tag == qn("w:t"):
            output.append(node.text or "")
        elif node.tag == qn("w:tab"):
            output.append("\t")
        elif node.tag in {qn("w:br"), qn("w:cr")}:
            output.append("\n")
        elif node.tag in {qn("a:blip"), "{urn:schemas-microsoft-com:vml}imagedata"}:
            reference = node.get(qn("r:embed")) or node.get(qn("r:id"))
            if not reference:
                raise QuestionnaireError("A linked Word question image is unavailable. Embed the picture in the document before importing.")
            try:
                part = paragraph.part.related_parts[reference]
                with Image.open(BytesIO(part.blob)) as image:
                    data = image_data_url(image)
            except Exception as exc:
                raise QuestionnaireError("A Word question image could not be read. Use an embedded PNG or JPEG, or export the document as a PDF.") from exc
            if not data:
                raise QuestionnaireError("A Word question image could not be attached within the supported size.")
            output.append("\n[PDF_IMAGE: " + data + "]\n")
    return "".join(output).strip()


def cell_questionnaire_text(cell):
    return "\n".join(value for paragraph in cell.paragraphs
                     if (value := paragraph_questionnaire_text(paragraph)))
