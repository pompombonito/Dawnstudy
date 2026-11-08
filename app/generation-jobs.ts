export type GenerationJobState = "queued" | "running" | "cancelling" | "cancelled" | "complete" | "error";

export type GenerationStatus = {
  status: GenerationJobState | "paused" | "reconnecting"; stage: string; message: string; completed: number; requested: number; model?: string | null; can_cancel?: boolean;
};

/** Older jobs may report the notes default before discovering a PDF's real total. */
export function generationReadyText(completed: number, requested: number): string {
  if (!Number.isFinite(completed) || completed < 0) return "";
  const count = Math.floor(completed);
  if (Number.isFinite(requested) && requested > 0 && requested >= count) {
    return `${count} of ${Math.floor(requested)} questions ready`;
  }
  return count ? `${count} ${count === 1 ? "question" : "questions"} ready` : "";
}

export type GenerationJob<Result> = Omit<GenerationStatus, "status"> & { status: GenerationJobState; job_id: string; result?: Result; error_status?: number };
export type QuestionnaireTypeMismatch = {
  number: string; questionnaire_index: number; question: string; source_type: string; answer: string | null;
  options: string[]; matching_prompts: string[]; matching_pairs: { prompt: string; answer: string }[];
  source_refs: string[]; image_count: number; must_preserve: boolean;
};
export type QuestionnaireMismatchPreview = { selected_type: string; mismatches: QuestionnaireTypeMismatch[] };
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

export class GenerationCancelledError extends GenerationJobError {
  readonly cancelled = true;
  constructor(message = "Generation cancelled.") {
    super(message, true);
    this.name = "GenerationCancelledError";
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
  if (!response.ok) throw new GenerationJobError(await errorMessage(response), true);
  const body = await response.json();
  if (!body.job_id) throw new GenerationJobError("The generation queue did not return a job ID. Please reconnect.");
  return { status: "queued", stage: "queued", message: "Joining the study queue…", completed: 0,
    requested: Number(form.get("question_count")) || 0, ...body };
}

export async function cancelGenerationJob<Result>(jobId: string, options: RequestOptions): Promise<GenerationJob<Result>> {
  options.signal.throwIfAborted();
  let response: Response;
  try {
    response = await (options.fetcher || fetch)(options.baseUrl + "/api/generation-jobs/" + encodeURIComponent(jobId) + "/cancel", {
      method: "POST", headers: { Authorization: "Bearer " + options.token }, signal: options.signal, cache: "no-store",
    });
  } catch (error) {
    if (options.signal.aborted) throw error;
    // The cancellation may have reached the API. Poll/reconnect to this job;
    // never submit a replacement generation to resolve an uncertain response.
    throw new GenerationJobError("Could not confirm cancellation. Reconnect to check the same generation.");
  }
  if (!response.ok) throw new GenerationJobError(await errorMessage(response), response.status < 500 && response.status !== 429);
  let body: GenerationJob<Result>;
  try { body = await response.json(); }
  catch { throw new GenerationJobError("The cancellation response could not be read. Reconnect to check the same generation."); }
  if (body.job_id !== jobId) throw new GenerationJobError("The cancellation response did not identify this generation. Reconnect to check the same job.");
  // Saving may already have started, or the job may have finished. Its current
  // state is authoritative; a successful POST alone does not mean cancelled.
  return body;
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
  const deadline = Date.now() + (options.timeoutMs ?? 60 * 60 * 1000);
  let current = initial;
  let failures = 0;
  let cancellationPending = false;
  while (Date.now() < deadline) {
    if (options.signal.aborted) throw new DOMException("Generation monitoring stopped.", "AbortError");
    try {
      const job = current || await findGenerationJob<Result>(options, jobId);
      current = undefined;
      if (!job) throw new GenerationJobError("This generation is no longer available. Check My Library for its saved questions.", true);
      failures = 0;
      cancellationPending = job.status === "cancelling";
      onStatus(job);
      if (job.status === "cancelled") throw new GenerationCancelledError(job.message || undefined);
      if (job.status === "error") throw new GenerationJobError(job.message || "Generation could not finish. Please try again.", true);
      if (job.status === "complete" && job.result) return job.result;
    } catch (error) {
      if (options.signal.aborted || (error instanceof GenerationJobError && error.terminal)) throw error;
      failures += 1;
      onStatus({
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
