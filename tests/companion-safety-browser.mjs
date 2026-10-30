import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
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
const artifacts = join(tmpdir(), "dawnstudy-companion-safety-qa");
await mkdir(artifacts, { recursive: true });
const errors = [];
let requests = 0,
  release,
  markStarted;
const delayedStarted = new Promise((resolve) => {
  markStarted = resolve;
});
const profile = {
  user_id: "safety-test",
  nickname: "Study tester",
  avatar_id: "pompompurin",
  gender: "prefer-not-to-say",
  theme: "rose",
  discoverable: false,
  companion_id: "pompompurin",
  companion_name: "Akito",
  onboarded: true,
  terms_version: "2026-10-30",
  key_fingerprint: "",
  public_key: null,
};

async function open(signedIn, legacy = false) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  if (legacy)
    await context.addInitScript(() =>
      sessionStorage.setItem(
        "dawnstudy-companion-chat:",
        JSON.stringify([
          { role: "user", content: "I feel suicidal" },
          { role: "assistant", content: "Outdated generic crisis reply" },
        ]),
      ),
    );
  if (signedIn)
    await context.addInitScript(() =>
      localStorage.setItem("dawnstudy_session_v1", "test-token"),
    );
  await context.route("http://localhost:8000/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (request.method() === "OPTIONS")
      return route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Allow-Methods": "*",
        },
      });
    let body = {};
    if (path === "/api/auth/me")
      body = {
        id: "safety-test",
        username: "tester",
        email: "test@ceu.edu.ph",
        display_name: "Tester",
      };
    else if (path === "/api/community/bootstrap")
      body = {
        profile,
        friends: [],
        incoming: [],
        outgoing: [],
        blocked: [],
        invitations: [],
        terms_version: "2026-10-30",
      };
    else if (path === "/api/generation-jobs") body = { job: null };
    else if (path === "/api/study-sets" || path === "/api/study-shares")
      body = [];
    else if (path === "/api/models") body = { models: [] };
    else if (path === "/api/progress")
      body = {
        total_reviews: 0,
        reviewed_today: 0,
        accuracy: 0,
        current_streak: 0,
        best_streak: 0,
        due_count: 0,
        total_cards: 0,
        week: [],
      };
    else if (path === "/api/community/companion") {
      requests++;
      const input = request.postDataJSON();
      if (input.message === "Help me review osmosis") {
        await new Promise((resolve) => {
          release = resolve;
          markStarted();
        });
        body = {
          reply: "An earlier reply must not replace the help contacts.",
          model: "mock",
          suggest_friends: false,
        };
      } else
        body = {
          reply: "We can review one topic at a time. Which chapter?",
          model: "mock",
          suggest_friends: false,
        };
    }
    await route
      .fulfill({
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify(body),
      })
      .catch(() => {});
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://localhost:3033");
  await page
    .getByRole("button", {
      name: signedIn
        ? "Akito, open companion chat"
        : "Miso, open companion chat",
    })
    .click();
  return { context, page };
}
async function send(page, text) {
  await page.getByLabel("Message your AI companion").fill(text);
  await page.getByRole("button", { name: "Send to companion" }).click();
}
async function verifyContacts(page) {
  const card = page.locator(".companion-help").last();
  await card.getByRole("link", { name: "Call 911", exact: true }).waitFor();
  assert.equal(
    await card
      .getByRole("link", { name: "Call 911", exact: true })
      .getAttribute("href"),
    "tel:911",
  );
  assert.equal(
    await card
      .getByRole("link", { name: "1800-1888-1553", exact: true })
      .getAttribute("href"),
    "tel:+63180018881553?oai_link_source=model_response_hotline",
  );
  assert.equal(
    await card
      .getByRole("link", { name: "gcd@ceu.edu.ph", exact: true })
      .getAttribute("href"),
    "mailto:gcd@ceu.edu.ph",
  );
}
try {
  const { context, page } = await open(true);
  await send(page, "I'm feeling lonely");
  await page
    .getByText(
      "Want some company? Let's find a study friend you can chat or study with.",
      { exact: true },
    )
    .waitFor();
  assert.equal(await page.locator(".companion-help").count(), 0);
  assert.equal(requests, 0);
  await page.getByRole("button", { name: "Meet a study friend ↗" }).click();
  await page.getByRole("heading", { name: "Your people." }).waitFor();
  await page
    .getByRole("button", { name: "Akito, open companion chat" })
    .click();
  console.log(
    "PASS ordinary loneliness offers friends with no counselling disclaimer or crisis contacts",
  );
  await send(page, "Explain chloroplasts");
  await page
    .getByText("We can review one topic at a time. Which chapter?", {
      exact: true,
    })
    .waitFor();
  assert.equal(requests, 1);
  await send(page, "Help me review osmosis");
  await page.locator(".typing-dots").waitFor();
  await delayedStarted;
  await send(page, "I feel suicidal");
  await verifyContacts(page);
  await page.waitForFunction(() => {
    const history = document
      .querySelector(".buddy-history")
      .getBoundingClientRect();
    const buttons = document.querySelectorAll('.buddy-turn a[href="tel:911"]');
    const call = buttons[buttons.length - 1].getBoundingClientRect();
    return call.top >= history.top && call.bottom <= history.bottom;
  });
  assert.equal(await page.locator(".typing-dots").count(), 0);
  release();
  await page.waitForTimeout(250);
  assert.equal(
    await page
      .getByText("An earlier reply must not replace the help contacts.", {
        exact: true,
      })
      .count(),
    0,
  );
  console.log(
    "PASS urgent message interrupts pending AI and shows verified Philippine contacts",
  );

  await context.setOffline(true);
  const before = requests;
  await send(page, "Ayoko nang mabuhay");
  await verifyContacts(page);
  await send(page, "I want to steal money");
  await page
    .getByText("I can't engage with that kind of conversation.", {
      exact: true,
    })
    .waitFor();
  assert.equal(requests, before);
  assert.equal(
    await page.locator(".buddy-turn.assistant").last().locator("p").innerText(),
    "I can't engage with that kind of conversation.",
  );
  await page
    .getByRole("button", { name: "Show Philippine help contacts" })
    .click();
  await page
    .locator(".buddy-help-panel")
    .getByRole("link", { name: "gcd@ceu.edu.ph", exact: true })
    .waitFor();
  console.log(
    "PASS English/Filipino crisis responses and exact crime refusal work offline without AI requests",
  );
  await context.setOffline(false);
  for (const [width, height, name] of [
    [390, 844, "mobile"],
    [820, 1180, "tablet"],
    [1440, 1000, "desktop"],
  ]) {
    await page.setViewportSize({ width, height });
    assert(
      !(await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      )),
      `${name} page must not overflow`,
    );
    await page.screenshot({
      path: join(artifacts, `${name}-help.png`),
      animations: "disabled",
    });
  }
  await page.reload();
  await page
    .getByRole("button", { name: "Akito, open companion chat" })
    .click();
  await page
    .getByText("I can't engage with that kind of conversation.", {
      exact: true,
    })
    .waitFor();
  await verifyContacts(page);
  console.log(
    "PASS help cards survive refresh and fit mobile, tablet and desktop",
  );

  const guest = await open(false);
  const guestBefore = requests;
  await send(guest.page, "I feel suicidal");
  await verifyContacts(guest.page);
  assert.equal(requests, guestBefore);
  assert.equal(await guest.page.locator(".auth-modal").count(), 0);
  const previous = await open(false, true);
  await verifyContacts(previous.page);
  assert.equal(
    await previous.page
      .getByText("Outdated generic crisis reply", { exact: true })
      .count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS crisis contacts remain available without sign-in; no runtime errors",
  );
} finally {
  release?.();
  await browser.close();
}
