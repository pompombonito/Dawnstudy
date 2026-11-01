import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

const DEFAULT_API_URL = "https://dawnstudy-api.onrender.com";
const DEFAULT_SITE_URL = "https://dawnstudy.vercel.app/";
const timestampedLog = message => console.log(`[${new Date().toISOString()}] ${message}`);

export function readConfig(env = process.env) {
  const base = new URL(env.KEEP_ALIVE_API_URL || DEFAULT_API_URL);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new Error("KEEP_ALIVE_API_URL must be an HTTP(S) API base URL without credentials, query, or fragment.");
  }
  base.pathname = `${base.pathname.replace(/\/+$/, "")}/api/health`;
  const site = new URL(env.KEEP_ALIVE_SITE_URL || DEFAULT_SITE_URL);
  if (!["http:", "https:"].includes(site.protocol) || site.username || site.password || site.search || site.hash) {
    throw new Error("KEEP_ALIVE_SITE_URL must be an HTTP(S) homepage URL without credentials, query, or fragment.");
  }
  const integer = (name, fallback, min, max) => {
    const value = Number(env[name] || fallback);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      throw new Error(`${name} must be an integer between ${min} and ${max}.`);
    }
    return value;
  };
  return {
    url: base.href,
    siteUrl: site.href,
    intervalMs: integer("KEEP_ALIVE_INTERVAL_SECONDS", 300, 60, 600) * 1000,
    timeoutMs: integer("KEEP_ALIVE_TIMEOUT_SECONDS", 90, 1, 120) * 1000,
    attempts: 3,
    retryDelayMs: 10_000,
  };
}

async function checkEndpoint(config, target, {
  signal,
  fetcher = fetch,
  wait = delay,
  log = timestampedLog,
} = {}) {
  for (let attempt = 1; attempt <= config.attempts; attempt++) {
    signal?.throwIfAborted();
    const started = performance.now();
    const timeout = AbortSignal.timeout(config.timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await fetcher(target.url, {
        method: "GET",
        headers: { Accept: target.accept, "Cache-Control": "no-cache", "User-Agent": "Dawnstudy-KeepAlive/1.0" },
        cache: "no-store",
        redirect: "error",
        signal: requestSignal,
      });
      if (response.status !== 200) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}`);
      }
      await target.validate(response);
      log(`OK ${target.url} (${Math.round(performance.now() - started)} ms; attempt ${attempt}/${config.attempts})`);
      return;
    } catch (error) {
      signal?.throwIfAborted();
      const reason = timeout.aborted ? `Timed out after ${config.timeoutMs / 1000}s` : error.message;
      log(`FAIL ${target.url} (attempt ${attempt}/${config.attempts}): ${reason}`);
      if (attempt === config.attempts) {
        throw new Error(`${target.label} unavailable after ${config.attempts} attempts: ${reason}`, { cause: error });
      }
      await wait(config.retryDelayMs, undefined, { signal });
    }
  }
}

// Both routes are public reads: no sign-in, AI calls, or Sheets writes.
export function checkHealth(config, options) {
  return checkEndpoint(config, { url: config.url, label: "API", accept: "application/json", validate: async response => {
    const body = await response.json();
    if (body?.status !== "ok") throw new Error("Health response did not report status=ok");
  } }, options);
}

export function checkHomepage(config, options) {
  return checkEndpoint(config, { url: config.siteUrl || DEFAULT_SITE_URL, label: "Homepage", accept: "text/html", validate: async response => {
    const type = response.headers.get("Content-Type") || "";
    if (!/^text\/html(?:\s*;|\s*$)/i.test(type)) {
      await response.body?.cancel();
      throw new Error("Homepage response is not HTML");
    }
    if (!/<html(?:\s|>)/i.test(await response.text())) throw new Error("Homepage response has no HTML document");
  } }, options);
}

export async function checkCycle(config, options = {}) {
  // Start both independently so an unavailable homepage cannot stop API checks.
  const results = await Promise.allSettled([checkHealth(config, options), checkHomepage(config, options)]);
  options.signal?.throwIfAborted();
  const failures = results.filter(result => result.status === "rejected").map(result => result.reason);
  if (failures.length) throw new AggregateError(failures, failures.map(error => error.message).join("; "));
}

export async function monitor(config, { signal, log = timestampedLog, wait = delay, check = checkCycle } = {}) {
  log(`Keep-alive started: ${config.siteUrl || DEFAULT_SITE_URL} and ${config.url}; interval ${config.intervalMs / 1000}s. Press Ctrl+C to stop.`);
  while (!signal?.aborted) {
    const started = performance.now();
    try {
      await check(config, { signal, log, wait });
    } catch (error) {
      if (signal?.aborted) return;
      log(`${error.message}. Will retry on the next cycle.`);
    }
    try {
      // Never overlap requests; slow checks do not add another full interval.
      await wait(Math.max(0, config.intervalMs - (performance.now() - started)), undefined, { signal });
    } catch (error) {
      if (signal?.aborted) return;
      throw error;
    }
  }
}

async function main() {
  const { values } = parseArgs({ options: { once: { type: "boolean" }, help: { type: "boolean" } } });
  if (values.help) {
    console.log("Usage: node scripts/keep-alive.mjs [--once]\nDefault: check homepage and API independently every 5 minutes. --once exits 1 if either target fails all three attempts.\nOptional environment: KEEP_ALIVE_SITE_URL, KEEP_ALIVE_API_URL, KEEP_ALIVE_INTERVAL_SECONDS (60-600), KEEP_ALIVE_TIMEOUT_SECONDS (1-120).");
    return;
  }
  const config = readConfig();
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    if (values.once) await checkCycle(config, { signal: controller.signal });
    else await monitor(config, { signal: controller.signal });
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
