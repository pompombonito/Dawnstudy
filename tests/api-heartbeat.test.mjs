import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../app/components/api-heartbeat.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { startApiHeartbeat } = await import('data:text/javascript;base64,' + Buffer.from(javascript).toString('base64'));
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup(fetcher = async () => new Response('{"status":"ok"}')) {
  const document = new EventTarget(), window = new EventTarget(), timers = new Map(), calls = [];
  document.hidden = false;
  let online = true, serial = 0;
  window.setTimeout = (fn, delay) => { timers.set(++serial, { fn, delay }); return serial; };
  window.clearTimeout = id => timers.delete(id);
  const stop = startApiHeartbeat('https://api.example/', { document, window, online: () => online, fetch: async (...args) => { calls.push(args); return fetcher(...args); } });
  const fire = async delay => {
    const item = [...timers].find(([,timer]) => timer.delay === delay);
    assert.ok(item, `Timer for ${delay}ms exists`);
    timers.delete(item[0]); item[1].fn(); await flush();
  };
  return { stop, document, window, timers, calls, fire, setOnline: value => { online = value; window.dispatchEvent(new Event(value ? 'online' : 'offline')); } };
}
test('public health GET immediately and every two minutes without credentials', async () => {
  const h = setup(); await flush();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][0], 'https://api.example/api/health');
  assert.equal(h.calls[0][1].credentials, 'omit');
  assert.equal(h.calls[0][1].cache, 'no-store');
  await h.fire(120000); assert.equal(h.calls.length, 2);
  h.stop(); assert.equal(h.timers.size, 0);
});
test('transient error retries in twenty seconds and recovers normal cadence', async () => {
  let attempts = 0;
  const h = setup(async () => { if (++attempts === 1) throw new Error('cold start'); return new Response('{"status":"ok"}'); });
  await flush(); await h.fire(20000);
  assert.equal(attempts, 2); assert.ok([...h.timers.values()].some(timer => timer.delay === 120000)); h.stop();
});
test('hidden/offline pauses and visibility/reconnection resume; cleanup removes listeners', async () => {
  const h = setup(); await flush();
  h.document.hidden = true; h.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(h.timers.size, 0);
  h.document.hidden = false; h.document.dispatchEvent(new Event('visibilitychange')); await flush();
  assert.equal(h.calls.length, 2);
  h.setOnline(false); assert.equal(h.timers.size, 0);
  h.setOnline(true); await flush(); assert.equal(h.calls.length, 3);
  h.stop(); h.setOnline(true); h.document.dispatchEvent(new Event('visibilitychange')); await flush();
  assert.equal(h.calls.length, 3);
});
test('pending cold-start request never overlaps and aborts on timeout', async () => {
  const h = setup((url, options) => new Promise((resolve,reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), {once:true})));
  h.document.dispatchEvent(new Event('visibilitychange')); h.setOnline(true);
  assert.equal(h.calls.length, 1);
  await h.fire(90000); assert.ok(h.calls[0][1].signal.aborted);
  await h.fire(20000); assert.equal(h.calls.length, 2);
  h.stop(); await flush(); assert.equal(h.timers.size, 0);
});
