import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const { chromium } = await import(process.env.DAWNSTUDY_PLAYWRIGHT_PATH
  ? pathToFileURL(process.env.DAWNSTUDY_PLAYWRIGHT_PATH).href
  : "playwright-core");
const browser = await chromium.launch({
  executablePath: process.env.DAWNSTUDY_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const base = process.env.DAWNSTUDY_TEST_URL || "http://127.0.0.1:3044";
const profile = {
  user_id: "quiz-blueprint-student", nickname: "Student", avatar_id: "cat", theme: "kuromi-dark",
  gender: "prefer-not-to-say", companion_id: "cat", companion_name: "Miso", onboarded: true,
  terms_version: "2026-10-30", public_key: null, key_fingerprint: "",
};
const blueprint = {
  title: "Quiz 11",
  topics: [{ id: "learning", title: "Learning theories", description: "Distinguish learning processes.", weight: 10, group: "Learning" }],
};
const question = [
  "Which statements describe observational learning?",
  "1. A learner can acquire behavior by watching someone else.",
  "2. A learner can remember a behavior before performing it.",
  "3. Learning always requires direct reinforcement.",
  "4. Watching another person prevents later imitation.",
].join("\n");
const answer = "1 and 2 only";
const card = {
  card_id: "combination-1", question, answer, correct_answer: answer,
  options: [answer, "2 and 3 only", "1, 2 and 3 only", "4 only"],
  statement_combinations: true, source_refs: ["learning.txt"],
  explanation: "Statements 1 and 2 describe learning by observing and retaining a behavior.",
};
const studySet = {
  id: "blueprint-set", title: "Learning theories practice", type: "multiple_choice",
  created_at: new Date().toISOString(), statement_combinations: true, quiz_blueprint: blueprint,
  items: [card], requested_count: 10, incomplete: true,
  blueprint_coverage: [{ topic_id: "learning", requested: 10, completed: 1 }],
};

async function checkQuestion(questionNode) {
  assert.equal(await questionNode.textContent(), question);
  assert.equal(await questionNode.evaluate(node => getComputedStyle(node).whiteSpace), "pre-wrap");
}

try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const errors = [];
    const submissions = [];
    let saved;
    await context.addInitScript(() => localStorage.setItem("dawnstudy_session_v1", "test-token"));
    await context.route("http://localhost:8000/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" };
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
      let data = {};
      let status = 200;
      if (path === "/api/auth/me") data = { id: profile.user_id, username: "student", email: "student@gmail.com", display_name: "Student" };
      else if (path === "/api/community/bootstrap") data = { profile, friends: [], incoming: [], outgoing: [], blocked: [], invitations: [], terms_version: "2026-10-30" };
      else if (path === "/api/models") data = { models: [] };
      else if (path === "/api/health") data = { status: "ok" };
      else if (path === "/api/study-sets") data = saved ? [saved] : [];
      else if (path === "/api/study-shares") data = [];
      else if (path === "/api/progress") data = { total_reviews: 0, reviewed_today: 0, accuracy: 0, current_streak: 0, best_streak: 0, due_count: 0, total_cards: 0, week: [] };
      else if (path === "/api/shared/tos") data = studySet;
      else if (path === "/api/generation-jobs" && request.method() === "POST") {
        const form = await new Response(request.postDataBuffer(), { headers: { "Content-Type": request.headers()["content-type"] } }).formData();
        submissions.push(form);
        const result = submissions.length === 1 ? studySet : {
          ...studySet,
          items: [card, ...Array.from({ length: 9 }, (_, index) => ({
            ...card, card_id: `combination-${index + 2}`, question: question.replace("Which statements", `In scenario ${index + 1}, which statements`),
          }))],
          blueprint_coverage: [{ topic_id: "learning", requested: 10, completed: 10 }],
          continued_set_id: studySet.id,
          incomplete: false,
        };
        saved = result;
        data = { job_id: form.get("client_request_id"), status: "complete", stage: "complete", completed: result.items.length, requested: 10, result };
        status = 202;
      } else if (path === "/api/generation-jobs") data = { job: null };
      await route.fulfill({ status, headers, contentType: "application/json", body: JSON.stringify(data) });
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    await page.waitForLoadState("networkidle");
    await page.locator('input[type="file"][multiple]').setInputFiles({
      name: "learning.txt", mimeType: "text/plain", buffer: Buffer.from("Observational learning occurs by watching others."),
    });
    await page.getByText("Table of Specifications (TOS)", { exact: false }).click();
    await page.getByLabel("Table of Specifications PDF").setInputFiles({
      name: "Quiz 11 TOS.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nQuiz blueprint"),
    });
    await page.locator(".quiz-blueprint-file").getByText("Quiz 11 TOS.pdf", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Choose practice" }).click();
    await page.getByRole("button", { name: "Multiple choice Choose the best answer" }).click();
    await page.getByRole("checkbox", { name: "Statement combinations" }).check();
    await page.getByRole("button", { name: "Review & create" }).click();
    await page.locator(".session-summary").getByText("Statement combinations", { exact: true }).waitFor();
    await page.locator(".session-summary").getByText("TOS · Quiz 11 TOS.pdf", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Create study set" }).click();
    const panel = page.locator(".result-panel");
    await panel.getByText("TOS · Quiz 11", { exact: true }).waitFor();
    await panel.getByText(/If a topic needs more evidence, start a new quiz/).waitFor();
    await panel.getByText("Quiz coverage", { exact: true }).click();
    await panel.locator(".quiz-coverage").getByText("Learning theories", { exact: true }).waitFor();
    await panel.locator(".quiz-coverage").getByText("1 of 10 ready", { exact: false }).waitFor();
    await panel.locator(".quiz-coverage").getByText("9 remaining", { exact: false }).waitFor();
    assert.equal(submissions[0].get("input_mode"), "notes");
    assert.equal(submissions[0].get("format"), "multiple_choice");
    assert.equal(submissions[0].get("statement_combinations"), "true");
    assert.equal(submissions[0].get("quiz_blueprint").name, "Quiz 11 TOS.pdf");
    assert.deepEqual(submissions[0].getAll("files").map(file => file.name), ["learning.txt"]);
    await checkQuestion(panel.locator(".statement-combination-prompt"));
    assert.equal(await panel.locator(".statement-combination-prompt").evaluate(node => getComputedStyle(node).textAlign), "left");
    await panel.locator(".choice-option").filter({ hasText: answer }).click();
    await panel.getByText("Correct! Nice work.", { exact: true }).waitFor();
    await panel.getByText(card.explanation, { exact: true }).waitFor();
    await panel.getByRole("combobox", { name: "Test pace" }).selectOption("0");
    await panel.getByRole("button", { name: "Start practice", exact: true }).click();
    const practice = page.locator(".practice-panel");
    await checkQuestion(practice.locator(".practice-question h3"));
    await practice.locator(".practice-choice").filter({ hasText: answer }).click();
    await practice.getByRole("button", { name: "Finish test", exact: true }).click();
    await practice.getByText("You answered every question correctly.", { exact: true }).waitFor();
    await practice.getByText(card.explanation, { exact: true }).waitFor();
    await practice.getByTitle("Exit practice test").click();
    await panel.getByRole("button", { name: "Continue generating" }).click();
    await panel.getByRole("button", { name: "Continue generating" }).waitFor({ state: "hidden" });
    assert.equal(submissions[1].get("study_set_id"), studySet.id);
    assert.equal(submissions[1].get("statement_combinations"), "true");
    assert.equal(submissions[1].has("quiz_blueprint"), false);
    const coverage = panel.locator(".quiz-coverage");
    if (!(await coverage.evaluate(node => node.open))) await coverage.locator("summary").click();
    await coverage.getByText("10 of 10 ready", { exact: true }).waitFor();

    await page.goto(base + "/shared/tos");
    const shared = page.locator(".shared-question-card");
    await shared.waitFor();
    await checkQuestion(shared.locator("h2"));
    await shared.locator(".shared-option").filter({ hasText: answer }).click();
    await shared.getByText("You’ve got it.", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: TOS upload, combination generation and continuation, multiline study/practice/share, and single-answer grading.`);
    await context.close();
  }
} finally {
  await browser.close();
}
