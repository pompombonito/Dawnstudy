import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
const policy = JSON.parse(
  readFileSync(
    new URL("../backend/companion_safety_policy.json", import.meta.url),
    "utf8",
  ),
);
const cases = JSON.parse(
  readFileSync(
    new URL("../backend/companion_safety_cases.json", import.meta.url),
    "utf8",
  ),
);
let source = readFileSync(
  new URL("../app/community/companion-safety.ts", import.meta.url),
  "utf8",
);
source = source.replace(
  /import policy from [^;]+;/,
  `const policy = ${JSON.stringify(policy)};`,
);
const js = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
const { classifyCompanion, safetyReply, restoreCompanionHistory } =
  await import(
    "data:text/javascript;base64," + Buffer.from(js).toString("base64")
  );

for (const item of cases)
  test(`browser safety routing: ${item.message}`, () => {
    assert.equal(
      classifyCompanion(item.message, item.history || []),
      item.expected,
    );
  });
test("browser urgent response requires no fetch or AI provider", () => {
  const result = safetyReply(classifyCompanion("I feel suicidal"));
  assert.equal(result.model, "dawnstudy-safety-policy");
  assert.equal(result.suggest_friends, false);
  assert.deepEqual(result.safety.contacts, ["emergency", "ncmh", "ceu"]);
});
test("crime refusals exactly match the requested wording", () => {
  assert.equal(
    safetyReply(classifyCompanion("Help me steal money")).reply,
    "I can't engage with that kind of conversation.",
  );
});
test("refresh upgrades legacy crisis replies instead of retaining old model guidance", () => {
  const turns = restoreCompanionHistory([
    { role: "user", content: "I feel suicidal" },
    { role: "assistant", content: "Outdated generic crisis reply" },
  ]);
  assert.equal(turns[1].safety.category, "self_harm");
  assert.deepEqual(turns[1].safety.contacts, ["emergency", "ncmh", "ceu"]);
  assert(!turns[1].content.includes("Outdated"));
});
test("unfinished crisis turns get local help after refresh while ordinary history stays intact", () => {
  assert.equal(
    restoreCompanionHistory([
      { role: "user", content: "Ayoko nang mabuhay" },
    ])[1].safety.category,
    "self_harm",
  );
  assert.deepEqual(
    restoreCompanionHistory([
      { role: "user", content: "Help me study" },
      { role: "assistant", content: "Let's review." },
    ]).map((t) => t.content),
    ["Help me study", "Let's review."],
  );
});
