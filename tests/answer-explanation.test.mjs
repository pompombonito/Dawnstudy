import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const javascript = ts.transpileModule(readFileSync(new URL("../app/components/AnswerExplanation.tsx", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const module = { exports: {} };
new Function("require", "module", "exports", javascript)(createRequire(import.meta.url), module, module.exports);
const AnswerExplanation = module.exports.default;
const render = (card, revealed) => renderToStaticMarkup(React.createElement(AnswerExplanation, { card, revealed }));

test("answers and rationale metadata never enter the DOM before reveal", () => {
  for (const origin of ["provided", "ai", undefined]) {
    assert.equal(render({ explanation: "SECRET: answer is mitochondrion.", explanation_origin: origin, import_notices: ["SECRET answer imported"] }, false), "");
  }
});

test("provided rationale is preserved as source text with clear provenance", () => {
  const html = render({ explanation: "C++ is correct because std::cout uses <iostream>.\nC# uses another API.", explanation_origin: "provided" }, true);
  assert.match(html, /Explanation from your material/);
  assert.match(html, /C\+\+ is correct because std::cout uses &lt;iostream&gt;/);
  assert.match(html, /\nC# uses another API\./);
  assert.doesNotMatch(html, /AI explanation/);
});

test("AI explanations have distinct provenance and import notices remain separate", () => {
  const html = render({ explanation: "Mitochondria make ATP.", explanation_origin: "ai", import_notices: ["Answer inferred; review it.", "Choices added by AI.", "Choices added by AI."] }, true);
  assert.match(html, /AI explanation · review for accuracy/);
  assert.match(html, /answer-rationale.*Mitochondria make ATP/);
  assert.match(html, /answer-import-notices.*Import notes.*Answer inferred/);
  assert.equal((html.match(/Choices added by AI\./g) || []).length, 1);
});

test("notice-only imports are not presented as an answer explanation", () => {
  const html = render({ explanation: " ", import_notices: ["OCR text needs review."] }, true);
  assert.match(html, /Import notes/);
  assert.doesNotMatch(html, /answer-rationale|Why this answer|AI explanation/);
  assert.equal(render({ explanation: " ", import_notices: [] }, true), "");
});

test("pending explanation status is shown only after the supplied answer is revealed", () => {
  assert.equal(render({ explanation_pending: true }, false), "");
  assert.match(render({ explanation_pending: true }, true), /explanation is still being prepared/);
  assert.doesNotMatch(render({ explanation_pending: true }, true), /AI explanation/);
});
