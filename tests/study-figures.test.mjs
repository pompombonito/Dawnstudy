import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../app/study-figures.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { sourceFigureLabel, studyFigures } = await import("data:text/javascript;base64," + Buffer.from(javascript).toString("base64"));

test("source figure numbers retain their actual numbering and support PDF dash variants", () => {
  assert.equal(sourceFigureLabel("FIGURE 1-4"), "Figure 1-4");
  assert.equal(sourceFigureLabel(" Fig. 1–5 "), "Figure 1-5");
  assert.equal(sourceFigureLabel("Figure: 12.3b"), "Figure 12.3b");
});

test("figure labels stay paired with their images and are never re-sorted by number", () => {
  assert.deepEqual(studyFigures({ images: ["pink", "red"], image_labels: ["Figure 1-5", "Figure 1-4"] }), [
    { image: "pink", sourceLabel: "Figure 1-5", label: "Figure 1-5" },
    { image: "red", sourceLabel: "Figure 1-4", label: "Figure 1-4" },
  ]);
});

test("generated figure descriptions cannot expose answers as visible source captions", () => {
  const description = "The pink CIN agar plate shows Yersinia enterocolitica.";
  assert.equal(sourceFigureLabel(description), undefined);
  assert.equal(sourceFigureLabel("Figure 1-5: Yersinia enterocolitica"), undefined);
  assert.deepEqual(studyFigures({ images: ["pink"], image_captions: [description] }), [
    { image: "pink", sourceLabel: undefined, label: "Attached image 1" },
  ]);
});

test("legacy label-only captions work, while unlabelled images use clearly ordinal names", () => {
  assert.equal(studyFigures({ images: ["red"], image_captions: ["Figure 1-4"] })[0].label, "Figure 1-4");
  assert.deepEqual(studyFigures({ images: ["first", "second"] }).map(figure => figure.label), ["Attached image 1", "Attached image 2"]);
  assert.deepEqual(studyFigures({}), []);
});
