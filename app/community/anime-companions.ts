import catalog from "../../backend/anime-characters.json";

export type AnimeCharacter = (typeof catalog)[number] & {
  quote?: string;
  quoteSource?: string;
};

export const animeCharacters: readonly AnimeCharacter[] = catalog;
export const animeSeries = [...new Set(animeCharacters.map((character) => character.series))]
  .sort((left, right) => left.localeCompare(right));
const charactersById = new Map(animeCharacters.map((character) => [character.id, character]));

export function findAnimeCharacter(id: string) {
  return charactersById.get(id);
}

export function filterAnimeCharacters(series = "all", search = "") {
  const needle = search.normalize("NFKC").trim().toLocaleLowerCase();
  return animeCharacters.filter((character) =>
    (series === "all" || character.series === series) &&
    (!needle || `${character.name} ${character.series}`.normalize("NFKC").toLocaleLowerCase().includes(needle)),
  );
}

export function companionNameAfterSelection(name: string, previousId: string, nextId: string) {
  const next = findAnimeCharacter(nextId);
  if (!next) return name;
  const current = name.trim();
  return !current || current === "Miso" || current === findAnimeCharacter(previousId)?.name
    ? next.name
    : name;
}

export type CompanionBubble = { text: string; quoteSource?: string };

export function animeCompanionBubble(id: string, sequence: number): CompanionBubble | undefined {
  const character = findAnimeCharacter(id);
  if (!character) return undefined;
  // A companion can share a famous line from its series without pretending
  // that a different character's dialogue was its own.
  const speaker = character.quote && character.quoteSource ? character
    : animeCharacters.find(candidate => candidate.series === character.series && candidate.quote && candidate.quoteSource);
  if (sequence % 2 === 1 && speaker) {
    return { text: `“${speaker.quote}” — ${"quoteAttribution" in speaker && speaker.quoteAttribution || speaker.name}`, quoteSource: speaker.quoteSource };
  }
  return { text: character.studyLine };
}
