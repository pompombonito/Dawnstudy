"""Lossless questionnaire import. Models may fill gaps, never rewrite source text."""
import re


class QuestionnaireError(ValueError):
    pass


QUESTION = re.compile(r"^(?:Q(?:uestion)?\s*)?(\d+)[.) :]\s*(\S.*)$", re.I)
QA = re.compile(r"^(?:Q|Question)\s*:\s*(\S.*)$", re.I)
OPTION = re.compile(r"^(?:\(([A-Ha-h])\)|([A-Ha-h])[.)])\s+(.+)$")
ANSWER = re.compile(r"^(?:Correct\s+answer|Answer|Ans|A)\s*[:=]\s*(.*)$", re.I)
KEY_HEADING = re.compile(r"^(?:answer\s*key|answers|key\s+to\s+answers)\s*:?(.*)$", re.I)
SOURCE = re.compile(r"^\[SOURCE: (.+)\]$")


def docx_questionnaire_text(document):
    """Include tables in document order; retain common Word list numbering."""
    parts, counter = [], 0
    for block in document.iter_inner_content():
        if hasattr(block, "text"):
            text = block.text.strip()
            if not text:
                continue
            if KEY_HEADING.match(text):
                counter = 0
            if block.style and block.style.name.startswith("List Number") and not QUESTION.match(text):
                counter += 1
                text = f"{counter}. {text}"
            parts.append(text)
        else:
            rows = [[cell.text.strip() for cell in row.cells] for row in block.rows]
            if not rows:
                continue
            headers = [value.casefold() for value in rows[0]]
            if "question" in headers:
                for row in rows[1:]:
                    question = row[headers.index("question")]
                    if not question:
                        if any(row):
                            raise QuestionnaireError("A questionnaire table has an answer or choices but no question.")
                        continue
                    parts.append(question if QUESTION.match(question) else "Q: " + question)
                    for index, header in enumerate(headers):
                        if header in list("abcdefgh") and row[index]:
                            parts.append(f"{header.upper()}. {row[index]}")
                    for answer_header in ("answer", "correct answer"):
                        if answer_header in headers and row[headers.index(answer_header)]:
                            parts.append("Answer: " + row[headers.index(answer_header)])
            else:
                for row in rows:
                    if len(row) == 2 and row[0].isdigit():
                        parts.append(f"{row[0]}. {row[1]}")
                    else:
                        parts.extend(value for value in row if value)
    return "\n".join(parts)


def _normalized(text):
    return re.sub(r"\s+", " ", text).strip().casefold()


def resolve_answer(raw, options, labels):
    """Resolve an answer key without editing the actual option text."""
    if not options:
        return raw
    letter = re.fullmatch(r"\(?([A-Ha-h])\)?[.)]?", raw.strip())
    if letter and letter[1].upper() in labels:
        return options[labels.index(letter[1].upper())]
    for option in options:
        if _normalized(raw) == _normalized(option):
            return option
    # Accept 'B. mitochondrion' only if the label AND its text agree.
    labeled = OPTION.match(raw)
    if labeled:
        label = (labeled[1] or labeled[2]).upper()
        if label in labels and _normalized(labeled[3]) == _normalized(options[labels.index(label)]):
            return options[labels.index(label)]
    raise QuestionnaireError(f"Answer key {raw!r} does not identify exactly one choice. Correct the key before importing.")


def parse_questionnaire(documents, limit=200):
    """Read numbered questions or Q:/A: blocks and optional numbered answer keys.

    Numbering/choice labels are structure; all question, option and answer wording
    stays intact. Ambiguous layouts fail rather than becoming invented questions.
    """
    records, keys, current, source = [], {}, None, ""

    def put_key(number, value):
        if not value.strip():
            raise QuestionnaireError(f"Answer key {number} is empty.")
        if number in keys and keys[number] != value.strip():
            raise QuestionnaireError(f"Conflicting answer keys for question {number}.")
        keys[number] = value.strip()

    for document in documents:
        current, in_key = None, False
        # Split same-line choices only at explicit labels; preserve their order.
        for raw_line in document.splitlines():
            line = raw_line.strip()
            if not line:
                continue
            marker = SOURCE.match(line)
            if marker:
                source = marker[1]
                continue
            heading = KEY_HEADING.match(line)
            if heading:
                in_key, current = True, None
                line = heading[1].strip()
                if not line:
                    continue
            if in_key:
                # Supports key columns such as '1. B  2. C', including one-letter answers.
                entries = list(re.finditer(r"(?:^|\s+)(\d+)\s*[.):=\-]\s*", line))
                if not entries:
                    raise QuestionnaireError("Use numbered answer keys, for example: 1. B or 2. Mitochondrion.")
                for index, match in enumerate(entries):
                    end = entries[index + 1].start() if index + 1 < len(entries) else len(line)
                    put_key(match[1], line[match.end():end])
                continue
            numbered, qa = QUESTION.match(line), QA.match(line)
            if numbered or qa:
                number = numbered[1] if numbered else str(len(records) + 1)
                question = numbered[2] if numbered else qa[1]
                current = {"number": number, "question": question, "options": [], "labels": [], "answer": "", "source_refs": [source] if source else []}
                records.append(current)
                if len(records) > limit:
                    raise QuestionnaireError(f"This questionnaire has more than {limit} questions. Select fewer pages or split it into smaller files; nothing was imported.")
                # Numbered question can also have choices on the same line.
                line = question
                inline = re.search(r"\s+(?=\(?[Aa][.)]\s+)", line)
                if inline:
                    current["question"] = line[:inline.start()].rstrip()
                    line = line[inline.end():]
                else:
                    inline_answer = re.search(r"\s+(?:Correct\s+answer|Answer|Ans)\s*[:=]\s*", question, re.I)
                    if inline_answer:
                        current["question"] = question[:inline_answer.start()].rstrip()
                        current["answer"] = question[inline_answer.end():].strip()
                    continue
            if current is None:
                # Titles/instructions before the first numbered question aren't items.
                continue
            if current["options"] and re.match(r"^[-–—]\s+", line):
                current["commentary"] = True
                continue
            answer = ANSWER.match(line)
            if answer:
                value = answer[1].strip()
                if current["answer"] and current["answer"] != value:
                    raise QuestionnaireError(f"Conflicting answers for question {current['number']}.")
                current["answer"] = value
                continue
            option = OPTION.match(line)
            if option:
                inline_answer = re.search(r"\s+(?:Correct\s+answer|Answer|Ans)\s*[:=]\s*", line, re.I)
                if inline_answer:
                    value = line[inline_answer.end():].strip()
                    if current["answer"] and current["answer"] != value:
                        raise QuestionnaireError(f"Conflicting answers for question {current['number']}.")
                    current["answer"] = value
                    line = line[:inline_answer.start()].rstrip()
                parts = re.split(r"\s+(?=\([A-Ha-h]\)\s+|[A-Ha-h][.)]\s+)", line)
                for part in parts:
                    match = OPTION.match(part)
                    label = (match[1] or match[2]).upper()
                    if label in current["labels"]:
                        raise QuestionnaireError(f"Repeated choice {label} in question {current['number']}. Put each question on its own numbered line.")
                    current["labels"].append(label)
                    current["options"].append(match[3])
                current["commentary"] = False
                continue
            if current.get("commentary"):
                continue
            if current["answer"]:
                current["answer"] += "\n" + line
            elif current["options"]:
                current["options"][-1] += "\n" + line
            else:
                current["question"] += "\n" + line

    if not records:
        raise QuestionnaireError("No questions were recognized. Use numbered questions (1. Question), A./B./C./D. choices, and Answer: text or a numbered Answer key section. Scanned PDFs need OCR first.")
    numbers = [item["number"] for item in records]
    if len(set(numbers)) != len(numbers):
        raise QuestionnaireError("Question numbers repeat. Use unique numbers across the uploaded questionnaire so answer keys cannot match the wrong question.")
    if set(keys) - set(numbers):
        raise QuestionnaireError("The answer key refers to questions outside this upload. Include their pages or remove the unmatched key entries.")
    for item in records:
        options, labels = item["options"], item["labels"]
        if options and (len(options) < 2 or set(labels) != set("ABCDEFGH"[:len(options)])):
            raise QuestionnaireError(f"Question {item['number']} has missing choices or unreadable labels. Make sure every choice from A onward is readable, or upload a clearer copy.")
        if options:
            # OCR often reads two columns as A,C,B,D. Match text to its printed
            # label before resolving answer keys, so 'Both A and B' stays valid.
            pairs = sorted(zip(labels, options))
            item["labels"] = labels = [label for label, _ in pairs]
            item["options"] = options = [option for _, option in pairs]
        if len({_normalized(option) for option in options}) != len(options):
            raise QuestionnaireError(f"Question {item['number']} has duplicate choices; fix them before importing.")
        explicit = item["answer"] if not re.fullmatch(r"[_\s.\-]+", item["answer"]) else ""
        raw_key = keys.get(item["number"], "")
        key = raw_key if not re.fullmatch(r"[_\s.\-]+", raw_key) else ""
        if explicit and key and _normalized(resolve_answer(explicit, options, labels)) != _normalized(resolve_answer(key, options, labels)):
            raise QuestionnaireError(f"Conflicting answers for question {item['number']}.")
        item["answer"] = resolve_answer(explicit or key, options, labels) if explicit or key else ""
    return records


def validate_completion(records, payload, choice_mode):
    """Reject omissions, changed source answers, duplicate distractors and wrong keys."""
    entries = payload.get("items") if isinstance(payload, dict) else None
    if not isinstance(entries, list) or len(entries) != len(records):
        raise QuestionnaireError("The model did not complete every question.")
    by_number = {}
    for entry in entries:
        if not isinstance(entry, dict) or str(entry.get("number")) in by_number:
            raise QuestionnaireError("The model returned invalid question identifiers.")
        by_number[str(entry.get("number"))] = entry
    completed = {}
    for record in records:
        entry = by_number.get(record["number"], {})
        answer = entry.get("answer")
        if entry.get("question") != record["question"] or not isinstance(answer, str) or not answer.strip() or entry.get("uncertain") is not False:
            raise QuestionnaireError(f"An answer for question {record['number']} could not be established. Supply an answer key and retry.")
        if record["answer"] and answer != record["answer"]:
            raise QuestionnaireError("The model changed a supplied answer.")
        if record["options"] and answer not in record["options"]:
            raise QuestionnaireError("The inferred answer is not one of the original options.")
        distractors = entry.get("distractors", [])
        if choice_mode and not record["options"]:
            if not isinstance(distractors, list) or len(distractors) != 3 or any(not isinstance(value, str) or not value.strip() for value in distractors):
                raise QuestionnaireError("The model did not supply three usable distractors.")
            if len({_normalized(value) for value in [answer, *distractors]}) != 4:
                raise QuestionnaireError("Generated choices contain duplicate answers.")
        completed[record["number"]] = {"answer": answer, "distractors": distractors}
    return completed


def convert_questionnaire(records, study_format, completions):
    items = []
    for record in records:
        inferred = not bool(record["answer"])
        completion = completions.get(record["number"], {})
        answer = record["answer"] or completion.get("answer", "")
        if not answer:
            raise QuestionnaireError(f"Supply an answer for question {record['number']}.")
        item = {"question": record["question"], "answer": answer, "source_refs": record["source_refs"], "imported": True, "answer_origin": "inferred" if inferred else "provided"}
        notices = []
        if inferred:
            notices.append("AI-inferred answer: no answer key was supplied. Review it for accuracy.")
        if study_format in {"multiple_choice", "checkbox"}:
            options = record["options"][:]
            if not options:
                options = [answer, *completion["distractors"]]
                # Vary new answer placement deterministically; original choices never move.
                offset = len(items) % 4
                options = options[offset:] + options[:offset]
                notices.append("Choices added by AI. Review them for accuracy.")
            item.update(options=options, correct_answer=answer)
        item["explanation"] = " ".join(notices)
        items.append(item)
    return items
