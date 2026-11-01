import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../app/community/themes.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { THEMES } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);
const css = ["character-themes.css", "classic-themes.css"]
  .map(file => readFileSync(new URL(`../app/${file}`, import.meta.url), "utf8")).join("\n");
const palettes = new Map();
for (const match of css.matchAll(/:root\[data-character="([^"]+)"\]\[data-theme="(light|dark)"\]\s*\{([^}]+)\}/g)) {
  const id = `${match[1]}-${match[2]}`;
  assert.ok(!palettes.has(id), `Duplicate palette block: ${id}`);
  palettes.set(id, Object.fromEntries([...match[3].matchAll(/--([\w-]+):\s*(#[\da-f]{6})\b/gi)]
    .map(token => [token[1], token[2].toLowerCase()])));
}

function linearRgb(hex) {
  assert.match(hex || "", /^#[\da-f]{6}$/i, `Expected a six-digit palette color, got ${hex}`);
  return hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
}
function luminance(hex) {
  return linearRgb(hex).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}
function contrast(foreground, background) {
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
// Original linear-sRGB conversion: https://bottosson.github.io/posts/oklab/
function oklab(hex) {
  const [r, g, b] = linearRgb(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}
function colorDistance(first, second) {
  const a = oklab(first), b = oklab(second);
  return Math.hypot(...a.map((value, index) => value - b[index]));
}

test("theme picker swatches match the CSS page, card and accent colors", () => {
  assert.equal(palettes.size, THEMES.length);
  for (const theme of THEMES) {
    const palette = palettes.get(theme.id);
    assert.ok(palette, `Missing CSS palette: ${theme.id}`);
    assert.deepEqual([...theme.colors], [palette.paper, palette.card, palette.accent], `${theme.id} preview does not match its CSS`);
  }
});

test("theme families do not reuse the same page and card combination", () => {
  const seen = new Map();
  for (const [id, palette] of palettes) {
    const signature = `${palette.paper}/${palette.card}`;
    assert.ok(!seen.has(signature), `${id} and ${seen.get(signature)} have identical page/card colors`);
    seen.set(signature, id);
  }
});

for (const mode of ["light", "dark"]) {
  test(`${mode} theme family accents remain distinct`, () => {
    const choices = THEMES.filter(theme => theme.mode === mode);
    for (let first = 0; first < choices.length; first++) for (let second = first + 1; second < choices.length; second++) {
      const a = choices[first], b = choices[second];
      const firstAccent = palettes.get(a.id).accent, secondAccent = palettes.get(b.id).accent;
      const distance = colorDistance(firstAccent, secondAccent);
      // Project regression guard against near-duplicate palettes, not a universal
      // perception threshold. Browser screenshots still need visual review.
      assert.ok(distance >= 0.06, `${a.id} (${firstAccent}) and ${b.id} (${secondAccent}) accents are too similar: OKLab distance ${distance.toFixed(4)} < 0.06`);
    }
  });
}

test("theme text and primary button colors retain readable contrast", () => {
  const pairs = [
    ...["paper", "card", "field", "mint"].flatMap(background => [
      ["ink", background, 4.5], ["ink-soft", background, 4.5],
    ]),
    ["muted", "card", 4.5], ["on-accent", "accent", 4.5],
    ["coral", "paper", 3], // Large hero heading, rather than small body text.
  ];
  for (const [id, palette] of palettes) for (const [foreground, background, minimum] of pairs) {
    const ratio = contrast(palette[foreground], palette[background]);
    assert.ok(ratio >= minimum, `${id}: --${foreground} on --${background} is ${ratio.toFixed(3)}:1; requires ${minimum}:1`);
  }
});

test("Pompompurin dark keeps graphite surfaces and a custard-yellow accent", () => {
  const palette = palettes.get("pompompurin-dark");
  const rgb = hex => hex.slice(1).match(/../g).map(value => parseInt(value, 16));
  for (const token of ["paper", "card", "field", "sidebar", "mint", "sage"]) {
    const channels = rgb(palette[token]);
    assert.ok(Math.max(...channels) - Math.min(...channels) <= 8, `Pompompurin --${token} should stay neutral graphite instead of brown/olive`);
    assert.ok(Math.max(...channels) < 100, `Pompompurin --${token} should remain a dark surface`);
  }
  const [red, green, blue] = rgb(palette.accent);
  assert.ok(red > green && green > blue && red - green <= 50 && green - blue >= 50, "Pompompurin's accent should read as custard yellow rather than tan/orange");
});
