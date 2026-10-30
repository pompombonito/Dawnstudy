import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const { chromium } = await import(
  process.env.DAWNSTUDY_PLAYWRIGHT_PATH
    ? pathToFileURL(process.env.DAWNSTUDY_PLAYWRIGHT_PATH).href
    : "playwright-core"
);
const browser = await chromium.launch({
  executablePath:
    process.env.DAWNSTUDY_BROWSER ||
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const uid = "ordinary-student";
const profile = {
  user_id: uid,
  nickname: "Student",
  avatar_id: "cat",
  gender: "prefer-not-to-say",
  theme: "dark",
  discoverable: false,
  companion_id: "cat",
  companion_name: "Miso",
  onboarded: true,
  terms_version: "2026-10-30",
  public_key: null,
  key_fingerprint: "",
};
let saved = null,
  requested = "";
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await context.addInitScript(() =>
    localStorage.setItem("dawnstudy_session_v1", "test-token"),
  );
  await context.route("http://localhost:8000/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (req.method() === "OPTIONS")
      return route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Allow-Methods": "*",
        },
      });
    let data = {},
      status = 200;
    if (path === "/api/auth/me")
      data = {
        id: uid,
        username: "student",
        email: "student@mnl.ceu.edu.ph",
        display_name: "Student",
      };
    else if (path === "/api/models") data = { models: [] };
    else if (path === "/api/community/bootstrap")
      data = {
        profile,
        friends: [],
        incoming: [],
        outgoing: [],
        blocked: [],
        invitations: [],
        terms_version: "2026-10-30",
      };
    else if (path === "/api/study-sets") data = saved ? [saved] : [];
    else if (path === "/api/study-shares") data = [];
    else if (path === "/api/progress")
      data = {
        total_reviews: 0,
        reviewed_today: 0,
        accuracy: 0,
        current_streak: 0,
        best_streak: 0,
        due_count: 0,
        total_cards: 0,
        week: [],
      };
    else if (path === "/api/generation-jobs" && req.method() === "GET")
      data = { job: null };
    else if (path === "/api/generation-jobs" && req.method() === "POST") {
      requested =
        req.postData().match(/name="question_count"\r\n\r\n(\d+)/)?.[1] || "";
      saved = {
        id: "quiz-100",
        title: "A hundred questions",
        type: "multiple_choice",
        created_at: new Date().toISOString(),
        requested_count: 100,
        incomplete: false,
        items: Array.from({ length: 100 }, (_, i) => ({
          card_id: `card-${i}`,
          question: `Question ${i + 1}?`,
          answer: "Alpha",
          correct_answer: "Alpha",
          options: ["Alpha", "Bravo", "Delta", "Gamma"],
        })),
        sources: [],
        usage: {
          remaining: null,
          limit: null,
          resets_at: null,
          unlimited: true,
        },
      };
      data = {
        job_id: "job-100",
        status: "complete",
        stage: "complete",
        completed: 100,
        requested: 100,
        result: saved,
      };
      status = 202;
    }
    await route.fulfill({
      status,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(data),
    });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:3033");
  await page.getByRole("button", { name: "Choose practice" }).click();
  await page.locator("#question-count").selectOption("100");
  assert.equal(await page.locator("#question-count option").count(), 10);
  assert(
    !(await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    )),
  );
  await page.getByRole("button", { name: /Multiple choice/ }).click();
  await page.getByRole("button", { name: "Review & create" }).click();
  await page.getByText("100 questions", { exact: false }).first().waitFor();
  await page.getByText("About generation", { exact: true }).click();
  await page
    .getByText(
      /Create up to 100 questions per set, with no daily generation limit/,
    )
    .waitFor();
  assert.equal(
    await page
      .getByText(/5 generations per day|generations left today/)
      .count(),
    0,
  );
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "A sample study material with enough source text to support a complete question set.",
      ),
    });
  await page.getByRole("button", { name: "Choose practice" }).click();
  await page.getByRole("button", { name: "Review & create" }).click();
  await page.getByRole("button", { name: "Create study set" }).click();
  await page.getByRole("heading", { name: "A hundred questions" }).waitFor();
  assert.equal(requested, "100");
  assert.equal(
    await page
      .getByText(/generations left today|5 generations per day/)
      .count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: mobile 100-question selection, no daily-cap messaging, 100-question request and completed result render without errors.",
  );
} finally {
  await browser.close();
}
