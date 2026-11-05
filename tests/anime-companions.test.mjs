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

test("the catalog has unique named companions and complete anime rosters", () => {
  assert.equal(catalog.length, 91);
  assert.equal(new Set(catalog.map(character => character.id)).size, catalog.length);
  assert.deepEqual(helper.allCompanionCharacters, catalog);
  assert.equal(helper.animeCharacters.length, 80);
  assert.equal(helper.animeSeries.length, 16);
  for (const series of helper.animeSeries) {
    assert.equal(helper.filterAnimeCharacters(series).length, 5, series);
  }
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
    if (ownSeries.length) assert.ok(ownSeries.some(speaker => bubble.text.includes(speaker.quote) && bubble.quoteSource === speaker.quoteSource), character.id);
    else assert.equal(bubble.text, character.studyLine, character.id);
    assert.equal(helper.animeCompanionBubble(character.id, 2).text, character.studyLine);
  }
  const yuno = helper.animeCompanionBubble("anime-yuno", 1);
  assert.ok(yuno.text.endsWith("— Asta"), "A shared line keeps the actual speaker’s name");
});

test("K-pop selections contain the actual BLACKPINK and BTS artists under their stage names", () => {
  const blackpink = helper.filterKpopCharacters("BLACKPINK");
  const bts = helper.filterKpopCharacters("BTS");
  assert.deepEqual(blackpink.map(character => character.name), ["JISOO", "JENNIE", "ROSÉ", "LISA"]);
  assert.deepEqual(bts.map(character => character.name), ["RM", "Jin", "SUGA", "j-hope", "Jimin", "V", "Jung Kook"]);
  assert.deepEqual(blackpink.map(character => character.id), ["kpop-jisoo", "kpop-jennie", "kpop-rose", "kpop-lisa"]);
  assert.deepEqual(bts.map(character => character.id), ["kpop-rm", "kpop-jin", "kpop-suga", "kpop-jhope", "kpop-jimin", "kpop-v", "kpop-jungkook"]);
  assert.equal(helper.kpopCharacters.length, 11);
  assert.deepEqual(helper.kpopGroups, ["BLACKPINK", "BTS"]);
  for (const character of [...blackpink, ...bts]) {
    assert.equal(character.category, "kpop");
    assert.equal(character.bg, "transparent");
    assert.equal(new URL(character.reference).protocol, "https:");
    assert.equal(new URL(character.chibiReference).protocol, "https:");
    assert.ok(character.studyLine.trim());
    assert.equal(helper.animeCompanionBubble(character.id, 1).text, character.studyLine);
  }
});

test("anime and K-pop filters stay separate while supporting artist and group search", () => {
  assert.equal(helper.filterAnimeCharacters("all", "blackpink").length, 0);
  assert.equal(helper.filterAnimeCharacters("BLACKPINK").length, 0);
  assert.equal(helper.filterKpopCharacters("all", "Naruto").length, 0);
  assert.equal(helper.filterKpopCharacters("Naruto").length, 0);
  assert.equal(helper.filterKpopCharacters("all", "  BLACKPINK ").length, 4);
  assert.equal(helper.filterKpopCharacters("all", "bts").length, 7);
  assert.deepEqual(helper.filterKpopCharacters("BLACKPINK", "rose"), [helper.findAnimeCharacter("kpop-rose")]);
  assert.deepEqual(helper.filterKpopCharacters("BTS", "JUNG KOOK"), [helper.findAnimeCharacter("kpop-jungkook")]);
  assert.equal(helper.filterKpopCharacters("BLACKPINK", "Jimin").length, 0);
  assert.equal(helper.filterKpopCharacters("all", "SOOYA").length, 0);
  assert.equal(helper.companionCategory("anime-naruto"), "anime");
  assert.equal(helper.companionCategory("kpop-jisoo"), "kpop");
  assert.equal(helper.companionCategory("cat"), undefined);
});

test("K-pop search accepts full real names regardless of accents, spacing, or hyphens", () => {
  for (const character of helper.kpopCharacters) {
    assert.deepEqual(helper.filterKpopCharacters("all", character.fullName), [character]);
  }
  const queries = [
    ["Kim Namjoon", "kpop-rm"], ["  KIM  NAM  JOON  ", "kpop-rm"],
    ["Kim Nam-joon", "kpop-rm"], ["Kim Seokjin", "kpop-jin"],
    ["Min Yoongi", "kpop-suga"], ["Jung Hoseok", "kpop-jhope"],
    ["Park Jimin", "kpop-jimin"], ["Kim Taehyung", "kpop-v"],
    ["Jeon Jungkook", "kpop-jungkook"], ["Kim Jisoo", "kpop-jisoo"],
    ["Lalisa Manobal", "kpop-lisa"], ["Roseanne Park", "kpop-rose"],
    ["Jennie Kim", "kpop-jennie"], ["j hope", "kpop-jhope"],
    ["ROSÉ", "kpop-rose"],
  ];
  for (const [query, id] of queries) {
    assert.deepEqual(helper.filterKpopCharacters("all", query), [helper.findAnimeCharacter(id)], query);
    assert.equal(helper.filterAnimeCharacters("all", query).length, 0, query);
  }
  assert.equal(helper.filterKpopCharacters("BLACKPINK", "Kim Namjoon").length, 0);
});

test("saved mascot selections migrate to artists and keep custom companion names", () => {
  const legacy = [
    ["sooya", "SOOYA", "jisoo"], ["gomdeuki", "GOMDEUKI", "jennie"],
    ["rosie", "ROSIE", "rose"], ["ppeu", "PPEU", "lisa"],
    ["koya", "KOYA", "rm"], ["rj", "RJ", "jin"], ["shooky", "SHOOKY", "suga"],
    ["mang", "MANG", "jhope"], ["chimmy", "CHIMMY", "jimin"],
    ["tata", "TATA", "v"], ["cooky", "COOKY", "jungkook"], ["van", "VAN", "rm"],
  ];
  for (const [oldSuffix, oldName, newSuffix] of legacy) {
    const oldId = `kpop-${oldSuffix}`, next = helper.findAnimeCharacter(`kpop-${newSuffix}`);
    assert.ok(next, newSuffix);
    assert.deepEqual(helper.findAnimeCharacter(oldId), next, oldId);
    assert.equal(helper.companionCategory(oldId), "kpop");
    assert.equal(helper.companionNameAfterSelection(oldName, oldId, oldId), next.name, oldId);
    assert.equal(helper.companionNameAfterSelection("My study friend", oldId, next.id), "My study friend", oldId);
    assert.equal(helper.animeCompanionBubble(oldId, 1).text, helper.animeCompanionBubble(next.id, 1).text);
  }
  assert.equal(helper.findAnimeCharacter("kpop-unknown-mascot"), undefined);
});

test("Naruto companions use their own sourced lines instead of another character's dialogue", () => {
  for (const id of ["anime-naruto", "anime-sasuke", "anime-sakura", "anime-kakashi", "anime-hinata"]) {
    const character = helper.findAnimeCharacter(id), bubble = helper.animeCompanionBubble(id, 1);
    assert.ok(character.quote && character.quoteSource, id);
    assert.equal(bubble.text, `“${character.quote}” — ${character.name}`);
    assert.equal(bubble.quoteSource, character.quoteSource);
  }
});
