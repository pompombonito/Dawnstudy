import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../app/pending-generation.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { generationCheckpointRevision } = await import("data:text/javascript;base64," + Buffer.from(javascript).toString("base64"));

test("full-count source-keyed checkpoints change revision as explanations finish", () => {
  const checkpoint = { requested_count: 2, incomplete: true, items: [
    { card_id: "one", question: "First?", answer: "Alpha", explanation: "", explanation_pending: true },
    { card_id: "two", question: "Second?", answer: "Beta", explanation: "", explanation_pending: true },
  ] };
  const original = generationCheckpointRevision(checkpoint);
  const next = structuredClone(checkpoint);
  next.items[0].explanation = "Alpha follows from the first source statement.";
  next.items[0].explanation_origin = "ai";
  delete next.items[0].explanation_pending;
  assert.equal(checkpoint.items.length, next.items.length);
  assert.notEqual(generationCheckpointRevision(next), original);
  assert.equal(generationCheckpointRevision(structuredClone(next)), generationCheckpointRevision(next));
});

test("unchanged large source figures do not inflate per-poll checkpoint comparisons", () => {
  const checkpoint = { requested_count: 1, items: [{ question: "Identify the image.", answer: "Alpha", images: ["data:image/png;base64," + "A".repeat(2_000_000)], option_labels: ["E", "F"] }] };
  const revision = generationCheckpointRevision(checkpoint);
  assert.ok(revision.length < 300);
  assert.equal(generationCheckpointRevision(structuredClone(checkpoint)), revision);
  checkpoint.items[0].option_labels = ["A", "B"];
  assert.notEqual(generationCheckpointRevision(checkpoint), revision);
});
