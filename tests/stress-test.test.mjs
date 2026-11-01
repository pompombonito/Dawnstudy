import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { percentile, readBody, readConfig, RequestGate, runStressTest } from "../scripts/stress-test.mjs";

test("configuration rejects unsafe URLs and excessive load", () => {
  assert.deepEqual(readConfig({}).stages, [1, 5, 10, 20, 40]);
  for (const overrides of [{ site: "file:///tmp" }, { api: "https://user:password@example.com" }, { rps: 21 }, { stages: "0,10" }, { seconds: 0 }]) {
    assert.throws(() => readConfig({}, overrides));
  }
});
test("percentiles are reproducible and do not mutate observations", () => {
  const values = [40, 10, 30, 20];
  assert.equal(percentile(values, 0.5), 20);
  assert.equal(percentile(values, 0.95), 40);
  assert.deepEqual(values, [40, 10, 30, 20]);
  assert.equal(percentile([], 0.95), null);
});
test("body reader enforces a response byte limit", async () => {
  assert.equal(await readBody(new Response("hello"), 5), "hello");
  await assert.rejects(readBody(new Response("too much"), 5), /exceeds/);
});
test("admission spaces request starts and enforces in-flight ceiling", async () => {
  const gate = new RequestGate(20, 1);
  const signal = new AbortController().signal;
  const first = await gate.acquire(signal);
  let admitted = false;
  const pending = gate.acquire(signal).then(value => { admitted = true; return value; });
  await delay(65);
  assert.equal(admitted, false);
  assert.equal(gate.active, 1);
  first.release(); first.release();
  const second = await pending;
  assert.ok(second.waitedMs >= 60);
  second.release();
  const started = performance.now();
  const third = await gate.acquire(signal);
  assert.ok(performance.now() - started >= 35);
  third.release();
  assert.equal(gate.active, 0);
});
test("public journeys validate all routes and never write", async () => {
  const calls = [];
  const config = { ...readConfig({}), stages: [2], durationMs: 160, thinkMs: 1000, rps: 1000 };
  const report = await runStressTest(config, { log() {}, fetcher: async (url, options) => {
    calls.push({ url, options });
    return new Response(url.endsWith("/api/health") ? '{"status":"ok"}' : url.endsWith("/api/models") ? '{"models":[]}' : "<html>hello</html>");
  } });
  assert.equal(report.stages[0].successes, 6);
  assert.equal(report.stages[0].completedJourneys, 2);
  assert.equal(report.stoppedReason, null);
  assert.ok(calls.every(({ options }) => !options.method || options.method === "GET"));
  assert.ok(calls.every(({ options }) => !options.headers.Authorization));
});
test("HTTP 429 stops future stages immediately", async () => {
  const report = await runStressTest({ ...readConfig({}), stages: [1, 10], durationMs: 1000 }, {
    log() {}, fetcher: async () => new Response("limited", { status: 429 }),
  });
  assert.equal(report.stages.length, 1);
  assert.equal(report.stages[0].failures, 1);
  assert.match(report.stoppedReason, /HTTP 429/);
});
test("validated content failures trigger the failure-rate safety stop", async () => {
  const report = await runStressTest({ ...readConfig({}), stages: [10, 20], durationMs: 1000, rps: 1000 }, {
    log() {}, fetcher: async () => new Response("proxy loading"),
  });
  assert.equal(report.stages.length, 1);
  assert.equal(report.stages[0].requests, 20);
  assert.equal(report.stages[0].failures, 20);
  assert.match(report.stoppedReason, /failure rate/);
});
