export type QuizKind = "flashcards" | "multiple_choice" | "checkbox" | "identification" | "matching";
type QuizCard = {
  answer: string; correct_answer?: string; correct_answers?: string[]; options?: string[]; imported?: boolean;
  quiz_type?: QuizKind; matching_prompts?: string[];
  matching_pairs?: { prompt: string; answer: string }[];
};

export function normalizedAnswer(value: unknown): string {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase().trim().replace(/\s+/g, " ");
}

export function quizKind(card: QuizCard, setType: string): QuizKind {
  // Imported mixed-format sets carry the chosen interaction on each card.
  // Honor it in private, shared, review, and practice sessions alike.
  if (card.quiz_type) return card.quiz_type;
  if (setType === "same_as_source") {
    if (card.matching_prompts?.length) return "matching";
    return card.options?.length ? "multiple_choice" : "identification";
  }
  return setType as QuizKind;
}

export function resolveChoiceAnswers(answer: unknown, options: string[]): string[] {
  const raw = String(answer ?? "").trim();
  const exactOption = (value: string) => {
    const matches = options.filter((option) => normalizedAnswer(option) === normalizedAnswer(value));
    return matches.length === 1 ? matches[0] : undefined;
  };
  // An answer can literally be "B" or contain a pipe. Resolve the whole text
  // before interpreting labels or a delimiter for multiple correct answers.
  const wholeMatch = exactOption(raw);
  const parts = wholeMatch ? [raw] : raw.split("|").map((value) => value.trim()).filter(Boolean);
  const resolved: string[] = [];
  for (const part of parts) {
    let match = exactOption(part);
    if (!match) {
      const letter = part.match(/^(?:option\s*)?([A-Z])(?:[.):\-])?$/i);
      if (letter) match = options[letter[1].toUpperCase().charCodeAt(0) - 65];
    }
    if (!match) return [];
    if (!resolved.some((option) => normalizedAnswer(option) === normalizedAnswer(match))) resolved.push(match);
  }
  return resolved;
}

export function quizAnswerIsCorrect(card: QuizCard, setType: string, response: unknown): boolean {
  if (response === null || response === undefined) return false;
  const kind = quizKind(card, setType);
  if (kind === "matching") {
    if (typeof response !== "object" || Array.isArray(response)) return false;
    const matches = card.matching_pairs || [];
    return matches.length > 0 && matches.length === (card.matching_prompts || []).length
      && Object.keys(response).length === (card.matching_prompts || []).length
      && matches.every((pair) => normalizedAnswer((response as Record<string, unknown>)[pair.prompt]) === normalizedAnswer(pair.answer));
  }
  if (typeof response !== "string" && !Array.isArray(response)) return false;
  const raw = card.correct_answer || card.answer || "";
  // Imported keys are complete source text, including literal pipes and letters.
  const resolved = card.imported
    ? kind === "checkbox" && card.correct_answers?.length ? card.correct_answers : [raw]
    : resolveChoiceAnswers(raw, card.options || []);
  const expected = (resolved.length ? resolved : kind === "checkbox" ? raw.split("|") : [raw])
    .map(normalizedAnswer).filter(Boolean).sort();
  if (kind === "checkbox") {
    const values = Array.isArray(response) ? response : card.imported
      ? card.correct_answers && card.correct_answers.length > 1 ? response.split(/\r?\n/) : [response]
      : response.split("|");
    if (values.some((value) => typeof value !== "string")) return false;
    const actual = values.map(normalizedAnswer).filter(Boolean).sort();
    return actual.length > 0 && actual.length === expected.length && actual.every((answer, index) => answer === expected[index]);
  }
  const actual = Array.isArray(response) ? response.length === 1 ? response[0] : undefined : response;
  return typeof actual === "string" && expected.includes(normalizedAnswer(actual));
}
