"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  BookOpen, Check, CheckSquare, ChevronLeft, ChevronRight, CircleHelp, Clock3,
  CloudUpload, Cpu, FileText, Globe2, Layers3, LogIn, LogOut, Menu, Moon, MoreHorizontal,
  Plus, Sparkles, Sun, UserRound, X,
} from "lucide-react";

type Kind = "flashcards" | "multiple_choice" | "checkbox" | "identification";
type Card = { question: string; answer: string; options?: string[]; correct_answer?: string; explanation?: string };
type StudySet = { id: string; title: string; type: Kind; items: Card[]; sources?: { title: string; url: string }[]; created_at: string; model?: string };
type Account = { id: string; username: string; email: string; display_name: string };
type AuthMode = "register" | "login";
type LoginResult = { token: string; user: Account };
type ModelOption = { id: string; provider: string; name: string };
type Theme = "dark" | "light";

type GoogleIdResponse = { credential: string };
type GoogleIdentity = {
  initialize: (config: { client_id: string; callback: (response: GoogleIdResponse) => void }) => void;
  renderButton: (element: HTMLElement, options: Record<string, string | number | boolean>) => void;
};
declare global { interface Window { google?: { accounts: { id: GoogleIdentity } } } }

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
const LOCAL_SETS_KEY = "dawnstudy_guest_sets_v1";
const TOKEN_KEY = "dawnstudy_session_v1";
const THEME_KEY = "dawnstudy_theme_v1";
const types: { id: Kind; title: string; detail: string; icon: typeof Layers3 }[] = [
  { id: "flashcards", title: "Flashcards", detail: "Quick question & answer pairs", icon: Layers3 },
  { id: "multiple_choice", title: "Multiple choice", detail: "Choose the best answer", icon: CircleHelp },
  { id: "checkbox", title: "Select all that apply", detail: "Find every correct answer", icon: CheckSquare },
  { id: "identification", title: "Identification", detail: "Recall key terms", icon: FileText },
];

function getLocalSets(): StudySet[] {
  try {
    const value = JSON.parse(localStorage.getItem(LOCAL_SETS_KEY) || "[]");
    return Array.isArray(value) ? value.filter((item) => item && Array.isArray(item.items) && item.type) : [];
  } catch { return []; }
}

function rememberLocalSet(studySet: StudySet) {
  try { localStorage.setItem(LOCAL_SETS_KEY, JSON.stringify([studySet, ...getLocalSets().filter((item) => item.id !== studySet.id)].slice(0, 50))); }
  catch { /* Browser storage may be unavailable; the current set remains usable. */ }
}

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

async function responseError(response: Response) {
  try {
    const body = await response.json();
    return body.detail || body.error || `Request failed (${response.status}).`;
  } catch { return `Request failed (${response.status}).`; }
}

export default function Home() {
  const [selected, setSelected] = useState<Kind>("flashcards");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [web, setWeb] = useState(false);
  const [modelChoice, setModelChoice] = useState("auto");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [theme, setTheme] = useState<Theme>("dark");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<StudySet | null>(null);
  const [current, setCurrent] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [sets, setSets] = useState<StudySet[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [authToken, setAuthToken] = useState("");
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("register");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const googleButton = useRef<HTMLDivElement>(null);

  async function loadAccountSets(token: string) {
    if (!API_BASE) return;
    try {
      const response = await fetch(`${API_BASE}/api/study-sets`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) return;
      const saved: StudySet[] = await response.json();
      setSets(saved);
    } catch { /* Auth can still be used if study-set sync is briefly unavailable. */ }
  }

  useEffect(() => {
    const savedTheme = localStorage.getItem(THEME_KEY);
    const initialTheme: Theme = savedTheme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = initialTheme;
    setTheme(initialTheme);
    setSets(getLocalSets());
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
      script.onerror = () => setAuthError("Google sign-in could not load. Check your connection or use username and password.");
      document.head.appendChild(script);
    }
  }, [authOpen]);

  function acceptLogin(data: LoginResult) {
    localStorage.setItem(TOKEN_KEY, data.token);
    setAuthToken(data.token); setAccount(data.user); setAuthOpen(false);
    setAuthError(""); setPassword(""); setNotice(`Welcome, ${data.user.display_name || data.user.username}. Your sets will sync to your account.`);
    void loadAccountSets(data.token);
  }

  function selectFile(nextFile?: File) {
    if (!nextFile) return;
    setFile(nextFile); setError(""); setNotice(""); setResult(null);
  }

  function setColorTheme(nextTheme: Theme) {
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem(THEME_KEY, nextTheme);
  }

  async function generate() {
    if (!file) { setError("Choose a study material first."); return; }
    setBusy(true); setError(""); setNotice("");
    const form = new FormData();
    form.append("file", file); form.append("format", selected); form.append("use_web", String(web));
    form.append("model", modelChoice);
    try {
      if (!API_BASE) throw new Error("The API address is not configured for this site.");
      const response = await fetch(`${API_BASE}/api/generate`, { method: "POST", body: form });
      if (!response.ok) throw new Error(await responseError(response));
      const data = await response.json();
      let studySet: StudySet = { ...data, id: crypto.randomUUID(), created_at: new Date().toISOString() };
      let generationNotice = "";
      if (data.fallback) {
        const original = models.find((item) => item.id === data.fallback.from)?.name || data.fallback.from;
        const fallbackModel = models.find((item) => item.id === data.fallback.to)?.name || data.fallback.to;
        const issue = data.fallback.reason === "limit" ? "may have reached its limit" : data.fallback.reason === "busy" ? "was busy" : "was unavailable";
        generationNotice = `${original} ${issue}; Dawnstudy switched to ${fallbackModel}.`;
      }
      setResult(studySet); setCurrent(0); setRevealed(false);
      if (authToken) {
        try {
          const saved = await fetch(`${API_BASE}/api/study-sets`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
            body: JSON.stringify({ title: studySet.title, type: studySet.type, items: studySet.items, sources: studySet.sources || [] }),
          });
          if (!saved.ok) throw new Error(await responseError(saved));
          const savedSet: StudySet = await saved.json();
          studySet = { ...studySet, id: savedSet.id, created_at: savedSet.created_at };
        } catch { generationNotice = [generationNotice, "Your study set could not sync to Google Sheets, so it is saved in this browser."].filter(Boolean).join(" "); }
      }
      rememberLocalSet(studySet);
      setResult(studySet);
      setSets((old) => [studySet, ...old.filter((item) => item.id !== studySet.id)].slice(0, 100));
      setNotice(generationNotice);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
    } finally { setBusy(false); }
  }

  async function submitCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setAuthBusy(true); setAuthError("");
    try {
      if (!API_BASE) throw new Error("The API address is not configured for this site.");
      const response = await fetch(`${API_BASE}/api/auth/${authMode === "register" ? "register" : "login"}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      acceptLogin(await response.json());
    } catch (caught) { setAuthError(caught instanceof Error ? caught.message : "Sign-in failed. Please try again."); }
    finally { setAuthBusy(false); }
  }

  function signOut() {
    localStorage.removeItem(TOKEN_KEY); setAuthToken(""); setAccount(null); setSets(getLocalSets());
    setNotice("You’re signed out. New sets will stay in this browser until you sign in again.");
  }

  function openSavedSet(studySet: StudySet) {
    setResult(studySet); setSelected(studySet.type); setCurrent(0); setRevealed(false); setError(""); setNotice("");
    document.querySelector(".result-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const currentCard = result?.items[current] || result?.items[0];
  const modelName = (modelId?: string) => models.find((item) => item.id === modelId)?.name || modelId;

  return (
    <main className="shell">
      <aside className="sidebar">
        <a className="brand" href="#home"><span className="brand-icon"><Sparkles size={19} strokeWidth={2.2} /></span><span>dawn<span className="brand-light">study</span></span></a>
        <div className="side-kicker">YOUR SPACE</div>
        <button className="nav-item active" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><span className="nav-icon"><BookOpen size={18}/></span> Study desk</button>
        <button className="nav-item" onClick={() => document.querySelector(".recent-section")?.scrollIntoView({ behavior: "smooth" })}><span className="nav-icon"><Layers3 size={18}/></span> My study sets <span className="nav-count">{sets.length}</span></button>
        <button className="nav-item" onClick={() => document.querySelector(".recent-section")?.scrollIntoView({ behavior: "smooth" })}><span className="nav-icon"><Clock3 size={18}/></span> Study history</button>
        <button className="nav-item" onClick={() => document.querySelector(".about-section")?.scrollIntoView({ behavior: "smooth" })}><span className="nav-icon"><UserRound size={18}/></span> About Jairo</button>
        <div className="side-separator" />
        <div className="set-heading"><span className="side-kicker">RECENT SETS</span><button className="plain-icon" title="Add a study set" onClick={() => input.current?.click()}><Plus size={17}/></button></div>
        <div className="mini-sets">
          {sets.slice(0, 4).map((studySet, index) => <button className="mini-set" key={studySet.id} onClick={() => openSavedSet(studySet)}>
            <span className={`set-dot ${["aqua", "coral", "gold"][index % 3]}`}><BookOpen size={14}/></span>
            <span className="mini-copy"><span className="mini-title">{studySet.title}</span><span className="mini-meta">{studySet.items.length} cards · {ageLabel(studySet.created_at)}</span></span>
          </button>)}
          {!sets.length && <p className="empty-side">Your saved sets will appear here.</p>}
        </div>
        <div className="sidebar-bottom">
          <div className="plan-card"><span className="plan-spark"><Sparkles size={16}/></span><strong>A little more focus.</strong><p>Your notes, a quieter mind, and a brighter tomorrow.</p><span className="plan-tag">MADE FOR THE MOMENT</span></div>
          <div className="profile"><span className="avatar">{(account?.display_name || account?.username || "S").slice(0, 1).toUpperCase()}</span><span className="profile-name">{account?.display_name || account?.username || "Guest student"}<small>{account ? "Account synced" : "Saved in this browser"}</small></span>
            {account ? <button className="profile-menu" title="Sign out" onClick={signOut}><LogOut size={16}/></button> : <button className="profile-menu" title="Sign in" onClick={() => { setAuthOpen(true); setAuthMode("register"); }}><MoreHorizontal size={19}/></button>}
          </div>
        </div>
      </aside>

      <section className="main-area" id="home">
        <header className="topbar"><div className="crumb"><span>Your space</span><ChevronRight size={14}/><b>Study desk</b></div><div className="top-actions"><button className="theme-toggle" onClick={() => setColorTheme(theme === "dark" ? "light" : "dark")} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>{theme === "dark" ? <Sun size={16}/> : <Moon size={16}/>}<span>{theme === "dark" ? "Light mode" : "Dark mode"}</span></button><span className="today-pill"><span className="status-dot"/> YOUR STUDY DESK</span>{!account && <button className="top-signin" onClick={() => { setAuthOpen(true); setAuthMode("register"); }}><UserRound size={14}/> Sign in</button>}<button className="profile-mobile" onClick={() => account ? signOut() : setAuthOpen(true)} title={account ? "Sign out" : "Sign in"}>{account ? <LogOut size={18}/> : <Menu size={20}/>}</button></div></header>
        <div className="content">
          <section className="welcome"><div className="welcome-copy"><div className="eyebrow"><span/> A FRESH PAGE, A FRESH START</div><h1>Make today<br/>a little <em>brighter.</em></h1><p>Drop in your notes. We’ll help the important things stick.</p></div><div className="sunrise-art" aria-hidden="true"><div className="sun"/><div className="cloud cloud-one"/><div className="cloud cloud-two"/><div className="horizon h-back"/><div className="horizon h-front"/></div><span className="welcome-note">one page at a time <span>✳</span></span></section>
          <div className="section-intro"><div><div className="section-title-row"><h2>Start a study set</h2><span className="step-tag"><span>01</span> OF 02</span></div><p>Choose how you’d like to practice.</p></div><span className="quiet-note">Good things take practice <span>↗</span></span></div>
          <div className="type-grid">{types.map(({ id, title, detail, icon: Icon }) => <button key={id} className={`type-card ${selected === id ? "chosen" : ""}`} onClick={() => { setSelected(id); setResult(null); setCurrent(0); setRevealed(false); setError(""); }}><span className="type-icon"><Icon size={19}/></span><span className="type-text"><strong>{title}</strong><small>{detail}</small></span>{selected === id && <span className="check-icon"><Check size={13} strokeWidth={3}/></span>}</button>)}</div>
          <section className={`upload-zone ${dragging ? "dragging" : ""} ${file ? "has-file" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); selectFile(event.dataTransfer.files[0]); }} onClick={() => !file && input.current?.click()} role="button" tabIndex={0} onKeyDown={(event) => event.key === "Enter" && input.current?.click()}>
            <input ref={input} type="file" accept=".pdf,.docx,.txt,.md" hidden onChange={(event) => selectFile(event.target.files?.[0])}/>
            <span className="upload-icon">{file ? <FileText size={22}/> : <CloudUpload size={23}/>}</span><span className="upload-copy">{file ? <><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(2)} MB · ready to study</small></> : <><strong>Drop your study material here</strong><small>or <span className="browse-link">browse your files</span></small></>}</span>{file ? <button className="remove-file" title="Remove file" onClick={(event) => { event.stopPropagation(); setFile(null); }}><X size={18}/></button> : <span className="format-hint">PDF, DOCX, TXT, MD <i>·</i> Max 15 MB</span>}
          </section>
          <div className="model-row"><label htmlFor="model-choice"><Cpu size={16}/> AI model</label><select id="model-choice" value={modelChoice} onChange={(event) => setModelChoice(event.target.value)}><option value="auto">Auto choose · switch when busy or limited</option>{models.map((model) => <option key={model.id} value={model.id}>{model.name} · {model.provider}</option>)}</select><span className="model-help">{modelChoice === "auto" ? "Automatic mode rotates across configured models and falls back when needed." : "Manual mode uses only this model; choose Auto to enable fallback."}</span></div>
          <div className="options-row"><button className={`web-toggle ${web ? "on" : ""}`} onClick={() => setWeb(!web)}><span className="toggle-track"><span/></span><Globe2 size={16}/><span>Enrich with the web</span><span className="optional-tag">OPTIONAL</span></button><button className="web-info" title="Searches the web for relevant context and includes source links with your results."><CircleHelp size={15}/></button></div>
          <div className="generate-row"><span className="privacy-note"><span className="privacy-dot"/> Sent to your selected AI provider; signed-in sets sync to Sheets.</span><button className="generate-button" onClick={generate} disabled={busy}>{busy ? <><span className="spinner"/> Making my study set…</> : <><Sparkles size={16}/> Make my study set <ChevronRight size={16}/></>}</button></div>
          {error && <div className="error-box"><CircleHelp size={16}/><span>{error}</span></div>}
          {notice && <div className="notice-box"><Check size={15}/><span>{notice}</span></div>}
          {result && currentCard && <section className="result-panel"><div className="result-head"><div><div className="result-kicker"><span/> YOUR STUDY SET</div><h2>{result.title}</h2><p>{result.items.length} {types.find((type) => type.id === result.type)?.title.toLowerCase()} · ready when you are{result.model ? ` · ${modelName(result.model)}` : ""}</p></div><button className="plain-icon" title="Close study set" onClick={() => setResult(null)}><X size={18}/></button></div>
            <div className="study-card"><div className="study-card-top"><span className="flashcard-label">{result.type === "flashcards" ? "FLASHCARD" : types.find((type) => type.id === result.type)?.title.toUpperCase()}</span><span className="card-number">{String(current + 1).padStart(2,"0")} <i>/</i> {String(result.items.length).padStart(2,"0")}</span></div>
              <button className={`study-face ${revealed ? "is-revealed" : ""}`} onClick={() => setRevealed(!revealed)}><span className="face-label">{revealed ? "THE ANSWER" : "YOUR QUESTION"}</span><span className="face-question">{revealed ? currentCard.answer : currentCard.question}</span>{!revealed && currentCard.options && <span className="answer-options">{currentCard.options.map((option, index) => <span key={`${index}-${option}`}><i>{String.fromCharCode(65 + index)}</i>{option}</span>)}</span>}{!revealed && <span className="tap-hint">Tap to reveal <span>↗</span></span>}</button>
              {revealed && currentCard.explanation && <p className="explanation">{currentCard.explanation}</p>}
              <div className="study-controls"><button className="control-button" onClick={() => { setCurrent((current - 1 + result.items.length) % result.items.length); setRevealed(false); }}><ChevronLeft size={16}/> Previous</button><span className="dots">{result.items.slice(0, Math.min(result.items.length, 7)).map((_, index) => <i key={index} className={index === current ? "dot-active" : ""}/>)}</span><button className="control-button next" onClick={() => { setCurrent((current + 1) % result.items.length); setRevealed(false); }}>Next <ChevronRight size={16}/></button></div>
              {result.sources?.length ? <div className="source-links"><Globe2 size={14}/><span>Sources:</span>{result.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}</a>)}</div> : null}
            </div></section>}
          <section className="recent-section"><div className="recent-head"><div><div className="section-title-row"><h2>Your recent sets</h2><span className="recent-count">{sets.length}</span></div><p>{account ? "Synced to your account." : "Saved on this device. Sign in to sync across devices."}</p></div>{sets.length > 3 && <button className="see-all" onClick={() => setShowAll(!showAll)}>{showAll ? "Show less" : "See all"} <ChevronRight size={15}/></button>}</div>
            {sets.length ? <div className="recent-grid">{sets.slice(0, showAll ? sets.length : 3).map((studySet, index) => <button className="recent-card" key={studySet.id} onClick={() => openSavedSet(studySet)}><span className={`recent-art art-${["aqua", "coral", "gold"][index % 3]}`}><BookOpen size={18}/><span className="art-orbit"/></span><span className="recent-info"><span className="subject-label">{types.find((type) => type.id === studySet.type)?.title.toUpperCase()}</span><strong>{studySet.title}</strong><small>{studySet.items.length} cards <i>·</i> {ageLabel(studySet.created_at)}</small></span><ChevronRight size={16} className="recent-arrow"/></button>)}</div> : <div className="empty-sets"><Layers3 size={20}/><span>Your study sets will appear here after you make one.</span></div>}
            <div className="bottom-note"><span>✳</span> Little by little, a little becomes a lot. <i>— A study reminder</i></div>
          </section>
          <section className="about-section" id="about"><div className="about-header"><img className="about-photo" src="/jairo-devon-daquioag.png" alt="Portrait of Jairo Devon A. Daquioag"/><div className="about-identity"><span className="eyebrow"><span/> THE PERSON BEHIND DAWNSTUDY</span><h2>Hey, I’m Jairo! <span role="img" aria-label="waving hand">👋</span></h2><p>Computer Engineering Student &amp; Developer</p><strong>Centro Escolar University Manila</strong><div className="about-tags"><span>Network Engineering</span><span>Applied AI</span></div></div></div><div className="about-body"><h3>Building Dawnstudy</h3><p>I’m Jairo Devon A. Daquioag, a Computer Engineering student at Centro Escolar University Manila who enjoys building things that solve problems, no matter how small.</p><p>I created Dawnstudy with my fellow students in mind. I wanted to make studying more accessible by turning PDFs into flashcards, multiple-choice questions, identification questions, and select-all-that-apply exercises—all powered by free-tier AI models.</p><p>I’m a tech generalist at heart, with a particular interest in Network Engineering and Applied AI. I enjoy exploring technology, experimenting with different AI models, and finding practical ways to use them to make everyday tasks easier.</p><p>For me, technology isn’t just about building something impressive. It’s about building something useful, especially when it can help others without costing them anything.</p></div><div className="about-links"><h3>Let’s connect</h3><a href="https://www.linkedin.com/in/jairo-devon-daquioag-466124295/" target="_blank" rel="noreferrer"><span className="social-mark">in</span><span><strong>LinkedIn</strong><small>Jairo Devon Daquioag</small></span><span className="external-mark">↗</span></a><a href="https://www.instagram.com/jairodaquioag/" target="_blank" rel="noreferrer"><span className="social-mark">◎</span><span><strong>Instagram</strong><small>@jairodaquioag</small></span><span className="external-mark">↗</span></a><a href="mailto:daquioagjairodevon@gmail.com"><span className="social-mark">✉</span><span><strong>Email</strong><small>daquioagjairodevon@gmail.com</small></span><span className="external-mark">↗</span></a></div></section>
        </div>
      </section>

      {authOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setAuthOpen(false); setAuthError(""); } }}>
        <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
          <button className="modal-close" aria-label="Close" onClick={() => { setAuthOpen(false); setAuthError(""); }}><X size={18}/></button>
          <div className="auth-mark"><Sparkles size={19}/></div>
          <p className="auth-eyebrow">YOUR STUDY SPACE</p>
          <h2 id="auth-title">{authMode === "register" ? "Create your account" : "Welcome back"}</h2>
          <p className="auth-subtitle">Save your study sets and pick up on any device.</p>
          <form className="auth-form" onSubmit={submitCredentials}>
            <label>Username<input autoComplete="username" minLength={3} maxLength={24} required value={username} onChange={(event) => setUsername(event.target.value)} placeholder="e.g. studywithsam"/></label>
            <label>Password<input autoComplete={authMode === "register" ? "new-password" : "current-password"} minLength={authMode === "register" ? 8 : undefined} maxLength={128} required type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={authMode === "register" ? "At least 8 characters" : "Your password"}/></label>
            {authMode === "register" && <small className="password-hint">Use 3–24 letters, numbers, dots, underscores, or hyphens for your username.</small>}
            {authError && <div className="auth-error">{authError}</div>}
            <button className="auth-submit" type="submit" disabled={authBusy}>{authBusy ? "Please wait…" : authMode === "register" ? "Create account" : "Sign in"}</button>
          </form>
          <div className="auth-divider"><span/> OR <span/></div>
          {GOOGLE_CLIENT_ID ? <div className="google-button-wrap"><div ref={googleButton}/></div> : <div className="google-not-ready">Google sign-in will be available after GCP setup.</div>}
          {!GOOGLE_CLIENT_ID && authError && <div className="auth-error">{authError}</div>}
          <p className="auth-switch">{authMode === "register" ? "Already have an account?" : "New to Dawnstudy?"} <button onClick={() => { setAuthMode(authMode === "register" ? "login" : "register"); setAuthError(""); }}> {authMode === "register" ? "Sign in" : "Create account"}</button></p>
        </section>
      </div>}
    </main>
  );
}
