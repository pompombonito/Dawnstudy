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
  const portraits = picker.locator(".avatar-grid svg[data-character]");
  assert.equal(await portraits.count(), 75);
  for (const portrait of await portraits.all()) {
    assert.equal(await portrait.getAttribute("data-transparent"), "true");
    assert.equal(await portrait.locator("[data-face][data-eyes]").count(), 1, await portrait.getAttribute("data-character"));
    const transparent = await portrait.evaluate(async svg => {
      if (getComputedStyle(svg).backgroundColor !== "rgba(0, 0, 0, 0)") return false;
      const source = new XMLSerializer().serializeToString(svg);
      const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml" }));
      try {
        const image = new Image(); image.src = url; await image.decode();
        const canvas = document.createElement("canvas"); canvas.width = canvas.height = 100;
        const context = canvas.getContext("2d"); context.drawImage(image, 0, 0, 100, 100);
        return [[0,0],[99,0],[0,99],[99,99]].every(([x,y]) => context.getImageData(x,y,1,1).data[3] === 0);
      } finally { URL.revokeObjectURL(url); }
    });
    assert.ok(transparent, `${await portrait.getAttribute("data-character")} must have empty transparent surroundings`);
  }
  await picker.locator(".avatar-grid").evaluate(grid => grid.style.maxHeight = "none");
  await picker.locator(".avatar-grid").screenshot({ path: join(artifacts, "all-75-chibis.png") });
  await picker.locator(".avatar-grid").evaluate(grid => grid.style.removeProperty("max-height"));
  await page.evaluate(() => {
    const stage = document.createElement("div"); stage.id = "chibi-style-preview";
    Object.assign(stage.style, {position:"fixed",top:"0",left:"0",zIndex:"999999",display:"grid",gridTemplateColumns:"repeat(6, 132px)",gap:"10px",padding:"18px",background:"#f4f0f7",color:"#302b37",fontFamily:"Arial, sans-serif"});
    for (const [id, label] of [["yuno","Yuno"],["levi","Levi"],["naruto","Naruto"],["bakugo","Bakugo"],["rimuru","Rimuru"],["hinata","Hinata"],["hange","Hange"],["sakamoto","Sakamoto"],["gojo","Gojo"],["shinpei","Shinpei"],["mikasa","Mikasa"],["yona","Yona"]]) {
      const original = document.querySelector(`.profile-settings svg[data-character="anime-${id}"]`);
      const card = document.createElement("div"); Object.assign(card.style, {display:"grid",justifyItems:"center",gap:"4px"});
      const portrait = original.cloneNode(true); Object.assign(portrait.style, {width:"132px",height:"132px",maxWidth:"none",background:"transparent",border:"0",borderRadius:"0"});
      const name = document.createElement("strong"); name.textContent = label; Object.assign(name.style, {fontSize:"13px",fontWeight:"600"});
      card.append(portrait, name); stage.append(card);
    }
    document.body.append(stage);
  });
  await page.locator("#chibi-style-preview").screenshot({path:join(artifacts,"style-preview.png")});
  await page.locator("#chibi-style-preview").evaluate(stage => stage.remove());

  await picker.getByLabel("Search anime characters", { exact: true }).fill("GOJO");
  assert.equal(await picker.locator(".avatar-grid button").count(), 1);
  await picker.getByRole("button", { name: "Satoru Gojo · Jujutsu Kaisen", exact: true }).click();
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await page.getByText("Your profile is saved.", { exact: true }).waitFor();
  assert.equal(profile.avatar_id, "anime-gojo");
  await page.reload(); await page.waitForLoadState("networkidle");
  assert.equal(await page.locator('.profile-avatar-button svg[data-character="anime-gojo"]').count(), 1);
  console.log("PASS all 75 individual face designs render with transparent SVG surroundings; search and saved selections work.");

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
