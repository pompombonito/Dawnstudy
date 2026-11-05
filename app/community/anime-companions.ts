import catalog from "../../backend/anime-characters.json";

export type AnimeCharacter = (typeof catalog)[number] & {
  quote?: string;
  quoteSource?: string;
};

export const allCompanionCharacters: readonly AnimeCharacter[] = catalog;
export const animeCharacters = allCompanionCharacters.filter(character => !character.id.startsWith("kpop-"));
export const kpopCharacters = allCompanionCharacters.filter(character => character.id.startsWith("kpop-"));
export const animeSeries = [...new Set(animeCharacters.map((character) => character.series))]
  .sort((left, right) => left.localeCompare(right));
export const kpopGroups = [...new Set(kpopCharacters.map((character) => character.series))]
  .sort((left, right) => left.localeCompare(right));
const charactersById = new Map(allCompanionCharacters.map((character) => [character.id, character]));
// Preserve saved selections from the brief mascot release while showing the artist.
const legacyKpopSelections: Record<string, { id: string; name: string }> = {
  "kpop-sooya": { id: "kpop-jisoo", name: "SOOYA" },
  "kpop-gomdeuki": { id: "kpop-jennie", name: "GOMDEUKI" },
  "kpop-rosie": { id: "kpop-rose", name: "ROSIE" },
  "kpop-ppeu": { id: "kpop-lisa", name: "PPEU" },
  "kpop-koya": { id: "kpop-rm", name: "KOYA" },
  "kpop-rj": { id: "kpop-jin", name: "RJ" },
  "kpop-shooky": { id: "kpop-suga", name: "SHOOKY" },
  "kpop-mang": { id: "kpop-jhope", name: "MANG" },
  "kpop-chimmy": { id: "kpop-jimin", name: "CHIMMY" },
  "kpop-tata": { id: "kpop-v", name: "TATA" },
  "kpop-cooky": { id: "kpop-jungkook", name: "COOKY" },
  "kpop-van": { id: "kpop-rm", name: "VAN" },
};

export function findAnimeCharacter(id: string) {
  return charactersById.get(legacyKpopSelections[id]?.id || id);
}

export function companionCategory(id: string) {
  const character = findAnimeCharacter(id);
  return character ? character.id.startsWith("kpop-") ? "kpop" : "anime" : undefined;
}

function searchable(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function filterCharacters(characters: readonly AnimeCharacter[], series: string, search: string) {
  const needle = searchable(search);
  return characters.filter((character) => {
    const fullName = "fullName" in character && typeof character.fullName === "string" ? character.fullName : "";
    return (series === "all" || character.series === series) &&
      (!needle || searchable(`${character.name} ${fullName} ${character.series}`).includes(needle));
  });
}

export function filterAnimeCharacters(series = "all", search = "") {
  return filterCharacters(animeCharacters, series, search);
}

export function filterKpopCharacters(group = "all", search = "") {
  return filterCharacters(kpopCharacters, group, search);
}

export function companionNameAfterSelection(name: string, previousId: string, nextId: string) {
  const next = findAnimeCharacter(nextId);
  if (!next) return name;
  const current = name.trim();
  return !current || current === "Miso" || current === findAnimeCharacter(previousId)?.name || current === legacyKpopSelections[previousId]?.name
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
    : allCompanionCharacters.find(candidate => candidate.series === character.series && candidate.quote && candidate.quoteSource);
  if (sequence % 2 === 1 && speaker) {
    return { text: `“${speaker.quote}” — ${"quoteAttribution" in speaker && speaker.quoteAttribution || speaker.name}`, quoteSource: speaker.quoteSource };
  }
  return { text: character.studyLine };
}
