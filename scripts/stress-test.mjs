import { writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

export function readConfig(env = process.env, options = {}) {
  const base = (value, label) => {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error(`${label} must be an HTTP(S) URL without credentials, query, or fragment`);
    }
    return url.href.replace(/\/$/, "");
  };
  const integer = (value, fallback, min, max, label) => {
    const number = Number(value ?? fallback);
    if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`${label} must be ${min}–${max}`);
    return number;
  };
  const stages = String(options.stages ?? env.STRESS_STAGES ?? "1,5,10,20,40").split(",")
    .map(value => integer(value, 1, 1, 100, "stage users"));
  if (!stages.length || stages.length > 10) throw new Error("Use 1–10 stages");
  return {
    site: base(options.site ?? env.STRESS_SITE_URL ?? "https://dawnstudy.vercel.app", "site URL"),
    api: base(options.api ?? env.STRESS_API_URL ?? "https://dawnstudy-api.onrender.com", "API URL"),
    stages,
    durationMs: integer(options.seconds ?? env.STRESS_STAGE_SECONDS, 20, 1, 300, "stage seconds") * 1000,
    rps: integer(options.rps ?? env.STRESS_MAX_RPS, 20, 1, 20, "maximum RPS"),
    maxInFlight: 20,
    thinkMs: 5000,
    timeoutMs: 10_000,
    maxBodyBytes: 1024 * 1024,
  };
}

export function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] * 100) / 100;
}

// Serial admission enforces both a spaced start rate and an in-flight ceiling.
export class RequestGate {
  constructor(rps, maxInFlight) {
    this.spacing = 1000 / rps;
    this.maxInFlight = maxInFlight;
    this.active = 0;
    this.nextStart = 0;
    this.tail = Promise.resolve();
  }
  async acquire(signal) {
    const queued = performance.now();
    const previous = this.tail;
    let unlock;
    this.tail = new Promise(resolve => { unlock = resolve; });
    await previous;
    try {
      signal.throwIfAborted();
      while (this.active >= this.maxInFlight) await delay(10, undefined, { signal });
      await delay(Math.max(0, this.nextStart - performance.now()), undefined, { signal });
      signal.throwIfAborted();
      this.nextStart = performance.now() + this.spacing;
      this.active++;
      let released = false;
      return { waitedMs: performance.now() - queued, release: () => {
        if (!released) { this.active--; released = true; }
      } };
    } finally { unlock(); }
  }
}

export async function readBody(response, maxBytes) {
  const chunks = [];
  let total = 0;
  const reader = response.body?.getReader();
  if (!reader) return "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return Buffer.concat(chunks).toString("utf8");
      total += value.byteLength;
      if (total > maxBytes) throw new Error(`Response exceeds ${maxBytes} bytes`);
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function runStressTest(config, { fetcher = fetch, log = console.error, signal } = {}) {
  const stop = new AbortController();
  const runSignal = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;
  const gate = new RequestGate(config.rps, config.maxInFlight);
  const report = { startedAt: new Date().toISOString(), profile: "public-baseline", config,
    limitation: "Public HTML, health, and model-list requests only. Excludes browser assets, sign-in, study-set storage, AI generation, and maximum mixed-student capacity.",
    stages: [], stoppedReason: null };
  const routes = [
    { name: "homepage", url: `${config.site}/`, valid: text => /<html[\s>]/i.test(text) },
    { name: "health", url: `${config.api}/api/health`, valid: text => JSON.parse(text)?.status === "ok" },
    { name: "models", url: `${config.api}/api/models`, valid: text => Array.isArray(JSON.parse(text)?.models) },
  ];
  for (const users of config.stages) {
    if (runSignal.aborted) break;
    log(`Public baseline: ${users} virtual visitors for ${config.durationMs / 1000}s (cap ${config.rps} request starts/s).`);
    const started = performance.now();
    const scheduling = AbortSignal.any([runSignal, AbortSignal.timeout(config.durationMs)]);
    const samples = [], waits = [], statuses = {}, endpoints = {}, errors = [];
    let journeys = 0, cancelled = 0, startedRequests = 0, maxObservedInFlight = 0;
    const worker = async () => {
      while (!scheduling.aborted) {
        let journeyOk = true;
        for (const route of routes) {
          let permit;
          try { permit = await gate.acquire(scheduling); } catch { return; }
          startedRequests++;
          waits.push(permit.waitedMs);
          maxObservedInFlight = Math.max(maxObservedInFlight, gate.active);
          const requestStarted = performance.now();
          let status = "network", ok = false;
          try {
            const response = await fetcher(route.url, { redirect: "error", cache: "no-store",
              headers: { "User-Agent": "Dawnstudy-PublicLoadTest/1.0", "Cache-Control": "no-cache" },
              signal: AbortSignal.any([runSignal, AbortSignal.timeout(config.timeoutMs)]) });
            status = String(response.status);
            if (response.status !== 200) {
              await response.body?.cancel();
              throw new Error(`HTTP ${status}`);
            }
            if (!route.valid(await readBody(response, config.maxBodyBytes))) throw new Error("Unexpected response body");
            ok = true;
          } catch (error) {
            if (runSignal.aborted) { cancelled++; return; }
            if (errors.length < 20) errors.push({ endpoint: route.name, status, message: error.message });
          } finally { permit.release(); }
          const sample = { ok, latencyMs: performance.now() - requestStarted };
          samples.push(sample);
          (endpoints[route.name] ??= []).push(sample);
          statuses[status] = (statuses[status] ?? 0) + 1;
          if (!ok) journeyOk = false;
          const failures = samples.filter(value => !value.ok).length;
          if (status === "429" || status === "503" || (samples.length >= 20 && failures / samples.length >= 0.05)) {
            report.stoppedReason = `Safety stop at ${users} virtual visitors: ${status === "429" || status === "503" ? `HTTP ${status}` : "failure rate reached 5%"}`;
            stop.abort();
            return;
          }
        }
        if (journeyOk) journeys++;
        try { await delay(config.thinkMs, undefined, { signal: scheduling }); } catch { return; }
      }
    };
    await Promise.all(Array.from({ length: users }, worker));
    const summarize = values => ({ requests: values.length, successes: values.filter(value => value.ok).length,
      failures: values.filter(value => !value.ok).length,
      p50Ms: percentile(values.map(value => value.latencyMs), 0.5),
      p95Ms: percentile(values.map(value => value.latencyMs), 0.95),
      maxMs: percentile(values.map(value => value.latencyMs), 1) });
    const elapsedSeconds = (performance.now() - started) / 1000;
    report.stages.push({ users, elapsedSeconds, ...summarize(samples), startedRequests, cancelled,
      requestsPerSecond: samples.length / elapsedSeconds, completedJourneys: journeys, statuses,
      capWaitP50Ms: percentile(waits, 0.5), capWaitP95Ms: percentile(waits, 0.95),
      maxObservedInFlight, endpoints: Object.fromEntries(Object.entries(endpoints).map(([name, values]) => [name, summarize(values)])), errors });
  }
  if (signal?.aborted && !report.stoppedReason) report.stoppedReason = "Cancelled by operator";
  report.finishedAt = new Date().toISOString();
  return report;
}

async function main() {
  const { values } = parseArgs({ options: { help: { type: "boolean" }, output: { type: "string" },
    site: { type: "string" }, api: { type: "string" }, stages: { type: "string" }, seconds: { type: "string" }, rps: { type: "string" } } });
  if (values.help) {
    console.log("Usage: node scripts/stress-test.mjs [--output report.json] [--site URL] [--api URL] [--stages 1,5,10,20,40] [--seconds 20] [--rps 20]\nPublic baseline only; no sign-in, writes, or AI requests. Maximum 20 request starts/s and 20 in flight. This does not establish mixed-student capacity.");
    return;
  }
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    const report = await runStressTest(readConfig(process.env, values), { signal: controller.signal });
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (values.output) await writeFile(values.output, json);
    else console.log(json);
    if (report.stoppedReason) process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
