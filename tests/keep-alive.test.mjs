import assert from "node:assert/strict";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { checkCycle, checkHealth, checkHomepage, monitor, readConfig } from "../scripts/keep-alive.mjs";

const config = (overrides = {}) => ({
  url: "https://api.example/api/health",
  intervalMs: 300_000,
  timeoutMs: 1000,
  attempts: 3,
  retryDelayMs: 10,
  ...overrides,
});
const healthy = () => new Response(JSON.stringify({ status: "ok", model: "not configured", web_search: false }));
const homepage = () => new Response("<!doctype html><html><body>Dawnstudy</body></html>", { headers: { "Content-Type": "text/html; charset=utf-8" } });
const quiet = { log() {}, wait: async () => {} };

test("default and custom configuration target the API health route", () => {
  const defaults = readConfig({});
  assert.equal(defaults.url, "https://dawnstudy-api.onrender.com/api/health");
  assert.equal(defaults.siteUrl, "https://dawnstudy.vercel.app/");
  assert.equal(defaults.intervalMs, 300_000);
  assert.equal(defaults.timeoutMs, 90_000);
  const custom = readConfig({
    KEEP_ALIVE_API_URL: "http://localhost:8000/prefix/",
    KEEP_ALIVE_SITE_URL: "http://localhost:3000/study/",
    KEEP_ALIVE_INTERVAL_SECONDS: "60",
    KEEP_ALIVE_TIMEOUT_SECONDS: "120",
  });
  assert.equal(custom.url, "http://localhost:8000/prefix/api/health");
  assert.equal(custom.siteUrl, "http://localhost:3000/study/");
  assert.equal(custom.intervalMs, 60_000);
  assert.equal(custom.timeoutMs, 120_000);
});

test("configuration rejects unsafe URLs and invalid timer values", () => {
  for (const url of ["not a URL", "ftp://api.example", "https://user:password@api.example", "https://api.example?key=secret", "https://api.example#health"]) {
    assert.throws(() => readConfig({ KEEP_ALIVE_API_URL: url }));
    assert.throws(() => readConfig({ KEEP_ALIVE_SITE_URL: url }));
  }
  for (const value of ["0", "59", "601", "300.5", "Infinity", "abc"]) {
    assert.throws(() => readConfig({ KEEP_ALIVE_INTERVAL_SECONDS: value }), /KEEP_ALIVE_INTERVAL_SECONDS/);
  }
  for (const value of ["0", "121", "1.5", "NaN"]) {
    assert.throws(() => readConfig({ KEEP_ALIVE_TIMEOUT_SECONDS: value }), /KEEP_ALIVE_TIMEOUT_SECONDS/);
  }
});

test("homepage check requests public HTML without credentials or writes", async () => {
  const siteUrl = "https://site.example/";
  const calls = [];
  await checkHomepage(config({ siteUrl }), { ...quiet, fetcher: async (url, request) => {
    calls.push([url, request]);
    return homepage();
  } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], siteUrl);
  assert.equal(calls[0][1].method, "GET");
  assert.equal(calls[0][1].headers.Accept, "text/html");
  assert.equal(calls[0][1].headers.Authorization, undefined);
  assert.equal(calls[0][1].body, undefined);
  assert.equal(calls[0][1].cache, "no-store");
});

for (const [name, response] of [
  ["HTTP failure", () => new Response("unavailable", { status: 503 })],
  ["non-HTML content type", () => new Response('{"status":"ok"}', { headers: { "Content-Type": "application/json" } })],
  ["missing HTML document", () => new Response("service starting", { headers: { "Content-Type": "text/html" } })],
]) {
  test(`homepage rejects ${name}`, async () => {
    await assert.rejects(checkHomepage(config({ attempts: 1 }), { ...quiet, fetcher: async () => response() }), /Homepage unavailable/);
  });
}

test("a failing homepage exhausts its own retries while API health still runs", async () => {
  const settings = config({ siteUrl: "https://site.example/" });
  const calls = [];
  await assert.rejects(checkCycle(settings, { ...quiet, fetcher: async url => {
    calls.push(url);
    return url === settings.url ? healthy() : new Response("Unavailable", { status: 503 });
  } }), /Homepage unavailable after 3 attempts/);
  assert.equal(calls.filter(url => url === settings.url).length, 1);
  assert.equal(calls.filter(url => url === settings.siteUrl).length, 3);
});

test("a failing API does not prevent checking the homepage and fails the overall cycle", async () => {
  const settings = config({ siteUrl: "https://site.example/" });
  const calls = [];
  await assert.rejects(checkCycle(settings, { ...quiet, fetcher: async url => {
    calls.push(url);
    return url === settings.siteUrl ? homepage() : new Response("Unavailable", { status: 503 });
  } }), /API unavailable after 3 attempts/);
  assert.equal(calls.filter(url => url === settings.url).length, 3);
  assert.equal(calls.filter(url => url === settings.siteUrl).length, 1);
});

test("a cycle starts both targets independently and waits for both outcomes", async () => {
  const settings = config({ siteUrl: "https://site.example/" });
  const calls = [];
  let finishHomepage;
  const homepagePending = new Promise(resolve => { finishHomepage = resolve; });
  let settled = false;
  const cycle = checkCycle(settings, { ...quiet, fetcher: async url => {
    calls.push(url);
    return url === settings.url ? healthy() : homepagePending;
  } }).then(() => { settled = true; });
  await delay(0);
  assert.deepEqual(new Set(calls), new Set([settings.url, settings.siteUrl]));
  assert.equal(settled, false);
  finishHomepage(homepage());
  await cycle;
  assert.equal(settled, true);
});

test("native homepage fetch times out during stalled HTML body consumption", async t => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.write("<!doctype html><html>");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const siteUrl = `http://127.0.0.1:${server.address().port}/`;
  await assert.rejects(checkHomepage(config({ siteUrl, timeoutMs: 100, attempts: 1 }), quiet), /Timed out after 0.1s/);
});

test("successful health check uses a public uncached GET without credentials", async () => {
  const calls = [];
  const logs = [];
  await checkHealth(config(), {
    ...quiet,
    log: message => logs.push(message),
    fetcher: async (url, request) => { calls.push([url, request]); return healthy(); },
  });
  assert.equal(calls.length, 1);
  const [url, request] = calls[0];
  assert.equal(url, config().url);
  assert.equal(request.method, "GET");
  assert.equal(request.cache, "no-store");
  assert.equal(request.redirect, "error");
  assert.equal(request.headers.Accept, "application/json");
  assert.equal(request.headers.Authorization, undefined);
  assert.equal(request.body, undefined);
  assert.match(logs[0], /^OK /);
});

test("transient HTTP and connection failures retry and recover", async () => {
  let calls = 0;
  const waits = [];
  const logs = [];
  await checkHealth(config(), {
    log: message => logs.push(message),
    wait: async milliseconds => waits.push(milliseconds),
    fetcher: async () => {
      calls++;
      if (calls === 1) return new Response("Unavailable", { status: 503 });
      if (calls === 2) throw new TypeError("Connection reset");
      return healthy();
    },
  });
  assert.equal(calls, 3);
  assert.deepEqual(waits, [10, 10]);
  assert.match(logs[0], /HTTP 503/);
  assert.match(logs[1], /Connection reset/);
  assert.match(logs[2], /^OK .*attempt 3\/3/);
});

test("exhausted retries reject after the configured attempt limit", async () => {
  let calls = 0;
  let waits = 0;
  await assert.rejects(checkHealth(config(), {
    ...quiet,
    wait: async () => { waits++; },
    fetcher: async () => { calls++; return new Response("Forbidden", { status: 403 }); },
  }), /API unavailable after 3 attempts: HTTP 403/);
  assert.equal(calls, 3);
  assert.equal(waits, 2);
});

for (const [name, body] of [
  ["HTML wake page", "<html>Starting service...</html>"],
  ["malformed JSON", '{"status":'],
  ["unhealthy status", '{"status":"error"}'],
  ["missing status", "{}"],
  ["null JSON", "null"],
]) {
  test(`${name} is not accepted as a healthy HTTP 200`, async () => {
    await assert.rejects(checkHealth(config({ attempts: 1 }), {
      ...quiet,
      fetcher: async () => new Response(body, { status: 200 }),
    }), /API unavailable after 1 attempts/);
  });
}

for (const sendHeaders of [false, true]) {
  test(`native fetch times out when ${sendHeaders ? "the response body" : "the response headers"} stalls`, async t => {
    const server = createServer((_request, response) => {
      if (sendHeaders) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.write('{"status":');
      }
      // Deliberately never finish; abort must also bound JSON body consumption.
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    t.after(async () => {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    });
    const url = `http://127.0.0.1:${server.address().port}/api/health`;
    await assert.rejects(checkHealth(config({ url, timeoutMs: 100, attempts: 1 }), quiet), /Timed out after 0.1s/);
  });
}

test("an already cancelled check sends no request", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(checkHealth(config(), {
    ...quiet,
    signal: controller.signal,
    fetcher: async () => assert.fail("Cancelled checks must not fetch"),
  }), { name: "AbortError" });
});

test("cancelling during retry delay prevents further requests", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(checkHealth(config(), {
    ...quiet,
    signal: controller.signal,
    fetcher: async () => { calls++; throw new TypeError("Offline"); },
    wait: async (_milliseconds, _value, { signal }) => {
      controller.abort();
      signal.throwIfAborted();
    },
  }), { name: "AbortError" });
  assert.equal(calls, 1);
});

test("continuous monitor survives an outage and never overlaps checks", async () => {
  const controller = new AbortController();
  const logs = [];
  let active = 0;
  let calls = 0;
  let waits = 0;
  await monitor(config({ intervalMs: 1 }), {
    signal: controller.signal,
    log: message => logs.push(message),
    wait: async milliseconds => { assert.ok(milliseconds >= 0); waits++; },
    check: async () => {
      assert.equal(active, 0);
      active++;
      const attempt = ++calls;
      await delay(2);
      active--;
      if (attempt === 1) throw new Error("Temporary outage");
      if (attempt === 3) controller.abort();
    },
  });
  assert.equal(calls, 3);
  assert.equal(active, 0);
  assert.equal(waits, 3);
  assert.ok(logs.some(message => /Temporary outage.*next cycle/.test(message)));
});

test("continuous monitor stops promptly while sleeping", async () => {
  const controller = new AbortController();
  let calls = 0;
  await monitor(config(), {
    signal: controller.signal,
    log() {},
    check: async () => { calls++; },
    wait: async (milliseconds, value, { signal }) => {
      controller.abort();
      return delay(milliseconds, value, { signal });
    },
  });
  assert.equal(calls, 1);
});
