"""Turn four source-grounded verdicts into a single-choice quiz item."""

from itertools import combinations
import re


STATEMENT_SCHEMA = {
    "type": "array",
    "minItems": 4,
    "maxItems": 4,
    "items": {
        "type": "object",
        "properties": {
            "text": {"type": "string"},
            "is_true": {"type": "boolean"},
            "evidence": {"type": "string"},
        },
        "required": ["text", "is_true", "evidence"],
    },
}


STATEMENT_INSTRUCTIONS = (
    "Create statement-combination questions. In the question field, introduce the specific topic or give a short "
    "scenario that applies to all four statements. Return exactly four distinct, concise, unnumbered statements "
    "about that topic in the statements array. "
    "Include at least one true and one false statement, and use the JSON boolean is_true to record each verdict. "
    "For each statement, include one contiguous verbatim evidence quote of 12 to 240 characters from the course "
    "material or another supplied evidence source. The quote must support a true statement or directly contradict "
    "a false one. Keep statements independently testable and avoid questions that depend on unsupported facts, "
    "omitted context, or trick wording. The app will ask which statements are true and build the answer combinations."
)


_TRUE_QUESTION = "Which statements are true?"
_ASKS_FOR_FALSE = re.compile(r"\b(?:which|what)\b.{0,200}\b(?:false|incorrect|untrue|not (?:true|correct)|except)\b[^?]*\?", re.I)
_ASKS_FOR_TRUE = re.compile(r"\bwhich\b.{0,200}\bstatements?\b.{0,200}\b(?:true|correct|accurate|correctly)\b[^?]*\?", re.I)


def _choice(numbers):
    labels = [str(number) for number in numbers]
    if len(labels) == 1:
        return f"{labels[0]} only"
    return f"{', '.join(labels[:-1])} and {labels[-1]} only"


def _comparison_text(text):
    return re.sub(r"\W+", " ", text.casefold()).strip()


def _option_numbers(correct):
    # Offer two choices of each size so the options don't reveal how many
    # statements are true. Give each statement number at least one appearance.
    numbers = range(1, 5)
    same_size = next(option for option in combinations(numbers, len(correct)) if option != correct)
    other_size = 1 if len(correct) == 2 else 2
    remaining = list(combinations(numbers, other_size))
    options = [correct, same_size]
    for _ in range(2):
        covered = set().union(*options)
        option = max(remaining, key=lambda candidate: (len(set(candidate) - covered), len(set(candidate) & set(correct))))
        options.append(option)
        remaining.remove(option)
    return options


def build_statement_card(item, has_evidence):
    """Check every quote and derive a single answer without trusting option keys."""
    if not isinstance(item, dict) or not isinstance(item.get("question"), str):
        return None
    question = " ".join(item["question"].split())
    statements = item.get("statements")
    if not question or _ASKS_FOR_FALSE.search(question) or not isinstance(statements, list) or len(statements) != 4:
        return None
    if not _ASKS_FOR_TRUE.search(question):
        question = f"{question} {_TRUE_QUESTION}"

    texts, verdicts, evidence_quotes, explanations = [], [], [], []
    for number, statement in enumerate(statements, 1):
        if not isinstance(statement, dict) or not isinstance(statement.get("text"), str):
            return None
        text = re.sub(r"^(?:statement\s+)?[1-4][.)]\s+", "", " ".join(statement["text"].split()), flags=re.I)
        verdict = statement.get("is_true")
        evidence = statement.get("evidence")
        if not text or len(text) > 320 or type(verdict) is not bool:
            return None
        if not isinstance(evidence, str) or not 12 <= len(evidence.strip()) <= 240 or not has_evidence(evidence):
            return None
        if verdict is False and _comparison_text(text) == _comparison_text(evidence):
            return None

        label = "True" if verdict else "False"
        texts.append(text)
        verdicts.append(verdict)
        evidence_quotes.append(evidence.strip())
        explanations.append(f"{number}. {label}. {' '.join(evidence.split())}")

    normalized_texts = {_comparison_text(text) for text in texts}
    correct = tuple(number for number, verdict in enumerate(verdicts, 1) if verdict)
    if len(normalized_texts) != 4 or "" in normalized_texts or not 1 <= len(correct) <= 3:
        return None

    answer = _choice(correct)
    numbered = "\n".join(f"{number}. {text}" for number, text in enumerate(texts, 1))
    return {
        "question": f"{question}\n{numbered}",
        "answer": answer,
        "correct_answer": answer,
        "options": list(map(_choice, _option_numbers(correct))),
        "explanation": "\n".join(explanations),
        "source_evidence": evidence_quotes[0],
        "statement_evidence": evidence_quotes,
        "statement_combinations": True,
        **{key: item[key] for key in ("source_refs", "figure_refs") if key in item},
    }
