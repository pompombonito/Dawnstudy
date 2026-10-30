"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import Avatar from "./components/Avatar";
import { useCommunity } from "./community/useCommunity";
import { communityApi } from "./community/api";
import type { Theme } from "./community/types";
import Onboarding from "./community/Onboarding";
import ProfilePage from "./community/ProfilePage";
import FriendsPage from "./community/FriendsPage";
import GameRoom from "./community/GameRoom";
import CompanionDock from "./community/CompanionDock";
import Agreement from "./community/Agreement";
import { DawnArtwork, DawnMark } from "./components/DawnArtwork";
import { findGenerationJob, GenerationJobError, pollGenerationJob, startGenerationJob, type GenerationJob, type GenerationStatus } from "./generation-jobs";
import {
  AlarmClock, BookOpen, Check, CheckSquare, ChevronLeft, ChevronRight, CircleHelp, Clock3,
  CloudUpload, Copy, Cpu, ExternalLink, FileText, Flag, Globe2, GraduationCap, Layers3, LogOut, Menu, Mic,
  MicOff, Moon, Maximize2, Minimize2, Plus, Send, Share2, Sparkles, Sun, Trash2, UserRound,
  Search, Volume2, X, ArrowUpRight, ArrowRight, FolderOpen, ChevronDown, Leaf, Users, Gamepad2, ShieldCheck, Youtube,
} from "lucide-react";

type Kind = "flashcards" | "multiple_choice" | "checkbox" | "identification";
type Card = { card_id?: string; question: string; answer: string; options?: string[]; correct_answer?: string; explanation?: string; source_refs?: string[] };
type StudySet = { id: string; title: string; type: Kind; items: Card[]; sources?: { title: string; url: string }[]; source_url?: string; created_at: string; material_fingerprint?: string; page_ranges?: Record<string, string>; focus_topic?: string; previous_question_count?: number; model?: string; models_used?: string[]; fallback?: { from: string; to: string; reason: string } | null; incomplete?: boolean; requested_count?: number; usage?: { remaining: number | null; limit: number | null; resets_at: string; unlimited?: boolean } };
type ActiveShare = { set_id: string; title: string; token: string; created_at: string };
type ReviewItem = { study_set_id: string; study_set_title: string; type: Kind; card: Card; retried?: boolean; intervals: { again: string; hard: string; good: string; easy: string } };
type Progress = { total_reviews: number; reviewed_today: number; accuracy: number; current_streak: number; best_streak: number; due_count: number; total_cards: number; week: { date: string; reviews: number }[] };
type Account = { id: string; username: string; email: string; display_name: string };
type LoginResult = { token: string; user: Account };
type ModelOption = { id: string; provider: string; name: string };
type MaterialSearchResult = { title: string; url: string; snippet: string; file_type: string };
type PracticeAnswer = string | string[] | null;
type WorkspaceView = "study" | "library" | "finder" | "voice" | "about" | "friends" | "games" | "profile" | "agreement";
type GenerationResult = StudySet & { auto_model?: string; auto_reason?: string; persistence_error?: string; continued_set_id?: string };
type PendingGeneration = { job_id: string; base?: StudySet };
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
const UNLIMITED_GENERATION_EMAILS = new Set([
  "hipolito2213611@ceu.edu.ph",
  "daquioag2200174@ceu.edu.ph",
  "corpuz2580868@mnl.ceu.edu.ph",
  "macaldo2214944@ceu.edu.ph",
]);
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
const TOKEN_KEY = "dawnstudy_session_v1";
const THEME_KEY = "dawnstudy_theme_v1";
const VOICE_PERSONA_KEY = "dawnstudy_voice_persona_v1";
const VOICE_DEVICE_KEY = "dawnstudy_device_voice_v1";
const GENERATION_KEY = "dawnstudy_generation_v1:";

function pendingGeneration(userId: string): PendingGeneration | null {
  try {
    const value = JSON.parse(localStorage.getItem(GENERATION_KEY + userId) || "null");
    if (typeof value?.job_id !== "string") return null;
    const base = value.base && typeof value.base.id === "string" && Array.isArray(value.base.items)
      && value.base.items.every((item: Card) => typeof item?.question === "string") ? value.base as StudySet : undefined;
    return { job_id: value.job_id, base };
  } catch { return null; }
}

function rememberGeneration(userId: string, pending: PendingGeneration | null) {
  try {
    if (pending) localStorage.setItem(GENERATION_KEY + userId, JSON.stringify(pending));
    else localStorage.removeItem(GENERATION_KEY + userId);
  } catch { /* Account job discovery also works when device storage is unavailable. */ }
}
const supportedFiles = new Set(["pdf", "pptx", "docx", "txt", "md", "png", "jpg", "jpeg", "webp"]);
const maxFileBytes = 15 * 1024 * 1024;
const maxCombinedFileBytes = 30 * 1024 * 1024;
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

function choiceAnswerOptions(answer: unknown, options: string[]) {
  const resolved: string[] = [];
  for (const part of String(answer ?? "").split("|").map((value) => value.trim()).filter(Boolean)) {
    const letter = part.match(/^(?:option\s*)?([A-D])(?:[.):\-])?$/i);
    let match = letter ? options[letter[1].toUpperCase().charCodeAt(0) - 65] : options.find((option) => normalizedAnswer(option) === normalizedAnswer(part));
    if (!match && part) {
      const left = Array.from(normalizedAnswer(part));
      const ranked = options.map((option) => {
        const right = Array.from(normalizedAnswer(option));
        let previous = new Uint16Array(right.length + 1);
        for (const leftChar of left) {
          const current = new Uint16Array(right.length + 1);
          for (let index = 1; index <= right.length; index += 1) {
            current[index] = leftChar === right[index - 1] ? previous[index - 1] + 1 : Math.max(previous[index], current[index - 1]);
          }
          previous = current;
        }
        return { option, similarity: left.length + right.length ? 2 * previous[right.length] / (left.length + right.length) : 0 };
      }).sort((a, b) => b.similarity - a.similarity);
      if (ranked[0]?.similarity >= 0.9 && (!ranked[1] || ranked[0].similarity - ranked[1].similarity >= 0.08)) match = ranked[0].option;
    }
    if (!match) return [];
    if (!resolved.some((option) => normalizedAnswer(option) === normalizedAnswer(match))) resolved.push(match);
  }
  return resolved;
}

function displayCorrectAnswer(card: Card) {
  const answer = card.correct_answer || card.answer;
  const resolved = choiceAnswerOptions(answer, card.options || []);
  return resolved.length ? resolved.join(" | ") : answer;
}

function isPracticeAnswerCorrect(card: Card, type: Kind, response: PracticeAnswer | undefined) {
  if (response === null || response === undefined) return false;
  const rawExpected = card.correct_answer || card.answer || "";
  const resolved = choiceAnswerOptions(rawExpected, card.options || []);
  const expected = (resolved.length ? resolved : String(rawExpected).split("|")).map(normalizedAnswer).filter(Boolean).sort();
  if (type === "checkbox") {
    const actual = (Array.isArray(response) ? response : [response]).map(normalizedAnswer).filter(Boolean).sort();
    return actual.length === expected.length && actual.every((answer, index) => answer === expected[index]);
  }
  const actual = Array.isArray(response) ? response[0] || "" : response;
  return expected.includes(normalizedAnswer(actual));
}

function displayPracticeAnswer(response: PracticeAnswer | undefined) {
  return Array.isArray(response) ? response.join(" · ") : response || "No answer";
}

function shuffleSavedItems(items: Card[], kind: Kind) {
  let previousCorrectIndex: number | null = null;
  return shuffleItems(items).map((card) => {
    const options = [...(card.options || [])];
    if (options.length < 2 || (kind !== "multiple_choice" && kind !== "checkbox")) return card;
    const correctOptions = choiceAnswerOptions(card.correct_answer || card.answer, options);
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
      ...(correctOptions.length ? { correct_answer: correctOptions.join(" | "), answer: correctOptions.join(" | ") } : {}),
    };
  });
}

export default function Home() {
  const [selected, setSelected] = useState<Kind>("flashcards");
  const [files, setFiles] = useState<File[]>([]);
  const [pageRanges, setPageRanges] = useState<Record<string, string>>({});
  const [websitePageRange, setWebsitePageRange] = useState("");
  const [focusTopic, setFocusTopic] = useState("");
  const [sourceMode, setSourceMode] = useState<"file" | "website" | "youtube">("file");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [finderTopic, setFinderTopic] = useState("");
  const [finderSubject, setFinderSubject] = useState("");
  const [finderTitle, setFinderTitle] = useState("");
  const [finderTags, setFinderTags] = useState("");
  const [finderResults, setFinderResults] = useState<MaterialSearchResult[]>([]);
  const [finderBusy, setFinderBusy] = useState(false);
  const [finderError, setFinderError] = useState("");
  const [finderSearched, setFinderSearched] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [web, setWeb] = useState(false);
  const [modelChoice, setModelChoice] = useState("auto");
  const [questionCount, setQuestionCount] = useState(10);
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard">("medium");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [theme, setTheme] = useState<Theme>("dark");
  const [activeView, setActiveView] = useState<WorkspaceView>("study");
  const [composerStep, setComposerStep] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [friendToOpen, setFriendToOpen] = useState("");
  const [gameSet, setGameSet] = useState("");
  const [busy, setBusy] = useState(false);
  const [continueBusy, setContinueBusy] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus | null>(null);
  const [generationNeedsReconnect, setGenerationNeedsReconnect] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<StudySet | null>(null);
  const [current, setCurrent] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [studySelectedOptions, setStudySelectedOptions] = useState<string[]>([]);
  const [reviewSelectedOptions, setReviewSelectedOptions] = useState<string[]>([]);
  const [studyIdentificationAnswer, setStudyIdentificationAnswer] = useState("");
  const [reviewIdentificationAnswer, setReviewIdentificationAnswer] = useState("");
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
  const [activeShares, setActiveShares] = useState<ActiveShare[]>([]);
  const [siteOrigin, setSiteOrigin] = useState("");
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
  const community = useCommunity(authToken, account?.id);
  const hasUnlimitedGenerations = account ? UNLIMITED_GENERATION_EMAILS.has(account.email.trim().toLowerCase()) : false;
  const [authOpen, setAuthOpen] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const replaceFilesOnPick = useRef(false);
  const googleButton = useRef<HTMLDivElement>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const microphoneStream = useRef<MediaStream | null>(null);
  const recordingChunks = useRef<BlobPart[]>([]);
  const recordingTimeout = useRef<number | null>(null);
  const voiceMessagesElement = useRef<HTMLDivElement>(null);
  const practicePanel = useRef<HTMLElement>(null);
  const voiceSessionId = useRef(0);
  const generationController = useRef<AbortController | null>(null);

  async function loadAccountSets(token: string) {
    if (!API_BASE) return;
    try {
      const response = await fetch(`${API_BASE}/api/study-sets`, { headers: { Authorization: `Bearer ${token}` } });
      if (response.ok) {
        const saved: StudySet[] = await response.json();
        setSets(saved);
      }
    } catch { /* Auth can still be used if study-set sync is briefly unavailable. */ }
    void loadProgress(token);
    void loadActiveLinks(token);
  }

  async function loadActiveLinks(token: string) {
    try {
      const response = await fetch(`${API_BASE}/api/study-shares`, { headers: { Authorization: `Bearer ${token}` } });
      if (response.ok) setActiveShares(await response.json());
    } catch { /* Active links can be refreshed when the account API is available. */ }
  }

  async function loadProgress(token: string) {
    try {
      const response = await fetch(`${API_BASE}/api/progress`, { headers: { Authorization: `Bearer ${token}` } });
      if (response.ok) setProgress(await response.json());
    } catch { /* Progress remains available when the Sheets API is reachable again. */ }
  }

  useEffect(() => {
    setSiteOrigin(window.location.origin);
    const savedTheme = localStorage.getItem(THEME_KEY);
    const initialTheme: Theme = savedTheme === "light" || savedTheme === "rose" ? savedTheme : "dark";
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
      .catch(() => { localStorage.removeItem(TOKEN_KEY); setAuthToken(""); setAccount(null); setActiveShares([]); });
  }, []);

  useEffect(() => {
    if (!authToken || !account?.id) return;
    void restoreGeneration(authToken, account.id);
    return () => {
      generationController.current?.abort();
      generationController.current = null;
    };
  }, [authToken, account?.id]);

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
      window.google.accounts.id.renderButton(googleButton.current, { theme: "outline", size: "large", shape: "rectangular", text: "continue_with", width: Math.min(320, googleButton.current.clientWidth || 320) });
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
    if (!authOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = document.querySelector<HTMLElement>(".auth-modal");
    const focusFrame = window.requestAnimationFrame(() => dialog?.querySelector<HTMLButtonElement>(".modal-close")?.focus());
    const handleDialogKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setAuthOpen(false); setAuthError(""); return; }
      if (event.key !== "Tab" || !dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), iframe, [tabindex="0"]'));
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", handleDialogKey);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleDialogKey);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [authOpen]);

  useEffect(() => {
    if (!practiceActive || practiceComplete || practiceSecondsPerQuestion === 0) return;
    if (practiceTimeLeft <= 0) { setPracticeComplete(true); return; }
    const timeout = window.setTimeout(() => setPracticeTimeLeft((seconds) => seconds - 1), 1000);
    return () => window.clearTimeout(timeout);
  }, [practiceActive, practiceComplete, practiceTimeLeft, practiceSecondsPerQuestion]);

  useEffect(() => {
    const syncFullscreenState = () => setIsFullscreen(document.fullscreenElement === practicePanel.current);
    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, []);

  useEffect(() => {
    voiceMessagesElement.current?.scrollTo({ top: voiceMessagesElement.current.scrollHeight, behavior: "smooth" });
  }, [voiceMessages]);

  async function toggleExerciseFullscreen() {
    if (document.fullscreenElement === practicePanel.current) {
      try { await document.exitFullscreen(); }
      catch { setNotice("Could not exit fullscreen. Press Esc to leave fullscreen mode."); }
      return;
    }
    if (!practicePanel.current?.requestFullscreen) {
      setNotice("Fullscreen is not supported in this browser.");
      return;
    }
    try { await practicePanel.current.requestFullscreen(); }
    catch { setNotice("Fullscreen was blocked by the browser. Use the fullscreen button to try again."); }
  }

  function acceptLogin(data: LoginResult) {
    localStorage.setItem(TOKEN_KEY, data.token);
    setAuthToken(data.token); setAccount(data.user); setActiveShares([]); setAuthOpen(false);
    setAuthError(""); setError(""); setFinderError(""); setNotice(`Welcome, ${data.user.display_name || data.user.username}. Your sets will sync to your account.`);
    void loadAccountSets(data.token);
  }

  function selectFiles(incoming?: FileList | File[]) {
    const additions = Array.from(incoming || []);
    if (!additions.length) return;
    const valid = additions.filter((candidate) => {
      const extension = candidate.name.split(".").pop()?.toLowerCase() || "";
      return supportedFiles.has(extension) && candidate.size > 0 && candidate.size <= maxFileBytes;
    });
    const invalidCount = additions.length - valid.length;
    const next = replaceFilesOnPick.current ? [] : [...files];
    replaceFilesOnPick.current = false;
    for (const candidate of valid) {
      const duplicate = next.some((currentFile) =>
        currentFile.name === candidate.name && currentFile.size === candidate.size && currentFile.lastModified === candidate.lastModified,
      );
      if (!duplicate) next.push(candidate);
    }
    if (next.length > 5) { setError("Choose up to five files per study set."); return; }
    if (next.reduce((total, candidate) => total + candidate.size, 0) > maxCombinedFileBytes) {
      setError("Keep the combined file size under 30 MB. Each file can be up to 15 MB.");
      return;
    }
    if (!next.length) {
      setError(invalidCount ? "Choose supported, nonempty files up to 15 MB each (30 MB total)." : "Choose at least one study material.");
      return;
    }
    setSourceMode("file");
    setActiveView("study");
    setComposerStep(0);
    setFiles(next); setError(invalidCount ? "Some files were skipped. Use PDF, PPTX, DOCX, TXT, MD, or an image up to 15 MB." : ""); setNotice("");
    if (!result?.incomplete) setResult(null);
    setSelectedOption(null); setStudySelectedOptions([]); setStudyIdentificationAnswer("");
  }

  function removeFile(index: number) {
    setFiles((old) => old.filter((_, position) => position !== index));
    setPageRanges((old) => Object.fromEntries(Object.entries(old).flatMap(([key, value]) => {
      const oldIndex = Number(key);
      if (oldIndex === index) return [];
      return [[String(oldIndex > index ? oldIndex - 1 : oldIndex), value]];
    })));
    setError("");
  }

  useEffect(() => {
    if (community.data?.profile?.theme) setColorTheme(community.data.profile.theme);
  }, [community.data?.profile?.theme]);

  useEffect(() => {
    if (authToken && community.data?.profile?.onboarded) void loadAccountSets(authToken);
  }, [authToken, community.data?.profile?.onboarded]);

  function setColorTheme(nextTheme: Theme) {
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem(THEME_KEY, nextTheme);
  }

  function navigateTo(view: WorkspaceView) {
    setMoreOpen(false);
    setActiveView(view);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function pickStudyFiles() {
    replaceFilesOnPick.current = false;
    setActiveView("study");
    setSourceMode("file");
    setComposerStep(0);
    input.current?.click();
  }

  function pickOriginalFiles() {
    replaceFilesOnPick.current = true;
    input.current?.click();
  }

  function beginStudySet() {
    setResult(null);
    setReviewActive(false);
    setPracticeActive(false);
    setPracticeComplete(false);
    setComposerStep(0);
    resetStudyAnswer();
    setError("");
    setNotice("");
    navigateTo("study");
  }


  function resetStudyAnswer() {
    setRevealed(false);
    setSelectedOption(null);
    setStudySelectedOptions([]);
    setStudyIdentificationAnswer("");
  }

  function resetReviewAnswer() {
    setRevealed(false);
    setSelectedOption(null);
    setReviewSelectedOptions([]);
    setReviewIdentificationAnswer("");
  }

  function navigateToLibrarySection(sectionId: string) {
    setActiveView("library");
    window.setTimeout(() => document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }

  function generationOptions(token: string, controller: AbortController) {
    return { baseUrl: API_BASE, token, signal: controller.signal };
  }

  async function acknowledgeGeneration(jobId: string, token: string, signal: AbortSignal) {
    try {
      await fetch(API_BASE + "/api/generation-jobs/" + encodeURIComponent(jobId) + "/acknowledge", {
        method: "POST", headers: { Authorization: "Bearer " + token }, signal,
      });
    } catch { /* The same completed set can be recovered if acknowledgement is interrupted. */ }
  }

  async function applyGenerationResult(data: GenerationResult, token: string, signal: AbortSignal, base?: StudySet) {
    let studySet: GenerationResult = { ...data, id: data.id || crypto.randomUUID(), created_at: data.created_at || new Date().toISOString() };
    const legacyContinuation = base && data.continued_set_id !== base.id;
    if (legacyContinuation) {
      const target = base.requested_count || base.items.length;
      const seen = new Set<string>();
      const items = [...base.items, ...data.items].filter((item) => {
        const key = normalizedAnswer(item.question);
        if (!key || seen.has(key) || seen.size >= target) return false;
        seen.add(key); return true;
      });
      studySet = { ...base, ...data, id: base.id, title: base.title, created_at: base.created_at, items,
        requested_count: target, incomplete: items.length < target, page_ranges: base.page_ranges, focus_topic: base.focus_topic,
        sources: [...new Map([...(base.sources || []), ...(data.sources || [])].map((source) => [source.url, source] as const)).values()].slice(0, 20) };
    }
    if (signal.aborted) throw new DOMException("Generation monitoring stopped.", "AbortError");
    setActiveView("study"); setSelected(studySet.type); setResult(studySet); setCurrent(0);
    resetStudyAnswer(); resetReviewAnswer(); setReviewActive(false); setPracticeActive(false); setPracticeComplete(false); setShareUrl("");
    setFocusTopic(studySet.focus_topic || "");
    if (studySet.source_url) {
      setSourceMode("website"); setWebsiteUrl(studySet.source_url); setWebsitePageRange(studySet.page_ranges?.["0"] || "");
    } else { setSourceMode("file"); setPageRanges(studySet.page_ranges || {}); }
    let synced = true;
    if (!data.id || data.persistence_error || legacyContinuation) {
      try {
        const body = JSON.stringify({ title: studySet.title, type: studySet.type, items: studySet.items,
          sources: studySet.sources || [], source_url: studySet.source_url || "", material_fingerprint: studySet.material_fingerprint,
          incomplete: studySet.incomplete || false, requested_count: studySet.requested_count || studySet.items.length,
          page_ranges: studySet.page_ranges || {}, focus_topic: studySet.focus_topic || "" });
        const headers = { "Content-Type": "application/json", Authorization: "Bearer " + token };
        const updateExisting = Boolean(data.id || legacyContinuation);
        let saved = await fetch(API_BASE + "/api/study-sets" + (updateExisting ? "/" + encodeURIComponent(studySet.id) : ""), {
          method: updateExisting ? "PUT" : "POST", headers, body, signal,
        });
        if (saved.status === 404 && updateExisting) saved = await fetch(API_BASE + "/api/study-sets", { method: "POST", headers, body, signal });
        if (!saved.ok) throw new Error(await responseError(saved));
        studySet = { ...studySet, ...await saved.json(), persistence_error: undefined };
        if (signal.aborted) throw new DOMException("Generation monitoring stopped.", "AbortError");
        setResult(studySet);
      } catch (caught) {
        if (signal.aborted) throw caught;
        synced = false;
        setError("Your questions are ready, but account sync is unavailable: " + (caught instanceof Error ? caught.message : "try again later.") + " Refreshing will retry saving these questions.");
      }
    }
    if (signal.aborted) throw new DOMException("Generation monitoring stopped.", "AbortError");
    if (synced) setSets((old) => [studySet, ...old.filter((item) => item.id !== studySet.id && item.id !== base?.id)].slice(0, 100));
    const notices = [studySet.incomplete
      ? `${studySet.items.length} of ${studySet.requested_count || studySet.items.length} questions are saved. Continue generating when you are ready.`
      : `Your study set is ready with ${studySet.items.length} questions.`];
    if (data.auto_model) notices.push("Auto chose " + modelName(data.auto_model) + ".");
    if (data.fallback) notices.push(modelName(data.fallback.to) + " helped complete the generation.");
    if (data.usage?.remaining !== null && data.usage?.remaining !== undefined) notices.push(`${data.usage.remaining} of ${data.usage.limit} generations left today.`);
    setNotice(notices.join(" "));
    void loadProgress(token);
    return synced;
  }

  async function watchGeneration(job: GenerationJob<GenerationResult>, pending: PendingGeneration, token: string, userId: string, controller: AbortController) {
    rememberGeneration(userId, pending);
    setGenerationNeedsReconnect(false);
    const data = await pollGenerationJob(job.job_id, generationOptions(token, controller), (status) => {
      if (controller.signal.aborted) return;
      setGenerationStatus((old) => status.completed < 0
        ? { ...status, completed: old?.completed || 0, requested: old?.requested || 0, model: old?.model }
        : status);
    }, job);
    const synced = await applyGenerationResult(data, token, controller.signal, pending.base);
    if (synced) {
      rememberGeneration(userId, null);
      await acknowledgeGeneration(job.job_id, token, controller.signal);
    }
    if (!controller.signal.aborted) {
      setGenerationNeedsReconnect(!synced);
      setGenerationStatus(synced ? null : {
        status: "paused", stage: "saving", message: "Your questions are ready. Reconnect to retry saving them to your account.",
        completed: data.items.length, requested: data.requested_count || data.items.length,
      });
    }
  }

  async function generationFailure(caught: unknown, userId: string, token: string, controller: AbortController, jobId?: string) {
    if (controller.signal.aborted) return;
    const message = caught instanceof Error ? caught.message : "Could not connect to the generation service.";
    setError(message);
    if (caught instanceof GenerationJobError && caught.terminal) {
      rememberGeneration(userId, null); setGenerationStatus(null); setGenerationNeedsReconnect(false);
      if (jobId) await acknowledgeGeneration(jobId, token, controller.signal);
    } else {
      setGenerationNeedsReconnect(true);
      setGenerationStatus((old) => ({ status: "paused", stage: "reconnecting", message: "Reconnect to restore your generation's progress.",
        completed: old?.completed || 0, requested: old?.requested || 0, model: old?.model }));
    }
  }

  function releaseGeneration(controller: AbortController) {
    if (generationController.current !== controller) return;
    generationController.current = null;
    setBusy(false); setContinueBusy(false);
  }

  async function runGeneration(form: FormData, base?: StudySet) {
    if (!account || !authToken || generationController.current) return;
    if (!API_BASE) { setError("The API address is not configured for this site."); setBusy(false); setContinueBusy(false); return; }
    const token = authToken, userId = account.id, controller = new AbortController();
    generationController.current = controller;
    setBusy(!base); setContinueBusy(Boolean(base)); setError(""); setNotice(""); setGenerationNeedsReconnect(false);
    let jobId: string | undefined;
    try {
      const job = await startGenerationJob<GenerationResult>(form, generationOptions(token, controller));
      jobId = job.job_id;
      const previous = pendingGeneration(userId);
      const pending = previous?.job_id === jobId ? previous : { job_id: jobId, base: job.resumed ? undefined : base };
      await watchGeneration(job, pending, token, userId, controller);
    } catch (caught) { await generationFailure(caught, userId, token, controller, jobId); }
    finally { releaseGeneration(controller); }
  }

  async function restoreGeneration(token: string, userId: string) {
    if (!API_BASE || generationController.current) return;
    const controller = new AbortController();
    generationController.current = controller;
    setBusy(true); setGenerationNeedsReconnect(false); setError("");
    let jobId: string | undefined;
    try {
      const previous = pendingGeneration(userId);
      let job = await findGenerationJob<GenerationResult>(generationOptions(token, controller));
      if (!job && previous) job = await findGenerationJob<GenerationResult>(generationOptions(token, controller), previous.job_id);
      if (!job) {
        rememberGeneration(userId, null); setGenerationStatus(null);
        if (previous) {
          setNotice("This generation is no longer running. Check My Library for its saved study set.");
          void loadAccountSets(token);
        }
        return;
      }
      jobId = job.job_id;
      setError("");
      const pending = previous?.job_id === jobId ? previous : { job_id: jobId };
      await watchGeneration(job, pending, token, userId, controller);
    } catch (caught) { await generationFailure(caught, userId, token, controller, jobId); }
    finally { releaseGeneration(controller); }
  }

  async function generate() {
    if (busy || continueBusy || generationNeedsReconnect || generationController.current) return;
    if (!authToken || !account) {
      setAuthOpen(true);
      setError("Sign in with your verified CEU Google account (@ceu.edu.ph, @mnl.ceu.edu.ph, @mkt.ceu.edu.ph, or @mls.ceu.edu.ph) to make a study set.");
      return;
    }
    if (sourceMode === "file" && !files.length) { setComposerStep(0); setError("Choose at least one study material first."); return; }
    if (sourceMode !== "file" && !websiteUrl.trim()) { setComposerStep(0); setError("Paste a public website link first."); return; }
    setBusy(true); setError(""); setNotice("");
    setGenerationStatus({ status: "queued", stage: "queued", message: "Joining the study queue…", completed: 0, requested: questionCount });
    const form = new FormData();
    if (sourceMode === "file") files.forEach((selectedFile) => form.append("files", selectedFile));
    else form.append("source_url", websiteUrl.trim());
    form.append("format", selected); form.append("use_web", String(web));
    form.append("model", modelChoice);
    form.append("question_count", String(questionCount));
    form.append("difficulty", difficulty);
    const requestPageRanges = sourceMode === "file"
      ? Object.fromEntries(Object.entries(pageRanges).filter(([, value]) => value.trim()))
      : websitePageRange.trim() ? { "0": websitePageRange.trim() } : {};
    form.append("page_ranges", JSON.stringify(requestPageRanges));
    form.append("focus_topic", focusTopic.trim());
    await runGeneration(form);
  }

  async function searchMaterials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFinderError("");
    setFinderSearched(false);
    setFinderResults([]);
    if (!authToken || !account) {
      setFinderError("Sign in with your CEU Google account to search for learning materials.");
      setAuthOpen(true);
      return;
    }
    if (![finderTopic, finderSubject, finderTitle, finderTags].some((value) => value.trim())) {
      setFinderError("Enter a topic, subject, title, or tag to search.");
      return;
    }
    if (!API_BASE) {
      setFinderError("The API address is not configured for this site.");
      return;
    }

    setFinderBusy(true);
    try {
      const response = await fetch(`${API_BASE}/api/material-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ topic: finderTopic, subject: finderSubject, title: finderTitle, tags: finderTags }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const data = await response.json();
      setFinderResults(Array.isArray(data.results) ? data.results : []);
      setFinderSearched(true);
    } catch (caught) {
      setFinderResults([]);
      setFinderError(caught instanceof Error ? caught.message : "Search is temporarily unavailable. Please try again.");
    } finally {
      setFinderBusy(false);
    }
  }

  function useFinderMaterial(resource: MaterialSearchResult) {
    setActiveView("study");
    setResult(null);
    setReviewActive(false);
    setPracticeActive(false);
    setComposerStep(0);
    setSourceMode("website");
    setWebsiteUrl(resource.url);
    setWebsitePageRange("");
    setError("");
    window.setTimeout(() => document.getElementById("study-source-toggle")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  }

  async function continueGenerating() {
    if (!result || !result.incomplete || busy || continueBusy || generationNeedsReconnect || generationController.current) return;
    if (!files.length && !result.source_url) {
      setError("Upload the original study material to continue generating this set.");
      return;
    }
    const targetCount = result.requested_count || result.items.length;
    const remainingCount = targetCount - result.items.length;
    if (remainingCount <= 0) {
      setResult({ ...result, incomplete: false });
      return;
    }
    setContinueBusy(true); setError(""); setNotice("");
    setGenerationStatus({ status: "queued", stage: "queued", message: "Joining the study queue…", completed: result.items.length, requested: targetCount });
    const form = new FormData();
    if (result.source_url) form.append("source_url", result.source_url);
    else files.forEach((selectedFile) => form.append("files", selectedFile));
    form.append("format", result.type);
    form.append("use_web", String(web));
    form.append("model", modelChoice);
    form.append("question_count", String(remainingCount));
    form.append("difficulty", difficulty);
    form.append("page_ranges", JSON.stringify(result.page_ranges || (result.source_url ? (websitePageRange.trim() ? { "0": websitePageRange.trim() } : {}) : Object.fromEntries(Object.entries(pageRanges).filter(([, value]) => value.trim())))));
    form.append("focus_topic", result.focus_topic || focusTopic.trim());
    form.append("existing_questions", JSON.stringify(result.items.map((item) => item.question)));
    if (result.material_fingerprint) form.append("expected_material_fingerprint", result.material_fingerprint);
    if (sets.some((item) => item.id === result.id)) form.append("study_set_id", result.id);
    await runGeneration(form, result);
  }

  function signOut() {
    if (authToken && community.data?.profile?.onboarded) void communityApi(authToken, "/presence", undefined, "DELETE").catch(() => {});
    setActiveView("study");
    generationController.current?.abort(); generationController.current = null;
    setBusy(false); setContinueBusy(false); setGenerationStatus(null); setGenerationNeedsReconnect(false);
    localStorage.removeItem(TOKEN_KEY); setAuthToken(""); setAccount(null); setSets([]); setActiveShares([]); setResult(null); setProgress(null); setReviewActive(false); setReviewQueue([]);
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
      setActiveShares((old) => old.filter((share) => share.set_id !== studySet.id));
      setResult((old) => old?.id === studySet.id ? null : old);
      void loadProgress(authToken);
      setNotice(`“${studySet.title}” was deleted.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not delete this study set."); }
  }

  function openSavedSet(studySet: StudySet) {
    setActiveView("study");
    if (studySet.incomplete && !studySet.source_url) setFiles([]);
    setSourceMode(studySet.source_url ? /(?:youtube\.com|youtu\.be)/i.test(studySet.source_url) ? "youtube" : "website" : "file");
    if (studySet.source_url) setWebsiteUrl(studySet.source_url);
    setReviewActive(false); setPracticeActive(false); setPracticeComplete(false); setShareUrl(""); setResult({ ...studySet, items: shuffleSavedItems(studySet.items, studySet.type) }); setSelected(studySet.type); setCurrent(0); resetStudyAnswer(); resetReviewAnswer(); setPageRanges(studySet.source_url ? {} : studySet.page_ranges || {}); setWebsitePageRange(studySet.source_url ? studySet.page_ranges?.["0"] || "" : ""); setFocusTopic(studySet.focus_topic || ""); setError(""); setNotice("");
    window.requestAnimationFrame(() => document.querySelector(".result-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function startPractice() {
    if (!result) return;
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
      await loadActiveLinks(authToken);
      try { await navigator.clipboard.writeText(url); setNotice("Share link copied. Anyone who has it can view this set until you turn the link off."); }
      catch { setNotice("Share link created. Anyone who has it can view this set until you turn the link off."); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create a share link."); }
    finally { setShareBusy(false); }
  }

  async function turnOffShareLink(setId: string) {
    if (!authToken) return;
    setShareBusy(true); setError("");
    try {
      const response = await fetch(`${API_BASE}/api/study-sets/${encodeURIComponent(setId)}/share`, { method: "DELETE", headers: { Authorization: `Bearer ${authToken}` } });
      if (!response.ok) throw new Error(await responseError(response));
      setActiveShares((old) => old.filter((share) => share.set_id !== setId));
      if (result?.id === setId) setShareUrl("");
      setNotice("The share link has been turned off.");
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
    setActiveView("study");
    if (!authToken) { setAuthOpen(true); return; }
    setError("");
    try {
      const response = await fetch(`${API_BASE}/api/reviews/due?limit=50`, { headers: { Authorization: `Bearer ${authToken}` } });
      if (!response.ok) throw new Error(await responseError(response));
      const data = await response.json();
      setReviewQueue(data.items || []); setReviewActive(true); setResult(null); setRevealed(false); setSelectedOption(null); setReviewSelectedOptions([]); setReviewIdentificationAnswer("");
      window.requestAnimationFrame(() => document.querySelector(".review-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }));
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
      setRevealed(false); setSelectedOption(null); setReviewSelectedOptions([]); setReviewIdentificationAnswer(""); void loadProgress(authToken);
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
      setCurrent((index) => (index + 1) % result.items.length); setRevealed(false); setSelectedOption(null); setStudySelectedOptions([]); setStudyIdentificationAnswer("");
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
    const correctOptions = choiceAnswerOptions(card.correct_answer || card.answer, card.options || []);
    const correctAnswers = correctOptions.length ? correctOptions.map(normalizedAnswer) : [normalizedAnswer(card.correct_answer || card.answer)];
    const isCorrect = (option: string) => correctAnswers.includes(normalizedAnswer(option));
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

  function renderCheckboxQuiz(card: Card, isReview = false) {
    const selectedAnswers = isReview ? reviewSelectedOptions : studySelectedOptions;
    const setSelectedAnswers = isReview ? setReviewSelectedOptions : setStudySelectedOptions;
    const correctOptions = choiceAnswerOptions(card.correct_answer || card.answer, card.options || []);
    const correctKeys = correctOptions.map(normalizedAnswer);
    const isCorrect = (option: string) => correctKeys.includes(normalizedAnswer(option));
    const typedAnswer = isReview ? reviewIdentificationAnswer : studyIdentificationAnswer;
    const setTypedAnswer = isReview ? setReviewIdentificationAnswer : setStudyIdentificationAnswer;
    const exact = card.options?.length
      ? selectedAnswers.length === correctOptions.length && selectedAnswers.every(isCorrect)
      : isPracticeAnswerCorrect(card, "checkbox", typedAnswer);
    return <div className={"study-face choice-study-face" + (revealed ? " is-revealed" : "")}>
      <span className="face-label">{revealed ? "ANSWER FEEDBACK" : "SELECT EVERY CORRECT ANSWER"}</span>
      <span className="face-question">{card.question}</span>
      {card.options?.length ? <div className="choice-options" role="group" aria-label="Choose all correct answers">{card.options.map((option, index) => {
        const picked = selectedAnswers.includes(option);
        const correct = isCorrect(option);
        const status = revealed ? correct ? "choice-correct" : picked ? "choice-wrong" : "" : "";
        return <button type="button" key={String(index) + "-" + option} className={"choice-option " + status + (picked && !revealed ? " selected" : "")} disabled={revealed} aria-pressed={picked} onClick={() => setSelectedAnswers((old) => old.includes(option) ? old.filter((value) => value !== option) : [...old, option])}>
          <i>{picked && !revealed ? "✓" : String.fromCharCode(65 + index)}</i><span>{option}</span>{revealed && correct && <Check size={16} aria-label="Correct answer"/>}
        </button>;
      })}</div> : <label className="practice-written study-identification-input"><span>Your answers (separate multiple answers with a | )</span><textarea value={typedAnswer} disabled={revealed} onChange={(event) => setTypedAnswer(event.target.value)} rows={2} placeholder="Type the answers you think apply"/></label>}
      {!revealed ? <button type="button" className="check-answer-button" disabled={card.options?.length ? selectedAnswers.length === 0 : !typedAnswer.trim()} onClick={() => setRevealed(true)}>Check answers</button> : <p className={"choice-feedback " + (exact || (!card.options?.length && isPracticeAnswerCorrect(card, "checkbox", typedAnswer)) ? "correct" : "wrong")} role="status">{exact || (!card.options?.length && isPracticeAnswerCorrect(card, "checkbox", typedAnswer)) ? "Correct! You selected every correct answer." : "Not quite. Correct answers: " + displayCorrectAnswer(card)}</p>}
    </div>;
  }

  function renderIdentificationQuiz(card: Card, isReview = false) {
    const answer = isReview ? reviewIdentificationAnswer : studyIdentificationAnswer;
    const setAnswer = isReview ? setReviewIdentificationAnswer : setStudyIdentificationAnswer;
    const correct = isPracticeAnswerCorrect(card, "identification", answer);
    return <div className={"study-face choice-study-face" + (revealed ? " is-revealed" : "")}>
      <span className="face-label">{revealed ? "ANSWER FEEDBACK" : "IDENTIFY THE TERM OR CONCEPT"}</span>
      <span className="face-question">{card.question}</span>
      <label className="practice-written study-identification-input"><span>Your answer</span><input value={answer} disabled={revealed} onChange={(event) => setAnswer(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && answer.trim() && !revealed) setRevealed(true); }} placeholder="Type the term or concept"/></label>
      {!revealed ? <button type="button" className="check-answer-button" disabled={!answer.trim()} onClick={() => setRevealed(true)}>Check answer</button> : <p className={"choice-feedback " + (correct ? "correct" : "wrong")} role="status">{correct ? "Correct! Nice work." : "Correct answer: " + displayCorrectAnswer(card)}</p>}
    </div>;
  }

  function renderCardInteraction(card: Card, kind: Kind, isReview = false) {
    if (kind === "multiple_choice") return card.options?.length ? renderMultipleChoice(card) : renderIdentificationQuiz(card, isReview);
    if (kind === "checkbox") return renderCheckboxQuiz(card, isReview);
    if (kind === "identification") return renderIdentificationQuiz(card, isReview);
    return <button className={"study-face" + (revealed ? " is-revealed" : "")} onClick={() => setRevealed(!revealed)}>
      <span className="face-label">{revealed ? "THE ANSWER" : "YOUR QUESTION"}</span>
      <span className="face-question">{revealed ? card.answer : card.question}</span>
      {!revealed && <span className="tap-hint">Tap to reveal <span>↗</span></span>}
    </button>;
  }

  const FullscreenIcon = isFullscreen ? Minimize2 : Maximize2;
  const viewTitle: Record<WorkspaceView, string> = { study: "Study desk", library: "My Library", finder: "PDF Finder", voice: "Voice review", about: "About Dawnstudy", friends: "Friends", games: "Play together", profile: "My profile", agreement: "Agreement & privacy" };

  return (
    <main className="shell studio-shell">
      <input ref={input} type="file" multiple accept=".pdf,.pptx,.docx,.txt,.md,.png,.jpg,.jpeg,.webp" hidden onChange={(event) => { selectFiles(event.target.files || undefined); event.target.value = ""; }}/>
      <aside className="sidebar" aria-label="Workspace navigation">
        <button className="brand" type="button" onClick={() => navigateTo("study")} aria-label="Dawnstudy home"><DawnMark className="brand-icon"/><span className="brand-copy"><span>dawn<span className="brand-light">study</span></span><small>A LITTLE BRIGHTER, EVERY DAY</small></span></button>
        <button type="button" className="new-session-button" onClick={beginStudySet} disabled={busy || continueBusy || generationNeedsReconnect} title="New study set"><Plus size={19}/><span>New study set</span></button>
        <div className="side-kicker">WORKSPACE</div>
        <nav className="desktop-navigation">
          <button className={`nav-item ${activeView === "study" ? "active" : ""}`} title="Study desk" aria-current={activeView === "study" ? "page" : undefined} onClick={() => navigateTo("study")}><span className="nav-icon"><BookOpen size={20}/></span><span className="nav-label">Study desk</span><span className="nav-active-mark"/></button>
          <button className={`nav-item ${activeView === "library" ? "active" : ""}`} title="My Library" aria-current={activeView === "library" ? "page" : undefined} onClick={() => navigateTo("library")}><span className="nav-icon"><FolderOpen size={20}/></span><span className="nav-label">My Library</span><span className="nav-count">{sets.length}</span></button>
          <button className={`nav-item ${activeView === "finder" ? "active" : ""}`} title="PDF Finder" aria-current={activeView === "finder" ? "page" : undefined} onClick={() => navigateTo("finder")}><span className="nav-icon"><Search size={20}/></span><span className="nav-label">PDF Finder</span><ArrowUpRight className="nav-outward" size={15}/></button>
          <button className={`nav-item ${activeView === "voice" ? "active" : ""}`} title="Voice review" aria-current={activeView === "voice" ? "page" : undefined} onClick={() => navigateTo("voice")}><span className="nav-icon"><Mic size={20}/></span><span className="nav-label">Voice review</span></button>
          <button className={`nav-item ${activeView === "friends" ? "active" : ""}`} title="Friends" onClick={() => navigateTo("friends")}><span className="nav-icon"><Users size={20}/></span><span className="nav-label">Friends</span>{!!community.data?.incoming.length && <span className="nav-count">{community.data.incoming.length}</span>}</button>
          <button className={`nav-item ${activeView === "games" ? "active" : ""}`} title="Play together" onClick={() => navigateTo("games")}><span className="nav-icon"><Gamepad2 size={20}/></span><span className="nav-label">Play together</span></button>
          <button className={`nav-item ${activeView === "profile" ? "active" : ""}`} title="My profile" onClick={() => navigateTo("profile")}><span className="nav-icon"><UserRound size={20}/></span><span className="nav-label">My profile</span></button>
          <button className={`nav-item ${activeView === "agreement" ? "active" : ""}`} title="Agreement & privacy" onClick={() => navigateTo("agreement")}><span className="nav-icon"><ShieldCheck size={20}/></span><span className="nav-label">Agreement & privacy</span></button>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note"><DawnMark/><p>Built for class notes.<br/><strong>Made for your next exam.</strong></p><span>DAWNSTUDY BY DEVON</span></div>
          <button className={`nav-item about-nav ${activeView === "about" ? "active" : ""}`} title="About Dawnstudy" aria-current={activeView === "about" ? "page" : undefined} onClick={() => navigateTo("about")}><span className="nav-icon"><CircleHelp size={20}/></span><span className="nav-label">About Dawnstudy</span></button>
          <div className="profile"><button className="profile-avatar-button" onClick={() => account ? navigateTo("profile") : setAuthOpen(true)} aria-label="Open profile"><Avatar id={community.data?.profile?.avatar_id || "cat"}/></button><span className="profile-name">{community.data?.profile?.nickname || account?.display_name || "Your study space"}<small>{account ? "CEU workspace" : "Sign in to get started"}</small></span><button className="profile-menu" title={account ? "Sign out" : "Sign in"} aria-label={account ? "Sign out" : "Sign in"} onClick={() => account ? signOut() : setAuthOpen(true)}>{account ? <LogOut size={17}/> : <ArrowUpRight size={18}/>}</button></div>
        </div>
      </aside>
      <section className="main-area" id="home">
        <header className="topbar"><div className="topbar-left"><button className="mobile-brand" type="button" aria-label="Dawnstudy home" onClick={() => navigateTo("study")}><DawnMark/></button><div className="crumb"><span>YOUR SPACE</span><b>{viewTitle[activeView]}</b></div></div><div className="top-actions">{account && <button className="online-friends" title="Recently online friends" onClick={() => navigateTo("friends")} aria-label={`${community.data?.friends.filter(p => p.online).length || 0} friends online`}><span className="online-friend-faces">{community.data?.friends.filter(p => p.online).slice(0, 3).map(p => <Avatar key={p.id} id={p.avatar_id}/>)}</span><Users size={16}/><span>{community.data?.friends.filter(p => p.online).length || 0} online</span></button>}{generationStatus && <button className="activity-pill" onClick={() => navigateTo("study")}><span/>{generationNeedsReconnect ? "Reconnect" : "Generating"}</button>}<button className="theme-toggle" onClick={() => { const next: Theme = theme === "dark" ? "light" : theme === "light" ? "rose" : "dark"; setColorTheme(next); if (community.data?.profile?.onboarded) void community.saveProfile({ ...community.data.profile, theme: next }).catch(e => setError(e.message)); }} aria-label="Cycle theme: Light, Rose Dawn, Dark" title="Cycle theme: Light, Rose Dawn, Dark">{theme === "dark" ? <Sun size={18}/> : <Moon size={18}/>}<span>{theme === "dark" ? "Midnight" : theme === "light" ? "Morning" : "Rose Dawn"}</span></button><span className="workspace-label"><span/> CEU WORKSPACE</span><button className="top-account" onClick={() => account ? signOut() : setAuthOpen(true)} title={account ? "Sign out" : "Sign in"}>{account ? <LogOut size={18}/> : <UserRound size={18}/>}<span>{account ? "Sign out" : "Sign in"}</span></button></div></header>
        <div className="content">
          {(error || notice) && <div className="workspace-feedback" aria-live="polite">{error && <div className="error-box"><CircleHelp size={18}/><span>{error}</span><button className="plain-icon" aria-label="Dismiss error" onClick={() => setError("")}><X size={16}/></button></div>}{notice && <div className="notice-box"><Check size={18}/><span>{notice}</span><button className="plain-icon" aria-label="Dismiss message" onClick={() => setNotice("")}><X size={16}/></button></div>}</div>}
          {generationStatus && <div className="generation-status" role="status" aria-live="polite"><span className="generation-status-pulse"/><div className="generation-status-copy"><strong>{generationStatus.message || "Preparing your study set…"}</strong><small>{generationStatus.model ? modelName(generationStatus.model) : generationStatus.stage === "queued" ? "Waiting for an available model" : "Dawnstudy generation service"}{generationStatus.requested > 0 && ` · ${generationStatus.completed} of ${generationStatus.requested} ready`}</small></div>{generationStatus.requested > 0 && <div className="generation-progress-track" aria-label={`${generationStatus.completed} of ${generationStatus.requested} questions ready`}><i style={{ width: `${Math.min(100, generationStatus.completed / generationStatus.requested * 100)}%` }}/></div>}{generationNeedsReconnect && account && <button type="button" className="generation-reconnect" disabled={busy || continueBusy} onClick={() => void restoreGeneration(authToken, account.id)}>Reconnect</button>}</div>}
          {community.error && account && <div className="social-error" role="alert">{community.error} <button className="text-button" onClick={() => void community.refresh()}>Retry profile connection</button></div>}
          {activeView === "agreement" && <div className="workspace-view social-card agreement-page"><Agreement/></div>}
          {(["friends", "games", "profile"] as WorkspaceView[]).includes(activeView) && !community.data?.profile?.onboarded && <div className="social-card social-empty"><h2>{account ? "Getting your space ready…" : "A little better together."}</h2><p>{account ? "Complete your profile to join the community." : "Sign in with your CEU account to meet friends and play together."}</p><button className="social-button primary" onClick={() => account ? void community.refresh() : setAuthOpen(true)}>{account ? "Retry" : "Sign in"}</button></div>}
          {community.data?.profile?.onboarded && activeView === "friends" && <FriendsPage community={community} initialPerson={friendToOpen} profile={() => navigateTo("profile")}/>}
          {community.data?.profile?.onboarded && activeView === "games" && <GameRoom community={community} sets={sets} initialSet={gameSet} friends={() => navigateTo("friends")}/>}
          {community.data?.profile?.onboarded && activeView === "profile" && <ProfilePage community={community} setTheme={setColorTheme} agreement={() => navigateTo("agreement")}/>}
          {activeView === "study" && <div className="workspace-view study-view" key="study">
          {!result && !reviewActive ? <>
            <section className="studio-intro"><div className="studio-intro-copy"><div className="eyebrow"><span/> A FRESH START TO LEARNING</div><h1>Make room for<br/><em>your next idea.</em></h1><p>Bring your notes. Find your rhythm.<br className="desktop-break"/> Make a little progress, every day.</p></div><DawnArtwork variant="study" className="studio-art"/></section>
            <div className="studio-dashboard">
              <section className="study-creator" aria-labelledby="creator-title">
                <div className="creator-heading"><div><span className="section-overline">LET'S MAKE IT STICK</span><h2 id="creator-title">Start a study set</h2></div><span className="creator-step-count">0{composerStep + 1}<i>/ 03</i></span></div>
                <div className="creation-steps" aria-label="Study set setup">{["Material", "Practice", "Create"].map((label, index) => <button type="button" key={label} className={composerStep === index ? "current" : composerStep > index ? "complete" : ""} aria-current={composerStep === index ? "step" : undefined} onClick={() => setComposerStep(index)}><i>{composerStep > index ? <Check size={14}/> : index + 1}</i><span>{label}</span></button>)}</div>
                <div className="creator-content" key={composerStep}>
                  {composerStep === 0 && <div className="creator-material"><div className="creator-prompt"><h3>What are you learning from?</h3><p>Use your own files or a publicly readable link.</p></div>
          <div className="source-mode-toggle" id="study-source-toggle" role="group" aria-label="Choose a study material source">
            <button type="button" className={sourceMode === "file" ? "source-mode-choice chosen" : "source-mode-choice"} aria-pressed={sourceMode === "file"} onClick={() => { setSourceMode("file"); setError(""); }}><CloudUpload size={16}/> Upload materials</button>
            <button type="button" className={sourceMode === "website" ? "source-mode-choice chosen" : "source-mode-choice"} aria-pressed={sourceMode === "website"} onClick={() => { setSourceMode("website"); setError(""); }}><Globe2 size={16}/> Public website</button>
            <button type="button" className={sourceMode === "youtube" ? "source-mode-choice chosen" : "source-mode-choice"} aria-pressed={sourceMode === "youtube"} onClick={() => { setSourceMode("youtube"); setError(""); }}><Youtube size={16}/> YouTube</button>
          </div>
          {sourceMode === "file" ? <section className="materials-uploader">
            <div className={"upload-zone " + (dragging ? "dragging" : "")} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); selectFiles(event.dataTransfer.files); }}>
              <span className="upload-icon"><CloudUpload size={23}/></span>
              <span className="upload-copy"><strong>{files.length ? "Add another material" : "Drop your study materials here"}</strong><small>{files.length ? files.length + " of 5 files selected" : "Upload more than one file, or choose them from your device."}</small></span>
              <button type="button" className="upload-browse-button" onClick={pickStudyFiles}><Plus size={15}/>{files.length ? "Add files" : "Browse files"}</button>
            </div>
            <div className="upload-limits">PDF, PPTX, DOCX, TXT, MD, PNG, JPG, WEBP · 15 MB each · 30 MB total</div>
            {files.length > 0 && <div className="selected-files">{files.map((selectedFile, index) => {
              const extension = selectedFile.name.split(".").pop()?.toLowerCase() || "";
              const pageSelectable = extension === "pdf" || extension === "pptx";
              return <article className="selected-file" key={selectedFile.name + ":" + selectedFile.size + ":" + selectedFile.lastModified}>
                <div className="selected-file-heading"><span className="selected-file-icon"><FileText size={17}/></span><span className="selected-file-copy"><strong title={selectedFile.name}>{selectedFile.name}</strong><small>{(selectedFile.size / 1024 / 1024).toFixed(2)} MB{pageSelectable ? " · pages/slides can be scoped" : ""}</small></span><button type="button" className="remove-file" title={"Remove " + selectedFile.name} aria-label={"Remove " + selectedFile.name} onClick={() => removeFile(index)}><X size={17}/></button></div>
                {pageSelectable && <label className="file-page-range">{extension === "pdf" ? "PDF pages" : "PowerPoint slides"} <span>(optional)</span><input value={pageRanges[String(index)] || ""} onChange={(event) => setPageRanges((old) => ({ ...old, [String(index)]: event.target.value }))} maxLength={120} placeholder="All pages, or 1-5, 8, 12-15"/></label>}
              </article>;
            })}</div>}
          </section> : <section className="website-source-zone"><label htmlFor="website-source-url">{sourceMode === "youtube" ? "Public YouTube video" : "Public website link"}</label><div className="website-source-input"><Globe2 size={17}/><input id="website-source-url" type="url" inputMode="url" value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} maxLength={2048} placeholder={sourceMode === "youtube" ? "https://www.youtube.com/watch?v=…" : "https://example.edu/biology/cell-division"}/><button type="button" onClick={() => setWebsiteUrl("")} disabled={!websiteUrl} aria-label="Clear website link"><X size={16}/></button></div><small>{sourceMode === "youtube" ? "Captions first, then video understanding if available. Public videos only; some videos cannot be read. Use the topic field to focus your quiz." : "Public pages only. Pages requiring sign-in will show a specific access message."}</small>{sourceMode !== "youtube" && <label className="file-page-range website-page-range">Pages <span>(optional, for direct PDF links)</span><input value={websitePageRange} onChange={(event) => setWebsitePageRange(event.target.value)} maxLength={120} placeholder="All pages, or 1-5, 8, 12-15"/></label>}</section>}
                    <details className="scope-details"><summary><span><FileText size={17}/> Focus on a topic or chapter <small>OPTIONAL</small></span><ChevronDown size={16}/></summary><label className="focus-topic-field"><span>Topic or chapter</span><input value={focusTopic} onChange={(event) => setFocusTopic(event.target.value)} maxLength={300} placeholder="e.g. Chapter 4: cellular respiration"/><small>Leave blank to use all the selected material.</small></label></details>
                    <button type="button" className="finder-shortcut" onClick={() => navigateTo("finder")}><Search size={17}/><span>No material yet? <b>Find something to study</b></span><ArrowUpRight size={17}/></button>
                  </div>}
                  {composerStep === 1 && <div className="creator-practice"><div className="creator-prompt"><h3>How do you want to practice?</h3><p>Choose the format that works for you.</p></div>
          <div className="type-grid">{types.map(({ id, title, detail, icon: Icon }) => <button key={id} className={`type-card ${selected === id ? "chosen" : ""}`} onClick={() => { setSelected(id); setResult(null); setCurrent(0); resetStudyAnswer(); resetReviewAnswer(); setError(""); }}><span className="type-icon"><Icon size={19}/></span><span className="type-text"><strong>{title}</strong><small>{detail}</small></span>{selected === id && <span className="check-icon"><Check size={13} strokeWidth={3}/></span>}</button>)}</div>
                    <div className="session-options"><label htmlFor="question-count">Questions<select id="question-count" value={questionCount} onChange={(event) => setQuestionCount(Number(event.target.value))}>{[10,20,30,40,50].map((count) => <option key={count} value={count}>{count} questions</option>)}</select></label><fieldset className="difficulty-choice"><legend>Difficulty</legend><div>{["easy", "medium", "hard"].map((level) => <button type="button" key={level} aria-pressed={difficulty === level} className={difficulty === level ? "selected" : ""} onClick={() => setDifficulty(level as "easy" | "medium" | "hard")}>{level}</button>)}</div></fieldset></div>
                  </div>}
                  {composerStep === 2 && <div className="creator-ready"><div className="creator-prompt"><h3>Your next session, ready to go.</h3><p>A quick look before we bring your material to life.</p></div><div className="session-summary"><span className="summary-icon"><BookOpen size={25}/></span><div><strong>{types.find((type) => type.id === selected)?.title}</strong><span>{questionCount} questions <i/> {difficulty} difficulty</span><small>{sourceMode === "file" ? files.length ? `${files.length} material${files.length === 1 ? "" : "s"} selected` : "Add your material in step 1" : websiteUrl.trim() ? sourceMode === "youtube" ? "YouTube video selected" : "Public website selected" : "Add a link in step 1"}{focusTopic ? ` · ${focusTopic}` : ""}</small></div><button type="button" className="plain-icon" aria-label="Edit practice choices" onClick={() => setComposerStep(1)}><ArrowUpRight size={18}/></button></div><label className="model-choice-field" htmlFor="model-choice"><span><Cpu size={18}/> AI model</span><select id="model-choice" value={modelChoice} onChange={(event) => setModelChoice(event.target.value)}><option value="auto">Auto choose the best available model</option>{models.map((model) => <option key={model.id} value={model.id}>{model.name} · {model.provider}</option>)}</select></label><div className="options-row"><button type="button" className={`web-toggle ${web ? "on" : ""}`} aria-pressed={web} onClick={() => setWeb(!web)}><span className="toggle-track"><span/></span><span><b>Enrich with the web</b><small>Add relevant context and source links.</small></span><Globe2 size={19}/></button></div><details className="model-help-details"><summary>About generation and your allowance <ChevronDown size={14}/></summary><p className="model-help">{hasUnlimitedGenerations ? "Your account has no Dawnstudy daily generation cap." : "Your account includes 5 generations per day, resetting at midnight in Manila."} If a model is busy, another available model can help. Completed questions are saved, and partial sets can be continued.</p></details></div>}
                </div>
                <div className="creator-footer"><span className="creator-footer-note">{composerStep === 0 ? <><Leaf size={15}/> One small step starts it.</> : <button type="button" className="creator-back" onClick={() => setComposerStep((step) => Math.max(0, step - 1))}><ChevronLeft size={16}/> Back</button>}</span>{composerStep < 2 ? <button className="creator-next" type="button" onClick={() => setComposerStep((step) => step + 1)}>{composerStep === 0 ? "Choose practice" : "Review & create"}<ArrowRight size={18}/></button> : <button className="generate-button" onClick={generate} disabled={busy || continueBusy || generationNeedsReconnect}>{busy ? <><span className="spinner"/> Generating...</> : <>Create study set <ArrowRight size={18}/></>}</button>}</div>
              </section>
              <aside className="desk-aside" aria-label="Study overview">
                <section className="daily-focus"><div className="daily-focus-top"><span>YOUR DAILY RHYTHM</span><DawnMark/></div><h2>A little<br/>adds up.</h2>{account && progress ? <><div className="daily-numbers"><div><strong>{progress.reviewed_today}</strong><span>reviewed today</span></div><div><strong>{progress.current_streak}<small> days</small></strong><span>current streak</span></div></div><button type="button" onClick={() => void startReview()}>Review what's due <span>{progress.due_count}</span><ArrowUpRight size={17}/></button></> : <><p>Your notes, your pace, and a fresh chance to understand something.</p><button type="button" onClick={() => setAuthOpen(true)}>Find your study rhythm <ArrowUpRight size={17}/></button></>}</section>
                <section className="desk-library"><div className="desk-section-head"><h3>Pick up where you left off</h3><button type="button" aria-label="Open library" onClick={() => navigateTo("library")}><ArrowUpRight size={18}/></button></div>{sets.length ? <div className="desk-recent-list">{sets.slice(0,3).map((studySet,index) => <button type="button" key={studySet.id} onClick={() => openSavedSet(studySet)}><span className={`desk-set-icon tone-${index}`}><BookOpen size={20}/></span><span><strong>{studySet.title}</strong><small>{studySet.items.length} questions · {ageLabel(studySet.created_at)}</small></span><ChevronRight size={16}/></button>)}</div> : <div className="desk-empty"><FolderOpen size={27}/><strong>Your first set belongs here.</strong><p>Create a study set and make this space your own.</p></div>}</section>
                <button type="button" className="desk-finder" onClick={() => navigateTo("finder")}><span><Search size={22}/></span><div><strong>Looking for study material?</strong><small>Search PDFs, slides, and notes</small></div><ArrowUpRight size={19}/></button>
              </aside>
            </div>
          </> : <div className="session-topline"><div><span className="section-overline">YOUR FOCUS SPACE</span><h1>One idea at a time.</h1></div><button type="button" className="outline-button" disabled={busy || continueBusy || generationNeedsReconnect} onClick={beginStudySet}><Plus size={17}/> New study set</button></div>}
          {reviewActive && <section className="review-panel"><div className="result-head"><div><div className="result-kicker"><span/> SPACED REPETITION</div><h2>{reviewQueue.length ? reviewQueue[0].study_set_title : "Review complete"}</h2><p>{reviewQueue.length ? `${reviewQueue.length} cards in this session · ${reviewQueue[0].type.replaceAll("_", " ")}` : "You’re all caught up for now. Nice work showing up."}</p></div><button className="plain-icon" title="Close review" onClick={() => { setReviewActive(false); setReviewQueue([]); setSelectedOption(null); }}><X size={18}/></button></div>{reviewQueue.length ? <div className="study-card"><div className="study-card-top"><span className="flashcard-label">REVIEW {reviewQueue.length} LEFT</span></div>{renderCardInteraction(reviewQueue[0].card, reviewQueue[0].type, true)}{revealed && reviewQueue[0].card.explanation && <p className="explanation">{reviewQueue[0].card.explanation}</p>}{revealed && <div className="rating-row"><button disabled={reviewBusy} onClick={() => void gradeCard("again")}><b>Again</b><small>{reviewQueue[0].intervals.again}</small></button><button disabled={reviewBusy} onClick={() => void gradeCard("hard")}><b>Hard</b><small>{reviewQueue[0].intervals.hard}</small></button><button disabled={reviewBusy} onClick={() => void gradeCard("good")}><b>Good</b><small>{reviewQueue[0].intervals.good}</small></button><button disabled={reviewBusy} onClick={() => void gradeCard("easy")}><b>Easy</b><small>{reviewQueue[0].intervals.easy}</small></button></div>}</div> : <button className="review-done" onClick={() => { setReviewActive(false); setReviewQueue([]); }}>Back to study desk <ChevronRight size={15}/></button>}</section>}
          {result && practiceActive && !reviewActive && <section ref={practicePanel} className="practice-panel">
            <div className="result-head"><div><div className="result-kicker"><span/> {practiceSecondsPerQuestion === 0 ? "SELF-PACED PRACTICE" : "TIMED PRACTICE TEST"}</div><h2>{result.title}</h2><p>{practiceComplete ? "Test results and missed answers" : `${result.items.length} questions · ${practiceSecondsPerQuestion === 0 ? "no time limit" : `${practiceSecondsPerQuestion} seconds per question`}`}</p></div><div className="practice-head-actions"><button className={`quiz-fullscreen-button ${isFullscreen ? "is-fullscreen" : ""}`} type="button" onClick={() => void toggleExerciseFullscreen()} aria-label={isFullscreen ? "Exit quiz fullscreen" : "Show quiz fullscreen"} aria-pressed={isFullscreen}><FullscreenIcon size={19}/><span>{isFullscreen ? "Exit fullscreen" : "Quiz fullscreen"}</span></button><button className="plain-icon" title="Exit practice test" onClick={() => { setPracticeActive(false); setPracticeComplete(false); }}><X size={18}/></button></div></div>
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
              {practiceScore === result.items.length ? <p className="all-correct">You answered every question correctly.</p> : <div className="missed-list">{result.items.map((card, index) => isPracticeAnswerCorrect(card, result.type, practiceAnswers[index]) ? null : <article className="missed-card" key={`${card.card_id || card.question}-${index}`}><strong>{index + 1}. {card.question}</strong><p><b>Your answer:</b> {displayPracticeAnswer(practiceAnswers[index])}</p><p><b>Correct answer:</b> {displayCorrectAnswer(card)}</p>{card.explanation && <small>{card.explanation}</small>}{card.source_refs?.length ? <small className="missed-source">Source: {card.source_refs.join(", ")}</small> : null}</article>)}</div>}
              <button className="finish-test" onClick={() => { setPracticeActive(false); setPracticeComplete(false); }}>Back to study cards</button>
            </> : null}
          </section>}
          {result && currentCard && !reviewActive && !practiceActive && <section className="result-panel"><div className="result-head"><div><div className="result-kicker"><span/> YOUR STUDY SET</div><h2>{result.title}</h2><p>{result.items.length} {types.find((type) => type.id === result.type)?.title.toLowerCase()} · ready when you are{result.model ? ` · ${modelName(result.model)}` : ""}</p></div><button className="plain-icon" title="Close study set" onClick={() => setResult(null)}><X size={18}/></button></div>
            <div className="set-action-row"><label>Test pace<select value={practiceSecondsPerQuestion} onChange={(event) => setPracticeSecondsPerQuestion(Number(event.target.value))}><option value={0}>No timer</option><option value={20}>20 sec / question</option><option value={30}>30 sec / question</option><option value={45}>45 sec / question</option></select></label>{result.type !== "flashcards" && <button className="action-button" onClick={() => { if (result) setGameSet(result.id); navigateTo("games"); }}><Gamepad2 size={15}/> Play with friends</button>}<button className="action-button" onClick={startPractice}><AlarmClock size={15}/> {practiceSecondsPerQuestion === 0 ? "Start practice" : "Start timed test"}</button><button className="action-button" onClick={() => void shareCurrentSet()} disabled={shareBusy}><Share2 size={15}/>{shareBusy ? "Working…" : "Share set"}</button></div>
            {result.incomplete && <div className="incomplete-generation"><div><strong>{result.items.length} of {result.requested_count || result.items.length} questions generated</strong><span>{result.source_url ? "Your generated questions are held. Continue from the same public webpage when ready." : files.length ? "Your generated questions are held. Continue with the selected original files when ready." : "Re-select the original files to continue this set."}</span>{!result.source_url && files.length > 0 && <button type="button" className="resume-source-button" onClick={pickOriginalFiles}>Replace original files ({files.length} selected)</button>}</div><button className="continue-generation-button" disabled={continueBusy || busy || generationNeedsReconnect} onClick={() => { if (!files.length && !result.source_url) pickOriginalFiles(); else void continueGenerating(); }}>{continueBusy ? <><span className="spinner"/> Continuing…</> : <><Sparkles size={17}/> {!files.length && !result.source_url ? "Select original files" : "Continue generating"}</>}</button></div>}
            {shareUrl && <div className="share-link-row"><span>Anyone with this link can view this set:</span><a href={shareUrl} target="_blank" rel="noreferrer">{shareUrl}</a><button className="plain-icon" title="Copy share link" onClick={() => { void navigator.clipboard.writeText(shareUrl).then(() => setNotice("Share link copied.")).catch(() => setNotice("Select and copy the share link above.")); }}><Copy size={15}/></button><button className="share-revoke" disabled={shareBusy} onClick={() => void turnOffShareLink(result.id)}>Turn off link</button></div>}
            <div className="study-card"><div className="study-card-top"><span className="flashcard-label">{result.type === "flashcards" ? "FLASHCARD" : types.find((type) => type.id === result.type)?.title.toUpperCase()}</span><span className="card-number">{String(current + 1).padStart(2,"0")} <i>/</i> {String(result.items.length).padStart(2,"0")}</span></div>
              {renderCardInteraction(currentCard, result.type)}
              {currentCard.source_refs?.length ? <div className="material-citations"><strong>From your material</strong>{currentCard.source_refs.map((source) => <span key={source}>{source}</span>)}</div> : null}
              {revealed && currentCard.explanation && <p className="explanation">{currentCard.explanation}</p>}
              {revealed && account && authToken && currentCard.card_id && <><div className="rating-prompt">How well did you recall it? Your answer schedules this card for another review.</div><div className="rating-row"><button disabled={reviewBusy} onClick={() => void gradeCurrentCard("again")}><b>Again</b><small>Hard to recall</small></button><button disabled={reviewBusy} onClick={() => void gradeCurrentCard("hard")}><b>Hard</b><small>With effort</small></button><button disabled={reviewBusy} onClick={() => void gradeCurrentCard("good")}><b>Good</b><small>Recalled it</small></button><button disabled={reviewBusy} onClick={() => void gradeCurrentCard("easy")}><b>Easy</b><small>Very easy</small></button></div></>}
              {currentCard.card_id && <div className="card-report-wrap">{reportedCards.includes(currentCard.card_id) ? <span className="report-sent"><Check size={14}/> Report received</span> : <button className="report-toggle" onClick={() => setReportingCard(!reportingCard)}><Flag size={14}/> Report an issue with this card</button>}{reportingCard && !reportedCards.includes(currentCard.card_id) && <div className="card-report-form"><label>What should we review?<select value={reportReason} onChange={(event) => setReportReason(event.target.value)}>{reportReasons.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><textarea value={reportNote} onChange={(event) => setReportNote(event.target.value)} maxLength={500} rows={2} placeholder="Optional note to help us check it"/><button className="action-button" disabled={reportBusy} onClick={() => void submitCardReport()}>{reportBusy ? "Sending…" : "Send report"}</button></div>}</div>}
              <div className="study-controls"><button className="control-button" onClick={() => { setCurrent((current - 1 + result.items.length) % result.items.length); resetStudyAnswer(); }}><ChevronLeft size={16}/> Previous</button><span className="dots">{result.items.slice(0, Math.min(result.items.length, 7)).map((_, index) => <i key={index} className={index === current ? "dot-active" : ""}/>)}</span><button className="control-button next" onClick={() => { setCurrent((current + 1) % result.items.length); resetStudyAnswer(); }}>Next <ChevronRight size={16}/></button></div>
              {result.sources?.length ? <div className="source-links"><Globe2 size={14}/><span>Sources:</span>{result.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}</a>)}</div> : null}
            </div></section>}
          </div>}
          {activeView === "finder" && <div className="workspace-view finder-view" key="finder">
          <div className="workspace-page-heading"><div className="result-kicker"><span/> LEARNING MATERIALS</div><h1>Find your next study source.</h1><p>Search public files by topic, course, book, or tags.</p></div>
          <section className="pdf-finder-section" id="pdf-finder">
            <div className="pdf-finder-heading"><div><div className="result-kicker"><span/> PDF FINDER</div><h2>Find material to study</h2><p>Search the web for PDFs, slides, documents, and other files Dawnstudy can read.</p></div><span className="finder-heading-icon"><Search size={20}/></span></div>
            <form className="finder-form" onSubmit={(event) => void searchMaterials(event)}>
              <label>Topic<input value={finderTopic} onChange={(event) => setFinderTopic(event.target.value)} maxLength={180} placeholder="e.g. cellular respiration"/></label>
              <label>Subject<input value={finderSubject} onChange={(event) => setFinderSubject(event.target.value)} maxLength={120} placeholder="e.g. biology"/></label>
              <label>Book or article title<input value={finderTitle} onChange={(event) => setFinderTitle(event.target.value)} maxLength={200} placeholder="Title or author, if known"/></label>
              <label>Tags<input value={finderTags} onChange={(event) => setFinderTags(event.target.value)} maxLength={300} placeholder="e.g. lecture notes, review, anatomy"/></label>
              <div className="finder-form-footer"><span>Choose a result to load its link into the study set form, or open it first. Check the source’s reuse terms.</span><button className="finder-search-button" type="submit" disabled={finderBusy}>{finderBusy ? <><span className="spinner"/> Searching…</> : <><Search size={16}/> Search materials</>}</button></div>
            </form>
            {finderError && <div className="finder-error" role="alert"><CircleHelp size={15}/><span>{finderError}</span></div>}
            {finderSearched && <div className="finder-results-heading"><strong>{finderResults.length ? `${finderResults.length} learning resources` : "No resources found"}</strong><span>Search results from the web</span></div>}
            {finderSearched && finderResults.length > 0 && <div className="finder-results">{finderResults.map((resource) => <article className="finder-result-card" key={resource.url}><span className="finder-file-type"><FileText size={14}/>{resource.file_type}</span><div className="finder-result-copy"><strong>{resource.title}</strong>{resource.snippet && <p>{resource.snippet}</p>}<small>{resource.url}</small></div><div className="finder-result-actions"><button className="finder-use-link" type="button" onClick={() => useFinderMaterial(resource)}><Plus size={14}/><span>Use for study set</span></button><a className="finder-open-link" href={resource.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${resource.title}`}><span>Open</span><ExternalLink size={15}/></a></div></article>)}</div>}
            {finderSearched && finderResults.length === 0 && !finderError && <p className="finder-empty">Try a broader topic, a different title, or fewer tags.</p>}
          </section>
          </div>}
          {activeView === "library" && <div className="workspace-view library-view" key="library">
          <div className="workspace-page-heading"><div className="result-kicker"><span/> YOUR STUDY SPACE</div><h1>Everything you’ve saved.</h1><p>Manage shared links, revisit a set, and keep your study rhythm in view.</p></div>
          {account && progress && <section className="progress-panel" id="study-progress"><div className="progress-copy"><div className="result-kicker"><span/> YOUR STUDY PROGRESS</div><h2>Small steps add up.</h2><p>Review a little each day to keep ideas fresh.</p><div className="progress-stats"><div><strong>{progress.reviewed_today}</strong><span>today</span></div><div><strong>{progress.accuracy}%</strong><span>accuracy</span></div><div><strong>{progress.current_streak} <small>days</small></strong><span>current streak</span></div><div><strong>{progress.best_streak} <small>days</small></strong><span>best streak</span></div></div><div className="week-bars" aria-label="Reviews during the past seven days">{progress.week.map((day) => <div key={day.date} title={`${day.reviews} reviews`}><i style={{ height: `${Math.max(8, Math.min(100, day.reviews * 18))}%` }}/><small>{new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "narrow" })}</small></div>)}</div></div><button className="review-start" onClick={() => void startReview()}><Clock3 size={17}/><span>Review due</span><b>{progress.due_count}</b><ChevronRight size={16}/></button></section>}
          <section className="active-links-section" id="active-links"><div className="recent-head"><div><div className="section-title-row"><h2>Active Links</h2><span className="recent-count">{activeShares.length}</span></div><p>Share links that are currently enabled for your study sets.</p></div></div>
            {activeShares.length ? <div className="active-links-list">{activeShares.map((share) => {
              const url = `${siteOrigin}/shared/${share.token}`;
              return <article className="active-link-card" key={share.set_id}><div className="active-link-info"><span className="active-link-status"><i/> ACTIVE</span><strong>{share.title}</strong><a href={url} target="_blank" rel="noreferrer">{url}</a><small>Created {ageLabel(share.created_at)}</small></div><div className="active-link-actions"><button className="active-link-copy" type="button" onClick={() => { void navigator.clipboard.writeText(url).then(() => setNotice("Share link copied.")).catch(() => setNotice("Could not copy the share link. Select its address to copy.")); }}><Copy size={14}/> Copy</button><button className="share-revoke" disabled={shareBusy} onClick={() => void turnOffShareLink(share.set_id)}>{shareBusy ? "Working…" : "Turn off link"}</button></div></article>;
            })}</div> : <div className="active-links-empty"><Share2 size={18}/><span>{account ? "You have no active share links. Share a study set and it will appear here." : "Sign in to manage links you have shared."}</span></div>}
          </section>
          <section className="recent-section" id="recent-sets"><div className="recent-head"><div><div className="section-title-row"><h2>Your recent sets</h2><span className="recent-count">{sets.length}</span></div><p>{account ? "Synced to your account." : "Sign in with your CEU Google account to view your sets."}</p></div>{sets.length > 3 && <button className="see-all" onClick={() => setShowAll(!showAll)}>{showAll ? "Show less" : "See all"} <ChevronRight size={15}/></button>}</div>
            {sets.length ? <div className="recent-grid">{sets.slice(0, showAll ? sets.length : 3).map((studySet, index) => <div className="recent-card-wrap" key={studySet.id}><button className="recent-card" onClick={() => openSavedSet(studySet)}><span className={`recent-art art-${["aqua", "coral", "gold"][index % 3]}`}><BookOpen size={18}/><span className="art-orbit"/></span><span className="recent-info"><span className="subject-label">{types.find((type) => type.id === studySet.type)?.title.toUpperCase()}</span><strong>{studySet.title}</strong><small>{studySet.items.length} cards <i>·</i> {ageLabel(studySet.created_at)}</small></span><ChevronRight size={16} className="recent-arrow"/></button><button className="recent-delete" title={`Delete ${studySet.title}`} aria-label={`Delete ${studySet.title}`} onClick={() => void removeStudySet(studySet)}><Trash2 size={15}/></button></div>)}</div> : <div className="empty-sets"><Layers3 size={20}/><span>{account ? "Your study sets will appear here after you make one." : "Sign in with your CEU Google account to access Dawnstudy."}</span></div>}
            <div className="bottom-note"><span>✳</span> Little by little, a little becomes a lot. <i>— A study reminder</i></div>
          </section>
          </div>}
          {activeView === "voice" && <div className="workspace-view voice-view" key="voice">
          <div className="workspace-page-heading"><div className="result-kicker"><span/> SPEAK IT TO REMEMBER IT</div><h1>Review it out loud.</h1><p>Have a spoken, back-and-forth study session with your chosen voice and format.</p></div>
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
          </div>}
          {activeView === "about" && <div className="workspace-view about-view" key="about">
          <div className="workspace-page-heading"><div className="result-kicker"><span/> BUILT FOR CURIOUS MINDS</div><h1>A calmer way to make learning stick.</h1><p>Dawnstudy turns your learning materials into practical ways to review.</p></div>
          <section className="about-section" id="about"><div className="about-header"><div className="about-identity"><span className="eyebrow"><span/> THE PERSON BEHIND DAWNSTUDY</span><h2>Hey, I’m Devon! <span role="img" aria-label="waving hand">👋</span></h2><p>Computer Engineering Student &amp; Developer</p><strong>Centro Escolar University Manila</strong><div className="about-tags"><span>Network Engineering</span><span>Applied AI</span></div></div></div><div className="about-body"><h3>Building Dawnstudy</h3><p>I’m Jairo Devon A. Daquioag, a Computer Engineering student at Centro Escolar University Manila who enjoys building things that solve problems, no matter how small.</p><p>I created Dawnstudy with my fellow students in mind. I wanted to make studying more accessible by turning PDFs into flashcards, multiple-choice questions, identification questions, and select-all-that-apply exercises—using the AI models available through the configured provider accounts.</p><p>I’m a tech generalist at heart, with a particular interest in Network Engineering and Applied AI. I enjoy exploring technology, experimenting with different AI models, and finding practical ways to use them to make everyday tasks easier.</p><p>For me, technology isn’t just about building something impressive. It’s about building something useful, especially when it can help others without costing them anything.</p></div><div className="about-links"><h3>Let’s connect</h3><a href="https://www.linkedin.com/in/jairo-devon-daquioag-466124295/" target="_blank" rel="noreferrer"><span className="social-mark">in</span><span><strong>LinkedIn</strong><small>Jairo Devon Daquioag</small></span><span className="external-mark">↗</span></a><a href="https://www.instagram.com/jairodaquioag/" target="_blank" rel="noreferrer"><span className="social-mark">◎</span><span><strong>Instagram</strong><small>@jairodaquioag</small></span><span className="external-mark">↗</span></a><a href="mailto:daquioagjairodevon@gmail.com"><span className="social-mark">✉</span><span><strong>Email</strong><small>daquioagjairodevon@gmail.com</small></span><span className="external-mark">↗</span></a></div></section>
          </div>}
        </div>
      </section>

      <nav className="mobile-bottom-nav" aria-label="Main navigation">
        <button aria-current={activeView === "study" ? "page" : undefined} onClick={() => navigateTo("study")}><BookOpen size={18}/><span>Study</span></button>
        <button aria-current={activeView === "library" ? "page" : undefined} onClick={() => navigateTo("library")}><Layers3 size={18}/><span>Library</span></button>
        <button aria-current={activeView === "friends" ? "page" : undefined} onClick={() => navigateTo("friends")}><Users size={18}/><span>Friends{community.data?.incoming.length ? ` (${community.data.incoming.length})` : ""}</span></button>
        <button aria-current={activeView === "games" ? "page" : undefined} onClick={() => navigateTo("games")}><Gamepad2 size={18}/><span>Play</span></button>
        <button aria-expanded={moreOpen} onClick={() => setMoreOpen(v => !v)}><Menu size={18}/><span>More</span></button>
      </nav>
      {moreOpen && <div className="more-menu-backdrop" onClick={() => setMoreOpen(false)}><nav className="more-menu" aria-label="More pages" onClick={e => e.stopPropagation()}><div><strong>Find your way</strong><button className="plain-icon" onClick={() => setMoreOpen(false)} aria-label="Close more pages"><X size={19}/></button></div>{([ ["finder", "PDF Finder"], ["voice", "Voice review"], ["profile", "My profile"], ["agreement", "Agreement & privacy"], ["about", "About Dawnstudy"] ] as [WorkspaceView, string][]).map(([id, title]) => <button key={id} onClick={() => navigateTo(id)}>{title}<ArrowRight size={16}/></button>)}</nav></div>}
      <CompanionDock key={`buddy-${account?.id || "guest"}`} community={community} friends={() => navigateTo("friends")} signIn={() => setAuthOpen(true)}/>
      {account && community.data && !community.data.profile?.onboarded && <Onboarding key={`setup-${account.id}`} community={community} setTheme={setColorTheme} signOut={signOut}/>}

      {authOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setAuthOpen(false); setAuthError(""); } }}>
        <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
          <button className="modal-close" aria-label="Close" onClick={() => { setAuthOpen(false); setAuthError(""); }}><X size={18}/></button>
          <div className="auth-main"><div className="auth-brand"><DawnMark/><span>dawnstudy</span></div><p className="auth-eyebrow">YOUR NEXT CHAPTER STARTS HERE</p><h2 id="auth-title">Welcome to your<br/>study space.</h2><p className="auth-subtitle">A place for your notes, your curiosity, and the small steps that make things click.</p>{GOOGLE_CLIENT_ID ? <div className="google-button-wrap"><div ref={googleButton} className="google-signin-container"/></div> : <div className="google-not-ready">Google sign-in is not configured yet. Please try again later.</div>}<p className="auth-school-note">Use your verified CEU school Google account. Dawnstudy currently welcomes @ceu.edu.ph, @mnl.ceu.edu.ph, @mkt.ceu.edu.ph, and @mls.ceu.edu.ph accounts.</p>{authError && <div className="auth-error">{authError}</div>}</div><div className="auth-art" aria-hidden="true"><DawnArtwork variant="botanical"/><div className="auth-art-copy"><strong>Good things grow<br/>one day at a time.</strong><p>Make learning a little lighter.<br/>Make today a little brighter.</p></div></div>
        </section>
      </div>}
    </main>
  );
}
