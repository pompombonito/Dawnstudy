"""Select document pages and source excerpts before applying the model context cap."""
import re
import unicodedata


_PAGE_SELECTION_HELP = 'Enter "All pages", or page numbers such as 1-5, 8, 12-15.'
_ALL_PAGES = {
    "", "*", "all", "all page", "all pages", "all slide", "all slides", "allpages", "allslides",
    "every page", "every slide", "everything", "all of the pages", "all of the slides",
    *{f"{scope} {document}" for scope in ("entire", "whole", "full")
      for document in ("document", "file", "presentation", "pdf", "deck")},
}
_PAGE_PREFIX = r"(?:(?:pages?|slides?|pp?)\.?\s*:?\s*)?"
_PAGE_RANGE = re.compile(rf"{_PAGE_PREFIX}(\d+)\s*(?:(?:-|to)\s*{_PAGE_PREFIX}(\d+))?")
_DASHES = str.maketrans({dash: "-" for dash in "\u00ad\u2010\u2011\u2012\u2013\u2014\u2212"})


def selected_pages(expression: str, total: int) -> list[int]:
    if not isinstance(expression, str):
        raise ValueError(_PAGE_SELECTION_HELP)
    expression = unicodedata.normalize("NFKC", expression).translate(_DASHES).strip().casefold()
    # Only recognize an all-pages phrase when it describes the entire input;
    # mixed or unrecognized instructions must not silently broaden the scope.
    all_pages = " ".join(re.sub(r"[-_]+", " ", expression).split()).strip(".,; ")
    if not expression or (all_pages and all_pages in _ALL_PAGES):
        return list(range(total))
    pages = set()
    for part in re.split(r"[,;\r\n\u2028\u2029]+", expression):
        part = part.strip()
        if not part:
            continue
        match = _PAGE_RANGE.fullmatch(part)
        if not match:
            raise ValueError(_PAGE_SELECTION_HELP)
        start, end = int(match[1]), int(match[2] or match[1])
        if start < 1 or end < start or end > total:
            raise ValueError(f"Page range must be between 1 and {total}.")
        pages.update(range(start - 1, end))
    if not pages:
        raise ValueError(_PAGE_SELECTION_HELP)
    return sorted(pages)


def focus_excerpt(text: str, topic: str, maximum: int) -> str:
    blocks = re.split(r"(?=\[SOURCE: )", text)
    chunks = []
    for block in blocks:
        label = re.match(r"\[SOURCE: [^\]]+\]", block)
        prefix = label.group(0) + "\n" if label else ""
        body = block[len(prefix.strip()):] if label else block
        for offset in range(0, len(body), 1800):
            chunk = prefix + body[offset:offset + 1800]
            chunks.append(chunk)
    if topic.strip():
        normalized_topic = re.sub(r"[^\w]+", " ", topic.casefold()).strip()
        terms = set(re.findall(r"\w{2,}", normalized_topic)) - {
            "the", "and", "for", "with", "from", "about", "into", "this", "that", "what",
        }
        scores = []
        for chunk in chunks:
            normalized_chunk = re.sub(r"[^\w]+", " ", chunk.casefold())
            phrase_score = 1000 if normalized_topic and normalized_topic in normalized_chunk else 0
            term_score = sum(normalized_chunk.count(term) for term in terms)
            scores.append(phrase_score + term_score)
        if any(scores):
            phrase_matches = [index for index, score in enumerate(scores) if score >= 1000]
            if phrase_matches:
                ranked = phrase_matches
            else:
                minimum_matches = max(1, (len(terms) + 1) // 2)
                ranked = [index for index, score in enumerate(scores) if score >= minimum_matches]
                ranked.sort(key=lambda index: (-scores[index], index))
                if not ranked:
                    raise ValueError("The requested topic or chapter was not found in the selected material. Try its exact heading or choose its page range.")
        else:
            raise ValueError("The requested topic or chapter was not found in the selected material. Try its exact heading or choose its page range.")
    else:
        if len(text) <= maximum:
            return text
        # Sample across every file/page, instead of silently discarding all later files.
        ranked = []
        left, right = 0, len(chunks) - 1
        while left <= right:
            ranked.append(left)
            if right != left:
                ranked.append(right)
            left += 1
            right -= 1
    chosen, length = [], 0
    for index in ranked:
        if length + len(chunks[index]) > maximum:
            continue
        chosen.append(index)
        length += len(chunks[index]) + 2
    return "\n\n".join(chunks[index] for index in sorted(chosen))[:maximum]
