"""Lossless questionnaire import. Models may fill gaps, never rewrite source text."""
import re
import unicodedata


class QuestionnaireError(ValueError):
    pass


QUESTION = re.compile(r"^(?:Q(?:uestion)?\s*)?(\d+)(?:[.)]|:\s+)\s*(\S.*)$", re.I)
QA = re.compile(r"^(?:Q|Question)\s*:\s*(\S.*)$", re.I)
OPTION = re.compile(r"^(?:\(([A-Ha-h])\)|([A-Ha-h])[.)])\s+(.+)$")
ANSWER = re.compile(r"^(?:Correct\s+answer|Answer|Ans|A)\s*[:=]\s*(.*)$", re.I)
PDF_HIGHLIGHT_ANSWER = re.compile(r"^\[PDF_HIGHLIGHT_ANSWER:\s*(.+?)\]$")
KEY_HEADING = re.compile(r"^(?:(?:answer\s*key|answers|correct\s+answers|key\s+to\s+answers)(?:\s*(?:and|&|with|/)\s*(?:rationales?|explanations?))?|answer\s+(?:and|&|with|/)\s+(?:rationales?|explanations?))\s*:?(.*)$", re.I)
SOURCE = re.compile(r"^\[SOURCE: (.+)\]$")
PDF_IMAGE = re.compile(r"^\[PDF_IMAGE:\s*(data:image/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=_-]+)\]$", re.I)
PDF_IMAGE_CAPTION = re.compile(r"^\[PDF_IMAGE_CAPTION:\s*(.+?)\]$", re.I)
SECTION = re.compile(r"^(?:(?:section|part|quiz|test|chapter|unit|set)\s+(?:\d+|[ivxlcdm]+|[a-z])(?:\b|[:.)])|(?-i:[IVXLCDM]+[.)]\s+(?:[A-Z][a-z]+|[A-Z0-9\s,:;—-]{3,}))|#{1,6}\s+\S)", re.I)
MULTIPLE_ANSWER_STEM = re.compile(r"\b(?:select|choose|check|mark)\s+(?:all|every|(?:the\s+)?(?:two|three|four|[2-8]))\b|\b(?:select|choose)\b.{0,50}\bthat apply\b", re.I)
EXPLANATION_LABEL = r"(?:explanations?|(?:answer\s+)?rationales?|(?:answer\s+)?explanations?|justifications?|reason(?:ing)?|why(?:\s+(?:this|the)\s+answer)?|solutions?|(?:side\s+)?notes?)"
EXPLANATION = re.compile(r"^(?:\*\*)?(?:" + EXPLANATION_LABEL + r")(?:\*\*)?\s*(?:[:=\u2013\u2014-]\s*(?:\*\*)?\s*(.*)|$)", re.I)
INLINE_EXPLANATION = re.compile(r"(?:^|\s+)(?:\*\*)?(?:" + EXPLANATION_LABEL + r")(?:\*\*)?\s*[:=]\s*(?:\*\*)?\s*", re.I)
IMPORT_NOTICES = (
    "AI-inferred answer: no answer key was supplied. Review it for accuracy.",
    "Choices added by AI. Review them for accuracy.",
)
QUESTIONNAIRE_TITLE = re.compile(r"(?:[\w &,./'-]+\s+)?(?:questionnaire|(?:practice\s+)?(?:test|quiz|examination|exam))(?:\s+by\b.*|\s*:?\s*)", re.I)


def _is_questionnaire_title(line):
    return bool(QUESTIONNAIRE_TITLE.fullmatch(line) and
                (line.isupper() or re.search(r"\bby\s+\S", line, re.I)
                 or re.match(r"^(?:practice|review|sample|mock)\s+(?:test|quiz|exam)", line, re.I)
                 or line.casefold().rstrip(":") == "questionnaire"))


def questionnaire_item_explanation(item):
    """Return teaching text, excluding metadata used as legacy explanations."""
    if not isinstance(item, dict):
        return ""
    value = item.get("explanation")
    if not isinstance(value, str):
        return ""
    value = value.strip()
    if item.get("explanation_origin") in {"provided", "ai"}:
        return value
    for notice in IMPORT_NOTICES:
        value = value.replace(notice, "")
    return value.strip()


def _split_explanation(value):
    match = INLINE_EXPLANATION.search(value)
    return (value[:match.start()].rstrip(), value[match.end():].strip()) if match else (value, "")


def _add_explanation(record, value):
    value = value.strip()
    if value:
        existing = record.get("explanation", "")
        record["explanation"] = (existing + "\n" + value) if existing else value
        record["explanation_origin"] = "provided"


def _questionnaire_lines(document):
    """Exclude an explicitly separated lecture preface, never ordinary items."""
    lines = document.splitlines()
    for index, value in enumerate(lines):
        line = value.strip()
        if not (_is_questionnaire_title(line)
                and not QUESTION.match(line)):
            continue
        prefix = lines[:index]
        lecture = any(re.match(r"\s*[\u25cb\u25cf\u25a0\u2605]", text) or re.search(r"\blecture\s+notes?\b", text, re.I) for text in prefix)
        real_questions = any(ANSWER.match(text.strip()) or QA.match(text.strip()) or "?" in text
                             or ((question := QUESTION.match(text.strip())) and re.match(r"(?:what|which|who|when|where|why|how|identify|name|state|give|list|define|match|choose|select)\b", question[2], re.I)) for text in prefix)
        if lecture and not real_questions:
            marker = next((text for text in reversed(prefix) if SOURCE.match(text.strip())), None)
            return ([marker] if marker else []) + lines[index:]
        break
    return lines


def docx_questionnaire_text(document):
    """Include tables in document order; retain common Word list numbering."""
    from docx_questionnaire_images import paragraph_questionnaire_text, cell_questionnaire_text
    parts, counter = [], 0
    for block in document.iter_inner_content():
        if hasattr(block, "text"):
            text = paragraph_questionnaire_text(block)
            if not text:
                continue
            if KEY_HEADING.match(text):
                counter = 0
            if block.style and block.style.name.startswith("List Number") and not QUESTION.match(text):
                counter += 1
                text = f"{counter}. {text}"
            parts.append(text)
        else:
            rows = [[cell_questionnaire_text(cell) for cell in row.cells] for row in block.rows]
            if not rows:
                continue
            headers = [re.sub(r"\s+", " ", value.casefold()).strip().rstrip(".:") for value in rows[0]]
            question_column = next((index for index, value in enumerate(headers) if value in {"question", "questions", "question text", "prompt", "stem"}), None)
            explanation_columns = [index for index, value in enumerate(headers)
                                   if re.fullmatch(EXPLANATION_LABEL, value, re.I)
                                   or value in {"explanation / rationale", "answer explanation", "answer rationale"}]
            number_column = next((index for index, value in enumerate(headers) if value in {"no", "number", "question no", "item no", "#"}), None)
            answer_columns = [index for index, value in enumerate(headers) if value in {"answer", "correct answer", "key"}]
            if question_column is not None:
                for row in rows[1:]:
                    question = row[question_column]
                    if not question:
                        if any(row):
                            raise QuestionnaireError("A questionnaire table has an answer or choices but no question.")
                        continue
                    if not QUESTION.match(question) and number_column is not None and row[number_column].isdigit():
                        question = row[number_column] + ". " + question
                    parts.append(question if QUESTION.match(question) else "Q: " + question)
                    for index, header in enumerate(headers):
                        if header in list("abcdefgh") and row[index]:
                            parts.append(f"{header.upper()}. {row[index]}")
                    for index in answer_columns:
                        if row[index]:
                            parts.append("Answer: " + row[index])
                    for index in explanation_columns:
                        if row[index]:
                            parts.append("Explanation: " + row[index])
            elif number_column is not None and answer_columns:
                parts.append("Answer key:")
                for row in rows[1:]:
                    if not any(row):
                        continue
                    if not row[number_column].isdigit():
                        raise QuestionnaireError("An answer-key table needs a question number in every nonempty row.")
                    for index in answer_columns:
                        if row[index]:
                            parts.append(row[number_column] + ". " + row[index])
                    for index in explanation_columns:
                        if row[index]:
                            parts.append("Explanation: " + row[index])
            else:
                for row in rows:
                    if len(row) == 2 and row[0].isdigit():
                        parts.append(f"{row[0]}. {row[1]}")
                    else:
                        parts.extend(value for value in row if value)
    return "\n".join(parts)


def _normalized(text):
    return re.sub(r"\s+", " ", text).strip().casefold()


def resolve_answer_values(raw, options, labels):
    """Resolve original option values, retaining answer boundaries explicitly."""
    if not options:
        return [raw]
    # In the uploaded answer key, a bare letter denotes its printed label.
    # Persisted cards keep the resolved text and structured answer values, so
    # later grading never interprets that text as another option's label.
    letter = re.fullmatch(r"\(?([A-Ha-h])\)?[.)]?", raw.strip())
    if letter and letter[1].upper() in labels:
        return [options[labels.index(letter[1].upper())]]
    for option in options:
        if _normalized(raw) == _normalized(option):
            return [option]
    # Accept 'B. mitochondrion' only if the label AND its text agree.
    labeled = OPTION.match(raw)
    if labeled:
        label = (labeled[1] or labeled[2]).upper()
        if label in labels and _normalized(labeled[3]) == _normalized(options[labels.index(label)]):
            return [options[labels.index(label)]]
    # Explicit multi-answer keys are common in select-all-that-apply source
    # questionnaires. Resolve every label without changing printed options.
    parts = re.split(r"\s*(?:\||,|;|&|\band\b)\s*", raw.strip(), flags=re.I)
    if len(parts) > 1:
        letters = [re.fullmatch(r"\(?([A-Ha-h])\)?[.)]?", part) for part in parts]
        if all(letters):
            values = [letter[1].upper() for letter in letters]
            if len(set(values)) == len(values) and all(value in labels for value in values):
                return [option for label, option in zip(labels, options) if label in values]
        # AI-completed checkbox answers use exact option text separated by pipes.
        # Resolve the whole value above first, preserving pipes within an option.
        if "|" in raw:
            exact_parts = raw.split("|")
            values = [next((option for option in options if _normalized(option) == _normalized(part)), None) for part in exact_parts]
            if all(value is not None for value in values) and len(set(values)) == len(values):
                return [option for option in options if option in values]
    raise QuestionnaireError(f"Answer key {raw!r} does not identify exactly one choice. Correct the key before importing.")


def resolve_answer(raw, options, labels):
    """Resolve an answer key without editing the actual option text."""
    return " | ".join(resolve_answer_values(raw, options, labels))


def resolve_matching_answers(raw, prompts, options, labels):
    """Resolve supplied matching keys by prompt/index, without asking a model."""
    raw = raw.strip()
    names = "|".join(re.escape(prompt) for prompt in sorted(prompts, key=len, reverse=True))
    entry = re.compile(r"(?:^|[;,\n]\s*)(" + names + r"|\d+)\s*(?:->|→|:|=|—|-)\s*", re.I)
    entries = list(entry.finditer(raw.strip()))
    mapping = {}
    if entries:
        if raw[:entries[0].start()].strip():
            raise QuestionnaireError("A matching answer key contains unreadable entries.")
        for index, match in enumerate(entries):
            key = match[1]
            prompt = next((prompt for prompt in prompts if _normalized(prompt) == _normalized(key)), None)
            if prompt is None and key.isdigit() and 1 <= int(key) <= len(prompts):
                prompt = prompts[int(key) - 1]
            if prompt is None or prompt in mapping:
                raise QuestionnaireError("A matching answer key has an unknown or repeated prompt.")
            end = entries[index + 1].start() if index + 1 < len(entries) else len(raw)
            answer = resolve_answer(raw[match.end():end].strip(), options, labels)
            if answer not in options:
                raise QuestionnaireError("Each matching answer must identify exactly one original option.")
            mapping[prompt] = answer
    else:
        # A plain list such as A, C, B is positional only when every prompt has
        # one explicit label. Never interpret free-form prose as a key.
        parts = re.split(r"\s*(?:\||,|;)\s*", raw.strip())
        if len(parts) != len(prompts) or not all(re.fullmatch(r"\(?[A-Ha-h]\)?[.)]?", part) for part in parts):
            raise QuestionnaireError("Use a matching key such as 1-A; 2-B, or one option label for every prompt.")
        mapping = {prompt: resolve_answer(value, options, labels) for prompt, value in zip(prompts, parts)}
    if set(mapping) != set(prompts) or len({_normalized(value) for value in mapping.values()}) != len(prompts):
        raise QuestionnaireError("Supply one distinct matching answer for every prompt.")
    return [{"prompt": prompt, "answer": mapping[prompt]} for prompt in prompts]


def _apply_answer_keys(records, scopes, blocks):
    """Match keys within a section/file; never broadcast a repeated number."""
    for block in blocks:
        keys = block["keys"]
        if not keys:
            continue
        preferred = scopes[block["scope"]]
        candidates = [scope for scope in scopes if scope["records"] and set(keys) <= {item["number"] for item in scope["records"]}]
        local = [scope for scope in candidates if scope["document"] == preferred["document"]]
        if preferred in candidates:
            targets = preferred["records"]
        elif len(local) == 1:
            targets = local[0]["records"]
        elif len(candidates) == 1:
            targets = candidates[0]["records"]
        else:
            # A key may span sections with globally unique printed numbers.
            local_records = [item for scope in scopes if scope["document"] == preferred["document"] for item in scope["records"]]
            pool = local_records or records
            matches = {number: [item for item in pool if item["number"] == number] for number in keys}
            if any(not values for values in matches.values()):
                raise QuestionnaireError("The answer key refers to questions outside this upload. Include their pages or remove the unmatched key entries.")
            if any(len(values) != 1 for values in matches.values()):
                raise QuestionnaireError("This separate answer key could match multiple sections with the same question numbers. Place each key after its section, or add answers beside the questions.")
            targets = [values[0] for values in matches.values()]
        for item in targets:
            if item["number"] not in keys:
                continue
            key = keys[item["number"]]
            key, inline_explanation = _split_explanation(key)
            if item.get("options"):
                # Textbook keys commonly print '1. b. <rationale>' without an
                # Explanation label. A long prose body after the keyed letter
                # is teaching text; a matching option remains ordinary answer
                # text. Short mismatched labels still fail validation.
                prose = re.fullmatch(r"\(?([A-Ha-h])\)?[.)]\s*(\S[\s\S]*)", key)
                if prose and prose[1].upper() in item["labels"]:
                    option = item["options"][item["labels"].index(prose[1].upper())]
                    if _normalized(prose[2]) != _normalized(option) and len(prose[2].split()) >= 5:
                        key, inline_explanation = prose[1], "\n".join(value for value in (prose[2], inline_explanation) if value)
            if item.get("key_answer") and item["key_answer"] != key:
                raise QuestionnaireError(f"Conflicting answer keys for question {item['source_number']}.")
            item["key_answer"] = key
            explanation = block.get("explanations", {}).get(item["number"], "")
            for value in (inline_explanation, explanation):
                if value and value != item.get("explanation"):
                    _add_explanation(item, value)


def parse_questionnaire(documents, limit=200):
    """Read numbered questions or Q:/A: blocks and optional numbered answer keys.

    Numbering/choice labels are structure; all question, option and answer wording
    stays intact. Ambiguous layouts fail rather than becoming invented questions.
    """
    records, scopes, blocks, current, source = [], [], [], None, ""

    def new_scope(document):
        scope = {"document": document, "records": []}
        scopes.append(scope)
        return scope

    def put_key(number, value):
        if not value.strip():
            raise QuestionnaireError(f"Answer key {number} is empty.")
        number = number.lstrip("0") or "0"
        keys = blocks[-1]["keys"]
        answer, explanation = _split_explanation(value.strip())
        if number in keys and keys[number] != answer:
            raise QuestionnaireError(f"Conflicting answer keys for question {number}.")
        keys[number] = answer
        if explanation:
            blocks[-1].setdefault("explanations", {})[number] = explanation
        return number

    def put_key_explanation(number, value):
        values = blocks[-1].setdefault("explanations", {})
        values[number] = "\n".join(part for part in (values.get(number, ""), value.strip()) if part)

    for document_index, document in enumerate(documents):
        current, in_key, source = None, False, ""
        last_key, key_explanation = None, False
        pending_images = []
        pending_image_labels = []
        scope = new_scope(document_index)
        lines = _questionnaire_lines(document)
        # Split same-line choices only at explicit labels; preserve their order.
        for line_index, raw_line in enumerate(lines):
            line = raw_line.strip()
            recovered_answer = PDF_HIGHLIGHT_ANSWER.match(line)
            if recovered_answer:
                line = "Answer: " + recovered_answer[1]
            if not line:
                if current is not None and current.get("in_explanation") and current.get("explanation"):
                    current["explanation"] += "\n"
                continue
            image = PDF_IMAGE.match(line)
            if image:
                if current is None:
                    pending_images.append(image[1])
                    pending_image_labels.append("")
                else:
                    current.setdefault("images", []).append(image[1])
                    if "image_labels" in current:
                        current["image_labels"].append("")
                    if source and source not in current["source_refs"]:
                        current["source_refs"].append(source)
                continue
            image_caption = PDF_IMAGE_CAPTION.match(line)
            if image_caption:
                if current is not None and current.get("images"):
                    labels = current.setdefault("image_labels", [""] * len(current["images"]))
                    labels[-1] = image_caption[1]
                elif pending_images:
                    pending_image_labels[-1] = image_caption[1]
                continue
            marker = SOURCE.match(line)
            if marker:
                source = marker[1]
                following = next((value.strip() for value in lines[line_index + 1:] if value.strip() and not SOURCE.match(value.strip()) and not PDF_IMAGE.match(value.strip()) and not PDF_IMAGE_CAPTION.match(value.strip())), "")
                continues_current = current is not None and not (QUESTION.match(following) or QA.match(following) or KEY_HEADING.match(following))
                if continues_current and source not in current["source_refs"]:
                    current["source_refs"].append(source)
                continue
            if (SECTION.match(line) or (_is_questionnaire_title(line) and not QUESTION.match(line))) and not OPTION.match(line):
                following = next((value.strip() for value in lines[line_index + 1:] if value.strip()), "")
                if current is not None and OPTION.match(following):
                    # A page/section heading can interrupt the choices of a
                    # question that started on the previous printed page.
                    continue
                current, in_key = None, False
                if scope["records"]:
                    scope = new_scope(document_index)
                continue
            heading = KEY_HEADING.match(line)
            if heading:
                in_key, current = True, None
                last_key, key_explanation = None, False
                blocks.append({"scope": len(scopes) - 1, "keys": {}, "explanations": {}})
                line = heading[1].strip()
                if not line:
                    continue
            # A new question after a key need not have an explicit section title.
            if in_key and QUESTION.match(line):
                following = next((value.strip() for value in lines[line_index + 1:] if value.strip() and not SOURCE.match(value.strip())), "")
                keyed_body = re.match(r"\(?[A-Ha-h]\)?[.)]?(?:\s|$)", QUESTION.match(line)[2])
                if ("?" in line and not keyed_body) or OPTION.match(following) or ANSWER.match(following):
                    in_key = False
                    scope = new_scope(document_index)
            if in_key:
                explanation = EXPLANATION.match(line)
                if explanation:
                    if last_key is None:
                        raise QuestionnaireError("Place each answer-key explanation after its numbered answer.")
                    put_key_explanation(last_key, explanation[1] or "")
                    key_explanation = True
                    continue
                # Supports key columns such as '1. B  2. C', including one-letter answers.
                entries = list(re.finditer(r"(?:^|\s+)(\d+)\s*[.):=\-]\s*", line))
                if not entries:
                    if last_key is not None:
                        if key_explanation or re.match(r"^\(?[A-Ha-h]\)?(?:[.)]|$)", blocks[-1]["keys"][last_key]):
                            put_key_explanation(last_key, line)
                            key_explanation = True
                        else:
                            blocks[-1]["keys"][last_key] += "\n" + line
                        continue
                    raise QuestionnaireError("Use numbered answer keys, for example: 1. B or 2. Mitochondrion.")
                for index, match in enumerate(entries):
                    end = entries[index + 1].start() if index + 1 < len(entries) else len(line)
                    last_key = put_key(match[1], line[match.end():end])
                    key_explanation = bool(blocks[-1]["explanations"].get(last_key))
                continue
            numbered, qa = QUESTION.match(line), QA.match(line)
            if numbered and current is not None and current.get("in_explanation"):
                following = next((value.strip() for value in lines[line_index + 1:] if value.strip() and not SOURCE.match(value.strip())), "")
                looks_like_question = ("?" in numbered[2] or re.match(r"(?:what|which|who|when|where|why|how|identify|name|state|give|list|define|match|choose|select)\b", numbered[2], re.I)
                                       or OPTION.match(following) or ANSWER.match(following))
                if int(numbered[1]) <= int(current["source_number"]) and not looks_like_question:
                    _add_explanation(current, line)
                    continue
            if numbered or qa:
                printed_number = numbered[1] if numbered else str(len(records) + 1)
                number = printed_number.lstrip("0") or "0"
                if any(item["number"] == number for item in scope["records"]):
                    scope = new_scope(document_index)
                question = numbered[2] if numbered else qa[1]
                current = {"number": number, "source_number": printed_number, "question": question, "options": [], "labels": [], "answer": "", "answer_after_option": False, "source_refs": [source] if source else [], "explanation": ""}
                current["matching_prompts"] = []
                if pending_images:
                    current["images"] = pending_images[:]
                    if any(pending_image_labels):
                        current["image_labels"] = pending_image_labels[:]
                    pending_images.clear()
                    pending_image_labels.clear()
                records.append(current)
                scope["records"].append(current)
                if len(records) > limit:
                    raise QuestionnaireError(f"This questionnaire has more than {limit} questions. Select fewer pages or split it into smaller files; nothing was imported.")
                # Numbered question can also have choices on the same line.
                line, inline_explanation = _split_explanation(question)
                if inline_explanation and "?" not in line and not re.search(r"\b(?:Correct\s+answer|Answer|Ans)\s*[:=]", line, re.I):
                    # A stem can itself discuss a 'rationale:' or 'reason:'.
                    # Inline teaching annotations need an answer/question
                    # boundary; standalone explanation headings are handled
                    # independently below.
                    line, inline_explanation = question, ""
                if inline_explanation:
                    _add_explanation(current, inline_explanation)
                    current["in_explanation"] = True
                    current["question"] = line
                inline = re.search(r"\s+(?=\(?[Aa][.)]\s+)", line)
                if inline:
                    current["question"] = line[:inline.start()].rstrip()
                    line = line[inline.end():]
                else:
                    inline_answer = re.search(r"\s+(?:Correct\s+answer|Answer|Ans)\s*[:=]\s*", line, re.I)
                    if inline_answer:
                        current["question"] = line[:inline_answer.start()].rstrip()
                        current["answer"] = line[inline_answer.end():].strip()
                    continue
            if current is None:
                # Titles/instructions before the first numbered question aren't items.
                continue
            explanation = EXPLANATION.match(line)
            if explanation:
                if (current["options"] and not current.get("matching_prompts")
                        and re.match(r"^notes?\s*:\s*all(?:\s+(?:of\s+)?(?:the\s+)?(?:above|options|choices|statements|these))?\s+(?:are\s+|is\s+)?(?:the\s+)?correct\s+answers?\b", line, re.I)):
                    current["noted_all_correct"] = True
                _add_explanation(current, explanation[1] or "")
                current["in_explanation"] = True
                continue
            if current.get("in_explanation") and not ANSWER.match(line) and not (numbered or qa):
                _add_explanation(current, line)
                continue
            printed_option = OPTION.match(line)
            inline_marker = INLINE_EXPLANATION.search(line)
            if printed_option and inline_marker and inline_marker.start() <= printed_option.start(3):
                # 'D. Rationale: a reason for an action' can be the literal
                # option text, rather than an annotation after that option.
                inline_explanation = ""
            else:
                line, inline_explanation = _split_explanation(line)
            if inline_explanation:
                _add_explanation(current, inline_explanation)
                current["in_explanation"] = True
            if current["options"] and re.match(r"^[-–—]\s+", line):
                current["commentary"] = True
                continue
            matching_prompt = re.match(r"^_{2,}\s*(\S.*)$", line)
            if matching_prompt and re.match(r"\s*match\b", current["question"], re.I):
                current["matching_prompts"].append(matching_prompt[1].strip())
                continue
            answer = ANSWER.match(line)
            if answer:
                value = answer[1].strip()
                if current["answer"] and current["answer"] != value:
                    raise QuestionnaireError(f"Conflicting answers for question {current['number']}.")
                current["answer"] = value
                # PDF highlight recovery can insert this answer between two
                # paragraphs of side notes. Keep their explanation block open
                # until the next actual question or explicit section.
                current["answer_after_option"] = bool(current["options"] and re.fullmatch(r"\(?[A-Ha-h]\)?[.)]?", value))
                current["answer_is_recovered"] = bool(recovered_answer)
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
                if any(OPTION.match(part) is None for part in parts):
                    # 'A. E. histolytica' starts with the option label A and
                    # an abbreviated genus. Splitting leaves an empty option,
                    # not another independently readable choice.
                    parts = [line]
                # A scientific abbreviation such as "C. difficile" can look
                # like an inline choice. If that label occurs again as a
                # standalone option before the next question, preserve the
                # entire current option line.
                if len(parts) > 1:
                    later_labels = set()
                    for future in lines[line_index + 1:]:
                        future = future.strip()
                        if QUESTION.match(future) or QA.match(future):
                            break
                        later_option = OPTION.match(future)
                        if later_option:
                            later_labels.add((later_option[1] or later_option[2]).upper())
                    split_labels = {
                        (match[1] or match[2]).upper()
                        for part in parts[1:]
                        if (match := OPTION.match(part))
                    }
                    if split_labels & later_labels:
                        parts = [line]
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
            if current.get("answer_after_option") and current["options"]:
                # A printed key already identifies an existing choice. Prose
                # below it explains that answer, rather than extending the
                # last (often incorrect) option. OCR keys are emitted after
                # complete question blocks so wrapped choices stay intact.
                if current.get("answer_is_recovered"):
                    # A physical page break can split the final choice after
                    # the extractor recorded a highlight on the first page.
                    current["options"][-1] += "\n" + line
                else:
                    _add_explanation(current, line)
                    current["in_explanation"] = True
            elif current["answer"]:
                current["answer"] += "\n" + line
            elif current["options"]:
                current["options"][-1] += "\n" + line
            else:
                current["question"] += "\n" + line

    if not records:
        raise QuestionnaireError("No questions were recognized. Use numbered questions (1. Question or 1) Question), A./B./C./D. choices, and Answer: text or a numbered Answer key section. Scanned PDFs need OCR first.")
    _apply_answer_keys(records, scopes, blocks)
    for item in records:
        item.pop("in_explanation", None)
        item["explanation"] = item.get("explanation", "").strip()
        options, labels = item["options"], item["labels"]
        if options and (len(options) < 2 or sorted(labels) != [chr(index) for index in range(ord(min(labels)), ord(max(labels)) + 1)]):
            found = ", ".join(labels) or "none"
            raise QuestionnaireError(f"Question {item['number']} has missing choices or unreadable labels (found: {found}). Make sure every choice from its first printed label onward is readable, or upload a clearer copy.")
        if options:
            # OCR often reads two columns as A,C,B,D. Match text to its printed
            # label before resolving answer keys, so 'Both A and B' stays valid.
            pairs = sorted(zip(labels, options))
            item["labels"] = labels = [label for label, _ in pairs]
            item["options"] = options = [option for _, option in pairs]
        if len({_normalized(option) for option in options}) != len(options):
            raise QuestionnaireError(f"Question {item['number']} has duplicate choices; fix them before importing.")
        explicit = item["answer"] if not re.fullmatch(r"[_\s.\-]+", item["answer"]) else ""
        raw_key = item.pop("key_answer", "")
        key = raw_key if not re.fullmatch(r"[_\s.\-]+", raw_key) else ""
        if item.pop("noted_all_correct", False):
            if any(resolve_answer_values(value, options, labels) != options for value in (explicit, key) if value):
                raise QuestionnaireError(f"The explicit all-options answer note conflicts with another key for question {item['source_number']}.")
            item["answer"] = " | ".join(options)
            item["correct_answers"] = options[:]
            item["quiz_type"] = "checkbox"
            continue
        if item.get("matching_prompts"):
            provided = resolve_matching_answers(explicit, item["matching_prompts"], options, labels) if explicit else []
            from_key = resolve_matching_answers(key, item["matching_prompts"], options, labels) if key else []
            if provided and from_key and provided != from_key:
                raise QuestionnaireError(f"Conflicting matching answers for question {item['number']}.")
            item["matching_pairs"] = provided or from_key
            item["answer"] = "\n".join(f"{pair['prompt']} — {pair['answer']}" for pair in item["matching_pairs"])
            continue
        if explicit and key and [_normalized(value) for value in resolve_answer_values(explicit, options, labels)] != [_normalized(value) for value in resolve_answer_values(key, options, labels)]:
            raise QuestionnaireError(f"Conflicting answers for question {item['number']}.")
        item["answer"] = resolve_answer(explicit or key, options, labels) if explicit or key else ""
        if options and (explicit or key):
            item["correct_answers"] = resolve_answer_values(explicit or key, options, labels)
        if options and (MULTIPLE_ANSWER_STEM.search(item["question"]) or len(item.get("correct_answers", [])) > 1):
            item["quiz_type"] = "checkbox"
    # AI completion IDs are unique across files/sections, independently of the
    # printed numbering retained for source attribution.
    for index, item in enumerate(records, 1):
        item["number"] = str(index)
    return records


def _completion_explanation(record, entry, required):
    supplied = questionnaire_item_explanation(record)
    explanation = supplied or questionnaire_item_explanation(entry)
    if required and (not explanation or (not supplied and _normalized(explanation) == _normalized(entry.get("answer", "")))):
        raise QuestionnaireError(f"The explanation for question {record['number']} could not be completed.")
    if not explanation:
        return {}
    return {"explanation": explanation,
            "explanation_origin": record.get("explanation_origin", "provided") if supplied else "ai"}


def validate_completion(records, payload, choice_mode, require_explanations=False):
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
        record_mode = (choice_mode.get(str(record["number"]), "identification")
                       if isinstance(choice_mode, dict) else choice_mode)
        entry = by_number.get(record["number"], {})
        answer = entry.get("answer")
        if entry.get("question") != record["question"] or not isinstance(answer, str) or not answer.strip() or entry.get("uncertain") is not False:
            raise QuestionnaireError(f"An answer for question {record['number']} could not be established. Supply an answer key and retry.")
        if record["answer"] and answer != record["answer"]:
            raise QuestionnaireError("The model changed a supplied answer.")
        explanation = _completion_explanation(record, entry, require_explanations or record.get("explanation_required", False))
        if record.get("matching_prompts"):
            supplied_pairs = record.get("matching_pairs") or []
            supplied_by_prompt = {pair["prompt"]: pair["answer"] for pair in supplied_pairs}
            raw_pairs = entry.get("matching_pairs")
            if not isinstance(raw_pairs, list) or len(raw_pairs) != len(record["matching_prompts"]):
                raise QuestionnaireError(f"The model did not complete every match in question {record['number']}.")
            mapping, used_prompts = [], set()
            for pair in raw_pairs:
                if not isinstance(pair, dict) or pair.get("prompt") not in record["matching_prompts"] or pair["prompt"] in used_prompts:
                    raise QuestionnaireError(f"The model returned invalid matches for question {record['number']}.")
                raw_match = pair.get("match", pair.get("answer"))
                if not isinstance(raw_match, str) or not raw_match.strip():
                    raise QuestionnaireError(f"The model returned an empty match for question {record['number']}.")
                match = raw_match if raw_match in record["options"] else resolve_answer(raw_match, record["options"], record["labels"])
                if supplied_pairs and match != supplied_by_prompt.get(pair["prompt"]):
                    raise QuestionnaireError("The model changed a supplied matching answer.")
                used_prompts.add(pair["prompt"])
                mapping.append({"prompt": pair["prompt"], "answer": match})
            if used_prompts != set(record["matching_prompts"]):
                raise QuestionnaireError(f"The model omitted a match in question {record['number']}.")
            if len({_normalized(pair["answer"]) for pair in mapping}) != len(mapping):
                raise QuestionnaireError(f"The model repeated a match in question {record['number']}.")
            if supplied_pairs:
                mapping = supplied_pairs
            completed[record["number"]] = {
                "answer": "\n".join(f"{pair['prompt']} — {pair['answer']}" for pair in mapping),
                "matching_pairs": mapping,
                "distractors": [],
                **explanation,
            }
            continue
        if entry.get("question") != record["question"] or not isinstance(answer, str) or not answer.strip() or entry.get("uncertain") is not False:
            raise QuestionnaireError(f"An answer for question {record['number']} could not be established. Supply an answer key and retry.")
        if record["answer"] and answer != record["answer"]:
            raise QuestionnaireError("The model changed a supplied answer.")
        correct_answers = None
        if record["options"]:
            multi_allowed = record_mode == "checkbox" or (record_mode == "same_as_source" and record.get("quiz_type") == "checkbox")
            if answer in record["options"]:
                correct_answers = [answer]
            elif multi_allowed:
                correct_answers = resolve_answer_values(answer, record["options"], record["labels"])
                answer = " | ".join(correct_answers)
            else:
                raise QuestionnaireError("The inferred answer is not one of the original options.")
        distractors = entry.get("distractors", [])
        if (record_mode is True or record_mode in {"multiple_choice", "checkbox"}) and not record["options"]:
            if not isinstance(distractors, list) or len(distractors) != 3 or any(not isinstance(value, str) or not value.strip() for value in distractors):
                raise QuestionnaireError("The model did not supply three usable distractors.")
            if len({_normalized(value) for value in [answer, *distractors]}) != 4:
                raise QuestionnaireError("Generated choices contain duplicate answers.")
        completed[record["number"]] = {"answer": answer, "distractors": distractors, **explanation}
        if correct_answers:
            completed[record["number"]]["correct_answers"] = correct_answers
    return completed


def validate_completion_partial(records, payload, choice_mode, require_explanations=False):
    """Keep independently verified answers when another item in the batch fails."""
    entries = payload.get("items") if isinstance(payload, dict) else None
    if not isinstance(entries, list):
        reason = "The model did not return a usable question list."
        return {}, {str(record["number"]): reason for record in records}

    expected = {str(record["number"]) for record in records}
    by_number = {}
    duplicates = set()
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        number = str(entry.get("number", ""))
        if number not in expected:
            continue
        if number in by_number:
            duplicates.add(number)
        else:
            by_number[number] = entry

    completed, errors = {}, {}
    for record in records:
        number = str(record["number"])
        if number in duplicates:
            errors[number] = f"The model returned question {number} more than once."
            continue
        entry = by_number.get(number)
        if entry is None:
            errors[number] = f"The model omitted question {number}."
            continue
        try:
            completed.update(validate_completion([record], {"items": [entry]}, choice_mode, require_explanations=require_explanations))
        except QuestionnaireError as exc:
            errors[number] = str(exc)
    return completed, errors


def _question_match_key(value):
    value = unicodedata.normalize("NFKC", str(value or "")).casefold()
    value = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\u00ad\ufffd\u200b\u2060\ufeff]", "", value)
    return re.sub(r"\s+", " ", value).strip()


def match_existing_questionnaire_items(records, existing_items):
    """Match saved partial-import cards back to stable parsed questionnaire positions."""
    if not existing_items:
        return {}
    record_by_index = {int(record["number"]): record for record in records}
    matched, used_indexes = {}, set()
    for item in existing_items:
        if not isinstance(item, dict) or not item.get("imported") or not str(item.get("answer") or "").strip():
            continue
        try:
            index = int(item.get("questionnaire_index"))
        except (TypeError, ValueError):
            index = 0
        record = record_by_index.get(index)
        if (record is not None and index not in used_indexes
                and _question_match_key(item.get("question")) == _question_match_key(record["question"])
                and str(item.get("source_number", "")) == str(record.get("source_number", record["number"]))):
            matched[index] = item
            used_indexes.add(index)

    # Older saved imports have no questionnaire_index. Fall back to an exact
    # question/source-number match, consuming duplicate-number questions in order.
    for item in existing_items:
        if not isinstance(item, dict) or not item.get("imported") or not str(item.get("answer") or "").strip():
            continue
        if any(item is value for value in matched.values()):
            continue
        for index, record in record_by_index.items():
            if index in used_indexes:
                continue
            if (_question_match_key(item.get("question")) == _question_match_key(record["question"])
                    and str(item.get("source_number", "")) == str(record.get("source_number", record["number"]))):
                matched[index] = item
                used_indexes.add(index)
                break
    return matched


def _set_item_explanation(item, record, completion, existing=None):
    supplied = questionnaire_item_explanation(record)
    saved = questionnaire_item_explanation(existing) if existing else ""
    generated = questionnaire_item_explanation(completion)
    explanation = supplied or saved or generated
    item["explanation"] = explanation
    if explanation:
        item["explanation_origin"] = (record.get("explanation_origin", "provided") if supplied else
                                      existing.get("explanation_origin", "provided") if saved else
                                      completion.get("explanation_origin", "ai"))
    else:
        item.pop("explanation_origin", None)
    if record.get("explanation_required") and not explanation:
        item["explanation_pending"] = True
    else:
        item.pop("explanation_pending", None)
    if existing:
        saved_notices = existing.get("import_notices")
        notices = [value for value in saved_notices if isinstance(value, str)] if isinstance(saved_notices, list) else []
        legacy = str(existing.get("explanation") or "")
        notices.extend(notice for notice in IMPORT_NOTICES if notice in legacy)
        if notices:
            item["import_notices"] = list(dict.fromkeys(notices))


def _refresh_existing_choices(saved, record):
    """Repair source choice extraction without silently changing a saved key."""
    number = record.get("source_number", record["number"])
    answer = saved["answer"]
    if record.get("answer") and answer != record["answer"]:
        raise QuestionnaireError(f"The saved answer for question {number} conflicts with its supplied source key. Review the saved answer before continuing this import.")
    options = record.get("options") or []
    if not options:
        # Identification imports may already have generated distractors.
        # Their source contains no replacement choices, so retain them.
        return
    if record.get("matching_prompts"):
        pairs = saved.get("matching_pairs") or []
        expected_prompts = set(record["matching_prompts"])
        supplied = {pair["prompt"]: pair["answer"] for pair in record.get("matching_pairs", [])}
        if (not isinstance(pairs, list) or len(pairs) != len(expected_prompts)
                or any(not isinstance(pair, dict) or pair.get("prompt") not in expected_prompts
                       or pair.get("answer") not in options
                       or (supplied and supplied.get(pair.get("prompt")) != pair.get("answer"))
                       for pair in pairs)
                or len({pair["prompt"] for pair in pairs}) != len(expected_prompts)
                or len({pair["answer"] for pair in pairs}) != len(pairs)):
            raise QuestionnaireError(f"The saved matching answers for question {number} do not match its current source choices. Review the saved matches before continuing this import.")
        if saved.get("matching_options") is not None or saved.get("quiz_type") == "matching":
            saved["matching_prompts"] = record["matching_prompts"][:]
            saved["matching_options"] = options[:]
            saved["option_labels"] = record["labels"][:]
        return
    values = record.get("correct_answers") if record.get("answer") == answer else saved.get("correct_answers")
    if not values:
        values = [answer] if answer in options else answer.split(" | ")
    if (not isinstance(values, list) or not values or any(value not in options for value in values)
            or len(set(values)) != len(values)):
        raise QuestionnaireError(f"The saved answer for question {number} is not one of its current source choices. Review the saved answer before continuing this import.")
    if saved.get("correct_answer") is not None and saved["correct_answer"] != answer:
        raise QuestionnaireError(f"The saved answer fields for question {number} disagree. Review the saved answer before continuing this import.")
    if saved.get("options") is not None:
        saved["options"] = options[:]
        saved["option_labels"] = record["labels"][:]
        saved["correct_answer"] = answer
        if saved.get("correct_answers") is not None or record.get("correct_answers"):
            saved["correct_answers"] = values[:]


def convert_questionnaire(records, study_format, completions, existing_items=None, allow_incomplete=False, preserve_types=None):
    items = []
    preserve_types = {str(value) for value in (preserve_types or ())}
    existing_by_index = match_existing_questionnaire_items(records, existing_items)
    for record in records:
        questionnaire_index = int(record["number"])
        existing = existing_by_index.get(questionnaire_index)
        if existing:
            saved = {**existing, "question": record["question"],
                     "source_number": record.get("source_number", record["number"]),
                     "questionnaire_index": questionnaire_index}
            for field in ("images", "image_labels", "image_captions"):
                saved.pop(field, None)
            if record.get("images"):
                saved["images"] = record["images"]
                if record.get("image_labels"):
                    saved["image_labels"] = record["image_labels"]
            if record.get("source_refs"):
                saved["source_refs"] = record["source_refs"]
            _refresh_existing_choices(saved, record)
            _set_item_explanation(saved, record, completions.get(record["number"], {}), existing)
            items.append(saved)
            continue
        inferred = not bool(record["answer"])
        completion = completions.get(record["number"], {})
        answer = record["answer"] or completion.get("answer", "")
        if not answer:
            if allow_incomplete:
                continue
            raise QuestionnaireError(f"Supply an answer for question {record['number']}.")
        item = {"question": record["question"], "answer": answer, "source_refs": record["source_refs"], "source_number": record.get("source_number", record["number"]), "questionnaire_index": questionnaire_index, "imported": True, "answer_origin": "inferred" if inferred else "provided"}
        if record.get("images"):
            item["images"] = record["images"]
            if record.get("image_labels"):
                item["image_labels"] = record["image_labels"]
        correct_answers = record.get("correct_answers") or completion.get("correct_answers")
        preserve_source_type = str(record["number"]) in preserve_types
        record_format = questionnaire_record_type(record) if preserve_source_type else study_format
        if record_format == "multiple_choice" and correct_answers and len(correct_answers) > 1:
            raise QuestionnaireError(f"Question {record.get('source_number', record['number'])} has multiple correct answers. Choose Select all that apply or Same type as the questionnaire to preserve its answer key.")
        if correct_answers and record_format in {"multiple_choice", "checkbox", "same_as_source"}:
            item["correct_answers"] = correct_answers
        notices = []
        if inferred:
            notices.append("AI-inferred answer: no answer key was supplied. Review it for accuracy.")
        if study_format == "same_as_source" or preserve_source_type:
            if record.get("matching_prompts"):
                matching_pairs = record.get("matching_pairs") or completion.get("matching_pairs", [])
                if matching_pairs:
                    item["answer"] = "\n".join(f"{pair['prompt']} — {pair['answer']}" for pair in matching_pairs)
                item.update(
                    quiz_type="matching",
                    matching_prompts=record["matching_prompts"],
                    matching_options=record["options"],
                    matching_pairs=matching_pairs,
                    option_labels=record["labels"][:],
                )
            elif record["options"]:
                quiz_type = "checkbox" if record_format == "checkbox" or record.get("quiz_type") == "checkbox" or len(correct_answers or [answer]) > 1 else "multiple_choice"
                item.update(quiz_type=quiz_type, options=record["options"], option_labels=record["labels"][:], correct_answer=answer)
            else:
                item["quiz_type"] = "identification"
        elif study_format in {"multiple_choice", "checkbox"}:
            options = record["options"][:]
            if not options:
                distractors = completion.get("distractors", [])
                if (not isinstance(distractors, list) or len(distractors) != 3
                        or any(not isinstance(value, str) or not value.strip() for value in distractors)):
                    if allow_incomplete:
                        continue
                    raise QuestionnaireError(f"The choices for question {record['number']} could not be completed.")
                options = [answer, *distractors]
                # Vary new answer placement deterministically; original choices never move.
                offset = len(items) % 4
                options = options[offset:] + options[:offset]
                notices.append("Choices added by AI. Review them for accuracy.")
            item.update(options=options, option_labels=record["labels"][:] if record["options"] else list("ABCDEFGH"[:len(options)]), correct_answer=answer)
        _set_item_explanation(item, record, completion)
        if notices:
            item["import_notices"] = notices
        items.append(item)
    return items


def questionnaire_record_type(record):
    """Infer the item's source quiz format from its parsed structure."""
    if record.get("matching_prompts"):
        return "matching"
    if record.get("quiz_type") == "checkbox":
        return "checkbox"
    if record.get("options"):
        return "multiple_choice"
    return "identification"


def questionnaire_type_mismatches(records, target):
    """Return source questions whose structure differs from the requested format."""
    if target == "same_as_source":
        return []
    mismatches = []
    for record in records:
        source_type = questionnaire_record_type(record)
        if source_type == target:
            continue
        must_preserve = target == "multiple_choice" and source_type in {"matching", "checkbox"}
        mismatches.append({
            "number": str(record.get("source_number", record["number"])),
            "questionnaire_index": int(record["number"]),
            "question": record["question"],
            "source_type": source_type,
            "answer": record.get("answer") or None,
            "options": list(record.get("options") or []),
            "matching_prompts": list(record.get("matching_prompts") or []),
            "matching_pairs": list(record.get("matching_pairs") or []),
            "source_refs": list(record.get("source_refs") or []),
            "image_count": len(record.get("images") or []),
            "must_preserve": must_preserve,
        })
    return mismatches
