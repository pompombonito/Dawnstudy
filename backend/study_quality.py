"""Shared question-quality rules for every generation format and provider."""
import re


QUESTION_QUALITY_INSTRUCTIONS = (
    "Test knowledge of the subject, not the layout or contents list of the source. "
    "Every question must make sense without opening the original document. "
    "Never ask which item is listed, mentioned, shown, or found on a particular page, "
    "slide, chapter, table, or in the uploaded material; never ask for page numbers, "
    "file names, or document navigation. Put page/slide citations only in source_refs, "
    "never in the question or answer choices. For example, 'Which antiviral agent is "
    "listed on page 465?' is unacceptable. Instead test a specific property, mechanism, "
    "distinction, or application explicitly supported by the source. If the source only "
    "contains a list, test a meaningful supported definition or relationship, or choose "
    "another concept; do not invent facts to turn a list into a clinical scenario. "
    "For single-answer questions, confirm that exactly one option satisfies the entire "
    "stem. Do not use a broad category question when two options belong to that category. "
    "At medium/hard difficulty, prefer plausible options from the same conceptual "
    "category; distinguish them using a supported property rather than unrelated items."
)

_LOCATION = re.compile(
    r"\b(?:pages?|slides?|chapters?|sections?|tables?|figures?|paragraphs?|appendi(?:x|ces)|"
    r"pp?\.)\s*(?:no\.?\s*|number\s*|#\s*)?(?:\d+[a-z]?|[ivxlcdm]+)\b",
    re.IGNORECASE,
)
_SOURCE_LOOKUP = re.compile(
    r"\b(?:which|what|name|identify|list)\b.{0,200}?"
    r"\b(?:listed|mentioned|named|found|shown|included|appears?|presented|printed)\b"
    r".{0,80}?\b(?:material|document|slides?|textbook|handout|pdf|presentation|reading|source)\b",
    re.IGNORECASE,
)
_NAVIGATION = re.compile(
    r"\b(?:which|what|how many|give|name|identify)\s+(?:is\s+the\s+|the\s+)?"
    r"(?:pages?|slides?|chapters?|sections?|file\s*names?|page\s+numbers?)\b"
    r".{0,100}?\b(?:contains?|discuss(?:es)?|covers?|mentions?|lists?|shows?|describes?|"
    r"document|material|uploaded|file|pdf|presentation)\b",
    re.IGNORECASE,
)


def is_source_lookup_question(question: str) -> bool:
    """Catch explicit source-location trivia, without banning topic references.

    A reference such as 'Chapter 4' belongs in source_refs even when the rest of
    the stem is useful. Reject and refill it rather than stripping text in a way
    that could change the question's meaning or correct answer.
    """
    text = re.sub(r"\s+", " ", question).strip()
    return bool(_LOCATION.search(text) or _SOURCE_LOOKUP.search(text) or _NAVIGATION.search(text))
