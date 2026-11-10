import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../app/choice-labels.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { choiceLabel } = await import("data:text/javascript;base64," + Buffer.from(javascript).toString("base64"));

test("original E/F/G/H labels remain paired with source choices", () => {
  const card = { options: ["First", "Second", "Third", "Fourth"], option_labels: ["E", "F", "G", "H"] };
  assert.deepEqual(card.options.map((_, index) => choiceLabel(card, index)), ["E", "F", "G", "H"]);
  assert.deepEqual(card.options, ["First", "Second", "Third", "Fourth"]);
});

test("unlabelled and malformed legacy options use stable alphabetical labels", () => {
  for (const card of [{ options: ["One", "Two"] }, { options: ["One", "Two"], option_labels: ["E"] }, { options: ["One", "Two"], option_labels: ["", "H"] }]) {
    assert.deepEqual(card.options.map((_, index) => choiceLabel(card, index)), ["A", "B"]);
  }
  assert.equal(choiceLabel({}, 26), "AA");
});

test("matching options use their original printed labels too", () => {
  const card = { options: [], matching_options: ["C#", "C++"], option_labels: ["E", "F"] };
  assert.deepEqual(card.matching_options.map((_, index) => choiceLabel(card, index)), ["E", "F"]);
});
