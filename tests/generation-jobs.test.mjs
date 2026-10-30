import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../app/generation-jobs.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { findGenerationJob, startGenerationJob, pollGenerationJob, GenerationJobError } =
  await import("data:text/javascript;base64," + Buffer.from(javascript).toString("base64"));

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const running = { job_id: "job-1", status: "running", stage: "generating", message: "GPT-OSS is generating", completed: 8, requested: 20, model: "GPT-OSS" };
const result = { id: "saved-set", title: "Recovered questions", items: [{ question: "Already generated" }] };
const options = (fetcher, controller = new AbortController()) => ({
  baseUrl: "https://api.example", token: "own-account-token", signal: controller.signal, fetcher, intervalMs: 0, timeoutMs: 1000,
});

test("page reload discovers and polls the existing job using GET only", async () => {
  const calls = [];
  const config = options(async (url, request) => {
    calls.push([url, request]);
    return json(url.endsWith("/generation-jobs") ? { job: running } : { ...running, status: "complete", result });
  });
  const job = await findGenerationJob(config);
  const statuses = [];
  assert.deepEqual(await pollGenerationJob(job.job_id, config, status => statuses.push(status), job), result);
  assert.equal(statuses[0].completed, 8);
  assert.equal(statuses[0].model, "GPT-OSS");
  assert.equal(calls.length, 2);
  assert.ok(calls.every(([, request]) => !request.method || request.method === "GET"));
  assert.ok(calls.every(([, request]) => request.headers.Authorization === "Bearer own-account-token"));
});

test("duplicate submission attaches to the existing job instead of displaying 409", async () => {
  const calls = [];
  const config = options(async (url, request) => {
    calls.push([url, request.method]);
    return request.method === "POST"
      ? json({ detail: "A generation is already running for your account.", job_id: "job-1" }, 409)
      : json(running);
  });
  const job = await startGenerationJob(new FormData(), config);
  assert.equal(job.job_id, "job-1");
  assert.equal(job.resumed, true);
  assert.equal(calls.filter(([, method]) => method === "POST").length, 1);
  assert.equal(calls[1][0], "https://api.example/api/generation-jobs/job-1");
});

test("a lost submission response discovers accepted work without resubmitting", async () => {
  let posts = 0;
  const config = options(async (_url, request) => {
    if (request.method === "POST") { posts++; throw new TypeError("Failed to fetch"); }
    return json({ job: running });
  });
  assert.equal((await startGenerationJob(new FormData(), config)).job_id, "job-1");
  assert.equal(posts, 1);
});

test("a completed job is returned immediately after refresh without another AI request", async () => {
  const config = options(async () => assert.fail("Completed job must not start or poll again"));
  assert.deepEqual(await pollGenerationJob("job-1", config, () => {}, { ...running, status: "complete", result }), result);
});

test("temporary connection and server failures retain the observer until recovery", async () => {
  let attempt = 0;
  const stages = [];
  const config = options(async () => {
    attempt++;
    if (attempt === 1) throw new TypeError("Failed to fetch");
    if (attempt === 2) return json({ detail: "Temporary outage" }, 503);
    return json({ ...running, status: "complete", result });
  });
  assert.deepEqual(await pollGenerationJob("job-1", config, status => stages.push(status.stage)), result);
  assert.equal(attempt, 3);
  assert.deepEqual(stages, ["reconnecting", "reconnecting", "generating"]);
});

test("failed generation is terminal and keeps the backend explanation", async () => {
  await assert.rejects(
    pollGenerationJob("job-1", options(async () => json({ ...running, status: "error", message: "Provider quota exhausted" })), () => {}),
    error => error instanceof GenerationJobError && error.terminal && error.message === "Provider quota exhausted",
  );
});

test("logout/unmount aborts monitoring and prevents further requests", async () => {
  const controller = new AbortController();
  const config = options(async () => assert.fail("No request should follow cancellation"), controller);
  await assert.rejects(
    pollGenerationJob("job-1", config, () => controller.abort(), running),
    error => error.name === "AbortError",
  );
});

test("expired monitoring remains reconnectable, while missing jobs are terminal", async () => {
  await assert.rejects(
    pollGenerationJob("job-1", { ...options(async () => assert.fail()), timeoutMs: 0 }, () => {}),
    error => error instanceof GenerationJobError && !error.terminal,
  );
  await assert.rejects(
    pollGenerationJob("job-1", options(async () => json({ detail: "Missing" }, 404)), () => {}),
    error => error instanceof GenerationJobError && error.terminal,
  );
});
