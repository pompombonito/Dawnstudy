type HeartbeatEnvironment = {
  document: Pick<Document, "hidden" | "addEventListener" | "removeEventListener">;
  window: Pick<Window, "addEventListener" | "removeEventListener" | "setTimeout" | "clearTimeout">;
  online: () => boolean;
  fetch: typeof fetch;
};

/** Public API traffic while someone uses the site, including the pre-login page. */
export function startApiHeartbeat(base: string, env: HeartbeatEnvironment) {
  if (!base) return () => {};
  const url = `${base.replace(/\/$/, "")}/api/health`;
  let stopped = false, timer: number | undefined;
  let request: AbortController | null = null;
  const active = () => !stopped && !env.document.hidden && env.online();
  const clearTimer = () => { if (timer !== undefined) env.window.clearTimeout(timer); timer = undefined; };
  const tick = async () => {
    if (!active() || request) return;
    clearTimer();
    const controller = new AbortController();
    request = controller;
    const timeout = env.window.setTimeout(() => controller.abort(), 90000);
    let next = 120000;
    try {
      const response = await env.fetch(url, {
        method: "GET", credentials: "omit", cache: "no-store", redirect: "error",
        headers: { Accept: "application/json" }, signal: controller.signal,
      });
      if (!response.ok || (await response.json())?.status !== "ok") throw new Error("API is waking up");
    } catch {
      // A cold start or transient outage should recover without refreshing the page.
      next = 20000;
    } finally {
      env.window.clearTimeout(timeout);
      request = null;
      if (active()) timer = env.window.setTimeout(() => void tick(), next);
    }
  };
  const changed = () => {
    clearTimer();
    if (active()) void tick();
    else request?.abort();
  };
  env.document.addEventListener("visibilitychange", changed);
  env.window.addEventListener("online", changed);
  env.window.addEventListener("offline", changed);
  void tick();
  return () => {
    stopped = true;
    clearTimer();
    request?.abort();
    env.document.removeEventListener("visibilitychange", changed);
    env.window.removeEventListener("online", changed);
    env.window.removeEventListener("offline", changed);
  };
}
