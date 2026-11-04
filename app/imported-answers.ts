type ImportedCard = { answer: string; correct_answer?: string; correct_answers?: string[]; options?: string[] };

const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase();

function correctAnswers(card: ImportedCard): string[] {
  return card.correct_answers?.length ? card.correct_answers : [card.correct_answer || card.answer];
}

export function importedOptionIsCorrect(card: ImportedCard, option: string): boolean {
  return correctAnswers(card).some((answer) => normalize(answer) === normalize(option));
}

// Imported keys contain the full answer, never an option letter. Preserve
// meaningful punctuation (C++, C#, +/-) and literal pipes in source answers.
export function importedAnswerMatches(card: ImportedCard, response: unknown): boolean {
  const values = Array.isArray(response) ? response : [response];
  const expected = correctAnswers(card).map(normalize).sort();
  if (values.length !== expected.length || values.some((value) => typeof value !== "string")) return false;
  const actual = values.map((value) => normalize(value as string)).sort();
  return actual.every((value, index) => value === expected[index]);
}
