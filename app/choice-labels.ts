type ChoiceLabels = { options?: readonly string[]; matching_options?: readonly string[]; option_labels?: readonly string[] };

/** Imported choices keep their printed labels as well as their original order. */
export function choiceLabel(card: ChoiceLabels, index: number): string {
  const labels = card.option_labels;
  const options = card.options?.length ? card.options : card.matching_options;
  if (labels?.length === options?.length && labels?.every((label) => typeof label === "string" && label.trim())) {
    return labels[index]?.trim() || "";
  }
  let value = index + 1, label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + value % 26) + label;
    value = Math.floor(value / 26);
  }
  return label;
}
