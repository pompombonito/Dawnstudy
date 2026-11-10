import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const { chromium } = await import(process.env.DAWNSTUDY_PLAYWRIGHT_PATH ? pathToFileURL(process.env.DAWNSTUDY_PLAYWRIGHT_PATH).href : "playwright-core");
const browser = await chromium.launch({ executablePath: process.env.DAWNSTUDY_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const base = process.env.DAWNSTUDY_TEST_URL || "http://127.0.0.1:3044";
const compiled = ts.transpileModule(readFileSync(new URL("../app/pending-generation.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const moduleUrl = "data:text/javascript;base64," + Buffer.from(compiled).toString("base64");
const profile = { user_id: "progress-student", nickname: "Student", avatar_id: "cat", theme: "kuromi-dark", gender: "prefer-not-to-say", companion_id: "cat", companion_name: "Miso", onboarded: true, terms_version: "2026-10-30", public_key: null, key_fingerprint: "" };

try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const errors = [];
    let job = null, restart = false, replays = 0;
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
      else if (path === "/api/study-sets" || path === "/api/study-shares") data = [];
      else if (path === "/api/progress") data = { total_reviews: 0, reviewed_today: 0, accuracy: 0, current_streak: 0, best_streak: 0, due_count: 0, total_cards: 0, week: [] };
      else if (path === "/api/generation-jobs" && method === "POST") {
        const form = await new Response(request.postDataBuffer(), { headers: { "Content-Type": request.headers()["content-type"] } }).formData();
        assert.equal(form.get("client_request_id"), job.job_id);
        assert.equal(JSON.parse(form.get("checkpoint_json")).items.length, 22);
        replays += 1; restart = false;
        job = { ...job, status: "running", stage: "reading", message: "Restoring the original source", completed: 0 };
        delete job.checkpoint;
        data = job; status = 202;
      } else if (path === "/api/generation-jobs") data = { job: restart ? null : job };
      else if (path.startsWith("/api/generation-jobs/")) {
        if (restart) { status = 404; data = { detail: "The process restarted" }; }
        else data = job;
      }
      await route.fulfill({ status, headers, contentType: "application/json", body: JSON.stringify(data) });
    });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base); await page.waitForLoadState("networkidle");
    const requestId = await page.evaluate(async moduleUrl => {
      const recovery = await import(moduleUrl), form = new FormData();
      form.set("format", "flashcards"); form.set("question_count", "50");
      form.set("files", new File(["Nucleic acids carry inherited information."], "notes.txt"));
      const pending = recovery.captureGenerationRequest("progress-student", form);
      pending.checkpoint = { type: "flashcards", requested_count: 50, material_fingerprint: "same-source", items: Array.from({ length: 18 }, (_, i) => ({ question: `Verified concept ${i}?`, answer: "DNA" })) };
      await recovery.savePendingGenerationRequest(pending);
      return pending.requestId;
    }, moduleUrl);
    job = { job_id: requestId, status: "running", stage: "reading", message: "Retrying reading", completed: 0, requested: 50, can_cancel: true };
    await page.reload();
    const bubble = page.locator(".buddy-generation-bubble");
    await bubble.filter({ hasText: "18 of 50 questions ready" }).waitFor();
    for (const stage of ["waiting", "preparing", "generating"]) {
      job = { ...job, stage, message: `Retrying ${stage}`, completed: 0 };
      await bubble.filter({ hasText: `Retrying ${stage}` }).waitFor();
      assert.match(await bubble.innerText(), /18 of 50 questions ready/);
    }
    const checkpoint = { type: "flashcards", requested_count: 50, material_fingerprint: "same-source", items: Array.from({ length: 22 }, (_, i) => ({ question: `Verified concept ${i}?`, answer: "DNA" })) };
    job = { ...job, completed: 22, checkpoint, message: "New questions verified" };
    await bubble.filter({ hasText: "22 of 50 questions ready" }).waitFor();
    // Confirm IDB committed before making the old worker disappear. Playwright
    // runtimes can treat an async waitForFunction callback as an immediate value.
    let retained = false;
    for (let i = 0; i < 100 && !retained; i++) {
      retained = await page.evaluate(async moduleUrl => (await (await import(moduleUrl)).getPendingGenerationRequest("progress-student"))?.checkpoint?.items?.length === 22, moduleUrl);
      if (!retained) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(retained);
    restart = true;
    await page.reload();
    await bubble.filter({ hasText: "Restoring the original source" }).waitFor();
    assert.match(await bubble.innerText(), /22 of 50 questions ready/);
    assert.equal(replays, 1);
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: 18/50 survives zero-count retries; 22/50 survives host restart and request replay.`);
    await context.close();
  }
} finally { await browser.close(); }
