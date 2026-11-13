"""Read a quiz's topic allocation table and select matching source excerpts."""

from collections import Counter, defaultdict
from io import BytesIO
import math
import re
import unicodedata

from pydantic import BaseModel, Field, field_validator
from pypdf import PdfReader


MAX_BLUEPRINT_BYTES = 10 * 1024 * 1024
MAX_BLUEPRINT_TOPICS = 100
_CELLS = re.compile(r"\S.*?(?= {2,}|$)")
_COUNTS = re.compile(r"(?:no\.?|(?:number of |no\. of )?(?:items|questions)|(?:item|question) count|weight|%)", re.I)
_WEIGHT = re.compile(r"(\d+)\s*%?")
_FOOTER = re.compile(r"page \d+(?: of \d+)?", re.I)
_STOP_WORDS = set("""
about across after against among another approach before being both chapter concerning content could during each effect
exam explain fact feature first from group how however into issue knowledge lesson level may method number only other
outcome period principle process question relating should stage state such table than that their them there these they
this those through time topic toward under versus what when where which while will with without would year
development developmental developmentally challenges challenge milestones milestone draw drawn forms forms
""".split())


class BlueprintError(ValueError):
    pass


class BlueprintTopic(BaseModel):
    id: str = Field(pattern=r"^t[1-9]\d{0,2}$")
    title: str = Field(min_length=1, max_length=250)
    description: str = Field(default="", max_length=1_200)
    weight: int = Field(ge=1, le=10_000)
    group: str = Field(default="", max_length=250)


class QuizBlueprint(BaseModel):
    title: str = Field(min_length=1, max_length=150)
    topics: list[BlueprintTopic] = Field(min_length=1, max_length=MAX_BLUEPRINT_TOPICS)

    @field_validator("topics")
    @classmethod
    def unique_topic_ids(cls, topics):
        if len({topic.id for topic in topics}) != len(topics):
            raise ValueError("Topic identifiers must be unique.")
        return topics


class BlueprintCoverage(BaseModel):
    topic_id: str = Field(pattern=r"^t[1-9]\d{0,2}$")
    requested: int = Field(ge=1, le=200)
    completed: int = Field(ge=0, le=200)


def read_quiz_blueprint(filename, raw):
    """Read the detailed topic table, including wrapped rows and page breaks."""
    if not filename.lower().endswith(".pdf") or not raw.lstrip().startswith(b"%PDF-"):
        raise BlueprintError("Upload the Table of Specifications as a PDF.")
    try:
        reader = PdfReader(BytesIO(raw))
        if len(reader.pages) > 30:
            raise BlueprintError("Use a Table of Specifications PDF with up to 30 pages.")
        pages = [page.extract_text(extraction_mode="layout", layout_mode_space_vertically=False)
                 for page in reader.pages]
    except BlueprintError:
        raise
    except Exception as exc:
        raise BlueprintError("This Table of Specifications PDF could not be read.") from exc

    title = next((line.strip() for page in pages[:1] for line in page.splitlines()
                  if re.search(r"\b(?:TOS|table of specifications)\b", line, re.I)), filename.rsplit(".", 1)[0])
    table_started = False
    group = ""
    rows = []
    explicit_total = None
    for page in pages:
        lines = [[(cell.start(), cell.group()) for cell in _CELLS.finditer(line.rstrip())]
                 for line in page.splitlines() if line.strip() and not _FOOTER.fullmatch(line.strip())]
        header_index = next((index for index, cells in enumerate(lines)
                             if len(cells) in {2, 3} and cells[0][1].casefold() in {"topic", "topics", "content area"}
                             and _COUNTS.fullmatch(cells[-1][1])), None)
        if header_index is not None:
            columns = [start for start, _ in lines[header_index]]
            lines = lines[header_index + 1:]
            table_started = True
        elif table_started:
            # pypdf's layout column widths can shift between pages. Use the
            # first complete row to realign a continuation without a header.
            row = next((cells for cells in lines if len(cells) == len(columns)
                        and _WEIGHT.fullmatch(cells[-1][1])), None)
            if row:
                columns = [start for start, _ in row]
        if not table_started:
            continue
        for cells in lines:
            values = [""] * len(columns)
            for start, value in cells:
                index = max((index for index, position in enumerate(columns) if start >= position - 3), default=0)
                values[index] = " ".join(part for part in (values[index], value) if part)
            label, count = values[0], values[-1]
            description = values[1] if len(values) == 3 else ""
            weight = _WEIGHT.fullmatch(count)
            if label.casefold() in {"total", "grand total"} and weight:
                explicit_total = int(weight[1])
                break
            if label and weight and int(weight[1]) > 0:
                rows.append([label, description, int(weight[1]), group])
            elif label and not description and not count:
                group = label
            elif rows and description and not count:
                rows[-1][0] = " ".join(part for part in (rows[-1][0], label) if part)
                rows[-1][1] = " ".join(part for part in (rows[-1][1], description) if part)
            elif count:
                raise BlueprintError("A topic row has an unreadable question count. Use a PDF with a Topic and Items column.")
        if explicit_total is not None:
            break

    if not rows:
        raise BlueprintError("No weighted topic table was found. Use a text-based TOS PDF with Topic and Items (or No.) columns.")
    if explicit_total is not None and sum(row[2] for row in rows) != explicit_total:
        raise BlueprintError("The topic counts do not add up to the total printed in the TOS.")
    try:
        return QuizBlueprint(
            title=title[:150],
            topics=[BlueprintTopic(id=f"t{index}", title=name, description=description, weight=weight, group=group)
                    for index, (name, description, weight, group) in enumerate(rows, 1)],
        )
    except ValueError as exc:
        raise BlueprintError(f"Use a TOS with up to {MAX_BLUEPRINT_TOPICS} readable topic rows and positive item counts.") from exc


def _apportion(weights, count):
    total = sum(weights)
    whole, fractions = zip(*(divmod(weight * count, total) for weight in weights))
    result = list(whole)
    order = sorted(range(len(weights)), key=lambda index: (-fractions[index], index))
    for index in order[:count - sum(whole)]:
        result[index] += 1
    return result


def allocate_questions(blueprint, count):
    """Preserve group proportions first, then divide each group's questions."""
    groups = defaultdict(list)
    for topic in blueprint.topics:
        groups[topic.group].append(topic)
    group_counts = _apportion([sum(topic.weight for topic in group) for group in groups.values()], count)
    return {
        topic.id: quota
        for group, group_count in zip(groups.values(), group_counts)
        for topic, quota in zip(group, _apportion([topic.weight for topic in group], group_count))
    }


def normalize_evidence(text):
    text = unicodedata.normalize("NFKC", text).replace("\u00ad", "")
    text = re.sub(r"(?<=\w)[\-\u2010\u2011\u2012\u2013\u2014][ \t]*\r?\n[ \t]*(?=\w)", "", text)
    return re.sub(r"\s+", " ", text).strip().casefold()


def _terms(text):
    return [word.removesuffix("s") if len(word) > 4 else word
            for word in re.findall(r"[^\W\d_]{3,}", normalize_evidence(text))
            if word not in _STOP_WORDS]


def _phrases(words):
    return set(zip(words, words[1:]))


def _source_blocks(excerpt):
    return [(label, normalize_evidence(body))
            for label, body in re.findall(r"(?ms)^\[SOURCE: ([^\]]+)\]\s*(.*?)(?=^\[SOURCE: |\Z)", excerpt)]


class BlueprintPlan:
    """Keep topic targets and excerpt routing separate from provider retries."""

    def __init__(self, blueprint, count, windows, prior_items=()):
        self.blueprint = blueprint
        self.targets = allocate_questions(blueprint, count)
        self.prior = Counter(item.get("blueprint_topic") for item in prior_items)
        self.unsupported = defaultdict(set)
        self.postponed = set()
        self.topic = None
        self.index = 0
        self.previous_count = 0
        bodies = [re.sub(r"(?m)^\[SOURCE: .*?\]\s*", "", excerpt) for excerpt, _ in windows]
        window_words = [_terms(body) for body in bodies]
        window_terms = [set(words) for words in window_words]
        window_phrases = [_phrases(words) for words in window_words]
        document_frequency = Counter(word for words in window_terms for word in words)
        back_matter = [bool(re.search(r"(?im)^(?:subject index|author index|references|recommended resources)\b", body))
                       for body in bodies]
        self.ranked = {}
        for topic in blueprint.topics:
            if not self.targets[topic.id]:
                continue
            title_words = _terms(topic.title)
            detail_words = _terms(topic.description)
            title_terms = set(title_words)
            topic_terms = title_terms | set(detail_words)
            topic_phrases = _phrases(title_words) | _phrases(detail_words)
            scores = []
            for index, terms in enumerate(window_terms):
                matching_terms = topic_terms & terms
                score = sum((2 if word in title_terms else 1) * math.log1p(len(windows) / document_frequency[word])
                            for word in matching_terms)
                score += 6 * len(topic_phrases & window_phrases[index])
                scores.append(score * (0.35 if back_matter[index] else 1))
            ranked = sorted((index for index, score in enumerate(scores) if score > 0),
                            key=lambda index: (-scores[index], index))
            # Bound no-evidence calls on long books while allowing several
            # different chapters to contribute evidence.
            self.ranked[topic.id] = [windows[index] for index in ranked[:8]]

    def counts(self, completed):
        return self.prior + Counter(item.get("blueprint_topic") for item in completed)

    def remaining(self, completed):
        counts = self.counts(completed)
        return [(topic, self.targets[topic.id] - counts[topic.id])
                for topic in self.blueprint.topics if counts[topic.id] < self.targets[topic.id]]

    def coverage(self, completed):
        counts = self.counts(completed)
        return [
            {"topic_id": topic.id, "requested": self.targets[topic.id], "completed": counts[topic.id]}
            for topic in self.blueprint.topics if self.targets[topic.id]
        ]

    def batch_size(self, maximum, completed):
        for topic, deficit in self.remaining(completed):
            if topic.id in self.postponed:
                continue
            eligible = self.available_indices(topic)
            if not eligible:
                continue
            if self.topic != topic:
                self.topic = topic
                self.index = eligible[0]
            elif len(completed) > self.previous_count or self.index not in eligible:
                self.index = next((index for index in eligible if index > self.index), eligible[0])
            self.previous_count = len(completed)
            return min(maximum, deficit)
        self.topic = None
        return 0

    def available_indices(self, topic):
        return [index for index in range(len(self.ranked.get(topic.id, []))) if index not in self.unsupported[topic.id]]

    @property
    def excerpt(self):
        return self.ranked[self.topic.id][self.index]

    @property
    def window_count(self):
        return len(self.available_indices(self.topic)) if self.topic else 0

    def advance_window(self, completed_count):
        if self.topic is None:
            return False
        eligible = self.available_indices(self.topic)
        if len(eligible) < 2:
            return False
        self.index = next((index for index in eligible if index > self.index), eligible[0])
        self.previous_count = completed_count
        return True

    def report_insufficient(self):
        self.unsupported[self.topic.id].add(self.index)

    def postpone_topic(self, completed):
        """Let other topics make progress before retrying this one's invalid output."""
        if self.topic is None:
            return False
        self.postponed.add(self.topic.id)
        return any(topic.id not in self.postponed and self.available_indices(topic)
                   for topic, _ in self.remaining(completed))

    def has_postponed_work(self, completed):
        return any(topic.id in self.postponed and self.available_indices(topic)
                   for topic, _ in self.remaining(completed))

    def restart_pass(self):
        self.postponed.clear()

    def accept_candidates(self, candidates):
        """Assign the scheduled topic and derive citations from actual quotes."""
        blocks = _source_blocks(self.excerpt[0])
        accepted = []
        for item in candidates:
            evidence = item.get("statement_evidence") or [item.get("source_evidence")]
            refs = []
            for quote in evidence:
                if not isinstance(quote, str) or len(quote.strip()) < 12:
                    break
                normalized = normalize_evidence(quote)
                match = next((label for label, body in blocks if normalized in body), None)
                if match is None:
                    break
                refs.append(match)
            else:
                accepted.append({**item, "source_refs": list(dict.fromkeys(refs)), "blueprint_topic": self.topic.id})
        return accepted
