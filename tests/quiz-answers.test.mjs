import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../app/quiz-answers.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { quizKind, resolveChoiceAnswers, quizAnswerIsCorrect } = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

test("shared and personal quizzes distinguish meaningful punctuation", () => {
  for (const [answer, wrong] of [["C++", "C#"], ["-1", "1"], ["+/-", "+"], ["x | y", "x"]]) {
    const card = { answer, options: [wrong, answer] };
    assert.deepEqual(resolveChoiceAnswers(answer, card.options), [answer]);
    assert.equal(quizAnswerIsCorrect(card, "multiple_choice", answer), true);
    assert.equal(quizAnswerIsCorrect(card, "multiple_choice", wrong), false);
  }
});

test("literal option letters and pipes take precedence over labels and delimiters", () => {
  assert.deepEqual(resolveChoiceAnswers("B", ["B", "A", "C"]), ["B"]);
  assert.deepEqual(resolveChoiceAnswers("x | y", ["x", "y", "x | y"]), ["x | y"]);
  assert.deepEqual(resolveChoiceAnswers("E", ["First", "Second", "Third", "Fourth", "Fifth"]), ["Fifth"]);
});

test("an unrecognized answer does not fuzzily select a nearby option", () => {
  const card = { answer: "option that's not present", options: ["option that's not presents", "Other"] };
  assert.deepEqual(resolveChoiceAnswers(card.answer, card.options), []);
  assert.equal(quizAnswerIsCorrect(card, "multiple_choice", card.options[0]), false);
});

test("mixed source checkbox questions require all answers exactly once", () => {
  const card = { quiz_type: "checkbox", answer: "Alpha | Gamma", options: ["Alpha", "Beta", "Gamma"] };
  assert.equal(quizKind(card, "same_as_source"), "checkbox");
  assert.equal(quizAnswerIsCorrect(card, "same_as_source", ["Gamma", "Alpha"]), true);
  assert.equal(quizAnswerIsCorrect(card, "same_as_source", ["Alpha"]), false);
  assert.equal(quizAnswerIsCorrect(card, "same_as_source", ["Alpha", "Gamma", "Beta"]), false);
  assert.equal(quizAnswerIsCorrect(card, "same_as_source", ["Alpha", "Alpha"]), false);
});

test("explicit formats survive stale options and source subtype metadata", () => {
  const card = { quiz_type: "multiple_choice", answer: "Alpha", options: ["Alpha", "Beta"] };
  assert.equal(quizKind(card, "flashcards"), "multiple_choice");
  assert.equal(quizKind(card, "identification"), "multiple_choice");
  assert.equal(quizKind(card, "multiple_choice"), "multiple_choice");
});

test("per-card types stay intact inside a user-selected mixed quiz set", () => {
  const setType = "multiple_choice";
  assert.equal(quizKind({ quiz_type: "identification", answer: "Mitochondrion" }, setType), "identification");
  assert.equal(quizKind({ quiz_type: "matching", answer: "", matching_prompts: ["One"] }, setType), "matching");
  assert.equal(quizKind({ answer: "Alpha", options: ["Alpha", "Beta"] }, setType), "multiple_choice");
  assert.equal(quizAnswerIsCorrect({ quiz_type: "identification", imported: true, answer: "Mitochondrion" }, setType, "Mitochondrion"), true);
});

test("older mixed imports recover interaction from card data when subtype is missing", () => {
  assert.equal(quizKind({ answer: "Alpha", options: ["Alpha", "Beta"] }, "same_as_source"), "multiple_choice");
  assert.equal(quizKind({ answer: "Alpha" }, "same_as_source"), "identification");
  assert.equal(quizKind({ answer: "", matching_prompts: ["One"] }, "same_as_source"), "matching");
});

test("matching grades every prompt and preserves answer punctuation", () => {
  const card = { quiz_type: "matching", answer: "", matching_prompts: ["First", "Second"], matching_pairs: [{ prompt: "First", answer: "C++" }, { prompt: "Second", answer: "C#" }] };
  assert.equal(quizAnswerIsCorrect(card, "same_as_source", { First: "C++", Second: "C#" }), true);
  assert.equal(quizAnswerIsCorrect(card, "same_as_source", { First: "C#", Second: "C++" }), false);
  assert.equal(quizAnswerIsCorrect(card, "same_as_source", { First: "C++" }), false);
  assert.equal(quizAnswerIsCorrect(card, "same_as_source", { First: "C++", Second: "C#", Extra: "C#" }), false);
  assert.equal(quizAnswerIsCorrect({ ...card, matching_pairs: [] }, "same_as_source", { First: "C++", Second: "C#" }), false);
});

test("imported source answers remain literal and single-answer quizzes reject extra responses", () => {
  const card = { imported: true, answer: "x | y", options: ["x | y", "x", "y"] };
  assert.equal(quizAnswerIsCorrect(card, "multiple_choice", " X | Y "), true);
  assert.equal(quizAnswerIsCorrect(card, "multiple_choice", ["x", "y"]), false);
  assert.equal(quizAnswerIsCorrect(card, "checkbox", ["x | y"]), true);
  assert.equal(quizAnswerIsCorrect({ answer: "Alpha" }, "identification", ["Alpha", "wrong"]), false);
});

test("imported checkbox keys use structured answers and retain literal pipes inside an option", () => {
  const card = { imported: true, quiz_type: "checkbox", answer: "x | y | C++", correct_answers: ["x | y", "C++"], options: ["x | y", "C++", "C#"] };
  assert.equal(quizAnswerIsCorrect(card, "same_as_source", ["C++", "x | y"]), true);
  assert.equal(quizAnswerIsCorrect(card, "same_as_source", ["x", "y", "C++"]), false);
  assert.equal(quizAnswerIsCorrect(card, "same_as_source", ["x | y", "C#"]), false);
  assert.equal(quizAnswerIsCorrect(card, "identification", "x | y | C++"), false);
});

test("written imported multi-answer questions preserve literal pipes with one answer per line", () => {
  const card = { imported: true, quiz_type: "checkbox", answer: "x | y | C++", correct_answers: ["x | y", "C++"] };
  assert.equal(quizAnswerIsCorrect(card, "checkbox", "C++\nx | y"), true);
  assert.equal(quizAnswerIsCorrect(card, "checkbox", "C++ | x | y"), false);
  assert.equal(quizAnswerIsCorrect(card, "checkbox", "C++\nx\ny"), false);
});

test("compatibility-equivalent source lettering matches without discarding punctuation", () => {
  const card = { imported: true, answer: "C++" };
  assert.equal(quizAnswerIsCorrect(card, "identification", "Ｃ＋＋"), true);
  assert.equal(quizAnswerIsCorrect(card, "identification", "C#"), false);
});
