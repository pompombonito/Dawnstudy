"""Lossless questionnaire import. Models may fill gaps, never rewrite source text."""
import re


class QuestionnaireError(ValueError):
    pass


QUESTION = re.compile(r"^(?:Q(?:uestion)?\s*)?(\d+)(?:[.)]|:\s+)\s*(\S.*)$", re.I)
QA = re.compile(r"^(?:Q|Question)\s*:\s*(\S.*)$", re.I)
OPTION = re.compile(r"^(?:\(([A-Ha-h])\)|([A-Ha-h])[.)])\s+(.+)$")
ANSWER = re.compile(r"^(?:Correct\s+answer|Answer|Ans|A)\s*[:=]\s*(.*)$", re.I)
KEY_HEADING = re.compile(r"^(?:answer\s*key|answers|key\s+to\s+answers)\s*:?(.*)$", re.I)
SOURCE = re.compile(r"^\[SOURCE: (.+)\]$")
PDF_IMAGE = re.compile(r"^\[PDF_IMAGE:\s*(data:image/(?:jpeg|webp);base64,[A-Za-z0-9+/=_-]+)\]$", re.I)
SECTION = re.compile(r"^(?:(?:section|part|quiz|test|chapter|unit|set)\s+(?:\d+|[ivxlcdm]+|[a-z])(?:\b|[:.)])|(?-i:[IVXLCDM]+[.)]\s+(?:[A-Z][a-z]+|[A-Z0-9\s,:;—-]{3,}))|#{1,6}\s+\S)", re.I)


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
            if item.get("key_answer") and item["key_answer"] != key:
                raise QuestionnaireError(f"Conflicting answer keys for question {item['source_number']}.")
            item["key_answer"] = key


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
        if number in keys and keys[number] != value.strip():
            raise QuestionnaireError(f"Conflicting answer keys for question {number}.")
        keys[number] = value.strip()

    for document_index, document in enumerate(documents):
        current, in_key, source = None, False, ""
        pending_images = []
        scope = new_scope(document_index)
        lines = document.splitlines()
        # Split same-line choices only at explicit labels; preserve their order.
        for line_index, raw_line in enumerate(lines):
            line = raw_line.strip()
            if not line:
                continue
            image = PDF_IMAGE.match(line)
            if image:
                if current is None:
                    pending_images.append(image[1])
                else:
                    current.setdefault("images", []).append(image[1])
                continue
            marker = SOURCE.match(line)
            if marker:
                source = marker[1]
                following = next((value.strip() for value in lines[line_index + 1:] if value.strip() and not SOURCE.match(value.strip()) and not PDF_IMAGE.match(value.strip())), "")
                continues_current = current is not None and not (QUESTION.match(following) or QA.match(following) or KEY_HEADING.match(following))
                if continues_current and source not in current["source_refs"]:
                    current["source_refs"].append(source)
                continue
            if SECTION.match(line) and not OPTION.match(line):
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
                blocks.append({"scope": len(scopes) - 1, "keys": {}})
                line = heading[1].strip()
                if not line:
                    continue
            # A new question after a key need not have an explicit section title.
            if in_key and QUESTION.match(line):
                following = next((value.strip() for value in lines[line_index + 1:] if value.strip() and not SOURCE.match(value.strip())), "")
                if "?" in line or OPTION.match(following) or ANSWER.match(following):
                    in_key = False
                    scope = new_scope(document_index)
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
                printed_number = numbered[1] if numbered else str(len(records) + 1)
                number = printed_number.lstrip("0") or "0"
                if any(item["number"] == number for item in scope["records"]):
                    scope = new_scope(document_index)
                question = numbered[2] if numbered else qa[1]
                current = {"number": number, "source_number": printed_number, "question": question, "options": [], "labels": [], "answer": "", "answer_after_option": False, "source_refs": [source] if source else []}
                current["matching_prompts"] = []
                if pending_images:
                    current["images"] = pending_images[:]
                    pending_images.clear()
                records.append(current)
                scope["records"].append(current)
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
                current["answer_after_option"] = bool(current["options"] and re.fullmatch(r"\(?[A-Ha-h]\)?[.)]?", value))
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
                current["options"][-1] += "\n" + line
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
        options, labels = item["options"], item["labels"]
        if options and (len(options) < 2 or set(labels) != set("ABCDEFGH"[:len(options)])):
            found = ", ".join(labels) or "none"
            raise QuestionnaireError(f"Question {item['number']} has missing choices or unreadable labels (found: {found}). Make sure every choice from A onward is readable, or upload a clearer copy.")
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
        if explicit and key and _normalized(resolve_answer(explicit, options, labels)) != _normalized(resolve_answer(key, options, labels)):
            raise QuestionnaireError(f"Conflicting answers for question {item['number']}.")
        item["answer"] = resolve_answer(explicit or key, options, labels) if explicit or key else ""
    # AI completion IDs are unique across files/sections, independently of the
    # printed numbering retained for source attribution.
    for index, item in enumerate(records, 1):
        item["number"] = str(index)
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
        if record.get("matching_prompts"):
            raw_pairs = entry.get("matching_pairs")
            if not isinstance(raw_pairs, list) or len(raw_pairs) != len(record["matching_prompts"]):
                raise QuestionnaireError(f"The model did not complete every match in question {record['number']}.")
            mapping, used_prompts = [], set()
            for pair in raw_pairs:
                if not isinstance(pair, dict) or pair.get("prompt") not in record["matching_prompts"] or pair["prompt"] in used_prompts:
                    raise QuestionnaireError(f"The model returned invalid matches for question {record['number']}.")
                if not isinstance(pair.get("match"), str) or not pair["match"].strip():
                    raise QuestionnaireError(f"The model returned an empty match for question {record['number']}.")
                match = resolve_answer(pair["match"], record["options"], record["labels"])
                used_prompts.add(pair["prompt"])
                mapping.append({"prompt": pair["prompt"], "answer": match})
            if used_prompts != set(record["matching_prompts"]):
                raise QuestionnaireError(f"The model omitted a match in question {record['number']}.")
            if len({_normalized(pair["answer"]) for pair in mapping}) != len(mapping):
                raise QuestionnaireError(f"The model repeated a match in question {record['number']}.")
            completed[record["number"]] = {
                "answer": "\n".join(f"{pair['prompt']} — {pair['answer']}" for pair in mapping),
                "matching_pairs": mapping,
                "distractors": [],
            }
            continue
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
                and item.get("question") == record["question"]
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
            if (item.get("question") == record["question"]
                    and str(item.get("source_number", "")) == str(record.get("source_number", record["number"]))):
                matched[index] = item
                used_indexes.add(index)
                break
    return matched


def convert_questionnaire(records, study_format, completions, existing_items=None, allow_incomplete=False):
    items = []
    existing_by_index = match_existing_questionnaire_items(records, existing_items)
    for record in records:
        questionnaire_index = int(record["number"])
        existing = existing_by_index.get(questionnaire_index)
        if existing:
            saved = {**existing, "questionnaire_index": questionnaire_index}
            if record.get("images"):
                saved["images"] = record["images"]
            if record.get("source_refs"):
                saved["source_refs"] = record["source_refs"]
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
        notices = []
        if inferred:
            notices.append("AI-inferred answer: no answer key was supplied. Review it for accuracy.")
        if study_format == "same_as_source":
            if record.get("matching_prompts"):
                if completion.get("matching_pairs"):
                    item["answer"] = "\n".join(f"{pair['prompt']} — {pair['answer']}" for pair in completion["matching_pairs"])
                item.update(
                    quiz_type="matching",
                    matching_prompts=record["matching_prompts"],
                    matching_options=record["options"],
                    matching_pairs=completion.get("matching_pairs", []),
                )
            elif record["options"]:
                item.update(quiz_type="multiple_choice", options=record["options"], correct_answer=answer)
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
            item.update(options=options, correct_answer=answer)
        item["explanation"] = " ".join(notices)
        items.append(item)
    return items
