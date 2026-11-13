import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../app/generation-jobs.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { findGenerationJob, startGenerationJob, cancelGenerationJob, pollGenerationJob, generationReadyText, generationRetryText, mergeGenerationStatus, generationCheckpointProgress, GenerationJobError, GenerationCancelledError, QuestionnaireTypeMismatchError } =
  await import("data:text/javascript;base64," + Buffer.from(javascript).toString("base64"));

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const running = { job_id: "job-1", status: "running", stage: "generating", message: "GPT-OSS is generating", completed: 8, requested: 20, model: "GPT-OSS" };
const result = { id: "saved-set", title: "Recovered questions", items: [{ question: "Already generated" }] };

test("only a queued wait with a future retry timestamp shows a retry time", () => {
  const now = Date.parse("2026-11-13T01:00:00Z");
  const waiting = { ...running, status: "queued", stage: "waiting", retry_at: "2026-11-13T01:05:00Z" };
  assert.match(generationRetryText(waiting, now), /^Next attempt at /);
  assert.equal(generationRetryText({ ...waiting, stage: "queued" }, now), "");
  assert.equal(generationRetryText({ ...waiting, status: "cancelled" }, now), "");
  assert.equal(generationRetryText({ ...waiting, retry_at: undefined }, now), "");
  assert.equal(generationRetryText({ ...waiting, retry_at: null }, now), "");
  assert.equal(generationRetryText({ ...waiting, retry_at: "invalid" }, now), "");
  assert.equal(generationRetryText(waiting, Date.parse(waiting.retry_at)), "");
  const resumed = mergeGenerationStatus(waiting, { ...running, completed: 0 });
  assert.equal(resumed.completed, 8);
  assert.equal(generationRetryText(resumed, now), "");
});

test("retained progress never falls from 18 of 50 to zero while the same job retries", () => {
  let status = { ...running, completed: 18, requested: 50 };
  for (const stage of ["waiting", "queued", "reading", "preparing", "generating", "reconnecting"]) {
    status = mergeGenerationStatus(status, { ...running, status: "running", stage, completed: 0, requested: 50 });
    assert.equal(generationReadyText(status.completed, status.requested), "18 of 50 questions ready");
    assert.equal(status.stage, stage);
  }
  status = mergeGenerationStatus(status, { ...running, completed: 22, requested: 50 });
  assert.equal(status.completed, 22);
  status = mergeGenerationStatus(status, { ...running, completed: -1, requested: 0, model: null });
  assert.equal(status.completed, 22);
  assert.equal(status.requested, 50);
  assert.equal(status.model, "GPT-OSS");
});

test("reload uses verified checkpoint count and continuation total before the server catches up", () => {
  const checkpoint = { requested_count: 50, items: Array.from({ length: 18 }, () => ({ question: "Verified" })) };
  const recovered = mergeGenerationStatus(null, { ...running, completed: 0, requested: 32 }, checkpoint);
  assert.equal(generationReadyText(recovered.completed, recovered.requested), "18 of 50 questions ready");
  assert.equal(mergeGenerationStatus(null, { ...running, completed: 0, requested: 50 }).completed, 0, "A new request starts at zero");
  const explanations = { requested_count: 2, items: [{ question: "Ready" }, { question: "Needs explanation", explanation_pending: true }] };
  assert.deepEqual(generationCheckpointProgress(explanations), { completed: 1, requested: 2 });
  assert.equal(mergeGenerationStatus(null, { ...running, completed: 0, requested: 10 }, explanations).requested, 2, "A discovered questionnaire total replaces the old default");
});
const options = (fetcher, controller = new AbortController()) => ({
  baseUrl: "https://api.example", token: "own-account-token", signal: controller.signal, fetcher, intervalMs: 0, timeoutMs: 1000,
});

test("progress reports source totals and never renders the stale 134-of-10 ratio", () => {
  assert.equal(generationReadyText(134, 136), "134 of 136 questions ready");
  assert.equal(generationReadyText(134, 10), "134 questions ready");
  assert.equal(generationReadyText(0, 0), "");
  assert.equal(generationReadyText(1, 0), "1 question ready");
  assert.equal(generationReadyText(136, 136), "136 of 136 questions ready");
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
  assert.ok(calls[0][1].signal instanceof AbortSignal);
  assert.equal(calls[0][1].signal.aborted, false);
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

for (const status of [429, 502, 503, 504]) {
  test(`submission HTTP ${status} recovers accepted work by exact request ID`, async () => {
    const calls = [];
    const form = new FormData();
    form.set("client_request_id", "request-1");
    const config = options(async (url, request) => {
      calls.push([url, request.method]);
      if (request.method === "POST") return json({ detail: "Gateway unavailable" }, status);
      assert.equal(url, "https://api.example/api/generation-jobs/request-1");
      return json({ ...running, job_id: "request-1" });
    });
    assert.equal((await startGenerationJob(form, config)).job_id, "request-1");
    assert.equal(calls.filter(([, method]) => method === "POST").length, 1);
  });
}

test("truncated submission JSON discovers the same accepted request", async () => {
  const form = new FormData();
  form.set("client_request_id", "request-1");
  const config = options(async (_url, request) => request.method === "POST"
    ? new Response('{"job_id":') : json({ ...running, job_id: "request-1" }));
  assert.equal((await startGenerationJob(form, config)).job_id, "request-1");
});

test("a hung status request aborts and polling automatically reconnects", async () => {
  let calls = 0, timedOutSignal;
  const config = { ...options(async (_url, request) => {
    if (++calls === 1) { timedOutSignal = request.signal; return new Promise(() => {}); }
    return json({ ...running, status: "complete", result });
  }), requestTimeoutMs: 5 };
  assert.deepEqual(await pollGenerationJob("job-1", config, () => {}), result);
  assert.equal(calls, 2);
  assert.equal(timedOutSignal.aborted, true);
});

test("a stalled response body is bounded as well as the fetch connection", async () => {
  let calls = 0;
  const config = { ...options(async () => ++calls === 1
    ? new Response(new ReadableStream({ start() {} }))
    : json({ ...running, status: "complete", result })), requestTimeoutMs: 5 };
  assert.deepEqual(await pollGenerationJob("job-1", config, () => {}), result);
  assert.equal(calls, 2);
});

test("default monitoring survives a quota wait longer than one hour", async () => {
  const originalNow = Date.now;
  let now = originalNow(), calls = 0;
  Date.now = () => now;
  try {
    const config = { ...options(async () => {
      if (++calls === 1) { now += 2 * 60 * 60_000; return json(running); }
      return json({ ...running, status: "complete", result });
    }), timeoutMs: undefined };
    assert.deepEqual(await pollGenerationJob("job-1", config, () => {}), result);
  } finally { Date.now = originalNow; }
});

test("validated checkpoints reach the recovery store before another status request", async () => {
  let persisted = false;
  const config = options(async () => {
    assert.equal(persisted, true);
    return json({ ...running, status: "complete", result });
  });
  assert.deepEqual(await pollGenerationJob("job-1", config, async status => {
    if (status.checkpoint) {
      await new Promise(resolve => setTimeout(resolve, 5));
      persisted = true;
    }
  }, { ...running, checkpoint: result }), result);
});

test("logout aborts an already hung network request promptly", async () => {
  const controller = new AbortController();
  let childSignal;
  const config = options(async (_url, request) => {
    childSignal = request.signal;
    queueMicrotask(() => controller.abort());
    return new Promise(() => {});
  }, controller);
  await assert.rejects(findGenerationJob(config, "job-1"), error => error.name === "AbortError");
  assert.equal(childSignal.aborted, true);
});

test("malformed or unrelated HTTP 200 status never confirms that a job was lost", async () => {
  for (const body of [null, {}, { ...running, job_id: "unrelated-job" }]) {
    await assert.rejects(findGenerationJob(options(async () => json(body)), "job-1"), error => error instanceof GenerationJobError && !error.terminal);
  }
});

for (const status of [401, 403]) {
  test(`HTTP ${status} preserves the authentication status so observers keep recovery data`, async () => {
    let posts = 0, gets = 0;
    const config = options(async (_url, request) => {
      if (request.method === "POST") posts++; else gets++;
      return json({ detail: "Restore account access" }, status);
    });
    const isAuthenticationError = error => error instanceof GenerationJobError && error.terminal
      && error.responseStatus === status && error.message === "Restore account access";
    await assert.rejects(pollGenerationJob("job-1", config, () => {}), isAuthenticationError);
    assert.equal(gets, 1, "An expired session must stop automatic polling");
    await assert.rejects(startGenerationJob(new FormData(), config), isAuthenticationError);
    assert.equal(posts, 1);
    assert.equal(gets, 1, "Authentication errors must not trigger submission recovery requests");
  });
}
