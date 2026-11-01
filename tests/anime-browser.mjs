import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const catalog = JSON.parse(await readFile(new URL("../backend/anime-characters.json", import.meta.url), "utf8"));
const { chromium } = await import(process.env.DAWNSTUDY_PLAYWRIGHT_PATH ? pathToFileURL(process.env.DAWNSTUDY_PLAYWRIGHT_PATH).href : "playwright-core");
const browser = await chromium.launch({ executablePath: process.env.DAWNSTUDY_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const artifacts = join(tmpdir(), "dawnstudy-anime-qa");
await mkdir(artifacts, { recursive: true });
const base = process.env.DAWNSTUDY_TEST_URL || "http://127.0.0.1:3044";
let profile = { user_id: "anime-student", nickname: "Student", avatar_id: "cat", theme: "kuromi-dark", gender: "prefer-not-to-say", companion_id: "cat", companion_name: "Miso", onboarded: true, terms_version: "2026-10-30", public_key: null, key_fingerprint: "" };
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(() => localStorage.setItem("dawnstudy_session_v1", "test-token"));
await context.route("http://localhost:8000/**", async route => {
  const req = route.request(), path = new URL(req.url()).pathname;
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" };
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
  let data = {};
  if (path === "/api/auth/me") data = { id: profile.user_id, username: "student", email: "student@ceu.edu.ph", display_name: "Student" };
  else if (path === "/api/community/bootstrap") data = { profile, friends: [], incoming: [], outgoing: [], blocked: [], invitations: [], terms_version: "2026-10-30" };
  else if (path === "/api/community/profile" && req.method() === "PUT") { profile = { ...profile, ...req.postDataJSON() }; data = profile; }
  else if (path === "/api/models") data = { models: [] };
  else if (path === "/api/study-sets" || path === "/api/study-shares") data = [];
  else if (path === "/api/generation-jobs") data = { job: null };
  else if (path === "/api/progress") data = { total_reviews: 0, reviewed_today: 0, accuracy: 0, current_streak: 0, best_streak: 0, due_count: 0, total_cards: 0, week: [] };
  await route.fulfill({ status: 200, headers, contentType: "application/json", body: JSON.stringify(data) });
});
const page = await context.newPage(), errors = [];
page.on("pageerror", error => errors.push(error.message));
async function noOverflow() { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false); }
try {
  await page.goto(base); await page.waitForLoadState("networkidle");
  await page.locator(".sidebar").getByRole("button", { name: "My profile", exact: true }).click();
  await page.getByText("190 icons", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Anime", exact: true }).click();
  const picker = page.locator(".profile-settings .avatar-picker");
  for (const series of [...new Set(catalog.map(character => character.series))]) {
    await picker.getByLabel("Anime series", { exact: true }).selectOption(series);
    assert.equal(await picker.locator(".avatar-grid button").count(), 5, series);
    for (const character of catalog.filter(character => character.series === series)) {
      const option = picker.getByRole("button", { name: `${character.name} · ${series}`, exact: true });
      assert.equal(await option.locator(`svg[data-character="${character.id}"]`).count(), 1, character.name);
    }
  }
  await picker.getByLabel("Anime series", { exact: true }).selectOption("all");
  while (await picker.getByRole("button", { name: "Show more icons", exact: true }).count()) await picker.getByRole("button", { name: "Show more icons", exact: true }).click();
  assert.equal(await picker.locator(".avatar-grid button").count(), 75);
  await picker.locator(".avatar-grid").evaluate(grid => grid.style.maxHeight = "none");
  await picker.locator(".avatar-grid").screenshot({ path: join(artifacts, "all-75-chibis.png") });
  await picker.locator(".avatar-grid").evaluate(grid => grid.style.removeProperty("max-height"));
  await picker.getByLabel("Search anime characters", { exact: true }).fill("GOJO");
  assert.equal(await picker.locator(".avatar-grid button").count(), 1);
  await picker.getByRole("button", { name: "Satoru Gojo · Jujutsu Kaisen", exact: true }).click();
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await page.getByText("Your profile is saved.", { exact: true }).waitFor();
  assert.equal(profile.avatar_id, "anime-gojo");
  await page.reload(); await page.waitForLoadState("networkidle");
  assert.equal(await page.locator('.profile-avatar-button svg[data-character="anime-gojo"]').count(), 1);
  console.log("PASS all 75 portraits render across 15 series, search works, and profile selection survives refresh.");

  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 900 });
    // The profile view is stored in the URL hash and restored after reload.
    if (!(await page.locator(".profile-settings").count())) {
      await page.getByRole("button", { name: "More", exact: true }).click();
      await page.getByRole("button", { name: "My profile", exact: true }).click();
    }
    await page.locator(".profile-settings").getByRole("button", { name: "Anime", exact: true }).click();
    await page.locator(".profile-settings").getByLabel("Anime series", { exact: true }).selectOption("That Time I Got Reincarnated as a Slime");
    await noOverflow();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Miso, open companion chat", exact: true }).click();
  await page.getByRole("button", { name: "Customize companion", exact: true }).click();
  const buddy = page.locator(".buddy-settings");
  await buddy.getByRole("button", { name: "Anime", exact: true }).click();
  assert.equal(await buddy.getByLabel("Anime series", { exact: true }).locator("option").count(), 16);
  await buddy.getByLabel("Anime series", { exact: true }).selectOption("Naruto");
  await buddy.getByRole("button", { name: "Naruto Uzumaki · Naruto", exact: true }).click();
  assert.equal(await buddy.getByLabel("Companion name", { exact: true }).inputValue(), "Naruto Uzumaki");
  await buddy.getByRole("button", { name: "Save companion", exact: true }).click();
  await page.getByText("Saved. Your buddy has a new look!", { exact: true }).waitFor();
  assert.equal(profile.companion_id, "anime-naruto");
  await noOverflow();
  await page.screenshot({ path: join(artifacts, "mobile-anime-companion.png"), fullPage: true });
  await page.clock.install();
  await page.getByRole("button", { name: "Close companion", exact: true }).click();
  await page.clock.fastForward(150001);
  assert.ok(await page.locator(".buddy-bubble").isVisible());
  assert.equal(await page.locator(".buddy-bubble span").innerText(), catalog.find(character => character.id === "anime-naruto").studyLine);
  await page.locator(".buddy-bubble").click();
  await page.clock.fastForward(150001);
  assert.ok((await page.locator(".buddy-bubble").innerText()).includes("Believe it!"));
  await page.locator(".buddy-bubble").click();
  await page.getByRole("button", { name: "Naruto Uzumaki, open companion chat", exact: true }).click();
  await buddy.getByLabel(/Quiet mode/).check();
  await buddy.getByLabel("Companion name", { exact: true }).fill("My custom buddy");
  await buddy.getByLabel("Anime series", { exact: true }).selectOption("Jujutsu Kaisen");
  await buddy.getByRole("button", { name: "Satoru Gojo · Jujutsu Kaisen", exact: true }).click();
  assert.equal(await buddy.getByLabel("Companion name", { exact: true }).inputValue(), "My custom buddy");
  await page.getByRole("button", { name: "Close companion", exact: true }).click();
  await page.clock.fastForward(300001);
  assert.equal(await page.locator(".buddy-bubble").count(), 0);
  assert.deepEqual(errors, []);
  console.log("PASS companion persistence, automatic/custom naming, timed signature quote, quiet mode and mobile layouts.");
  console.log(`Screenshots: ${artifacts}`);
} catch (error) {
  console.error("Browser errors:", errors);
  await page.screenshot({ path: join(artifacts, "failure.png"), fullPage: true }).catch(() => {});
  throw error;
} finally { await browser.close(); }
