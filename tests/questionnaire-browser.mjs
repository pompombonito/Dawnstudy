import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(process.env.DAWNSTUDY_PLAYWRIGHT_PATH || "C:/Users/daqui/AppData/Local/Temp/dawn-qa/node_modules/playwright-core/index.mjs").href);
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const base = process.env.DAWNSTUDY_TEST_URL || "http://127.0.0.1:3044";
const profile = { user_id: "import-student", nickname: "Student", avatar_id: "cat", theme: "kuromi-dark", gender: "prefer-not-to-say", companion_id: "cat", companion_name: "Miso", onboarded: true, terms_version: "2026-10-30", public_key: null, key_fingerprint: "" };
const sourceImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKtwAAAAASUVORK5CYII=";
const importedSet = { id: "import-set", title: "Original questionnaire", type: "multiple_choice", created_at: new Date().toISOString(), incomplete: false, requested_count: 2, items: [
  { card_id: "q1", imported: true, answer_origin: "provided", question: "Which language uses std::cout?", answer: "C++", correct_answer: "C++", options: ["C#", "C++", "Java", "Python"], explanation: "" },
  { card_id: "q2", imported: true, answer_origin: "inferred", question: "Identify the organelle that releases usable energy.", answer: "Mitochondrion", correct_answer: "Mitochondrion", options: ["Nucleus", "Mitochondrion", "Ribosome", "Chloroplast"], explanation: "AI-inferred answer: no answer key was supplied. Review it for accuracy. Choices added by AI." },
] };
importedSet.items[0].images = [sourceImage];
importedSet.items[0].image_labels = ["Figure 1-4"];
importedSet.items[0].image_captions = ["The image description must not reveal C++ before answering."];
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addInitScript(() => localStorage.setItem("dawnstudy_session_v1", "test-token"));
    let job = null, stored = false, form = "";
    const errors = [];
    await context.route("http://localhost:8000/**", async route => {
      const req = route.request(), path = new URL(req.url()).pathname, method = req.method();
      const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" };
      if (method === "OPTIONS") return route.fulfill({ status: 204, headers });
      let data = {}, status = 200;
      if (path === "/api/auth/me") data = { id: profile.user_id, username: "student", email: "student@gmail.com", display_name: "Student" };
      else if (path === "/api/community/bootstrap") data = { profile, friends: [], incoming: [], outgoing: [], blocked: [], invitations: [], terms_version: "2026-10-30" };
      else if (path === "/api/health") data = { status: "ok" };
      else if (path === "/api/models") data = { models: [] };
      else if (path === "/api/study-sets") { data = stored ? [importedSet] : []; }
      else if (path === "/api/study-shares") data = [];
      else if (path === "/api/progress") data = { total_reviews: 0, reviewed_today: 0, accuracy: 0, current_streak: 0, best_streak: 0, due_count: 0, total_cards: 0, week: [] };
      else if (path === "/api/generation-jobs" && method === "GET") data = { job };
      else if (path === "/api/generation-jobs" && method === "POST") {
        form = req.postData(); stored = true;
        job = { job_id: "import-job", status: "complete", stage: "complete", message: "Your study set is ready.", completed: 2, requested: 2, result: importedSet };
        data = { job_id: job.job_id }; status = 202;
      } else if (path.endsWith("/acknowledge")) { job = null; data = { ok: true }; }
      else if (path.startsWith("/api/generation-jobs/")) data = job;
      else if (path.startsWith("/api/shared/")) data = importedSet;
      await route.fulfill({ status, headers, contentType: "application/json", body: JSON.stringify(data) });
    });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base); await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Import questionnaire", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Public website", exact: true }).isDisabled(), true);
    await page.locator('input[type="file"]').first().setInputFiles({ name: "quiz.txt", mimeType: "text/plain", buffer: Buffer.from("1. Which language uses std::cout?\nA. C#\nB. C++\nC. Java\nD. Python\nAnswer: B") });
    await page.getByRole("button", { name: "Choose practice" }).click();
    await page.getByRole("button", { name: /^Multiple choice / }).click();
    assert.equal(await page.locator("#question-count").count(), 0);
    await page.getByRole("button", { name: "Review & create" }).click();
    assert.equal(await page.getByRole("button", { name: /Enrich with the web/ }).count(), 0);
    await page.getByRole("button", { name: "Create study set" }).click();
    await page.locator(".choice-option").first().waitFor();
    assert.deepEqual(await page.locator(".study-figure-list figcaption").allTextContents(), ["Figure 1-4"]);
    assert.equal(await page.locator(".study-figure-list img").getAttribute("src"), sourceImage);
    assert.doesNotMatch(await page.locator(".study-figures").textContent(), /reveal C\+\+/);
    assert.match(form, /name="input_mode"\r\n\r\nquestionnaire/);
    assert.match(form, /name="use_web"\r\n\r\nfalse/);
    assert.deepEqual(await page.locator(".choice-option > span").allTextContents(), importedSet.items[0].options);
    await page.locator(".choice-option").first().click();
    await page.getByText("Not quite. The correct answer is highlighted in green.").waitFor();
    assert.deepEqual(await page.locator(".choice-correct > span").allTextContents(), ["C++"]);
    // Reopening a saved import must preserve both question and choice order.
    await page.reload(); await page.waitForLoadState("networkidle");
    await page.locator(".desk-recent-list button").filter({ hasText: "Original questionnaire" }).click();
    assert.equal(await page.locator(".face-question").textContent(), importedSet.items[0].question);
    assert.deepEqual(await page.locator(".choice-option > span").allTextContents(), importedSet.items[0].options);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.goto(base + "/shared/test-token"); await page.waitForLoadState("networkidle");
    assert.deepEqual(await page.locator(".study-figure-list figcaption").allTextContents(), ["Figure 1-4"]);
    await page.locator(".shared-option").first().click();
    assert.deepEqual(await page.locator(".shared-option.is-correct > span").allTextContents(), ["C++"]);
    await page.getByRole("button", { name: "Next question" }).click();
    assert.equal(await page.locator(".study-figure-list img").count(), 0);
    await page.locator(".shared-option").nth(1).click();
    await page.getByText(/AI-inferred answer: no answer key/).waitFor();
    assert.deepEqual(errors, []);
    console.log(`PASS questionnaire upload, exact choices/grading, reopen and shared rendering (${width}px).`);
    await context.close();
  }
} finally { await browser.close(); }
