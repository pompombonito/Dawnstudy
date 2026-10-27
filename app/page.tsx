"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlarmClock, BookOpen, Check, CheckSquare, ChevronLeft, ChevronRight, CircleHelp, Clock3,
  CloudUpload, Copy, Cpu, FileText, Flag, Globe2, GraduationCap, Layers3, LogOut, Menu, Mic,
  MicOff, Moon, Maximize2, Minimize2, Plus, Send, Share2, Sparkles, Sun, Trash2, UserRound,
  Volume2, X,
} from "lucide-react";

type Kind = "flashcards" | "multiple_choice" | "checkbox" | "identification";
type Card = { card_id?: string; question: string; answer: string; options?: string[]; correct_answer?: string; explanation?: string; source_refs?: string[] };
type StudySet = { id: string; title: string; type: Kind; items: Card[]; sources?: { title: string; url: string }[]; created_at: string; material_fingerprint?: string; previous_question_count?: number; model?: string; models_used?: string[]; fallback?: { from: string; to: string; reason: string } | null; incomplete?: boolean; requested_count?: number; usage?: { remaining: number; limit: number; resets_at: string } };
type ReviewItem = { study_set_id: string; study_set_title: string; type: Kind; card: Card; retried?: boolean; intervals: { again: string; hard: string; good: string; easy: string } };
type Progress = { total_reviews: number; reviewed_today: number; accuracy: number; current_streak: number; best_streak: number; due_count: number; total_cards: number; week: { date: string; reviews: number }[] };
type Account = { id: string; username: string; email: string; display_name: string };
type LoginResult = { token: string; user: Account };
type ModelOption = { id: string; provider: string; name: string };
type Theme = "dark" | "light";
type PracticeAnswer = string | string[] | null;
type VoiceMode = "multiple_choice" | "identification" | "open_ended" | "enumeration";
type VoicePersona = "warm_tutor" | "calm_mentor" | "energetic_coach" | "clear_lecturer";

type GoogleIdResponse = { credential: string };
type VoiceTurn = { role: "user" | "assistant"; content: string };
type GoogleIdentity = {
  initialize: (config: { client_id: string; callback: (response: GoogleIdResponse) => void }) => void;
  renderButton: (element: HTMLElement, options: Record<string, string | number | boolean>) => void;
};
declare global { interface Window { google?: { accounts: { id: GoogleIdentity } } } }

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
const TOKEN_KEY = "dawnstudy_session_v1";
const THEME_KEY = "dawnstudy_theme_v1";
const VOICE_PERSONA_KEY = "dawnstudy_voice_persona_v1";
const VOICE_DEVICE_KEY = "dawnstudy_device_voice_v1";
const voicePersonas: { id: VoicePersona; name: string; rate: number; pitch: number }[] = [
  { id: "warm_tutor", name: "Warm tutor", rate: 0.96, pitch: 1.04 },
  { id: "calm_mentor", name: "Calm mentor", rate: 0.88, pitch: 0.92 },
  { id: "energetic_coach", name: "Energetic coach", rate: 1.08, pitch: 1.12 },
  { id: "clear_lecturer", name: "Clear lecturer", rate: 0.94, pitch: 0.98 },
];
const types: { id: Kind; title: string; detail: string; icon: typeof Layers3 }[] = [
  { id: "flashcards", title: "Flashcards", detail: "Quick question & answer pairs", icon: Layers3 },
  { id: "multiple_choice", title: "Multiple choice", detail: "Choose the best answer", icon: CircleHelp },
  { id: "checkbox", title: "Select all that apply", detail: "Find every correct answer", icon: CheckSquare },
  { id: "identification", title: "Identification", detail: "Recall key terms", icon: FileText },
];

function ageLabel(value: string) {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Yesterday" : `${days}d ago`;
}

function shuffleItems<T>(items: T[]) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  return shuffled;
}

async function responseError(response: Response) {
  try {
    const body = await response.json();
    return body.detail || body.error || `Request failed (${response.status}).`;
  } catch { return `Request failed (${response.status}).`; }
}

function normalizedAnswer(value: unknown) {
  return String(value ?? "").toLocaleLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function isPracticeAnswerCorrect(card: Card, type: Kind, response: PracticeAnswer | undefined) {
  if (response === null || response === undefined) return false;
  const expected = String(card.correct_answer || card.answer || "").split("|").map(normalizedAnswer).filter(Boolean).sort();
  if (type === "checkbox") {
    const actual = (Array.isArray(response) ? response : [response]).map(normalizedAnswer).filter(Boolean).sort();
    return actual.length === expected.length && actual.every((answer, index) => answer === expected[index]);
  }
  const actual = Array.isArray(response) ? response[0] || "" : response;
  return normalizedAnswer(actual) === expected[0];
}

function displayPracticeAnswer(response: PracticeAnswer | undefined) {
  return Array.isArray(response) ? response.join(" · ") : response || "No answer";
}

function shuffleSavedItems(items: Card[], kind: Kind) {
  let previousCorrectIndex: number | null = null;
  return shuffleItems(items).map((card) => {
    const options = [...(card.options || [])];
    if (options.length < 2 || (kind !== "multiple_choice" && kind !== "checkbox")) return card;
    const correctValues = (card.correct_answer || card.answer || "").split("|").map((value) => value.trim()).filter(Boolean);
    const correctOptions = correctValues.map((value) => {
      const letter = value.match(/^(?:option\s*)?([A-D])(?:[.):\-])?$/i);
      if (letter) return options[letter[1].toUpperCase().charCodeAt(0) - 65];
      return options.find((option) => normalizedAnswer(option) === normalizedAnswer(value));
    }).filter((value): value is string => Boolean(value));
    const shuffledOptions = shuffleItems(options);
    if (kind === "multiple_choice" && correctOptions.length === 1) {
      let correctIndex = shuffledOptions.indexOf(correctOptions[0]);
      if (correctIndex === previousCorrectIndex) {
        const replacementIndex = (correctIndex + 1 + Math.floor(Math.random() * (shuffledOptions.length - 1))) % shuffledOptions.length;
        [shuffledOptions[correctIndex], shuffledOptions[replacementIndex]] = [shuffledOptions[replacementIndex], shuffledOptions[correctIndex]];
        correctIndex = replacementIndex;
      }
      previousCorrectIndex = correctIndex;
    }
    return {
      ...card,
      options: shuffledOptions,
      ...(correctOptions.length ? { correct_answer: correctOptions.join(" | ") } : {}),
    };
  });
}

export default function Home() {
  const [selected, setSelected] = useState<Kind>("flashcards");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [web, setWeb] = useState(false);
  const [modelChoice, setModelChoice] = useState("auto");
  const [questionCount, setQuestionCount] = useState(10);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [theme, setTheme] = useState<Theme>("dark");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<StudySet | null>(null);
  const [current, setCurrent] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [practiceActive, setPracticeActive] = useState(false);
  const [practiceComplete, setPracticeComplete] = useState(false);
  const [practiceIndex, setPracticeIndex] = useState(0);
  const [practiceSecondsPerQuestion, setPracticeSecondsPerQuestion] = useState(30);
  const [practiceTimeLeft, setPracticeTimeLeft] = useState(0);
  const [practiceAnswers, setPracticeAnswers] = useState<PracticeAnswer[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [voiceTopic, setVoiceTopic] = useState("");
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("open_ended");
  const [voiceModelChoice, setVoiceModelChoice] = useState("auto");
  const [voicePersona, setVoicePersona] = useState<VoicePersona>("warm_tutor");
  const [deviceVoiceURI, setDeviceVoiceURI] = useState("");
  const [deviceVoices, setDeviceVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speechAvailable, setSpeechAvailable] = useState(false);
  const [voiceMessages, setVoiceMessages] = useState<VoiceTurn[]>([]);
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceTranscribing, setVoiceTranscribing] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceDraft, setVoiceDraft] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [voiceModelUsed, setVoiceModelUsed] = useState("");
  const [voiceFallbackNote, setVoiceFallbackNote] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [shareBusy, setShareBusy] = useState(false);
  const [reportingCard, setReportingCard] = useState(false);
  const [reportReason, setReportReason] = useState("incorrect_answer");
  const [reportNote, setReportNote] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [reportedCards, setReportedCards] = useState<string[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [reviewQueue, setReviewQueue] = useState<ReviewItem[]>([]);
  const [reviewActive, setReviewActive] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [sets, setSets] = useState<StudySet[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [authToken, setAuthToken] = useState("");
  const [authOpen, setAuthOpen] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const googleButton = useRef<HTMLDivElement>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const microphoneStream = useRef<MediaStream | null>(null);
  const recordingChunks = useRef<BlobPart[]>([]);
  const recordingTimeout = useRef<number | null>(null);
  const voiceMessagesElement = useRef<HTMLDivElement>(null);
  const voiceSessionId = useRef(0);

  async function loadAccountSets(token: string) {
    if (!API_BASE) return;
    try {
      const response = await fetch(`${API_BASE}/api/study-sets`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) return;
      const saved: StudySet[] = await response.json();
      setSets(saved);
    } catch { /* Auth can still be used if study-set sync is briefly unavailable. */ }
    void loadProgress(token);
  }

  async function loadProgress(token: string) {
    try {
      const response = await fetch(`${API_BASE}/api/progress`, { headers: { Authorization: `Bearer ${token}` } });
      if (response.ok) setProgress(await response.json());
    } catch { /* Progress remains available when the Sheets API is reachable again. */ }
  }

  useEffect(() => {
    const savedTheme = localStorage.getItem(THEME_KEY);
    const initialTheme: Theme = savedTheme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = initialTheme;
    setTheme(initialTheme);
    const savedPersona = localStorage.getItem(VOICE_PERSONA_KEY) as VoicePersona | null;
    if (savedPersona && voicePersonas.some((persona) => persona.id === savedPersona)) setVoicePersona(savedPersona);
    setDeviceVoiceURI(localStorage.getItem(VOICE_DEVICE_KEY) || "");
    setSets([]);
    if (API_BASE) {
      fetch(`${API_BASE}/api/models`).then((response) => response.ok ? response.json() : null)
        .then((data) => { if (Array.isArray(data?.models)) setModels(data.models); })
        .catch(() => { /* Model list is optional; the API will explain if no model is configured. */ });
    }
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token || !API_BASE) return;
    setAuthToken(token);
    fetch(`${API_BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        if (!response.ok) throw new Error("Session expired");
        setAccount(await response.json());
        void loadAccountSets(token);
      })
      .catch(() => { localStorage.removeItem(TOKEN_KEY); setAuthToken(""); setAccount(null); });
  }, []);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    setSpeechAvailable(true);
    const refreshDeviceVoices = () => {
      const available = window.speechSynthesis.getVoices();
      setDeviceVoices(available);
    };
    refreshDeviceVoices();
    window.speechSynthesis.addEventListener("voiceschanged", refreshDeviceVoices);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", refreshDeviceVoices);
  }, []);

  useEffect(() => {
    if (!authOpen || !GOOGLE_CLIENT_ID || !googleButton.current) return;
    const renderGoogleButton = () => {
      if (!window.google || !googleButton.current) return;
      googleButton.current.innerHTML = "";
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (response) => {
          setAuthBusy(true); setAuthError("");
          try {
            const apiResponse = await fetch(`${API_BASE}/api/auth/google`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ credential: response.credential }),
            });
            if (!apiResponse.ok) throw new Error(await responseError(apiResponse));
            acceptLogin(await apiResponse.json());
          } catch (caught) { setAuthError(caught instanceof Error ? caught.message : "Google sign-in failed. Please try again."); }
          finally { setAuthBusy(false); }
        },
      });
      window.google.accounts.id.renderButton(googleButton.current, { theme: "outline", size: "large", shape: "rectangular", text: "continue_with", width: 320 });
    };
    const currentScript = document.getElementById("google-identity-services") as HTMLScriptElement | null;
    if (window.google) renderGoogleButton();
    else if (currentScript) currentScript.addEventListener("load", renderGoogleButton, { once: true });
    else {
      const script = document.createElement("script");
      script.id = "google-identity-services";
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true; script.defer = true;
      script.onload = renderGoogleButton;
      script.onerror = () => setAuthError("Google sign-in could not load. Check your connection and try again.");
      document.head.appendChild(script);
    }
  }, [authOpen]);

  useEffect(() => {
    if (!practiceActive || practiceComplete || practiceSecondsPerQuestion === 0) return;
    if (practiceTimeLeft <= 0) { setPracticeComplete(true); return; }
    const timeout = window.setTimeout(() => setPracticeTimeLeft((seconds) => seconds - 1), 1000);
    return () => window.clearTimeout(timeout);
  }, [practiceActive, practiceComplete, practiceTimeLeft, practiceSecondsPerQuestion]);

  useEffect(() => {
    const syncFullscreenState = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, []);

  useEffect(() => {
    voiceMessagesElement.current?.scrollTo({ top: voiceMessagesElement.current.scrollHeight, behavior: "smooth" });
  }, [voiceMessages]);

  async function toggleExerciseFullscreen() {
    if (document.fullscreenElement) {
      try { await document.exitFullscreen(); }
      catch { setNotice("Could not exit fullscreen. Press Esc to leave fullscreen mode."); }
      return;
    }
    if (!document.documentElement.requestFullscreen) {
      setNotice("Fullscreen is not supported in this browser.");
      return;
    }
    try { await document.documentElement.requestFullscreen(); }
    catch { setNotice("Fullscreen was blocked by the browser. Use the fullscreen button to try again."); }
  }

  function acceptLogin(data: LoginResult) {
    localStorage.setItem(TOKEN_KEY, data.token);
    setAuthToken(data.token); setAccount(data.user); setAuthOpen(false);
    setAuthError(""); setError(""); setNotice(`Welcome, ${data.user.display_name || data.user.username}. Your sets will sync to your account.`);
    void loadAccountSets(data.token);
  }

  function selectFile(nextFile?: File) {
    if (!nextFile) return;
    setFile(nextFile); setError(""); setNotice(""); setResult(null); setSelectedOption(null);
  }

  function setColorTheme(nextTheme: Theme) {
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem(THEME_KEY, nextTheme);
  }

  async function generate() {
    if (!authToken || !account) {
      setAuthOpen(true);
      setError("Sign in with your verified CEU Google account (@ceu.edu.ph, @mnl.ceu.edu.ph, @mkt.ceu.edu.ph, or @mls.ceu.edu.ph) to make a study set.");
      return;
    }
    if (!file) { setError("Choose a study material first."); return; }
    setBusy(true); setError(""); setNotice("");
    const form = new FormData();
    form.append("file", file); form.append("format", selected); form.append("use_web", String(web));
    form.append("model", modelChoice);
    form.append("question_count", String(questionCount));
    try {
      if (!API_BASE) throw new Error("The API address is not configured for this site.");
      const headers: Record<string, string> = { Authorization: `Bearer ${authToken}` };
      const response = await fetch(`${API_BASE}/api/generate`, { method: "POST", headers, body: form });
      if (!response.ok) throw new Error(await responseError(response));
      const data = await response.json();
      let studySet: StudySet = { ...data, id: crypto.randomUUID(), created_at: new Date().toISOString() };
      let generationNotice = "";
      if (data.auto_model) {
        generationNotice = `Auto chose ${modelName(data.auto_model)} for this material (${data.auto_reason}).`;
      }
      if (data.fallback) {
        const original = models.find((item) => item.id === data.fallback.from)?.name || data.fallback.from;
        const fallbackModel = models.find((item) => item.id === data.fallback.to)?.name || data.fallback.to;
        const issue = data.fallback.reason === "limit" ? "may have reached its limit" : data.fallback.reason === "busy" ? "was busy" : data.fallback.reason === "incomplete" ? "returned an incomplete set" : "was unavailable";
        generationNotice = [generationNotice, `${original} ${issue}; ${fallbackModel} helped finish the set.`].filter(Boolean).join(" ");
      }
      if (data.incomplete) generationNotice = [generationNotice, `Only ${data.items.length} of ${data.requested_count} requested questions could be completed by the available models.`].filter(Boolean).join(" ");
      if (data.previous_question_count) generationNotice = [generationNotice, `Checked ${data.previous_question_count} questions from your earlier sets to avoid repeats.`].filter(Boolean).join(" ");
      if (data.usage) generationNotice = [generationNotice, `${data.usage.remaining} of ${data.usage.limit} generations left today${authToken ? " for your account" : " in this browser"}.`].filter(Boolean).join(" ");
      setResult(studySet); setCurrent(0); setRevealed(false); setSelectedOption(null); setShareUrl(""); setPracticeActive(false);
      const saved = await fetch(`${API_BASE}/api/study-sets`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ title: studySet.title, type: studySet.type, items: studySet.items, sources: studySet.sources || [], material_fingerprint: studySet.material_fingerprint }),
      });
      if (!saved.ok) throw new Error(await responseError(saved));
      const savedSet: StudySet = await saved.json();
      studySet = { ...studySet, id: savedSet.id, items: savedSet.items, created_at: savedSet.created_at };
      setResult(studySet);
      setSets((old) => [studySet, ...old.filter((item) => item.id !== studySet.id)].slice(0, 100));
      void loadProgress(authToken);
      setNotice(generationNotice);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
    } finally { setBusy(false); }
  }

  function signOut() {
    localStorage.removeItem(TOKEN_KEY); setAuthToken(""); setAccount(null); setSets([]); setResult(null); setProgress(null); setReviewActive(false); setReviewQueue([]);
    setNotice("You’re signed out. Sign in with your CEU Google account to continue using Dawnstudy.");
  }

  async function removeStudySet(studySet: StudySet) {
    if (!authToken || !window.confirm(`Delete “${studySet.title}” permanently?`)) return;
    setError("");
    try {
      const response = await fetch(`${API_BASE}/api/study-sets/${encodeURIComponent(studySet.id)}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!response.ok) throw new Error(await responseError(response));
      setSets((old) => old.filter((item) => item.id !== studySet.id));
      setResult((old) => old?.id === studySet.id ? null : old);
      void loadProgress(authToken);
      setNotice(`“${studySet.title}” was deleted.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not delete this study set."); }
  }

  function openSavedSet(studySet: StudySet) {
    setReviewActive(false); setPracticeActive(false); setPracticeComplete(false); setShareUrl(""); setResult({ ...studySet, items: shuffleSavedItems(studySet.items, studySet.type) }); setSelected(studySet.type); setCurrent(0); setRevealed(false); setSelectedOption(null); setError(""); setNotice("");
    document.querySelector(".result-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function startPractice() {
    if (!result) return;
    if (practiceSecondsPerQuestion > 0 && !document.fullscreenElement) {
      void toggleExerciseFullscreen();
    }
    setPracticeAnswers(Array.from({ length: result.items.length }, () => null));
    setPracticeIndex(0); setPracticeTimeLeft(practiceSecondsPerQuestion === 0 ? 0 : result.items.length * practiceSecondsPerQuestion);
    setPracticeComplete(false); setPracticeActive(true); setError("");
  }

  function speakVoiceReply(text: string) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = deviceVoices.find((item) => item.voiceURI === deviceVoiceURI);
    const persona = voicePersonas.find((item) => item.id === voicePersona) || voicePersonas[0];
    utterance.voice = voice || null;
    utterance.lang = voice?.lang || navigator.language || "en-US";
    utterance.rate = persona.rate;
    utterance.pitch = persona.pitch;
    window.speechSynthesis.speak(utterance);
  }

  async function sendVoiceTurn(message: string, previousHistory: VoiceTurn[] = voiceMessages) {
    const cleanMessage = message.trim();
    if (!cleanMessage || !authToken) return;
    const sessionId = voiceSessionId.current;
    const history = previousHistory.slice(-12);
    setVoiceMessages([...previousHistory, { role: "user", content: cleanMessage }]);
    setVoiceBusy(true); setVoiceError(""); setVoiceFallbackNote("");
    try {
      if (!API_BASE) throw new Error("The API address is not configured for this site.");
      const response = await fetch(API_BASE + "/api/voice/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + authToken },
        body: JSON.stringify({ topic: voiceTopic, message: cleanMessage, history, model: voiceModelChoice, mode: voiceMode }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const data: { answer: string; model: string; fallback?: { from: string; to: string } | null } = await response.json();
      if (sessionId !== voiceSessionId.current) return;
      setVoiceMessages((current) => [...current, { role: "assistant", content: data.answer }]);
      setVoiceModelUsed(data.model);
      if (data.fallback) {
        const from = models.find((item) => item.id === data.fallback?.from)?.name || data.fallback.from;
        const to = models.find((item) => item.id === data.fallback?.to)?.name || data.fallback.to;
        setVoiceFallbackNote(from + " was unavailable, so " + to + " replied.");
      }
      speakVoiceReply(data.answer);
    } catch (caught) {
      if (sessionId !== voiceSessionId.current) return;
      setVoiceError(caught instanceof Error ? caught.message : "Could not continue the voice review.");
    } finally { if (sessionId === voiceSessionId.current) setVoiceBusy(false); }
  }

  function beginVoiceReview() {
    if (!authToken || !account) {
      setAuthOpen(true); setVoiceError("Sign in with your verified CEU Google account to use Voice Review.");
      return;
    }
    if (voiceTopic.trim().length < 2) { setVoiceError("Enter a topic you want to review first."); return; }
    voiceSessionId.current += 1;
    setVoiceActive(true); setVoiceMessages([]); setVoiceError(""); setVoiceFallbackNote("");
    void sendVoiceTurn("Start by asking me one question about this topic.", []);
  }

  function endVoiceReview() {
    voiceSessionId.current += 1;
    if (recordingTimeout.current !== null) window.clearTimeout(recordingTimeout.current);
    recordingTimeout.current = null;
    if (mediaRecorder.current?.state !== "inactive") mediaRecorder.current?.stop();
    mediaRecorder.current = null;
    microphoneStream.current?.getTracks().forEach((track) => track.stop()); microphoneStream.current = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setVoiceActive(false); setVoiceListening(false); setVoiceBusy(false); setVoiceTranscribing(false);
  }

  async function transcribeVoiceRecording(blob: Blob) {
    if (!blob.size || !authToken) {
      setVoiceError("I didn’t hear any audio. Try recording your reply again.");
      return;
    }
    const sessionId = voiceSessionId.current;
    setVoiceBusy(true); setVoiceTranscribing(true); setVoiceError("");
    try {
      if (!API_BASE) throw new Error("The API address is not configured for this site.");
      const form = new FormData();
      const mimeType = blob.type || "audio/webm";
      const extension = mimeType.includes("mp4") ? "mp4" : mimeType.includes("ogg") ? "ogg" : "webm";
      form.append("file", blob, `voice-reply.${extension}`);
      form.append("topic", voiceTopic);
      const response = await fetch(API_BASE + "/api/voice/transcribe", {
        method: "POST", headers: { Authorization: "Bearer " + authToken }, body: form,
      });
      if (!response.ok) throw new Error(await responseError(response));
      const data: { transcript: string; provider: string } = await response.json();
      if (sessionId !== voiceSessionId.current) return;
      if (!data.transcript?.trim()) throw new Error("I couldn’t make out those words. Try again, or type your reply.");
      setVoiceTranscribing(false);
      await sendVoiceTurn(data.transcript);
    } catch (caught) {
      if (sessionId === voiceSessionId.current) setVoiceError(caught instanceof Error ? caught.message : "Could not transcribe that recording. Try typing your reply.");
    } finally { if (sessionId === voiceSessionId.current) { setVoiceBusy(false); setVoiceTranscribing(false); } }
  }

  async function toggleVoiceInput() {
    if (voiceListening) {
      if (recordingTimeout.current !== null) window.clearTimeout(recordingTimeout.current);
      recordingTimeout.current = null;
      if (mediaRecorder.current?.state === "recording") mediaRecorder.current.stop();
      setVoiceListening(false);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setVoiceError("Audio recording is not available in this browser. Try a recent Chrome, Edge, Firefox, or Safari, or type your reply.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      microphoneStream.current = stream;
      const recordingSessionId = voiceSessionId.current;
      const preferredMime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((mime) => MediaRecorder.isTypeSupported(mime));
      const recorder = new MediaRecorder(stream, preferredMime ? { mimeType: preferredMime } : undefined);
      recordingChunks.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) recordingChunks.current.push(event.data); };
      recorder.onerror = () => {
        setVoiceListening(false); setVoiceError("The microphone recording failed. Check microphone permissions and try again.");
        stream.getTracks().forEach((track) => track.stop()); microphoneStream.current = null; mediaRecorder.current = null;
      };
      recorder.onstop = () => {
        if (recordingTimeout.current !== null) window.clearTimeout(recordingTimeout.current);
        recordingTimeout.current = null;
        const blob = new Blob(recordingChunks.current, { type: recorder.mimeType || "audio/webm" });
        recordingChunks.current = [];
        stream.getTracks().forEach((track) => track.stop());
        if (microphoneStream.current === stream) microphoneStream.current = null;
        if (mediaRecorder.current === recorder) mediaRecorder.current = null;
        if (recordingSessionId === voiceSessionId.current && blob.size) void transcribeVoiceRecording(blob);
      };
      mediaRecorder.current = recorder;
      recorder.start(250);
      setVoiceError(""); setVoiceListening(true);
      recordingTimeout.current = window.setTimeout(() => {
        recordingTimeout.current = null;
        if (recorder.state === "recording") {
          setVoiceListening(false); recorder.stop();
        }
      }, 30_000);
    } catch (caught) {
      microphoneStream.current?.getTracks().forEach((track) => track.stop()); microphoneStream.current = null;
      setVoiceListening(false);
      const name = caught instanceof DOMException ? caught.name : "";
      setVoiceError(name === "NotAllowedError" || name === "PermissionDeniedError"
        ? "Microphone access is blocked. Allow microphone access for this site in your browser, then try again."
        : name === "NotFoundError" ? "No microphone was detected. Connect or enable one, then try again."
        : "The microphone could not start. Check browser permissions and try again.");
    }
  }

  async function shareCurrentSet() {
    if (!result || !authToken) { setAuthOpen(true); return; }
    setShareBusy(true); setError("");
    try {
      const response = await fetch(`${API_BASE}/api/study-sets/${encodeURIComponent(result.id)}/share`, { method: "POST", headers: { Authorization: `Bearer ${authToken}` } });
      if (!response.ok) throw new Error(await responseError(response));
      const data: { token: string } = await response.json();
      const url = `${window.location.origin}/shared/${data.token}`;
      setShareUrl(url);
      try { await navigator.clipboard.writeText(url); setNotice("Share link copied. Anyone who has it can view this set until you turn the link off."); }
      catch { setNotice("Share link created. Anyone who has it can view this set until you turn the link off."); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create a share link."); }
    finally { setShareBusy(false); }
  }

  async function turnOffShareLink() {
    if (!result || !authToken) return;
    setShareBusy(true); setError("");
    try {
      const response = await fetch(`${API_BASE}/api/study-sets/${encodeURIComponent(result.id)}/share`, { method: "DELETE", headers: { Authorization: `Bearer ${authToken}` } });
      if (!response.ok) throw new Error(await responseError(response));
      setShareUrl(""); setNotice("The share link has been turned off.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not turn off the share link."); }
    finally { setShareBusy(false); }
  }

  async function submitCardReport() {
    if (!result || !currentCard?.card_id || !authToken || reportBusy) return;
    setReportBusy(true); setError("");
    try {
      const response = await fetch(`${API_BASE}/api/reports`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ study_set_id: result.id, card_id: currentCard.card_id, reason: reportReason, note: reportNote }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      setReportedCards((old) => [...old, currentCard.card_id!]); setReportingCard(false); setReportNote("");
      setNotice("Thanks. Your report was sent for review.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not send your report."); }
    finally { setReportBusy(false); }
  }

  function updatePracticeAnswer(index: number, answer: PracticeAnswer) {
    setPracticeAnswers((old) => old.map((entry, position) => position === index ? answer : entry));
  }

  function togglePracticeChoice(index: number, option: string) {
    const currentAnswer = practiceAnswers[index];
    const selected = Array.isArray(currentAnswer) ? currentAnswer : currentAnswer ? [currentAnswer] : [];
    updatePracticeAnswer(index, selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option]);
  }

  async function startReview() {
    if (!authToken) { setAuthOpen(true); return; }
    setError("");
    try {
      const response = await fetch(`${API_BASE}/api/reviews/due?limit=50`, { headers: { Authorization: `Bearer ${authToken}` } });
      if (!response.ok) throw new Error(await responseError(response));
      const data = await response.json();
      setReviewQueue(data.items || []); setReviewActive(true); setResult(null); setRevealed(false); setSelectedOption(null);
      document.querySelector(".review-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load your review queue."); }
  }

  async function gradeCard(rating: "again" | "hard" | "good" | "easy") {
    const item = reviewQueue[0];
    if (!item || !item.card.card_id || !authToken || reviewBusy) return;
    setReviewBusy(true); setError("");
    try {
      const response = await fetch(`${API_BASE}/api/reviews`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ study_set_id: item.study_set_id, card_id: item.card.card_id, rating }) });
      if (!response.ok) throw new Error(await responseError(response));
      setReviewQueue((old) => {
        const remaining = old.slice(1);
        return rating === "again" && !item.retried && remaining.length ? [...remaining, { ...item, retried: true }] : remaining;
      });
      setRevealed(false); setSelectedOption(null); void loadProgress(authToken);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save your review."); }
    finally { setReviewBusy(false); }
  }

  async function gradeCurrentCard(rating: "again" | "hard" | "good" | "easy") {
    if (!result || !currentCard?.card_id || !authToken || reviewBusy) return;
    setReviewBusy(true); setError("");
    try {
      const response = await fetch(`${API_BASE}/api/reviews`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ study_set_id: result.id, card_id: currentCard.card_id, rating }) });
      if (!response.ok) throw new Error(await responseError(response));
      const data = await response.json();
      setNotice(`Card added to your review schedule · next review ${data.next_review_in}.`);
      setCurrent((index) => (index + 1) % result.items.length); setRevealed(false); setSelectedOption(null);
      void loadProgress(authToken);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save this card's review schedule."); }
    finally { setReviewBusy(false); }
  }

  const currentCard = result?.items[current] || result?.items[0];
  const modelName = (modelId?: string) => models.find((item) => item.id === modelId)?.name || modelId;
  const practiceCard = result?.items[practiceIndex];
  const practiceScore = result ? result.items.reduce((score, card, index) => score + (isPracticeAnswerCorrect(card, result.type, practiceAnswers[index]) ? 1 : 0), 0) : 0;
  const practicePercent = result?.items.length ? Math.round(practiceScore / result.items.length * 100) : 0;
  const reportReasons = [
    ["incorrect_answer", "Incorrect answer"], ["unclear_question", "Unclear question"],
    ["bad_source", "Source reference is wrong"], ["other", "Other issue"],
  ];
  function renderMultipleChoice(card: Card) {
    const correctAnswer = normalizedAnswer(card.correct_answer || card.answer);
    const isCorrect = (option: string) => normalizedAnswer(option) === correctAnswer;
    const selectedAnswer = selectedOption === null ? undefined : card.options?.[selectedOption];
    const selectedIsCorrect = Boolean(selectedAnswer && isCorrect(selectedAnswer));
    return <div className={`study-face choice-study-face ${revealed ? "is-revealed" : ""}`}>
      <span className="face-label">{revealed ? "ANSWER FEEDBACK" : "CHOOSE YOUR ANSWER"}</span>
      <span className="face-question">{card.question}</span>
      <div className="choice-options">{card.options?.map((option, index) => {
        const correct = isCorrect(option);
        const selected = selectedOption === index;
        const status = selectedOption === null ? "" : correct ? "choice-correct" : selected ? "choice-wrong" : "";
        return <button type="button" key={`${index}-${option}`} className={`choice-option ${status}`} disabled={selectedOption !== null} aria-pressed={selected} onClick={() => { setSelectedOption(index); setRevealed(true); }}>
          <i>{String.fromCharCode(65 + index)}</i><span>{option}</span>{revealed && correct && <Check size={16} aria-label="Correct answer"/>}
        </button>;
      })}</div>
      {selectedOption === null ? <span className="tap-hint choice-hint">Select an option to reveal the answer</span> : <p className={`choice-feedback ${selectedIsCorrect ? "correct" : "wrong"}`} role="status">{selectedIsCorrect ? "Correct! Nice work." : "Not quite. The correct answer is highlighted in green."}</p>}
    </div>;
  }

  const FullscreenIcon = isFullscreen ? Minimize2 : Maximize2;

  return (
    <main className="shell">
      <aside className="sidebar">
        <a className="brand" href="#home"><span className="brand-icon"><Sparkles size={19} strokeWidth={2.2} /></span><span className="brand-copy"><span>dawn<span className="brand-light">study</span></span><small>by Devon</small></span></a>
        <div className="side-kicker">YOUR SPACE</div>
        <button className="nav-item active" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><span className="nav-icon"><BookOpen size={18}/></span> Study desk</button>
        <button className="nav-item" onClick={() => document.querySelector(".voice-review")?.scrollIntoView({ behavior: "smooth" })}><span className="nav-icon"><Mic size={18}/></span> Voice review</button>
        <button className="nav-item" onClick={() => document.querySelector(".recent-section")?.scrollIntoView({ behavior: "smooth" })}><span className="nav-icon"><Layers3 size={18}/></span> My study sets <span className="nav-count">{sets.length}</span></button>
        <button className="nav-item" onClick={() => document.querySelector(".progress-panel")?.scrollIntoView({ behavior: "smooth" })}><span className="nav-icon"><Clock3 size={18}/></span> Study progress</button>
        <button className="nav-item" onClick={() => document.querySelector(".about-section")?.scrollIntoView({ behavior: "smooth" })}><span className="nav-icon"><UserRound size={18}/></span> About the Developer</button>
        <div className="side-separator" />
        <div className="set-heading"><span className="side-kicker">RECENT SETS</span><button className="plain-icon" title={account ? "Add a study set" : "Sign in to add a study set"} onClick={() => account ? input.current?.click() : setAuthOpen(true)}><Plus size={17}/></button></div>
        <div className="mini-sets">
          {sets.slice(0, 4).map((studySet, index) => <button className="mini-set" key={studySet.id} onClick={() => openSavedSet(studySet)}>
            <span className={`set-dot ${["aqua", "coral", "gold"][index % 3]}`}><BookOpen size={14}/></span>
            <span className="mini-copy"><span className="mini-title">{studySet.title}</span><span className="mini-meta">{studySet.items.length} cards · {ageLabel(studySet.created_at)}</span></span>
          </button>)}
          {!sets.length && <p className="empty-side">Your saved sets will appear here.</p>}
        </div>
        <div className="sidebar-bottom">
          <div className="plan-card"><span className="plan-spark"><Sparkles size={16}/></span><strong>A little more focus.</strong><p>Your notes, a quieter mind, and a brighter tomorrow.</p><span className="plan-tag">MADE FOR THE MOMENT</span></div>
          <div className="profile"><span className="avatar">{(account?.display_name || "S").slice(0, 1).toUpperCase()}</span><span className="profile-name">{account?.display_name || "CEU student"}<small>{account ? "Account synced" : "CEU Google sign-in required"}</small></span>
            {account ? <button className="profile-menu" title="Sign out" onClick={signOut}><LogOut size={16}/></button> : <button className="profile-menu" title="Sign in with Google" onClick={() => setAuthOpen(true)}><UserRound size={17}/></button>}
          </div>
        </div>
      </aside>

      <section className="main-area" id="home">
        <header className="topbar"><div className="crumb"><span>Your space</span><ChevronRight size={14}/><b>Study desk</b></div><div className="top-actions"><button className="theme-toggle" onClick={() => setColorTheme(theme === "dark" ? "light" : "dark")} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>{theme === "dark" ? <Sun size={16}/> : <Moon size={16}/>}<span>{theme === "dark" ? "Light mode" : "Dark mode"}</span></button><span className="today-pill"><span className="status-dot"/> YOUR STUDY DESK</span>{!account && <button className="top-signin" onClick={() => setAuthOpen(true)}><UserRound size={14}/> Sign in</button>}<button className="profile-mobile" onClick={() => account ? signOut() : setAuthOpen(true)} title={account ? "Sign out" : "Sign in with Google"}>{account ? <LogOut size={18}/> : <Menu size={20}/>}</button></div></header>
        <div className="content">
          {result && !reviewActive && <button className={`exercise-fullscreen-toggle ${isFullscreen ? "is-fullscreen" : ""}`} type="button" onClick={() => void toggleExerciseFullscreen()} aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"} aria-pressed={isFullscreen}><FullscreenIcon size={16}/><span>{isFullscreen ? "Exit fullscreen" : "Fullscreen"}</span></button>}
          <div className="access-banner"><GraduationCap size={19}/><span><strong>For Centro Escolar University students, for now.</strong> To conserve AI tokens, Dawnstudy is limited to verified Google accounts ending in <b>@ceu.edu.ph</b>, <b>@mnl.ceu.edu.ph</b>, <b>@mkt.ceu.edu.ph</b>, or <b>@mls.ceu.edu.ph</b>.</span></div>
          <section className="welcome"><div className="welcome-copy"><div className="eyebrow"><span/> A FRESH PAGE, A FRESH START</div><h1>Make today<br/>a little <em>brighter.</em></h1><p>Drop in your notes. We’ll help the important things stick.</p></div><div className="sunrise-art" aria-hidden="true"><div className="sun"/><div className="cloud cloud-one"/><div className="cloud cloud-two"/><div className="horizon h-back"/><div className="horizon h-front"/></div><span className="welcome-note">one page at a time <span>✳</span></span></section>
          <div className="section-intro"><div><div className="section-title-row"><h2>Start a study set</h2></div><p>Choose how you’d like to practice.</p></div><span className="quiet-note">Good things take practice <span>↗</span></span></div>
          {account && progress && <section className="progress-panel"><div className="progress-copy"><div className="result-kicker"><span/> YOUR STUDY PROGRESS</div><h2>Small steps add up.</h2><p>Review a little each day to keep ideas fresh.</p><div className="progress-stats"><div><strong>{progress.reviewed_today}</strong><span>today</span></div><div><strong>{progress.accuracy}%</strong><span>accuracy</span></div><div><strong>{progress.current_streak} <small>days</small></strong><span>current streak</span></div><div><strong>{progress.best_streak} <small>days</small></strong><span>best streak</span></div></div><div className="week-bars" aria-label="Reviews during the past seven days">{progress.week.map((day) => <div key={day.date} title={`${day.reviews} reviews`}><i style={{ height: `${Math.max(8, Math.min(100, day.reviews * 18))}%` }}/><small>{new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "narrow" })}</small></div>)}</div></div><button className="review-start" onClick={() => void startReview()}><Clock3 size={17}/><span>Review due</span><b>{progress.due_count}</b><ChevronRight size={16}/></button></section>}
          <div className="type-grid">{types.map(({ id, title, detail, icon: Icon }) => <button key={id} className={`type-card ${selected === id ? "chosen" : ""}`} onClick={() => { setSelected(id); setResult(null); setCurrent(0); setRevealed(false); setError(""); }}><span className="type-icon"><Icon size={19}/></span><span className="type-text"><strong>{title}</strong><small>{detail}</small></span>{selected === id && <span className="check-icon"><Check size={13} strokeWidth={3}/></span>}</button>)}</div>
          <section className={`upload-zone ${dragging ? "dragging" : ""} ${file ? "has-file" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); selectFile(event.dataTransfer.files[0]); }} onClick={() => !file && input.current?.click()} role="button" tabIndex={0} onKeyDown={(event) => event.key === "Enter" && input.current?.click()}>
            <input ref={input} type="file" accept=".pdf,.pptx,.docx,.txt,.md,.png,.jpg,.jpeg,.webp" hidden onChange={(event) => selectFile(event.target.files?.[0])}/>
            <span className="upload-icon">{file ? <FileText size={22}/> : <CloudUpload size={23}/>}</span><span className="upload-copy">{file ? <><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(2)} MB · ready to study</small></> : <><strong>Drop your study material here</strong><small>or <span className="browse-link">browse your files</span></small></>}</span>{file ? <button className="remove-file" title="Remove file" onClick={(event) => { event.stopPropagation(); setFile(null); }}><X size={18}/></button> : <span className="format-hint">PDF, PPTX, DOCX, TXT, MD, or image <i>·</i> Max 15 MB</span>}
          </section>
          <div className="model-row"><label htmlFor="model-choice"><Cpu size={16}/> AI model</label><select id="model-choice" value={modelChoice} onChange={(event) => setModelChoice(event.target.value)}><option value="auto">Auto choose · switch when busy or limited</option>{models.map((model) => <option key={model.id} value={model.id}>{model.name} · {model.provider}</option>)}</select><label className="count-label" htmlFor="question-count">Questions</label><select id="question-count" value={questionCount} onChange={(event) => setQuestionCount(Number(event.target.value))}>{[10, 20, 30, 40, 50].map((count) => <option key={count} value={count}>{count} questions</option>)}</select><span className="model-help">{modelChoice === "auto" ? "Auto uses file size, extracted text, and question count to choose a compact model for smaller jobs and a stronger one for larger jobs." : "Your choice is tried first. Another configured model can help if it fails or returns a partial set."} Up to 50 questions per request; each submitted request uses one of 5 daily generations, even if fallback models are tried. Your allowance resets at midnight Manila time. Provider free quotas are shared and may still be busy or exhausted.</span></div>
          <div className="options-row"><button className={`web-toggle ${web ? "on" : ""}`} onClick={() => setWeb(!web)}><span className="toggle-track"><span/></span><Globe2 size={16}/><span>Enrich with the web</span><span className="optional-tag">OPTIONAL</span></button><button className="web-info" title="Searches the web for relevant context and includes source links with your results."><CircleHelp size={15}/></button></div>
          <div className="generate-row"><span className="privacy-note"><span className="privacy-dot"/> Sent to your selected AI provider; sets sync to your account.</span><button className="generate-button" onClick={generate} disabled={busy}>{busy ? <><span className="spinner"/> Trying available models…</> : <><Sparkles size={16}/> Make my study set <ChevronRight size={16}/></>}</button></div>
          {error && <div className="error-box"><CircleHelp size={16}/><span>{error}</span></div>}
          {notice && <div className="notice-box"><Check size={15}/><span>{notice}</span></div>}
          {reviewActive && <section className="review-panel"><div className="result-head"><div><div className="result-kicker"><span/> SPACED REPETITION</div><h2>{reviewQueue.length ? reviewQueue[0].study_set_title : "Review complete"}</h2><p>{reviewQueue.length ? `${reviewQueue.length} cards in this session · ${reviewQueue[0].type.replaceAll("_", " ")}` : "You’re all caught up for now. Nice work showing up."}</p></div><button className="plain-icon" title="Close review" onClick={() => { setReviewActive(false); setReviewQueue([]); setSelectedOption(null); }}><X size={18}/></button></div>{reviewQueue.length ? <div className="study-card"><div className="study-card-top"><span className="flashcard-label">REVIEW {reviewQueue.length} LEFT</span></div>{reviewQueue[0].type === "multiple_choice" && reviewQueue[0].card.options?.length ? renderMultipleChoice(reviewQueue[0].card) : <button className={`study-face ${revealed ? "is-revealed" : ""}`} onClick={() => setRevealed(!revealed)}><span className="face-label">{revealed ? "THE ANSWER" : "YOUR QUESTION"}</span><span className="face-question">{revealed ? reviewQueue[0].card.answer : reviewQueue[0].card.question}</span>{!revealed && <span className="tap-hint">Tap to reveal <span>↗</span></span>}</button>}{revealed && reviewQueue[0].card.explanation && <p className="explanation">{reviewQueue[0].card.explanation}</p>}{revealed && <div className="rating-row"><button disabled={reviewBusy} onClick={() => void gradeCard("again")}><b>Again</b><small>{reviewQueue[0].intervals.again}</small></button><button disabled={reviewBusy} onClick={() => void gradeCard("hard")}><b>Hard</b><small>{reviewQueue[0].intervals.hard}</small></button><button disabled={reviewBusy} onClick={() => void gradeCard("good")}><b>Good</b><small>{reviewQueue[0].intervals.good}</small></button><button disabled={reviewBusy} onClick={() => void gradeCard("easy")}><b>Easy</b><small>{reviewQueue[0].intervals.easy}</small></button></div>}</div> : <button className="review-done" onClick={() => { setReviewActive(false); setReviewQueue([]); }}>Back to study desk <ChevronRight size={15}/></button>}</section>}
          {result && practiceActive && !reviewActive && <section className="practice-panel">
            <div className="result-head"><div><div className="result-kicker"><span/> {practiceSecondsPerQuestion === 0 ? "SELF-PACED PRACTICE" : "TIMED PRACTICE TEST"}</div><h2>{result.title}</h2><p>{practiceComplete ? "Test results and missed answers" : `${result.items.length} questions · ${practiceSecondsPerQuestion === 0 ? "no time limit" : `${practiceSecondsPerQuestion} seconds per question`}`}</p></div><button className="plain-icon" title="Exit practice test" onClick={() => { setPracticeActive(false); setPracticeComplete(false); }}><X size={18}/></button></div>
            {!practiceComplete && practiceCard ? <>
              <div className="practice-timer"><AlarmClock size={18}/><span>{practiceSecondsPerQuestion === 0 ? "No time limit" : `${Math.floor(practiceTimeLeft / 60)}:${String(practiceTimeLeft % 60).padStart(2, "0")} remaining`}</span><span className="practice-progress">Question {practiceIndex + 1} of {result.items.length}</span></div>
              <div className="practice-question"><span className="face-label">QUESTION {practiceIndex + 1}</span><h3>{practiceCard.question}</h3>
                {practiceCard.options?.length ? <div className="practice-choices">{practiceCard.options.map((option, index) => {
                  const checkboxMode = result.type === "checkbox";
                  const answer = practiceAnswers[practiceIndex];
                  const selected = checkboxMode ? Array.isArray(answer) && answer.includes(option) : answer === option;
                  return <button type="button" key={`${index}-${option}`} className={`practice-choice ${selected ? "selected" : ""}`} onClick={() => checkboxMode ? togglePracticeChoice(practiceIndex, option) : updatePracticeAnswer(practiceIndex, option)}><i>{checkboxMode ? (selected ? "✓" : "") : String.fromCharCode(65 + index)}</i><span>{option}</span></button>;
                })}</div> : <label className="practice-written"><span>Your answer</span><textarea value={typeof practiceAnswers[practiceIndex] === "string" ? practiceAnswers[practiceIndex] as string : ""} onChange={(event) => updatePracticeAnswer(practiceIndex, event.target.value)} rows={3} placeholder="Type your answer"/></label>}
              </div>
              <div className="practice-controls"><button className="control-button" disabled={practiceIndex === 0} onClick={() => setPracticeIndex((index) => Math.max(0, index - 1))}><ChevronLeft size={15}/> Previous</button><span>{practiceAnswers.filter((answer) => answer !== null && answer !== "" && (!Array.isArray(answer) || answer.length > 0)).length} answered</span><div>{practiceIndex < result.items.length - 1 && <button className="control-button next" onClick={() => setPracticeIndex((index) => Math.min(result.items.length - 1, index + 1))}>Next <ChevronRight size={15}/></button>}<button className="finish-test" onClick={() => setPracticeComplete(true)}>Finish test</button></div></div>
            </> : practiceComplete ? <>
              <div className="practice-score"><strong>{practiceScore}<span>/{result.items.length}</span></strong><div><b>{practicePercent}%</b><small>{practicePercent >= 80 ? "Great work — keep it up." : "Review the missed answers below."}</small></div></div>
              <h3 className="missed-heading">Review missed answers</h3>
              {practiceScore === result.items.length ? <p className="all-correct">You answered every question correctly.</p> : <div className="missed-list">{result.items.map((card, index) => isPracticeAnswerCorrect(card, result.type, practiceAnswers[index]) ? null : <article className="missed-card" key={`${card.card_id || card.question}-${index}`}><strong>{index + 1}. {card.question}</strong><p><b>Your answer:</b> {displayPracticeAnswer(practiceAnswers[index])}</p><p><b>Correct answer:</b> {card.correct_answer || card.answer}</p>{card.explanation && <small>{card.explanation}</small>}{card.source_refs?.length ? <small className="missed-source">Source: {card.source_refs.join(", ")}</small> : null}</article>)}</div>}
              <button className="finish-test" onClick={() => { setPracticeActive(false); setPracticeComplete(false); }}>Back to study cards</button>
            </> : null}
          </section>}
          {result && currentCard && !reviewActive && !practiceActive && <section className="result-panel"><div className="result-head"><div><div className="result-kicker"><span/> YOUR STUDY SET</div><h2>{result.title}</h2><p>{result.items.length} {types.find((type) => type.id === result.type)?.title.toLowerCase()} · ready when you are{result.model ? ` · ${modelName(result.model)}` : ""}</p></div><button className="plain-icon" title="Close study set" onClick={() => setResult(null)}><X size={18}/></button></div>
            <div className="set-action-row"><label>Test pace<select value={practiceSecondsPerQuestion} onChange={(event) => setPracticeSecondsPerQuestion(Number(event.target.value))}><option value={0}>No timer</option><option value={20}>20 sec / question</option><option value={30}>30 sec / question</option><option value={45}>45 sec / question</option></select></label><button className="action-button" onClick={startPractice}><AlarmClock size={15}/> {practiceSecondsPerQuestion === 0 ? "Start practice" : "Start timed test"}</button><button className="action-button" onClick={() => void shareCurrentSet()} disabled={shareBusy}><Share2 size={15}/>{shareBusy ? "Working…" : "Share set"}</button></div>
            {shareUrl && <div className="share-link-row"><span>Anyone with this link can view this set:</span><a href={shareUrl} target="_blank" rel="noreferrer">{shareUrl}</a><button className="plain-icon" title="Copy share link" onClick={() => { void navigator.clipboard.writeText(shareUrl).then(() => setNotice("Share link copied.")).catch(() => setNotice("Select and copy the share link above.")); }}><Copy size={15}/></button><button className="share-revoke" disabled={shareBusy} onClick={() => void turnOffShareLink()}>Turn off link</button></div>}
            <div className="study-card"><div className="study-card-top"><span className="flashcard-label">{result.type === "flashcards" ? "FLASHCARD" : types.find((type) => type.id === result.type)?.title.toUpperCase()}</span><span className="card-number">{String(current + 1).padStart(2,"0")} <i>/</i> {String(result.items.length).padStart(2,"0")}</span></div>
              {result.type === "multiple_choice" && currentCard.options?.length ? renderMultipleChoice(currentCard) : <button className={`study-face ${revealed ? "is-revealed" : ""}`} onClick={() => setRevealed(!revealed)}><span className="face-label">{revealed ? "THE ANSWER" : "YOUR QUESTION"}</span><span className="face-question">{revealed ? currentCard.answer : currentCard.question}</span>{!revealed && <span className="tap-hint">Tap to reveal <span>↗</span></span>}</button>}
              {currentCard.source_refs?.length ? <div className="material-citations"><strong>From your material</strong>{currentCard.source_refs.map((source) => <span key={source}>{source}</span>)}</div> : null}
              {revealed && currentCard.explanation && <p className="explanation">{currentCard.explanation}</p>}
              {revealed && account && authToken && currentCard.card_id && <><div className="rating-prompt">How well did you recall it? Your answer schedules this card for another review.</div><div className="rating-row"><button disabled={reviewBusy} onClick={() => void gradeCurrentCard("again")}><b>Again</b><small>Hard to recall</small></button><button disabled={reviewBusy} onClick={() => void gradeCurrentCard("hard")}><b>Hard</b><small>With effort</small></button><button disabled={reviewBusy} onClick={() => void gradeCurrentCard("good")}><b>Good</b><small>Recalled it</small></button><button disabled={reviewBusy} onClick={() => void gradeCurrentCard("easy")}><b>Easy</b><small>Very easy</small></button></div></>}
              {currentCard.card_id && <div className="card-report-wrap">{reportedCards.includes(currentCard.card_id) ? <span className="report-sent"><Check size={14}/> Report received</span> : <button className="report-toggle" onClick={() => setReportingCard(!reportingCard)}><Flag size={14}/> Report an issue with this card</button>}{reportingCard && !reportedCards.includes(currentCard.card_id) && <div className="card-report-form"><label>What should we review?<select value={reportReason} onChange={(event) => setReportReason(event.target.value)}>{reportReasons.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><textarea value={reportNote} onChange={(event) => setReportNote(event.target.value)} maxLength={500} rows={2} placeholder="Optional note to help us check it"/><button className="action-button" disabled={reportBusy} onClick={() => void submitCardReport()}>{reportBusy ? "Sending…" : "Send report"}</button></div>}</div>}
              <div className="study-controls"><button className="control-button" onClick={() => { setCurrent((current - 1 + result.items.length) % result.items.length); setRevealed(false); setSelectedOption(null); }}><ChevronLeft size={16}/> Previous</button><span className="dots">{result.items.slice(0, Math.min(result.items.length, 7)).map((_, index) => <i key={index} className={index === current ? "dot-active" : ""}/>)}</span><button className="control-button next" onClick={() => { setCurrent((current + 1) % result.items.length); setRevealed(false); setSelectedOption(null); }}>Next <ChevronRight size={16}/></button></div>
              {result.sources?.length ? <div className="source-links"><Globe2 size={14}/><span>Sources:</span>{result.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}</a>)}</div> : null}
            </div></section>}
          <section className="recent-section"><div className="recent-head"><div><div className="section-title-row"><h2>Your recent sets</h2><span className="recent-count">{sets.length}</span></div><p>{account ? "Synced to your account." : "Sign in with your CEU Google account to view your sets."}</p></div>{sets.length > 3 && <button className="see-all" onClick={() => setShowAll(!showAll)}>{showAll ? "Show less" : "See all"} <ChevronRight size={15}/></button>}</div>
            {sets.length ? <div className="recent-grid">{sets.slice(0, showAll ? sets.length : 3).map((studySet, index) => <div className="recent-card-wrap" key={studySet.id}><button className="recent-card" onClick={() => openSavedSet(studySet)}><span className={`recent-art art-${["aqua", "coral", "gold"][index % 3]}`}><BookOpen size={18}/><span className="art-orbit"/></span><span className="recent-info"><span className="subject-label">{types.find((type) => type.id === studySet.type)?.title.toUpperCase()}</span><strong>{studySet.title}</strong><small>{studySet.items.length} cards <i>·</i> {ageLabel(studySet.created_at)}</small></span><ChevronRight size={16} className="recent-arrow"/></button><button className="recent-delete" title={`Delete ${studySet.title}`} aria-label={`Delete ${studySet.title}`} onClick={() => void removeStudySet(studySet)}><Trash2 size={15}/></button></div>)}</div> : <div className="empty-sets"><Layers3 size={20}/><span>{account ? "Your study sets will appear here after you make one." : "Sign in with your CEU Google account to access Dawnstudy."}</span></div>}
            <div className="bottom-note"><span>✳</span> Little by little, a little becomes a lot. <i>— A study reminder</i></div>
          </section>
          <section className="voice-review" id="voice-review">
            <div className="voice-review-heading"><div><div className="result-kicker"><span/> VOICE REVIEW</div><h2>Talk it through.</h2><p>Choose a topic and a question style for a spoken, back-and-forth review.</p></div><span className="voice-mark"><Mic size={20}/></span></div>
            {!voiceActive ? <div className="voice-setup">
              <label>What topic do you want to review?<input value={voiceTopic} onChange={(event) => setVoiceTopic(event.target.value)} maxLength={200} placeholder="e.g. Cell division, pharmacology, or network layers"/></label>
              <label>Practice format<select value={voiceMode} onChange={(event) => setVoiceMode(event.target.value as VoiceMode)}><option value="multiple_choice">Multiple Choice Questions</option><option value="identification">Identification</option><option value="open_ended">Open-ended Questions</option><option value="enumeration">Enumeration</option></select></label>
              <label>Conversation model<select value={voiceModelChoice} onChange={(event) => setVoiceModelChoice(event.target.value)}><option value="auto">Auto · switch if a model is busy or limited</option>{models.map((model) => <option key={model.id} value={model.id}>{model.name} · {model.provider}</option>)}</select></label>
              <label>Voice persona<select value={voicePersona} onChange={(event) => { const value = event.target.value as VoicePersona; setVoicePersona(value); localStorage.setItem(VOICE_PERSONA_KEY, value); }}>{voicePersonas.map((persona) => <option key={persona.id} value={persona.id}>{persona.name}</option>)}</select></label>
              <div className="voice-device-choice"><label>Device voice<select value={deviceVoiceURI} onChange={(event) => { setDeviceVoiceURI(event.target.value); if (event.target.value) localStorage.setItem(VOICE_DEVICE_KEY, event.target.value); else localStorage.removeItem(VOICE_DEVICE_KEY); }}><option value="">Device default</option>{deviceVoiceURI && !deviceVoices.some((voice) => voice.voiceURI === deviceVoiceURI) && <option value={deviceVoiceURI}>Saved voice unavailable · use default</option>}{[...deviceVoices].sort((a, b) => Number(b.default) - Number(a.default) || a.name.localeCompare(b.name)).map((voice) => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} · {voice.lang}</option>)}</select></label><button className="voice-preview" type="button" disabled={!speechAvailable} onClick={() => speakVoiceReply("Hello! I’m ready to help you review.")} aria-label="Preview selected voice" title="Preview selected voice"><Volume2 size={15}/></button></div>
              <button className="voice-start" type="button" onClick={beginVoiceReview} disabled={voiceBusy}><Mic size={16}/> Start voice review</button>
              <p className="voice-privacy">Voice input is transcribed as English, with your topic used to help recognize technical terms. Choose a speaking style and device voice for replies. Audio is sent to a configured provider; its quotas or rates may apply.</p>
            </div> : <div className="voice-session">
              <div className="voice-session-bar"><div><strong>Reviewing: {voiceTopic}</strong><small>{voiceMode.replaceAll("_", " ")} · {voiceModelUsed ? "Answered by " + modelName(voiceModelUsed) : "Connecting to your selected model…"}</small></div><button type="button" className="voice-end" onClick={endVoiceReview}>End review</button></div>
              {voiceFallbackNote && <p className="voice-fallback">{voiceFallbackNote}</p>}
              <div className="voice-transcript" ref={voiceMessagesElement} role="log" aria-live="polite">
                {voiceMessages.map((turn, index) => <article className={turn.role === "assistant" ? "voice-message assistant" : "voice-message user"} key={index}><span>{turn.role === "assistant" ? "STUDY PARTNER" : "YOU"}</span><p>{turn.content}</p>{turn.role === "assistant" && <button type="button" className="voice-replay" onClick={() => speakVoiceReply(turn.content)} aria-label="Read this reply aloud"><Volume2 size={14}/> Listen</button>}</article>)}
                {voiceBusy && <p className="voice-thinking"><span className="spinner"/> Thinking of your next question…</p>}
              </div>
              <form className="voice-compose" onSubmit={(event) => { event.preventDefault(); if (!voiceBusy && voiceDraft.trim()) { void sendVoiceTurn(voiceDraft); setVoiceDraft(""); } }}>
                <button type="button" className={voiceListening ? "voice-mic listening" : "voice-mic"} onClick={() => void toggleVoiceInput()} disabled={voiceBusy && !voiceListening} aria-label={voiceListening ? "Stop recording and send" : "Record your answer"} title={voiceListening ? "Stop recording and send" : "Record your answer"}>{voiceListening ? <MicOff size={18}/> : <Mic size={18}/>}</button>
                <input value={voiceDraft} onChange={(event) => setVoiceDraft(event.target.value)} maxLength={1200} placeholder={voiceListening ? "Recording… tap mic when done (30 sec max)" : voiceTranscribing ? "Transcribing your recording…" : "Record or type your answer"} aria-label="Your reply"/>
                <button type="submit" className="voice-send" disabled={voiceBusy || !voiceDraft.trim()} aria-label="Send reply"><Send size={17}/></button>
              </form>
            </div>}
            {voiceError && <p className="voice-error" role="alert">{voiceError}</p>}
          </section>
          <section className="about-section" id="about"><div className="about-header"><div className="about-identity"><span className="eyebrow"><span/> THE PERSON BEHIND DAWNSTUDY</span><h2>Hey, I’m Devon! <span role="img" aria-label="waving hand">👋</span></h2><p>Computer Engineering Student &amp; Developer</p><strong>Centro Escolar University Manila</strong><div className="about-tags"><span>Network Engineering</span><span>Applied AI</span></div></div></div><div className="about-body"><h3>Building Dawnstudy</h3><p>I’m Jairo Devon A. Daquioag, a Computer Engineering student at Centro Escolar University Manila who enjoys building things that solve problems, no matter how small.</p><p>I created Dawnstudy with my fellow students in mind. I wanted to make studying more accessible by turning PDFs into flashcards, multiple-choice questions, identification questions, and select-all-that-apply exercises—all powered by free-tier AI models.</p><p>I’m a tech generalist at heart, with a particular interest in Network Engineering and Applied AI. I enjoy exploring technology, experimenting with different AI models, and finding practical ways to use them to make everyday tasks easier.</p><p>For me, technology isn’t just about building something impressive. It’s about building something useful, especially when it can help others without costing them anything.</p></div><div className="about-links"><h3>Let’s connect</h3><a href="https://www.linkedin.com/in/jairo-devon-daquioag-466124295/" target="_blank" rel="noreferrer"><span className="social-mark">in</span><span><strong>LinkedIn</strong><small>Jairo Devon Daquioag</small></span><span className="external-mark">↗</span></a><a href="https://www.instagram.com/jairodaquioag/" target="_blank" rel="noreferrer"><span className="social-mark">◎</span><span><strong>Instagram</strong><small>@jairodaquioag</small></span><span className="external-mark">↗</span></a><a href="mailto:daquioagjairodevon@gmail.com"><span className="social-mark">✉</span><span><strong>Email</strong><small>daquioagjairodevon@gmail.com</small></span><span className="external-mark">↗</span></a></div></section>
        </div>
      </section>

      {authOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setAuthOpen(false); setAuthError(""); } }}>
        <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
          <button className="modal-close" aria-label="Close" onClick={() => { setAuthOpen(false); setAuthError(""); }}><X size={18}/></button>
          <div className="auth-mark"><Sparkles size={19}/></div>
          <p className="auth-eyebrow">YOUR STUDY SPACE</p>
          <h2 id="auth-title">Sign in with Google</h2>
          <p className="auth-subtitle">Dawnstudy is currently for Centro Escolar University students. Use your verified Google account ending in <b>@ceu.edu.ph</b>, <b>@mnl.ceu.edu.ph</b>, <b>@mkt.ceu.edu.ph</b>, or <b>@mls.ceu.edu.ph</b>. Access is limited to conserve AI tokens.</p>
          {GOOGLE_CLIENT_ID ? <div className="google-button-wrap"><div ref={googleButton}/></div> : <div className="google-not-ready">Google sign-in is not configured yet. Please try again later.</div>}
          {authError && <div className="auth-error">{authError}</div>}
        </section>
      </div>}
    </main>
  );
}
