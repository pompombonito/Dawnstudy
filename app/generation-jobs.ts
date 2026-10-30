export type GenerationStatus = {
  status: string; stage: string; message: string; completed: number; requested: number; model?: string | null;
};

export type GenerationJob<Result> = GenerationStatus & { job_id: string; result?: Result; error_status?: number };
type RequestOptions = { baseUrl: string; token: string; signal: AbortSignal; fetcher?: typeof fetch };
type PollOptions = RequestOptions & { intervalMs?: number; timeoutMs?: number };

export class GenerationJobError extends Error {
  terminal: boolean;
  constructor(message: string, terminal = false) {
    super(message);
    this.name = "GenerationJobError";
    this.terminal = terminal;
  }
}

async function errorMessage(response: Response) {
  try {
    const body = await response.json();
    return typeof body.detail === "string" ? body.detail : "The generation service could not respond. Please reconnect.";
  } catch { return "The generation service could not respond. Please reconnect."; }
}

export async function findGenerationJob<Result>(options: RequestOptions, jobId?: string): Promise<GenerationJob<Result> | null> {
  const response = await (options.fetcher || fetch)(
    options.baseUrl + "/api/generation-jobs" + (jobId ? "/" + encodeURIComponent(jobId) : ""),
    { headers: { Authorization: "Bearer " + options.token }, signal: options.signal, cache: "no-store" },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new GenerationJobError(await errorMessage(response), response.status < 500 && response.status !== 429);
  const body = await response.json();
  return jobId ? body as GenerationJob<Result> : body.job || null;
}

export async function startGenerationJob<Result>(form: FormData, options: RequestOptions): Promise<GenerationJob<Result> & { resumed?: boolean }> {
  let response: Response;
  try {
    response = await (options.fetcher || fetch)(options.baseUrl + "/api/generation-jobs", {
      method: "POST", headers: { Authorization: "Bearer " + options.token }, body: form, signal: options.signal,
    });
  } catch (error) {
    if (options.signal.aborted) throw error;
    // A dropped response can follow a successful submission. Discover that job
    // before the user tries another request and spends a second allowance.
    const existing = await findGenerationJob<Result>(options);
    if (existing) return { ...existing, resumed: true };
    throw error;
  }
  if (response.status === 409) {
    const body = await response.json();
    if (body.job_id || /generation is already running/i.test(String(body.detail))) {
      const existing = await findGenerationJob<Result>(options, body.job_id);
      if (existing) return { ...existing, resumed: true };
    }
    throw new GenerationJobError(typeof body.detail === "string" ? body.detail : "The existing generation could not be found.", true);
  }
  if (!response.ok) throw new GenerationJobError(await errorMessage(response), true);
  const body = await response.json();
  if (!body.job_id) throw new GenerationJobError("The generation queue did not return a job ID. Please reconnect.");
  return { status: "queued", stage: "queued", message: "Joining the study queue…", completed: 0,
    requested: Number(form.get("question_count")) || 0, ...body };
}

function pause(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("Generation monitoring stopped.", "AbortError")); return; }
    const onAbort = () => { clearTimeout(timer); reject(new DOMException("Generation monitoring stopped.", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function pollGenerationJob<Result>(
  jobId: string, options: PollOptions, onStatus: (job: GenerationStatus) => void, initial?: GenerationJob<Result>,
): Promise<Result> {
  const deadline = Date.now() + (options.timeoutMs ?? 12 * 60 * 1000);
  let current = initial;
  let failures = 0;
  while (Date.now() < deadline) {
    if (options.signal.aborted) throw new DOMException("Generation monitoring stopped.", "AbortError");
    try {
      const job = current || await findGenerationJob<Result>(options, jobId);
      current = undefined;
      if (!job) throw new GenerationJobError("This generation is no longer available. Check My Library for its saved questions.", true);
      failures = 0;
      onStatus(job);
      if (job.status === "error") throw new GenerationJobError(job.message || "Generation could not finish. Please try again.", true);
      if (job.status === "complete" && job.result) return job.result;
    } catch (error) {
      if (options.signal.aborted || (error instanceof GenerationJobError && error.terminal)) throw error;
      failures += 1;
      onStatus({
        status: "reconnecting", stage: "reconnecting", message: "Reconnecting to your generation. Your job is still running…",
        completed: -1, requested: 0,
      });
    }
    await pause(Math.min(5000, (options.intervalMs ?? 1100) * Math.max(1, failures)), options.signal);
  }
  throw new GenerationJobError("Generation monitoring timed out. Reconnect to check the same job.");
}
