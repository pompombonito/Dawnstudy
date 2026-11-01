import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../app/community/themes.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const {
  CHARACTERS, THEMES, DEFAULT_THEME, THEME_STORAGE_KEY, GUEST_THEME_STORAGE_KEY,
  SESSION_STORAGE_KEY, normalizeTheme, getTheme, themeFor, setThemeCharacter,
  setThemeMode, readInitialTheme, applyTheme, themeBootstrapScript,
} = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);

const storage = values => ({ getItem: key => values[key] ?? null });
const root = () => ({ dataset: {}, style: {} });

test("five characters each have exactly one canonical light and dark theme", () => {
  assert.deepEqual(CHARACTERS.map(character => character.id), ["cinnamoroll", "pompompurin", "kuromi", "hello-kitty", "pochacco"]);
  assert.equal(THEMES.length, 10);
  assert.equal(new Set(THEMES.map(theme => theme.id)).size, 10);
  for (const character of CHARACTERS) {
    assert.deepEqual(THEMES.filter(theme => theme.character === character.id).map(theme => theme.mode).sort(), ["dark", "light"]);
    for (const mode of ["light", "dark"]) {
      const theme = getTheme(themeFor(character.id, mode));
      assert.equal(theme.id, `${character.id}-${mode}`);
      assert.equal(theme.colors.length, 3);
      assert.ok(theme.colors.every(color => /^#[0-9a-f]{6}$/i.test(color)));
      assert.ok(theme.name.includes(character.name));
    }
  }
});

test("legacy preferences migrate deterministically and unknown values default to Kuromi", () => {
  assert.equal(DEFAULT_THEME, "kuromi-dark");
  assert.equal(normalizeTheme("light"), "cinnamoroll-light");
  assert.equal(normalizeTheme("dark"), "kuromi-dark");
  assert.equal(normalizeTheme("rose"), "hello-kitty-light");
  assert.equal(normalizeTheme("  HELLO-KITTY-DARK  "), "hello-kitty-dark");
  for (const value of [undefined, null, "", "green", "constructor", "__proto__", 1, {}, ["cinnamoroll-light"]]) {
    assert.equal(normalizeTheme(value), DEFAULT_THEME);
  }
});

test("changing characters preserves the current light or dark mode", () => {
  for (const current of THEMES) {
    for (const character of CHARACTERS) {
      assert.equal(setThemeCharacter(current.id, character.id), `${character.id}-${current.mode}`);
    }
  }
  assert.equal(setThemeCharacter("rose", "pompompurin"), "pompompurin-light");
});

test("changing modes preserves the selected character", () => {
  for (const current of THEMES) {
    assert.equal(setThemeMode(current.id, "light"), `${current.character}-light`);
    assert.equal(setThemeMode(current.id, "dark"), `${current.character}-dark`);
  }
});

test("account preferences require a session and guest preferences stay separate", () => {
  assert.equal(readInitialTheme(storage({ [THEME_STORAGE_KEY]: "pompompurin-light" })), DEFAULT_THEME);
  assert.equal(readInitialTheme(storage({ [THEME_STORAGE_KEY]: "rose", [GUEST_THEME_STORAGE_KEY]: "pochacco-dark" })), "pochacco-dark");
  assert.equal(readInitialTheme(storage({ [SESSION_STORAGE_KEY]: "session", [THEME_STORAGE_KEY]: "rose", [GUEST_THEME_STORAGE_KEY]: "pochacco-dark" })), "hello-kitty-light");
  assert.equal(readInitialTheme(storage({ [SESSION_STORAGE_KEY]: "session", [GUEST_THEME_STORAGE_KEY]: "pochacco-light" })), DEFAULT_THEME);
  assert.equal(readInitialTheme({ getItem() { throw new Error("Storage blocked"); } }), DEFAULT_THEME);
});

test("applying a theme maintains old CSS mode selectors and sets character identity", () => {
  for (const theme of THEMES) {
    const documentRoot = root();
    assert.equal(applyTheme(theme.id, documentRoot), theme.id);
    assert.deepEqual(documentRoot.dataset, { theme: theme.mode, character: theme.character, colorTheme: theme.id });
    assert.equal(documentRoot.style.colorScheme, theme.mode);
  }
  assert.equal(applyTheme("rose"), "hello-kitty-light"); // Safe during server rendering.
});

test("prepaint bootstrap matches runtime storage selection for every theme and alias", () => {
  const values = [...THEMES.map(theme => theme.id), "light", "dark", "rose", "unknown", "__proto__", '";globalThis.injected=true;//', null];
  for (const value of values) {
    for (const hasSession of [false, true]) {
      const preferences = storage({
        [SESSION_STORAGE_KEY]: hasSession ? "session" : null,
        [THEME_STORAGE_KEY]: value,
        [GUEST_THEME_STORAGE_KEY]: hasSession ? "pochacco-light" : value,
      });
      const expected = root();
      applyTheme(readInitialTheme(preferences), expected);
      const actual = root();
      const context = { localStorage: preferences, document: { documentElement: actual } };
      vm.runInNewContext(themeBootstrapScript, context);
      assert.deepEqual(actual, expected);
      assert.equal(context.injected, undefined);
    }
  }
});

test("prepaint bootstrap still applies Kuromi when browser storage is blocked", () => {
  const actual = root();
  vm.runInNewContext(themeBootstrapScript, {
    document: { documentElement: actual },
    localStorage: { getItem() { throw new Error("Storage blocked"); } },
  });
  assert.deepEqual(actual, { dataset: { theme: "dark", character: "kuromi", colorTheme: "kuromi-dark" }, style: { colorScheme: "dark" } });
});
