export type GenerationJobState = "queued" | "running" | "cancelling" | "cancelled" | "complete" | "error";

export type GenerationStatus = {
  status: GenerationJobState | "paused" | "reconnecting"; stage: string; message: string; completed: number; requested: number; model?: string | null; can_cancel?: boolean;
  retry_at?: string | null;
};

export function generationRetryText(status: GenerationStatus, now = Date.now()): string {
  if (status.status !== "queued" || status.stage !== "waiting" || typeof status.retry_at !== "string") return "";
  const retryAt = new Date(status.retry_at);
  if (!Number.isFinite(retryAt.getTime()) || retryAt.getTime() <= now) return "";
  const sameDay = retryAt.toDateString() === new Date(now).toDateString();
  const scheduledTime = retryAt.toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    ...(sameDay ? {} : { month: "short", day: "numeric" }),
  });
  return `Next attempt at ${scheduledTime}`;
}

/** Count verified cards, including explanation-only questionnaire progress. */
export function generationCheckpointProgress(checkpoint: unknown): { completed: number; requested: number } {
  if (!checkpoint || typeof checkpoint !== "object") return { completed: 0, requested: 0 };
  const saved = checkpoint as Record<string, unknown>;
  const completed = Array.isArray(saved.items) ? saved.items.filter(item => item && typeof item === "object" && !item.explanation_pending).length : 0;
  const requested = typeof saved.requested_count === "number" && Number.isFinite(saved.requested_count) && saved.requested_count > 0
    ? Math.floor(saved.requested_count) : 0;
  return { completed, requested };
}

/** Call only within the same request; starting a new request resets its state. */
export function mergeGenerationStatus(previous: GenerationStatus | null, next: GenerationStatus, ...checkpoints: unknown[]): GenerationStatus {
  const retained = checkpoints.map(generationCheckpointProgress);
  const completed = Math.max(previous?.completed || 0, Number.isFinite(next.completed) ? next.completed : 0, ...retained.map(progress => progress.completed));
  const requested = retained.find(progress => progress.requested > 0)?.requested || (Number.isFinite(next.requested) && next.requested > 0 ? next.requested : previous?.requested || 0);
  return { ...next, completed, requested, model: next.model ?? previous?.model };
}

/** Older jobs may report the notes default before discovering a PDF's real total. */
export function generationReadyText(completed: number, requested: number): string {
  if (!Number.isFinite(completed) || completed < 0) return "";
  const count = Math.floor(completed);
  if (Number.isFinite(requested) && requested > 0 && requested >= count) {
    return `${count} of ${Math.floor(requested)} questions ready`;
  }
  return count ? `${count} ${count === 1 ? "question" : "questions"} ready` : "";
}

export type GenerationJob<Result> = Omit<GenerationStatus, "status"> & { status: GenerationJobState; job_id: string; result?: Result; checkpoint?: Result; error_status?: number };
export type QuestionnaireTypeMismatch = {
  number: string; questionnaire_index: number; question: string; source_type: string; answer: string | null;
  options: string[]; matching_prompts: string[]; matching_pairs: { prompt: string; answer: string }[];
  source_refs: string[]; image_count: number; must_preserve: boolean;
};
export type QuestionnaireMismatchPreview = { selected_type: string; mismatches: QuestionnaireTypeMismatch[] };
type RequestOptions = { baseUrl: string; token: string; signal: AbortSignal; fetcher?: typeof fetch; requestTimeoutMs?: number; submissionTimeoutMs?: number };
type PollOptions = RequestOptions & { intervalMs?: number; timeoutMs?: number };

export class GenerationJobError extends Error {
  terminal: boolean;
  responseStatus?: number;
  constructor(message: string, terminal = false, responseStatus?: number) {
    super(message);
    this.name = "GenerationJobError";
    this.terminal = terminal;
    this.responseStatus = responseStatus;
  }
}

export class GenerationCancelledError extends GenerationJobError {
  readonly cancelled = true;
  constructor(message = "Generation cancelled.") {
    super(message, true);
    this.name = "GenerationCancelledError";
  }
}

export class GenerationJobMissingError extends GenerationJobError {
  constructor() {
    super("The generation service restarted. Recovering the same request from this browser…", true);
    this.name = "GenerationJobMissingError";
  }
}

export class QuestionnaireTypeMismatchError extends GenerationJobError {
  readonly preview: QuestionnaireMismatchPreview;
  constructor(preview: QuestionnaireMismatchPreview) {
    super("Some questionnaire items use a different question type.", true);
    this.name = "QuestionnaireTypeMismatchError";
    this.preview = preview;
  }
}

async function errorMessage(response: Response) {
  try {
    const body = await response.json();
    return typeof body.detail === "string" ? body.detail : "The generation service could not respond. Please reconnect.";
  } catch { return "The generation service could not respond. Please reconnect."; }
}

async function boundedRequest<T>(options: RequestOptions, request: (signal: AbortSignal) => Promise<T>, milliseconds = options.requestTimeoutMs ?? 90_000): Promise<T> {
  options.signal.throwIfAborted();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  let onAbort: () => void;
  const interrupted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      const error = options.signal.reason || new DOMException("Generation monitoring stopped.", "AbortError");
      reject(error);
      controller.abort(error);
    };
    options.signal.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      const error = new GenerationJobError("The generation service is taking longer to respond. Reconnecting to the same request…");
      reject(error);
      controller.abort(error);
    }, Math.max(1, milliseconds));
  });
  try { return await Promise.race([request(controller.signal), interrupted]); }
  finally {
    clearTimeout(timer!);
    options.signal.removeEventListener("abort", onAbort!);
  }
}

export async function findGenerationJob<Result>(options: RequestOptions, jobId?: string): Promise<GenerationJob<Result> | null> {
  return boundedRequest(options, async (signal) => {
    const response = await (options.fetcher || fetch)(
      options.baseUrl + "/api/generation-jobs" + (jobId ? "/" + encodeURIComponent(jobId) : ""),
      { headers: { Authorization: "Bearer " + options.token }, signal, cache: "no-store" },
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new GenerationJobError(await errorMessage(response), response.status < 500 && response.status !== 429, response.status);
    const body = await response.json();
    const job = jobId ? body : body?.job;
    if (!jobId && job === null) return null;
    if (!job || typeof job.job_id !== "string" || typeof job.status !== "string" || (jobId && job.job_id !== jobId)) {
      throw new GenerationJobError("The generation status could not be read. Reconnecting to the same request…");
    }
    return job as GenerationJob<Result>;
  });
}

export async function startGenerationJob<Result>(form: FormData, options: RequestOptions): Promise<GenerationJob<Result> & { resumed?: boolean }> {
  try {
    return await boundedRequest(options, async (signal) => {
      const response = await (options.fetcher || fetch)(options.baseUrl + "/api/generation-jobs", {
        method: "POST", headers: { Authorization: "Bearer " + options.token }, body: form, signal,
      });
      if (response.status === 409) {
        const body = await response.json();
        if (body.code === "questionnaire_type_mismatch" && typeof body.selected_type === "string" && Array.isArray(body.mismatches)) {
          throw new QuestionnaireTypeMismatchError({
            selected_type: body.selected_type,
            mismatches: body.mismatches.filter((item: unknown) => item && typeof item === "object"
              && typeof (item as QuestionnaireTypeMismatch).question === "string"
              && typeof (item as QuestionnaireTypeMismatch).source_type === "string"),
          });
        }
        if (body.job_id || /generation is already running/i.test(String(body.detail))) {
          const existing = await findGenerationJob<Result>(options, body.job_id);
          if (existing) return { ...existing, resumed: true };
        }
        throw new GenerationJobError(typeof body.detail === "string" ? body.detail : "The existing generation could not be found.", true);
      }
      if (!response.ok) throw new GenerationJobError(await errorMessage(response), response.status < 500 && response.status !== 429, response.status);
      const body = await response.json();
      if (!body.job_id) throw new GenerationJobError("The generation queue did not return a job ID. Please reconnect.");
      return { status: "queued", stage: "queued", message: "Joining the study queue…", completed: 0,
        requested: Number(form.get("question_count")) || 0, ...body };
    }, options.submissionTimeoutMs ?? 10 * 60_000);
  } catch (error) {
    if (options.signal.aborted || (error instanceof GenerationJobError && error.terminal)) throw error;
    // Proxies can lose a successful submission response, return a gateway
    // error, or truncate JSON. Reattach to this exact idempotent request.
    const requestId = form.get("client_request_id");
    const existing = await findGenerationJob<Result>(options, typeof requestId === "string" && requestId ? requestId : undefined);
    if (existing) return { ...existing, resumed: true };
    throw error;
  }
}

export async function cancelGenerationJob<Result>(jobId: string, options: RequestOptions): Promise<GenerationJob<Result>> {
  return boundedRequest(options, async (signal) => {
    let response: Response;
    try {
      response = await (options.fetcher || fetch)(options.baseUrl + "/api/generation-jobs/" + encodeURIComponent(jobId) + "/cancel", {
        method: "POST", headers: { Authorization: "Bearer " + options.token }, signal, cache: "no-store",
      });
    } catch (error) {
      if (options.signal.aborted) throw error;
      // The cancellation may have reached the API. Poll/reconnect to this job;
      // never submit a replacement generation to resolve an uncertain response.
      throw new GenerationJobError("Could not confirm cancellation. Reconnect to check the same generation.");
    }
    if (!response.ok) throw new GenerationJobError(await errorMessage(response), response.status < 500 && response.status !== 429, response.status);
    let body: GenerationJob<Result>;
    try { body = await response.json(); }
    catch { throw new GenerationJobError("The cancellation response could not be read. Reconnect to check the same generation."); }
    if (body.job_id !== jobId) throw new GenerationJobError("The cancellation response did not identify this generation. Reconnect to check the same job.");
    // Saving may already have started, or the job may have finished. Its current
    // state is authoritative; a successful POST alone does not mean cancelled.
    return body;
  });
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
  jobId: string, options: PollOptions, onStatus: (job: GenerationStatus & { checkpoint?: Result }) => void | Promise<void>, initial?: GenerationJob<Result>,
): Promise<Result> {
  // A quota reset or a temporary outage can take hours. Monitoring stops only
  // on a terminal response, explicit caller deadline, or logout/unmount.
  const deadline = options.timeoutMs === undefined ? Infinity : Date.now() + options.timeoutMs;
  let current = initial;
  let failures = 0;
  let cancellationPending = false;
  while (Date.now() < deadline) {
    if (options.signal.aborted) throw new DOMException("Generation monitoring stopped.", "AbortError");
    try {
      const job = current || await findGenerationJob<Result>(options, jobId);
      current = undefined;
      if (!job) throw new GenerationJobMissingError();
      failures = 0;
      cancellationPending = job.status === "cancelling";
      await onStatus(job);
      if (job.status === "cancelled") throw new GenerationCancelledError(job.message || undefined);
      if (job.status === "error") throw new GenerationJobError(job.message || "Generation could not finish. Please try again.", true, job.error_status);
      if (job.status === "complete" && job.result) return job.result;
    } catch (error) {
      if (options.signal.aborted || (error instanceof GenerationJobError && error.terminal)) throw error;
      failures += 1;
      await onStatus({
        status: cancellationPending ? "cancelling" : "reconnecting",
        stage: cancellationPending ? "cancelling" : "reconnecting",
        message: cancellationPending ? "Reconnecting to confirm cancellation…" : "Reconnecting to your generation. Checking its latest status…",
        completed: -1, requested: 0,
        ...(cancellationPending ? { can_cancel: false } : {}),
      });
    }
    await pause(Math.min(5000, (options.intervalMs ?? 1100) * Math.max(1, failures)), options.signal);
  }
  throw new GenerationJobError("Generation monitoring timed out. Reconnect to check the same job.");
}
