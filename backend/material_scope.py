"""Select document pages and source excerpts before applying the model context cap."""
import re


def selected_pages(expression: str, total: int) -> list[int]:
    if not expression.strip():
        return list(range(total))
    pages = set()
    for part in expression.split(","):
        match = re.fullmatch(r"\s*(\d+)\s*(?:-\s*(\d+)\s*)?", part)
        if not match:
            raise ValueError("Use page numbers such as 1-5, 8, 12-15.")
        start, end = int(match[1]), int(match[2] or match[1])
        if start < 1 or end < start or end > total:
            raise ValueError(f"Page range must be between 1 and {total}.")
        pages.update(range(start - 1, end))
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
