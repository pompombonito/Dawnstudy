import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const { chromium } = await import(process.env.DAWNSTUDY_PLAYWRIGHT_PATH ? pathToFileURL(process.env.DAWNSTUDY_PLAYWRIGHT_PATH).href : "playwright-core");
const browser = await chromium.launch({ executablePath: process.env.DAWNSTUDY_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const base = process.env.DAWNSTUDY_TEST_URL || "http://127.0.0.1:3044";
const profile = { user_id: "explanations-student", nickname: "Student", avatar_id: "cat", theme: "kuromi-dark", gender: "prefer-not-to-say", companion_id: "cat", companion_name: "Miso", onboarded: true, terms_version: "2026-10-30", public_key: null, key_fingerprint: "" };
const common = { imported: true, answer_origin: "provided", source_refs: ["Original questionnaire · page 2"] };
const cards = [
  { ...common, card_id: "mc", quiz_type: "multiple_choice", question: "A learner compiles a program.\nWhich language uses std::cout?", options: ["C#", "C++", "Java"], option_labels: ["E", "F", "G"], answer: "C++", correct_answer: "C++", explanation: "SOURCE RATIONALE: std::cout belongs to the C++ standard library.", explanation_origin: "provided" },
  { ...common, card_id: "id", quiz_type: "identification", question: "Name the energy-carrying molecule.", answer: "ATP", explanation: "AI RATIONALE: ATP transfers usable cellular energy.", explanation_origin: "ai", import_notices: ["The answer was inferred; review it against the source."] },
  { ...common, card_id: "checkbox", quiz_type: "checkbox", question: "Select both source keys, retaining punctuation.", options: ["x | y", "C++", "C#"], answer: "x | y | C++", correct_answers: ["x | y", "C++"], explanation: "CHECKBOX RATIONALE: the source identifies the first two options.", explanation_origin: "provided" },
  { ...common, card_id: "matching", quiz_type: "matching", question: "Match each prompt to the source language.", matching_prompts: ["First prompt", "Second prompt"], matching_options: ["C#", "C++"], option_labels: ["E", "F"], matching_pairs: [{ prompt: "First prompt", answer: "C++" }, { prompt: "Second prompt", answer: "C#" }], answer: "First prompt — C++; Second prompt — C#", explanation: "MATCHING RATIONALE: the supplied pairs define these associations.", explanation_origin: "provided" },
  { ...common, card_id: "written", quiz_type: "checkbox", question: "Write both source answers, one per line.", answer: "x | y | C++", correct_answers: ["x | y", "C++"], explanation: "WRITTEN RATIONALE: a pipe belongs to the first answer itself.", explanation_origin: "ai" },
];
const mixed = { id: "explanations-mixed", title: "Questionnaire explanations", type: "same_as_source", created_at: new Date().toISOString(), requested_count: cards.length, incomplete: false, items: cards };
const flashCard = { ...common, card_id: "flash", question: "Recall the energy carrier.", answer: "ATP", explanation: "FLASHCARD RATIONALE: ATP is the source answer.", explanation_origin: "provided" };
const flash = { ...mixed, id: "explanations-flash", title: "Flashcard explanation", type: "flashcards", items: [flashCard], requested_count: 1 };
const pendingSet = { ...mixed, id: "explanations-pending", title: "Pending explanation repair", requested_count: 1, items: [{ ...cards[0], explanation: "", explanation_pending: true }] };
const errors = [];
let gamePhase = "question", gameCardIndex = 0, reviews = 0, explanationRepairs = 0;

async function openContext(width) {
  const context = await browser.newContext({ viewport: { width, height: 950 } });
  await context.addInitScript(() => localStorage.setItem("dawnstudy_session_v1", "test-token"));
  await context.route("http://localhost:8000/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" };
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers });
    let data = {};
    if (path === "/api/auth/me") data = { id: profile.user_id, username: "student", email: "student@gmail.com", display_name: "Student" };
    else if (path === "/api/community/bootstrap") data = { profile, friends: [], incoming: [], outgoing: [], blocked: [], invitations: [], terms_version: "2026-10-30" };
    else if (path === "/api/models") data = { models: [] };
    else if (path === "/api/health") data = { status: "ok" };
    else if (path === "/api/study-sets") data = [mixed, flash, pendingSet];
    else if (path === "/api/study-shares") data = [];
    else if (path === "/api/generation-jobs" && method === "POST") {
      const form = await new Response(request.postDataBuffer(), { headers: { "Content-Type": request.headers()["content-type"] } }).formData();
      assert.equal(form.get("question_count"), "1", "A full question count must still request its missing explanation");
      assert.equal(form.get("study_set_id"), pendingSet.id);
      assert.equal(form.get("input_mode"), "questionnaire");
      explanationRepairs++;
      const result = { ...pendingSet, items: [cards[0]], continued_set_id: pendingSet.id };
      data = { job_id: form.get("client_request_id"), status: "complete", stage: "complete", completed: 1, requested: 1, result };
    }
    else if (path === "/api/generation-jobs") data = { job: null };
    else if (path === "/api/progress") data = { total_reviews: 0, reviewed_today: 0, accuracy: 0, current_streak: 0, best_streak: 0, due_count: cards.length, total_cards: cards.length, week: [] };
    else if (path === "/api/reviews/due") data = { items: cards.map(card => ({ study_set_id: mixed.id, study_set_title: mixed.title, type: mixed.type, card, intervals: { again: "1 min", hard: "1 day", good: "3 days", easy: "5 days" } })) };
    else if (path === "/api/reviews") { reviews++; data = { next_review_in: "3 days" }; }
    else if (path.startsWith("/api/shared/")) data = path.endsWith("flash") ? flash : mixed;
    else if (path === "/api/community/games/TEST42") {
      if (method === "POST") gamePhase = "reveal";
      const card = cards[gameCardIndex];
      data = { code: "TEST42", host: profile.user_id, title: mixed.title, kind: mixed.type, phase: gamePhase, index: gameCardIndex, total: cards.length, deadline: Date.now() + 25_000, server_time: Date.now(), players: [{ id: profile.user_id, nickname: "Student", avatar_id: "cat", points: gamePhase === "reveal" ? 1500 : 0, correct: gamePhase === "reveal" ? 1 : 0, rank: 1 }], answered: gamePhase === "reveal", answered_count: gamePhase === "reveal" ? 1 : 0,
        question: { question: card.question, options: card.options || [], matching_prompts: card.matching_prompts, matching_options: card.matching_options, option_labels: card.option_labels, quiz_type: card.quiz_type, ...(gamePhase === "reveal" ? { answer: card.answer, explanation: card.explanation, explanation_origin: card.explanation_origin } : {}) }, feedback: gamePhase === "reveal" ? { correct: true, points: 1500 } : undefined };
    }
    await route.fulfill({ status: 200, headers, contentType: "application/json", body: JSON.stringify(data) });
  });
  const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  return { context, page };
}

async function assertHidden(panel, card) {
  assert.equal(await panel.locator(".answer-explanation").count(), 0, "Rationale must not be mounted before an answer");
  assert.doesNotMatch(await panel.ariaSnapshot(), /RATIONALE:|The answer was inferred/);
}

async function answerCard(panel, card, mode) {
  if (card.quiz_type === "matching") {
    if (card.option_labels) assert.deepEqual(await panel.locator(".matching-row select").first().locator("option").allTextContents(), ["Choose a match", ...card.matching_options.map((option, index) => `${card.option_labels[index]}. ${option}`)]);
    for (let index = 0; index < card.matching_pairs.length; index++) await panel.locator(".matching-row select").nth(index).selectOption(card.matching_pairs[index].answer);
    if (mode !== "practice") await panel.getByRole("button", { name: "Check matches", exact: true }).click();
  } else if (card.options?.length) {
    const selector = mode === "shared" ? ".shared-option" : mode === "practice" ? ".practice-choice" : ".choice-option";
    for (const answer of card.correct_answers || [card.answer]) await panel.locator(selector).filter({ hasText: answer }).click();
    if (card.quiz_type === "checkbox" && mode !== "practice") await panel.getByRole("button", { name: mode === "shared" ? "Check my answers" : "Check answers", exact: true }).click();
  } else {
    const response = card.correct_answers ? card.correct_answers.join("\n") : card.answer;
    await panel.locator(card.quiz_type === "checkbox" || mode === "practice" ? "textarea" : "input").fill(response);
    if (mode !== "practice") await panel.getByRole("button", { name: mode === "shared" ? "Check my answer" : card.quiz_type === "checkbox" ? "Check answers" : "Check answer", exact: true }).click();
  }
}

try {
  for (const width of [1280, 390]) {
    const { context, page } = await openContext(width);
    await page.goto(base); await page.waitForLoadState("networkidle");
    await page.locator(".desk-recent-list button").filter({ hasText: mixed.title }).click();
    let panel = page.locator(".result-panel");
    for (const card of cards) {
      await panel.getByText(card.question, { exact: true }).waitFor();
      await assertHidden(panel, card);
      if (card.options) assert.deepEqual(await panel.locator(".choice-option>span").allTextContents(), card.options);
      if (card.option_labels && card.options) assert.deepEqual(await panel.locator(".choice-option>i").allTextContents(), card.option_labels);
      if (card.quiz_type === "matching") assert.deepEqual(await panel.locator(".matching-row select").first().locator("option").allTextContents(), ["Choose a match", ...card.matching_options.map((option, i) => `${card.option_labels[i]}. ${option}`)]);
      await answerCard(panel, card, "study");
      await panel.getByText(card.explanation, { exact: true }).waitFor();
      await panel.getByText(card.explanation_origin === "provided" ? "Explanation from your material" : "AI explanation · review for accuracy", { exact: true }).waitFor();
      if (card.import_notices) await panel.getByRole("note").getByText(card.import_notices[0]).waitFor();
      await panel.locator(".study-controls").getByRole("button", { name: "Next", exact: true }).click();
    }
    assert.equal(await panel.locator(".face-question").evaluate(node => getComputedStyle(node).whiteSpace), "pre-wrap");
    await panel.getByRole("combobox", { name: "Test pace" }).selectOption("0");
    await panel.getByRole("button", { name: "Start practice", exact: true }).click();
    panel = page.locator(".practice-panel");
    for (let index = 0; index < cards.length; index++) {
      await assertHidden(panel, cards[index]);
      if (cards[index].option_labels && cards[index].options) assert.deepEqual(await panel.locator(".practice-choice>i").allTextContents(), cards[index].option_labels);
      await answerCard(panel, cards[index], "practice");
      if (index < cards.length - 1) await panel.getByRole("button", { name: "Next", exact: true }).click();
    }
    await panel.getByRole("button", { name: "Finish test", exact: true }).click();
    await panel.getByText("You answered every question correctly.", { exact: true }).waitFor();
    assert.equal(await panel.locator(".answer-explanation").count(), cards.length, "Correct answers must also show explanations after the test");
    for (const card of cards) await panel.getByText(card.explanation, { exact: true }).waitFor();
    console.log(`PASS private study/provenance and practice full-score explanation review (${width}px).`);

    await page.reload(); await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /Review what.s due/ }).click();
    panel = page.locator(".review-panel");
    for (const card of cards) {
      await panel.getByText(card.question, { exact: true }).waitFor(); await assertHidden(panel, card);
      await answerCard(panel, card, "review");
      await panel.getByText(card.explanation, { exact: true }).waitFor();
      await panel.getByRole("button", { name: /^Good/ }).click();
    }
    await panel.getByText("Review complete", { exact: true }).waitFor();
    console.log(`PASS spaced review shows rationale only after each submitted answer (${width}px).`);

    await page.goto(base + "/shared/mixed"); await page.waitForLoadState("networkidle");
    panel = page.locator(".shared-question-card");
    for (const card of cards) {
      await panel.getByRole("heading", { name: card.question, exact: true }).waitFor(); await assertHidden(panel, card);
      if (card.options) assert.deepEqual(await panel.locator(".shared-option>span").allTextContents(), card.options);
      if (card.option_labels && card.options) assert.deepEqual(await panel.locator(".shared-option>i").allTextContents(), card.option_labels);
      await answerCard(panel, card, "shared");
      await panel.getByText(card.explanation, { exact: true }).waitFor();
      await panel.getByText("You’ve got it.", { exact: true }).waitFor();
      if (card !== cards.at(-1)) await panel.getByRole("button", { name: "Next question", exact: true }).click();
    }
    await page.reload(); await page.waitForLoadState("networkidle");
    await page.locator(".shared-question-card").getByText(cards[0].explanation, { exact: true }).waitFor();
    assert.deepEqual(await page.locator(".shared-option>span").allTextContents(), cards[0].options);
    await page.goto(base + "/shared/flash"); await page.waitForLoadState("networkidle");
    panel = page.locator(".shared-question-card"); await assertHidden(panel, flashCard);
    await panel.locator(".shared-reveal").click(); await panel.getByText(flashCard.explanation, { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    console.log(`PASS all shared interactions, written checkbox, source order, reload and flashcard explanation (${width}px).`);

    await page.goto(base); await page.waitForLoadState("networkidle");
    await page.locator(".desk-recent-list button").filter({ hasText: flash.title }).click();
    panel = page.locator(".result-panel"); await assertHidden(panel, flashCard);
    await panel.locator(".study-face").click(); await panel.getByText(flashCard.explanation, { exact: true }).waitFor();
    await panel.locator(".study-face").click(); await assertHidden(panel, flashCard);
    console.log(`PASS private flashcard hides explanation again when flipped back (${width}px).`);

    await page.reload(); await page.waitForLoadState("networkidle");
    await page.locator(".desk-recent-list button").filter({ hasText: pendingSet.title }).click();
    panel = page.locator(".result-panel");
    await panel.getByText(/1 explanations pending/).waitFor();
    await page.locator('input[type="file"]').first().setInputFiles({ name: "original-questionnaire.txt", mimeType: "text/plain", buffer: Buffer.from("1. Which language uses std::cout?\nE. C#\nF. C++\nG. Java\nAnswer: F") });
    await panel.getByRole("button", { name: "Complete explanations", exact: true }).click();
    await panel.locator(".choice-option").filter({ hasText: "C++" }).click();
    await panel.getByText(cards[0].explanation, { exact: true }).waitFor();
    console.log(`PASS explanation-only continuation retains full source question count and original files (${width}px).`);

    gamePhase = "question"; gameCardIndex = 0;
    await page.evaluate(() => localStorage.setItem("dawnstudy-live-room:explanations-student", "TEST42"));
    await page.getByRole("button", { name: width < 700 ? "Play" : "Play together", exact: true }).click();
    panel = page.locator(".game-round");
    await panel.getByRole("heading", { name: cards[0].question, exact: true }).waitFor(); await assertHidden(panel, cards[0]);
    assert.deepEqual(await panel.locator(".game-options button").allTextContents(), cards[0].options.map((option, index) => cards[0].option_labels[index] + option));
    await panel.locator(".game-options button").filter({ hasText: "C++" }).click();
    await panel.getByRole("button", { name: "Lock my answer", exact: true }).click();
    await panel.getByText(cards[0].explanation, { exact: true }).waitFor();
    await panel.getByText("Explanation from your material", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    gamePhase = "question"; gameCardIndex = 3;
    await panel.getByRole("heading", { name: cards[3].question, exact: true }).waitFor(); await assertHidden(panel, cards[3]);
    assert.deepEqual(await panel.locator(".matching-row select").first().locator("option").allTextContents(), ["Choose a match", "E. C#", "F. C++"]);
    for (let index = 0; index < cards[3].matching_pairs.length; index++) await panel.locator(".matching-row select").nth(index).selectOption(cards[3].matching_pairs[index].answer);
    await panel.getByRole("button", { name: "Lock my answer", exact: true }).click();
    await panel.getByText(cards[3].explanation, { exact: true }).waitFor();
    console.log(`PASS live quiz rationale/provenance appears only in reveal, with original MC/matching labels (${width}px).`);
    await context.close();
  }
  assert.equal(reviews, cards.length * 2);
  assert.equal(explanationRepairs, 2);
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
