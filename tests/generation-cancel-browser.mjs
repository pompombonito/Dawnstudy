import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { chromium } = await import(process.env.DAWNSTUDY_PLAYWRIGHT_PATH ? pathToFileURL(process.env.DAWNSTUDY_PLAYWRIGHT_PATH).href : "playwright-core");
const browser = await chromium.launch({ executablePath: process.env.DAWNSTUDY_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const base = process.env.DAWNSTUDY_TEST_URL || "http://127.0.0.1:3044";
const profile = { user_id: "cancel-student", nickname: "Student", avatar_id: "cat", theme: "kuromi-dark", gender: "prefer-not-to-say", companion_id: "cat", companion_name: "Miso", onboarded: true, terms_version: "2026-10-30", public_key: null, key_fingerprint: "" };
const errors = [];
let job = null, submissions = 0, cancellations = 0, acknowledgements = 0, failCancel = false, releaseSubmit, reachedSubmit;
const submitted = new Promise(resolve => { reachedSubmit = resolve; });
const pendingSubmission = new Promise(resolve => { releaseSubmit = resolve; });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(() => localStorage.setItem("dawnstudy_session_v1", "test-token"));
await context.route("http://localhost:8000/**", async route => {
  const req = route.request(), path = new URL(req.url()).pathname, method = req.method();
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" };
  if (method === "OPTIONS") return route.fulfill({ status: 204, headers });
  let data = {}, status = 200;
  if (path === "/api/auth/me") data = { id: profile.user_id, username: "student", email: "student@ceu.edu.ph", display_name: "Student" };
  else if (path === "/api/community/bootstrap") data = { profile, friends: [], incoming: [], outgoing: [], blocked: [], invitations: [], terms_version: "2026-10-30" };
  else if (path === "/api/models") data = { models: [] };
  else if (path === "/api/study-sets" || path === "/api/study-shares") data = [];
  else if (path === "/api/progress") data = { total_reviews: 0, reviewed_today: 0, accuracy: 0, current_streak: 0, best_streak: 0, due_count: 0, total_cards: 0, week: [] };
  else if (path === "/api/generation-jobs" && method === "GET") data = { job };
  else if (path === "/api/generation-jobs" && method === "POST") {
    submissions++; reachedSubmit(); await pendingSubmission;
    job = { job_id: "cancel-job", status: "queued", stage: "queued", message: "Waiting…", completed: 0, requested: 10, can_cancel: true };
    data = job; status = 202;
  } else if (path.endsWith("/cancel")) {
    cancellations++;
    if (failCancel) { status = 503; data = { detail: "Temporary test outage" }; }
    else { job = { ...job, status: "cancelled", stage: "cancelled", message: "Generation cancelled.", can_cancel: false }; data = job; }
  } else if (path.endsWith("/acknowledge")) { acknowledgements++; job = null; data = { ok: true }; }
  else if (path.startsWith("/api/generation-jobs/")) data = job;
  await route.fulfill({ status, headers, contentType: "application/json", body: JSON.stringify(data) });
});
const page = await context.newPage();
page.on("pageerror", error => errors.push(error.message));
try {
  await page.goto(base); await page.waitForLoadState("networkidle");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("A sample study material with enough source text to support generation.") });
  await page.getByRole("button", { name: "Choose practice" }).click();
  await page.getByRole("button", { name: "Review & create" }).click();
  await page.getByRole("button", { name: "Create study set" }).click();
  await submitted;
  await page.locator(".buddy-menu-toggle").click();
  await page.screenshot({ path: join(tmpdir(), "dawnstudy-generation-bubble.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Cancel generation", exact: true }).click();
  await page.locator(".buddy-generation-bubble").filter({ hasText: "Stopping…" }).waitFor();
  await page.locator(".buddy-generation-bubble").click();
  assert.equal(await page.locator(".buddy-generation-bubble").count(), 0, "Tapping status dismisses it");
  await page.locator(".buddy-launcher").click();
  await page.locator(".buddy-generation-bubble").waitFor();
  assert.equal(cancellations, 0, "An early click waits for the accepted job ID");
  releaseSubmit();
  await page.getByText("Generation cancelled. Your materials are ready if you want to try again.", { exact: true }).waitFor();
  await page.waitForFunction(() => !localStorage.getItem("dawnstudy-generation:cancel-student"));
  assert.equal(submissions, 1); assert.equal(cancellations, 1);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  assert.ok(await page.getByText("notes.txt", { exact: true }).count(), "Cancelling preserves uploaded inputs");
  console.log("PASS early cancellation waits for job ID, confirms terminal cancellation, and preserves source inputs.");

  job = { job_id: "restored-job", status: "running", stage: "generating", message: "Generating…", completed: 4, requested: 10, can_cancel: true };
  failCancel = true;
  await page.reload(); await page.waitForLoadState("networkidle");
  await page.locator(".buddy-menu-toggle").click();
  await page.getByRole("button", { name: "Cancel generation", exact: true }).click();
  await page.getByText(/Could not confirm cancellation/).waitFor();
  assert.equal(job.status, "running");
  failCancel = false;
  await page.getByRole("button", { name: "Cancel generation", exact: true }).click();
  await page.getByText("Generation cancelled. Your materials are ready if you want to try again.", { exact: true }).waitFor();
  assert.equal(submissions, 1, "Recovery and retry never resubmit generation");
  assert.equal(cancellations, 3);
  console.log("PASS restored generation cancellation retries failed POST while preserving monitoring.");

  job = { job_id: "saving-job", status: "running", stage: "saving", message: "Saving your study set…", completed: 10, requested: 10, can_cancel: false };
  await page.reload(); await page.waitForLoadState("networkidle");
  await page.locator(".buddy-menu-toggle").click();
  assert.ok(await page.getByRole("button", { name: "Questions are being saved", exact: true }).isDisabled());
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  assert.ok(acknowledgements >= 2);
  assert.deepEqual(errors, []);
  console.log("PASS saving protects completion; mobile layout has no overflow or browser errors.");
} finally { await browser.close(); }
