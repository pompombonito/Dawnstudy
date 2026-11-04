"""Read native PDF highlight annotations as questionnaire answer keys."""
import re
import threading

from questionnaire import OPTION, QuestionnaireError

# PDFium is not thread-safe. Generation workers may import PDFs concurrently.
_pdfium_lock = threading.RLock()


def extract_pdf_questionnaire(raw, reader, page_indices):
    import pypdfium2 as pdfium

    segments = []
    with _pdfium_lock:
        document = pdfium.PdfDocument(raw)
        try:
            for index in page_indices:
                page = document[index]
                textpage = page.get_textpage()
                try:
                    text = textpage.get_text_bounded().replace("\r\n", "\n")
                    label = f"PDF page {index + 1}"
                    keys = {}
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
                        prefix = textpage.get_text_range(index=0, count=first_index).replace("\r\n", "\n")
                        starts = list(re.finditer(r"(?m)^\s*(?:Q(?:uestion)?\s*)?(\d+)[.) :]\s*\S", prefix, re.I))
                        if not starts:
                            continue
                        question = starts[-1]
                        value = " ".join(part for part in selected if part)
                        labeled = OPTION.match(value)
                        # Ignore highlighted titles/stems. Full option labels or
                        # an option section before the selection identify a key.
                        if not labeled and not any(OPTION.match(line.strip()) for line in prefix[question.start():].splitlines()[1:]):
                            continue
                        key = (labeled[1] or labeled[2]).upper() if labeled else value
                        if not key:
                            raise QuestionnaireError("A highlighted PDF answer could not be read. Add a written answer key for that question.")
                        number = question[1]
                        occurrence = (number, sum(match[1] == number for match in starts))
                        if occurrence in keys and keys[occurrence] != key:
                            raise QuestionnaireError(f"Question {number} has multiple highlighted answers. Use one clear correct answer or supply a written key.")
                        keys[occurrence] = key
                    # Attach a highlight to its actual question occurrence,
                    # rather than a global printed number that may restart.
                    starts = list(re.finditer(r"(?m)^[ \t]*(?:Q(?:uestion)?\s*)?(\d+)[.) :]\s*\S", text, re.I))
                    seen, insertions = {}, []
                    for position, match in enumerate(starts):
                        number = match[1]
                        seen[number] = seen.get(number, 0) + 1
                        key = keys.get((number, seen[number]))
                        if not key:
                            continue
                        end = starts[position + 1].start() if position + 1 < len(starts) else len(text)
                        block = text[match.start():end]
                        choice = re.search(r"(?m)^[ \t]*(?:\([A-Ha-h]\)|[A-Ha-h][.)])\s+\S", block)
                        insertion = match.start() + choice.start() if choice else end
                        insertions.append((insertion, f"\nAnswer: {key}\n"))
                    for insertion, value in reversed(insertions):
                        text = text[:insertion] + value + text[insertion:]
                    if text.strip():
                        segments.append((label, text))
                finally:
                    textpage.close()
                    page.close()
        finally:
            document.close()
    text = "\n\n".join(f"[SOURCE: {label}]\n{content}" for label, content in segments)
    return text, [label for label, _ in segments]
