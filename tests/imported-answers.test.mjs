import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile(new URL("../app/imported-answers.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { importedAnswerMatches } = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

test("imported keys distinguish punctuation, literal option letters and pipes", () => {
  for (const [answer, wrong] of [["C++", "C#"], ["x | y", "x"], ["B", "second option"], ["-1", "1"]]) {
    const card = { answer, correct_answer: answer, options: [wrong, answer] };
    assert.equal(importedAnswerMatches(card, answer), true);
    assert.equal(importedAnswerMatches(card, wrong), false);
    assert.equal(importedAnswerMatches(card, [answer, wrong]), false);
    assert.equal(importedAnswerMatches(card, [answer]), true);
  }
});
test("imported text answers allow whitespace and case without removing symbols", () => {
  assert.equal(importedAnswerMatches({ answer: "Cell membrane" }, " cell   MEMBRANE "), true);
  assert.equal(importedAnswerMatches({ answer: "Cell membrane" }, undefined), false);
});
