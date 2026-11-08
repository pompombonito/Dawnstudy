import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../app/generation-jobs.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { findGenerationJob, startGenerationJob, cancelGenerationJob, pollGenerationJob, GenerationJobError, GenerationCancelledError, QuestionnaireTypeMismatchError } =
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

test("questionnaire format mismatch returns a review preview without looking up a generation job", async () => {
  const preview = { selected_type: "multiple_choice", mismatches: [{ question: "Name this process.", source_type: "identification", answer: "Photosynthesis" }] };
  const config = options(async (_url, request) => request.method === "POST"
    ? json({ code: "questionnaire_type_mismatch", ...preview }, 409)
    : assert.fail("A format review is not an active generation"));
  await assert.rejects(startGenerationJob(new FormData(), config), (error) => {
    assert.ok(error instanceof QuestionnaireTypeMismatchError);
    assert.deepEqual(error.preview, preview);
    return true;
  });
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

test("cancelling sends one authenticated POST to the exact encoded job and returns its state", async () => {
  const calls = [];
  const controller = new AbortController();
  const job = { ...running, job_id: "job/1?", status: "cancelling", stage: "cancelling", can_cancel: false };
  const config = options(async (url, request) => { calls.push([url, request]); return json(job); }, controller);
  assert.deepEqual(await cancelGenerationJob(job.job_id, config), job);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "https://api.example/api/generation-jobs/job%2F1%3F/cancel");
  assert.equal(calls[0][1].method, "POST");
  assert.deepEqual(calls[0][1].headers, { Authorization: "Bearer own-account-token" });
  assert.equal(calls[0][1].signal, controller.signal);
  assert.equal(calls[0][1].cache, "no-store");
  assert.equal(calls[0][1].body, undefined);
  assert.equal(controller.signal.aborted, false, "Requesting cancellation must not abort monitoring");
});

test("a queued job cancelled immediately is a dedicated terminal outcome without further polling", async () => {
  const cancelled = { ...running, status: "cancelled", stage: "cancelled", message: "Generation cancelled.", can_cancel: false };
  const calls = [];
  const config = options(async (url, request) => {
    calls.push([url, request.method]);
    if (request.method !== "POST") assert.fail("Cancelled queue entry must not be polled again");
    return json(cancelled);
  });
  const acknowledged = await cancelGenerationJob("job-1", config);
  const statuses = [];
  await assert.rejects(pollGenerationJob("job-1", config, status => statuses.push(status), acknowledged), error => {
    assert.ok(error instanceof GenerationCancelledError);
    assert.ok(error instanceof GenerationJobError);
    assert.equal(error.name, "GenerationCancelledError");
    assert.equal(error.terminal, true);
    assert.equal(error.cancelled, true);
    assert.equal(error.message, "Generation cancelled.");
    return true;
  });
  assert.deepEqual(statuses.map(status => status.status), ["cancelled"]);
  assert.equal(calls.length, 1);
});

test("running cancellation keeps polling until the worker acknowledges cancellation", async () => {
  const cancelling = { ...running, status: "cancelling", stage: "cancelling", message: "Stopping generation…", can_cancel: false };
  const requests = [], statuses = [];
  const config = options(async (url, request) => {
    requests.push([url, request.method || "GET"]);
    if (request.method === "POST") return json(cancelling);
    return json({ ...cancelling, status: "cancelled", stage: "cancelled", message: "Stopped before another provider request." });
  });
  const acknowledged = await cancelGenerationJob("job-1", config);
  await assert.rejects(pollGenerationJob("job-1", config, status => statuses.push(status), acknowledged), error => error instanceof GenerationCancelledError);
  assert.deepEqual(statuses.map(status => status.status), ["cancelling", "cancelled"]);
  assert.equal(statuses[0].completed, 8);
  assert.deepEqual(requests.map(([, method]) => method), ["POST", "GET"]);
});

test("temporary polling failure keeps a pending cancellation visible until confirmation", async () => {
  let calls = 0;
  const statuses = [];
  const cancelling = { ...running, status: "cancelling", stage: "cancelling", can_cancel: false };
  const config = options(async () => {
    calls++;
    return calls === 1 ? json({ detail: "Temporary outage" }, 503) : json({ ...cancelling, status: "cancelled", message: "Cancelled" });
  });
  await assert.rejects(pollGenerationJob("job-1", config, status => statuses.push(status), cancelling), error => error instanceof GenerationCancelledError);
  assert.deepEqual(statuses.map(status => status.status), ["cancelling", "cancelling", "cancelled"]);
  assert.equal(statuses[1].stage, "cancelling");
  assert.equal(statuses[1].can_cancel, false);
  assert.match(statuses[1].message, /confirm cancellation/i);
});

test("an already completed job returned by cancellation retains its saved result", async () => {
  const complete = { ...running, status: "complete", result, can_cancel: false };
  let calls = 0;
  const config = options(async (_url, request) => {
    calls++;
    assert.equal(request.method, "POST");
    return json(complete);
  });
  const acknowledged = await cancelGenerationJob("job-1", config);
  assert.deepEqual(await pollGenerationJob("job-1", config, () => {}, acknowledged), result);
  assert.equal(calls, 1);
});

test("a cancellation that arrives during durable saving follows the authoritative save state", async () => {
  const saving = { ...running, stage: "saving", message: "Saving your questions…", can_cancel: false };
  const statuses = [];
  const config = options(async (_url, request) => request.method === "POST" ? json(saving) : json({ ...saving, status: "complete", result }));
  const acknowledged = await cancelGenerationJob("job-1", config);
  assert.equal(acknowledged.status, "running");
  assert.equal(acknowledged.can_cancel, false);
  assert.deepEqual(await pollGenerationJob("job-1", config, status => statuses.push(status), acknowledged), result);
  assert.deepEqual(statuses.map(status => status.status), ["running", "complete"]);
});

for (const status of [401, 403, 404]) {
  test(`cancel HTTP ${status} preserves its authorization or missing-job explanation`, async () => {
    const config = options(async () => json({ detail: `Cannot cancel: ${status}` }, status));
    await assert.rejects(cancelGenerationJob("job-1", config), error => error instanceof GenerationJobError && error.terminal && error.message === `Cannot cancel: ${status}`);
  });
}

for (const status of [429, 503]) {
  test(`cancel HTTP ${status} remains reconnectable and does not resubmit generation`, async () => {
    let calls = 0;
    const config = options(async (url, request) => {
      calls++;
      assert.ok(url.endsWith("/job-1/cancel"));
      assert.equal(request.method, "POST");
      return json({ detail: "Please retry cancellation" }, status);
    });
    await assert.rejects(cancelGenerationJob("job-1", config), error => error instanceof GenerationJobError && !error.terminal);
    assert.equal(calls, 1);
  });
}

test("a lost cancel response never submits new work or assumes the worker has stopped", async () => {
  const calls = [];
  const config = options(async (url, request) => { calls.push([url, request]); throw new TypeError("Failed to fetch"); });
  await assert.rejects(cancelGenerationJob("job-1", config), error => error instanceof GenerationJobError && !error.terminal && /confirm cancellation/.test(error.message));
  assert.equal(calls.length, 1);
  assert.ok(calls[0][0].endsWith("/job-1/cancel"));
});

test("an aborted cancellation request sends no network request", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(cancelGenerationJob("job-1", options(async () => assert.fail("Cancelled request must not run"), controller)), error => error.name === "AbortError");
});

test("unreadable or mismatched cancel replies require reconnecting to the original job", async () => {
  for (const response of [new Response("not JSON"), json({ ...running, job_id: "another-job" })]) {
    await assert.rejects(cancelGenerationJob("job-1", options(async () => response)), error => error instanceof GenerationJobError && !error.terminal && /same (?:generation|job)/.test(error.message));
  }
});
