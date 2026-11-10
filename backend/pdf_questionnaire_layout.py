"""Read native questionnaire columns while retaining PDF glyph coordinates.

PDF text-object order is not reading order. PDFium may also combine independent
columns on one line. This view separates large physical gaps, orders question
columns left to right, and maps every retained character back to its original
glyph so highlights and figures use the same evidence as the resulting text.
"""
import re


_QUESTION = re.compile(r"\s*(?:Q(?:uestion)?\s*)?\d+(?:[.)]|:\s+)\s*\S", re.I)


class OrderedTextPage:
    def __init__(self, textpage, indices):
        self.textpage = textpage
        self.indices = indices
        self.reverse = {original: index for index, original in enumerate(indices) if original is not None}

    def get_charbox(self, index):
        original = self.indices[index]
        return self.textpage.get_charbox(original) if original is not None else None

    def get_index(self, *args):
        original = self.textpage.get_index(*args)
        if original is None or original < 0:
            return original
        for distance in range(4):
            for candidate in (original + distance, original - distance):
                if candidate in self.reverse:
                    return self.reverse[candidate]
        return -1

    def get_text_bounded(self, *args, **kwargs):
        return self.textpage.get_text_bounded(*args, **kwargs)


def ordered_questionnaire_text(textpage, text, page_width):
    fragments = []

    def keep(start, end):
        while start < end and text[start].isspace():
            start += 1
        while end > start and text[end - 1].isspace():
            end -= 1
        if start >= end:
            return
        boxes = []
        for index in range(start, end):
            if text[index].isspace():
                continue
            try:
                box = textpage.get_charbox(index)
            except Exception:
                box = None
            if box:
                boxes.append(box)
        if not boxes:
            return
        bounds = (min(box[0] for box in boxes), min(box[1] for box in boxes),
                  max(box[2] for box in boxes), max(box[3] for box in boxes))
        fragments.append({"start": start, "end": end, "text": text[start:end], "bounds": bounds})

    for line in re.finditer(r"[^\r\n]+", text):
        # Keep running chapter headers whole so the edge-noise filter can
        # recognize their page number even when the PDF uses distant runs.
        if re.search(r"\b(?:CHAPTER|UNIT|SECTION)\s+\d+\b", line.group(), re.I):
            keep(line.start(), line.end())
            continue
        start, previous = line.start(), None
        for index in range(line.start(), line.end()):
            if text[index].isspace():
                continue
            try:
                box = textpage.get_charbox(index)
            except Exception:
                box = None
            if not box:
                continue
            if previous and box[0] - previous[2] > 18:
                keep(start, index)
                start = index
            previous = box
        keep(start, line.end())

    anchors = sorted(fragment["bounds"][0] for fragment in fragments if _QUESTION.match(fragment["text"]))
    columns = []
    for x in anchors:
        if not columns or x - columns[-1][-1] > page_width * .18:
            columns.append([x])
        else:
            columns[-1].append(x)
    if len(columns) < 2:
        return text, textpage
    starts = [sum(values) / len(values) for values in columns]

    def column(fragment):
        left, _bottom, right, _top = fragment["bounds"]
        index = max((index for index, x in enumerate(starts) if left >= x - 20), default=0)
        # Text spanning an established column boundary is a page/section
        # heading, not another line in the first question's stem.
        if index < len(starts) - 1 and right > starts[index + 1] - 10:
            return None
        return index

    body, spanning = [], []
    for fragment in fragments:
        index = column(fragment)
        fragment["column"] = index
        (spanning if index is None else body).append(fragment)

    def order_band(values):
        return sorted(values, key=lambda fragment: (fragment["column"], -fragment["bounds"][3], fragment["bounds"][0]))

    ordered = []
    for heading in sorted(spanning, key=lambda fragment: -fragment["bounds"][3]):
        above = [fragment for fragment in body if fragment["bounds"][3] > heading["bounds"][3] + 2]
        ordered.extend(order_band(above))
        ordered.append(heading)
        body = [fragment for fragment in body if fragment not in above]
    ordered.extend(order_band(body))

    parts, indices = [], []
    for fragment in ordered:
        if parts:
            parts.append("\n")
            indices.append(None)
        parts.append(fragment["text"])
        indices.extend(range(fragment["start"], fragment["end"]))
    return "".join(parts), OrderedTextPage(textpage, indices)
