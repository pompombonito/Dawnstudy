type ImportedCard = { answer: string; correct_answer?: string; options?: string[] };

// Imported keys contain the full answer, never an option letter. Preserve
// meaningful punctuation (C++, C#, +/-) and literal pipes in source answers.
export function importedAnswerMatches(card: ImportedCard, response: unknown): boolean {
  const values = Array.isArray(response) ? response : [response];
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  return values.length === 1 && typeof values[0] === "string"
    && normalize(values[0]) === normalize(card.correct_answer || card.answer);
}
