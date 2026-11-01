import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const catalog = JSON.parse(readFileSync(new URL("../backend/anime-characters.json", import.meta.url), "utf8"));
const source = readFileSync(new URL("../app/community/anime-companions.ts", import.meta.url), "utf8");
async function loadHelper(characters) {
  const javascript = ts.transpileModule(source.replace(/import catalog from [^;]+;/, `const catalog = ${JSON.stringify(characters)};`), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return import("data:text/javascript;base64," + Buffer.from(javascript).toString("base64"));
}
const helper = await loadHelper(catalog);

test("the catalog contains five unique characters per series and supports exact lookup only", () => {
  assert.equal(catalog.length, 80);
  assert.equal(new Set(catalog.map(character => character.id)).size, catalog.length);
  assert.equal(helper.animeSeries.length, 16);
  for (const series of helper.animeSeries) assert.equal(helper.filterAnimeCharacters(series).length, 5);
  for (const character of catalog) {
    assert.deepEqual(helper.findAnimeCharacter(character.id), character);
    assert.equal(helper.findAnimeCharacter(character.id + "-variant"), undefined);
    assert.ok(character.name.length <= 24, "Automatic companion names must fit the profile field");
    assert.ok(character.studyLine.trim());
    if (character.quote) {
      assert.equal(new URL(character.quoteSource).protocol, "https:");
      assert.ok(character.quote.trim().split(/\s+/u).length <= 10, "Canonical excerpts stay brief");
    }
  }
});

test("anime search combines series selection with case-insensitive character and series names", () => {
  const selected = catalog[0];
  assert.deepEqual(helper.filterAnimeCharacters(selected.series, selected.name.toUpperCase()), [selected]);
  assert.equal(helper.filterAnimeCharacters("all", selected.series.toUpperCase()).length, 5);
  assert.equal(helper.filterAnimeCharacters("all", "  no such study character  ").length, 0);
  const otherSeries = helper.animeSeries.find(series => series !== selected.series);
  assert.equal(helper.filterAnimeCharacters(otherSeries, selected.name).length, 0);
});

test("selecting anime replaces only the default, empty, or previous character name", () => {
  const [first, next] = catalog;
  assert.equal(helper.companionNameAfterSelection("Miso", "cat", first.id), first.name);
  assert.equal(helper.companionNameAfterSelection("  ", "cat", first.id), first.name);
  assert.equal(helper.companionNameAfterSelection(first.name, first.id, next.id), next.name);
  assert.equal(helper.companionNameAfterSelection("My study pal", first.id, next.id), "My study pal");
  assert.equal(helper.companionNameAfterSelection("Miso", "cat", "bogus-character"), "Miso");
});

test("anime bubbles alternate original study lines and attributed sourced quotes", async () => {
  const character = { id: "anime-test", name: "Study Hero", series: "Test series", studyLine: "Let's review one more page.", quote: "Keep going.", quoteSource: "https://example.com/official-quote" };
  const { animeCompanionBubble } = await loadHelper([character]);
  assert.deepEqual(animeCompanionBubble(character.id, 0), { text: character.studyLine });
  assert.deepEqual(animeCompanionBubble(character.id, 1), { text: "“Keep going.” — Study Hero", quoteSource: character.quoteSource });
  assert.deepEqual(animeCompanionBubble(character.id, 2), { text: character.studyLine });
  assert.equal(animeCompanionBubble("cat", 1), undefined);
});

test("unsourced and missing quotes fall back to original study encouragement", async () => {
  const characters = [
    { id: "anime-no-quote", name: "Study Hero", series: "Test series", studyLine: "Small steps help." },
    { id: "anime-no-source", name: "Study Hero", series: "Test series", studyLine: "Small steps help.", quote: "Unverified words." },
  ];
  const { animeCompanionBubble } = await loadHelper(characters);
  for (const character of characters) {
    assert.deepEqual(animeCompanionBubble(character.id, 0), { text: character.studyLine });
    assert.deepEqual(animeCompanionBubble(character.id, 1), { text: character.studyLine });
  }
});

test("a shared series rule keeps its own attribution", () => {
  const character = catalog.find(character => character.quoteAttribution);
  assert.ok(character);
  assert.equal(helper.animeCompanionBubble(character.id, 1).text,
    `“${character.quote}” — ${character.quoteAttribution}`);
});

test("every companion can share a sourced signature line from its own series", () => {
  for (const character of catalog) {
    const bubble = helper.animeCompanionBubble(character.id, 1);
    const ownSeries = catalog.filter(speaker => speaker.series === character.series && speaker.quoteSource);
    assert.ok(ownSeries.some(speaker => bubble.text.includes(speaker.quote) && bubble.quoteSource === speaker.quoteSource), character.id);
    assert.equal(helper.animeCompanionBubble(character.id, 2).text, character.studyLine);
  }
  const yuno = helper.animeCompanionBubble("anime-yuno", 1);
  assert.ok(yuno.text.endsWith("— Asta"), "A shared line keeps the actual speaker’s name");
});
