import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(process.env.DAWNSTUDY_PLAYWRIGHT_PATH || join(tmpdir(), "dawn-qa/node_modules/playwright-core/index.mjs")).href);
const base = process.env.DAWNSTUDY_TEST_URL || "http://127.0.0.1:3044";
const artifacts = join(tmpdir(), "dawnstudy-theme-qa");
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.DAWNSTUDY_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const characters = [["cinnamoroll", "Cinnamoroll"], ["pompompurin", "Pompompurin"], ["kuromi", "Kuromi"], ["hello-kitty", "Hello Kitty"], ["pochacco", "Pochacco"]];
const errors = [], savedThemes = [], metrics = [];
let profile = { user_id: "theme-student", nickname: "June", avatar_id: "kuromi", gender: "prefer-not-to-say", theme: "dark", discoverable: false, companion_id: "cat", companion_name: "Miso", onboarded: true, terms_version: "2026-10-30", terms_accepted_at: "now", key_fingerprint: "", public_key: null };

async function context(storage = {}, width = 1440) {
  const c = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
  if (Object.keys(storage).length) await c.addInitScript(values => {
    if (!sessionStorage.getItem("theme-qa-seeded")) {
      for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
      sessionStorage.setItem("theme-qa-seeded", "1");
    }
  }, storage);
  await c.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(base).origin) return route.continue();
    if (url.origin !== "http://localhost:8000") return route.abort();
    const method = route.request().method();
    let data = {};
    if (url.pathname === "/api/models") data = { models: [] };
    else if (url.pathname === "/api/auth/me") data = { id: "theme-student", username: "june", email: "june@ceu.edu.ph", display_name: "June" };
    else if (url.pathname === "/api/study-sets" || url.pathname === "/api/study-shares") data = [];
    else if (url.pathname === "/api/generation-jobs") data = { job: null };
    else if (url.pathname === "/api/progress") data = { total_reviews: 0, reviewed_today: 0, accuracy: 0, current_streak: 0, best_streak: 0, due_count: 0, total_cards: 0, week: [] };
    else if (url.pathname === "/api/community/bootstrap") data = { profile, friends: [], incoming: [], outgoing: [], blocked: [], invitations: [], terms_version: "2026-10-30" };
    else if (url.pathname === "/api/community/profile" && method === "PUT") {
      profile = { ...profile, ...route.request().postDataJSON() };
      savedThemes.push(profile.theme);
      data = profile;
    } else if (url.pathname.startsWith("/api/shared/")) data = { title: "Shared biology", type: "flashcards", items: [{ question: "What carries cellular energy?", answer: "ATP" }], sources: [] };
    else if (url.pathname === "/api/community/safety-policy") data = {};
    else data = { ok: true };
    await route.fulfill({ status: method === "OPTIONS" ? 204 : 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" }, body: method === "OPTIONS" ? undefined : JSON.stringify(data) });
  });
  const p = await c.newPage();
  p.on("pageerror", error => errors.push(error.message));
  return { c, p };
}

async function themed(p, id) {
  await p.waitForFunction(expected => document.documentElement.dataset.colorTheme === expected, id);
  assert.equal(await p.locator("html").getAttribute("data-character"), id.replace(/-(light|dark)$/, ""));
  assert.equal(await p.locator("html").getAttribute("data-theme"), id.endsWith("-light") ? "light" : "dark");
}
async function open(p) {
  if (!await p.locator(".theme-picker-popover").isVisible()) await p.getByRole("button", { name: /^Change theme/ }).click();
}
async function choose(p, name, mode) {
  await open(p);
  const panel = p.locator(".theme-picker-popover");
  await panel.getByRole("radio", { name, exact: true }).locator("..").click();
  await panel.getByRole("radio", { name: mode === "light" ? "Light" : "Dark", exact: true }).locator("..").click();
}
async function noOverflow(p) {
  const size = await p.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
  assert.ok(size.scroll <= size.width + 1, `Overflow ${size.scroll} > ${size.width}`);
  const box = await p.locator(".theme-picker-popover").boundingBox();
  if (box) assert.ok(box.x >= 0 && box.x + box.width <= size.width + 1, "Theme choices must fit the viewport");
}
async function contrast(p) {
  return p.evaluate(() => {
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });
    canvas.width = canvas.height = 1;
    const rgba = value => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
    const lum = c => c.slice(0, 3).map(x => { const s = x / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }).reduce((a, x, i) => a + x * [.2126, .7152, .0722][i], 0);
    return ["body", ".creator-heading h2", ".creator-prompt p", ".type-card", ".creator-next", ".theme-picker-heading strong", ".theme-mode-option.is-selected"].flatMap(selector => {
      const el = document.querySelector(selector);
      if (!el || !el.getClientRects().length) return [];
      let bg = el, color;
      do { color = rgba(getComputedStyle(bg).backgroundColor); if (color[3] > 250) break; bg = bg.parentElement; } while (bg);
      if (!bg) color = rgba(getComputedStyle(document.body).backgroundColor);
      const fg = rgba(getComputedStyle(el).color), a = lum(fg), b = lum(color);
      return [{ selector, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) }];
    });
  });
}

try {
  const guest = await context();
  const html = await (await guest.c.request.get(base)).text();
  assert.match(html, /data-character="kuromi"/);
  assert.match(html, /data-color-theme="kuromi-dark"/);
  await guest.p.goto(base);
  await guest.p.getByRole("button", { name: /^Change theme/ }).waitFor();
  await themed(guest.p, "kuromi-dark");
  await guest.p.screenshot({ path: join(artifacts, "kuromi-default-desktop.png"), fullPage: true, animations: "disabled" });
  const papers = new Set();
  for (const [id, name] of characters) for (const mode of ["light", "dark"]) {
    await choose(guest.p, name, mode);
    await themed(guest.p, `${id}-${mode}`);
    assert.equal(await guest.p.evaluate(() => localStorage.getItem("dawnstudy_guest_theme_v1")), `${id}-${mode}`);
    const colors = await guest.p.evaluate(() => ({ paper: getComputedStyle(document.documentElement).getPropertyValue("--paper").trim(), ink: getComputedStyle(document.body).color }));
    papers.add(colors.paper);
    const checks = await contrast(guest.p);
    for (const check of checks) assert.ok(check.ratio >= 4.5, `${id}-${mode} ${check.selector} contrast ${check.ratio}`);
    metrics.push({ id: `${id}-${mode}`, colors, contrast: checks });
    await noOverflow(guest.p);
    await guest.p.keyboard.press("Escape");
    await guest.p.screenshot({ path: join(artifacts, `${id}-${mode}.png`), fullPage: true, animations: "disabled" });
  }
  assert.equal(papers.size, 10);
  await guest.p.reload();
  await themed(guest.p, "pochacco-dark");
  for (const width of [320, 390, 768, 1440]) {
    await guest.p.setViewportSize({ width, height: 900 });
    await open(guest.p);
    await noOverflow(guest.p);
    await guest.p.screenshot({ path: join(artifacts, `picker-${width}.png`), fullPage: true, animations: "disabled" });
    await guest.p.keyboard.press("Escape");
    assert.ok(await guest.p.getByRole("button", { name: /^Change theme/ }).evaluate(el => el === document.activeElement));
  }
  await guest.p.goto(`${base}/shared/theme-qa`);
  await guest.p.getByRole("heading", { name: "Shared biology" }).waitFor();
  await themed(guest.p, "pochacco-dark");
  await choose(guest.p, "Cinnamoroll", "light");
  await themed(guest.p, "cinnamoroll-light");
  const sharedPaper = await guest.p.locator(".shared-shell").evaluate(el => getComputedStyle(el).backgroundColor);
  assert.equal(sharedPaper, "rgb(238, 245, 250)");
  await guest.p.goto(base);
  await themed(guest.p, "cinnamoroll-light");
  await guest.c.close();

  const signed = await context({ dawnstudy_session_v1: "theme-student", dawnstudy_theme_v1: "dark", dawnstudy_guest_theme_v1: "pompompurin-light" });
  await signed.p.goto(base);
  await signed.p.getByRole("button", { name: "Sign out", exact: true }).first().waitFor();
  await themed(signed.p, "kuromi-dark");
  await choose(signed.p, "Hello Kitty", "light");
  await signed.p.waitForFunction(() => localStorage.getItem("dawnstudy_theme_v1") === "hello-kitty-light");
  await signed.p.waitForTimeout(250);
  assert.equal(profile.theme, "hello-kitty-light");
  assert.ok(savedThemes.includes("hello-kitty-light"));
  await signed.p.reload();
  await themed(signed.p, "hello-kitty-light");
  await signed.p.goto(`${base}/shared/theme-qa`);
  await signed.p.getByRole("heading", { name: "Shared biology" }).waitFor();
  await themed(signed.p, "hello-kitty-light");
  await choose(signed.p, "Cinnamoroll", "dark");
  await signed.p.waitForTimeout(300);
  assert.equal(profile.theme, "cinnamoroll-dark");
  await signed.p.goto(base);
  await themed(signed.p, "cinnamoroll-dark");
  await signed.p.getByRole("button", { name: "Sign out", exact: true }).first().click();
  await themed(signed.p, "pompompurin-light");
  await signed.p.reload();
  await themed(signed.p, "pompompurin-light");
  await signed.c.close();
  const fresh = await context({ dawnstudy_theme_v1: "hello-kitty-dark" });
  await fresh.p.goto(base);
  await themed(fresh.p, "kuromi-dark");
  await fresh.c.close();
  assert.deepEqual(errors, []);
  await writeFile(join(artifacts, "theme-checks.json"), JSON.stringify(metrics, null, 2));
  console.log("PASS all ten themes, contrast, account/guest persistence, shared pages, responsive picker and keyboard dismissal.");
  console.log(`Screenshots: ${artifacts}`);
} finally { await browser.close(); }
