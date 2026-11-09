import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const { chromium } = await import(process.env.DAWNSTUDY_PLAYWRIGHT_PATH ? pathToFileURL(process.env.DAWNSTUDY_PLAYWRIGHT_PATH).href : "playwright-core");
const browser = await chromium.launch({ executablePath: process.env.DAWNSTUDY_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const base = process.env.DAWNSTUDY_TEST_URL || "http://127.0.0.1:3044";
const profile = { user_id: "recovery-student", nickname: "Student", avatar_id: "cat", theme: "kuromi-dark", gender: "prefer-not-to-say", companion_id: "cat", companion_name: "Miso", onboarded: true, terms_version: "2026-10-30", public_key: null, key_fingerprint: "" };
const sourceText = "Original biology source: ATP transports usable cellular energy. Chlorophyll captures light for photosynthesis.";
const errors = [], submissions = [], statusReads = [];
let job = null, requestedId, saved = null, restarting = false;
const context = await browser.newContext();
await context.addInitScript(() => localStorage.setItem("dawnstudy_session_v1", "test-token"));
await context.route("http://localhost:8000/**", async route => {
  const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" };
  if (method === "OPTIONS") return route.fulfill({ status: 204, headers });
  let data = {}, status = 200;
  if (path === "/api/auth/me") data = { id: profile.user_id, username: "student", email: "student@gmail.com", display_name: "Student" };
  else if (path === "/api/community/bootstrap") data = { profile, friends: [], incoming: [], outgoing: [], blocked: [], invitations: [], terms_version: "2026-10-30" };
  else if (path === "/api/models") data = { models: [] };
  else if (path === "/api/health") data = { status: "ok" };
  else if (path === "/api/study-sets") data = saved ? [saved] : [];
  else if (path === "/api/study-shares") data = [];
  else if (path === "/api/progress") data = { total_reviews: 0, reviewed_today: 0, accuracy: 0, current_streak: 0, best_streak: 0, due_count: 0, total_cards: 0, week: [] };
  else if (path === "/api/generation-jobs" && method === "POST") {
    const form = await new Response(request.postDataBuffer(), { headers: { "Content-Type": request.headers()["content-type"] } }).formData();
    submissions.push(form);
    const requestId = form.get("client_request_id");
    assert.match(requestId, /^[0-9a-f-]{36}$/);
    assert.equal(await form.get("files").text(), sourceText);
    assert.equal(form.get("files").name, "biology.txt");
    if (submissions.length === 1) {
      requestedId = requestId;
      const checkpoint = { id: requestId, title: "Recovered biology", type: form.get("format"), created_at: new Date().toISOString(), material_fingerprint: "source-fingerprint", requested_count: 10, incomplete: true, sources: [], items: [
        { card_id: "retained-1", question: "What transports cellular energy?", answer: "ATP" },
        { card_id: "retained-2", question: "What captures light?", answer: "Chlorophyll" },
      ] };
      job = { job_id: requestId, status: "running", stage: "generating", message: "Generating…", completed: 2, requested: 10, checkpoint };
      // The proxy loses a response even though the request was accepted.
      status = 502; data = { detail: "Temporary gateway failure" };
    } else {
      assert.equal(requestId, requestedId, "Restart recovery must preserve the idempotency key");
      const checkpoint = JSON.parse(form.get("checkpoint_json"));
      assert.equal(checkpoint.items.length, 2);
      assert.equal(checkpoint.items[0].card_id, "retained-1");
      saved = { ...checkpoint, incomplete: false, items: [...checkpoint.items, ...Array.from({ length: 8 }, (_, i) => ({ card_id: "new-" + i, question: "Biology question " + (i + 3) + "?", answer: "Answer " + i }))] };
      job = { job_id: requestId, status: "complete", stage: "complete", message: "Ready", completed: 10, requested: 10, result: saved };
      data = job; status = 202;
    }
  } else if (path === "/api/generation-jobs" && method === "GET") {
    // This old terminal job must never replace the locally tracked request.
    data = { job: restarting ? { job_id: "unrelated-old-job", status: "complete", result: { title: "Unrelated old set", items: [] } } : job };
  } else if (path.endsWith("/acknowledge")) { data = { ok: true }; }
  else if (path.startsWith("/api/generation-jobs/")) {
    statusReads.push(path);
    if (!job) { status = 404; data = { detail: "This process restarted" }; }
    else data = job;
  }
  await route.fulfill({ status, headers, contentType: "application/json", body: JSON.stringify(data) });
});
const page = await context.newPage();
page.on("pageerror", error => errors.push(error.message));
try {
  await page.goto(base); await page.waitForLoadState("networkidle");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "biology.txt", mimeType: "text/plain", buffer: Buffer.from(sourceText) });
  await page.getByRole("button", { name: "Choose practice" }).click();
  await page.getByRole("button", { name: "Review & create" }).click();
  await page.getByRole("button", { name: "Create study set" }).click();
  await page.waitForFunction(async () => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open("dawnstudy-generation-recovery-v1", 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try { return await new Promise(resolve => { const request = db.transaction("requests").objectStore("requests").get("recovery-student"); request.onsuccess = () => resolve(request.result?.checkpoint?.items?.length === 2); }); }
    finally { db.close(); }
  });
  assert.equal(submissions.length, 1, "A 502 after acceptance must not duplicate work");
  assert.ok(statusReads.includes("/api/generation-jobs/" + requestedId));
  job = null; restarting = true;
  await page.reload();
  await page.getByText("Your study set is ready with 10 questions.", { exact: true }).waitFor();
  assert.equal(submissions.length, 2, "A confirmed restart should replay once");
  assert.equal(saved.items[0].card_id, "retained-1");
  await page.waitForFunction(() => !localStorage.getItem("dawnstudy_generation_v1:recovery-student"));
  console.log("PASS lost gateway response reattaches; refresh after host restart replays original files, request ID and validated checkpoint.");

  const compiled = ts.transpileModule(readFileSync(new URL("../app/pending-generation.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const moduleUrl = "data:text/javascript;base64," + Buffer.from(compiled).toString("base64");
  const storageResult = await page.evaluate(async moduleUrl => {
    const recovery = await import(moduleUrl);
    const form = new FormData(); form.append("files", new File(["binary-source"], "original.txt", { type: "text/plain" })); form.append("page_ranges", '{"0":"2-4"}');
    const alice = recovery.captureGenerationRequest("alice", form);
    await recovery.savePendingGenerationRequest(alice);
    const bob = recovery.captureGenerationRequest("bob", new FormData()); await recovery.savePendingGenerationRequest(bob);
    await recovery.updatePendingGenerationRequest("alice", "older-request-id", { checkpoint: { items: ["wrong"] } });
    await recovery.deletePendingGenerationRequest("alice", "older-request-id");
    const restored = await recovery.getPendingGenerationRequest("alice");
    const restoredForm = recovery.restoreGenerationForm(restored);
    const output = { requestId: restored.requestId, expectedId: alice.requestId, filename: restoredForm.get("files").name, content: await restoredForm.get("files").text(), scope: restoredForm.get("page_ranges"), checkpoint: restored.checkpoint, otherAccount: (await recovery.getPendingGenerationRequest("bob")).requestId === bob.requestId };
    await recovery.deletePendingGenerationRequest("alice", alice.requestId); await recovery.deletePendingGenerationRequest("bob", bob.requestId);
    return output;
  }, moduleUrl);
  assert.equal(storageResult.requestId, storageResult.expectedId);
  assert.equal(storageResult.filename, "original.txt"); assert.equal(storageResult.content, "binary-source");
  assert.equal(storageResult.scope, '{"0":"2-4"}'); assert.equal(storageResult.checkpoint, undefined); assert.equal(storageResult.otherAccount, true);
  assert.deepEqual(errors, []);
  console.log("PASS real IndexedDB preserves file bytes/names and page selection, isolates accounts, and rejects stale observer changes.");

  await page.evaluate(async moduleUrl => {
    const recovery = await import(moduleUrl);
    const form = new FormData(); form.append("files", new File(["cancelled source"], "cancelled.txt"));
    const pending = recovery.captureGenerationRequest("recovery-student", form);
    pending.cancelRequested = true;
    await recovery.savePendingGenerationRequest(pending);
  }, moduleUrl);
  job = null;
  await page.reload();
  await page.getByText("Generation cancelled. Your materials are ready if you want to try again.", { exact: true }).waitFor();
  assert.equal(submissions.length, 2, "A cancelled request must never replay after a restart");
  assert.deepEqual(errors, []);
  console.log("PASS cancellation intention survives refresh and prevents restart replay.");
} finally { await browser.close(); }
