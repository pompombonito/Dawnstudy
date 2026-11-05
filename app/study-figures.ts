export type StudyFigureCard = {
  images?: readonly string[];
  image_labels?: readonly string[];
  image_captions?: readonly string[];
};

/** Only a source figure identifier is safe to show before an answer is revealed. */
export function sourceFigureLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.normalize("NFKC").replace(/[–—−]/g, "-").match(/^\s*(?:Figure|Fig\.?)[\s:]+(\d+(?:[.\-]\d+)*[A-Za-z]?)\s*$/iu);
  return match ? `Figure ${match[1]}` : undefined;
}

export function studyFigures(card: StudyFigureCard) {
  return (card.images || []).map((image, index) => {
    const sourceLabel = sourceFigureLabel(card.image_labels?.[index]) || sourceFigureLabel(card.image_captions?.[index]);
    return { image, sourceLabel, label: sourceLabel || `Attached image ${index + 1}` };
  });
}
