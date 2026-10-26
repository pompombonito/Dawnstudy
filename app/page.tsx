"use client";

import { useRef, useState } from "react";
import { BookOpen, Check, CheckSquare, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, CloudUpload, FileText, Globe2, GraduationCap, Layers3, Menu, MoreHorizontal, Plus, Search, Sparkles, Trash2, X } from "lucide-react";

type Kind = "flashcards" | "multiple_choice" | "checkbox" | "identification";
type Card = { question: string; answer: string; options?: string[]; correct_answer?: string; explanation?: string };
type StudySet = { title: string; type: Kind; items: Card[]; sources?: { title: string; url: string }[] };
const types: { id: Kind; title: string; detail: string; icon: typeof Layers3 }[] = [
  { id: "flashcards", title: "Flashcards", detail: "Quick question & answer pairs", icon: Layers3 },
  { id: "multiple_choice", title: "Multiple choice", detail: "Choose the best answer", icon: CircleHelp },
  { id: "checkbox", title: "Select all that apply", detail: "Find every correct answer", icon: CheckSquare },
  { id: "identification", title: "Identification", detail: "Recall key terms", icon: FileText },
];
const examples: Card[] = [
  { question: "What is photosynthesis?", answer: "The process by which green plants convert sunlight, water, and carbon dioxide into glucose and oxygen." },
  { question: "Where does photosynthesis take place?", answer: "In the chloroplasts, using the green pigment chlorophyll to absorb light." },
  { question: "What are the two main stages of photosynthesis?", answer: "The light-dependent reactions and the Calvin cycle (light-independent reactions)." },
];
const initialSets = [
  { title: "Cell biology: the essentials", subject: "BIOLOGY", count: 18, color: "aqua", ago: "2h ago" },
  { title: "The French Revolution", subject: "HISTORY", count: 24, color: "coral", ago: "Yesterday" },
  { title: "Molecules & bonding", subject: "CHEMISTRY", count: 12, color: "gold", ago: "Oct 22" },
];

export default function Home() {
  const [selected, setSelected] = useState<Kind>("flashcards");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [web, setWeb] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<StudySet | null>(null);
  const [current, setCurrent] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [sets, setSets] = useState(initialSets);
  const [showAll, setShowAll] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const selectFile = (f?: File) => { if (f) { setFile(f); setError(""); setResult(null); } };
  async function generate() {
    if (!file) { setError("Choose a study material first."); return; }
    setBusy(true); setError("");
    const form = new FormData(); form.append("file", file); form.append("format", selected); form.append("use_web", String(web));
    try {
      const base = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");
      if (!base) throw new Error("Connect your Render API by setting NEXT_PUBLIC_API_URL in Vercel. Your file stays on this device until you generate a study set.");
      const res = await fetch(`${base}/api/generate`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Couldn't create your study set. Please try again.");
      setResult(data); setCurrent(0); setRevealed(false);
      setSets((old) => [{ title: data.title || file.name.replace(/\.[^.]+$/, ""), subject: "JUST CREATED", count: data.items.length, color: "aqua", ago: "Just now" }, ...old]);
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); }
    finally { setBusy(false); }
  }
  const items = result?.items || examples;
  const cur: Card = items[current] || items[0] || { question: "", answer: "" };
  return (
    <main className="shell">
      <aside className="sidebar">
        <a className="brand" href="#home"><span className="brand-icon"><Sparkles size={19} strokeWidth={2.2} /></span><span>dawn<span className="brand-light">study</span></span></a>
        <div className="side-kicker">YOUR SPACE</div>
        <button className="nav-item active"><span className="nav-icon"><BookOpen size={18}/></span> Study desk</button>
        <button className="nav-item"><span className="nav-icon"><Layers3 size={18}/></span> My study sets <span className="nav-count">{sets.length}</span></button>
        <button className="nav-item"><span className="nav-icon"><Clock3 size={18}/></span> Study history</button>
        <div className="side-separator" />
        <div className="set-heading"><span className="side-kicker">RECENT SETS</span><button className="plain-icon" title="Add a study set" onClick={() => input.current?.click()}><Plus size={17}/></button></div>
        <div className="mini-sets">{sets.map((s, i) => <button className="mini-set" key={`${s.title}-${i}`} onClick={() => { setResult({ title: s.title, type: selected, items: examples }); setCurrent(0); }}><span className={`set-dot ${s.color}`}><BookOpen size={14}/></span><span className="mini-copy"><span className="mini-title">{s.title}</span><span className="mini-meta">{s.count} cards · {s.ago}</span></span></button>)}</div>
        <div className="sidebar-bottom"><div className="plan-card"><span className="plan-spark"><Sparkles size={16}/></span><strong>A little more focus.</strong><p>Your notes, a quieter mind, and a brighter tomorrow.</p><span className="plan-tag">MADE FOR THE MOMENT</span></div><div className="profile"><span className="avatar">S</span><span className="profile-name">Student account<small>Free plan</small></span><MoreHorizontal size={19} className="profile-more"/></div></div>
      </aside>
      <section className="main-area" id="home">
        <header className="topbar"><div className="crumb"><span>Your space</span><ChevronRight size={14}/><b>Study desk</b></div><div className="top-actions"><span className="today-pill"><span className="status-dot"/> YOUR STUDY DESK</span><button className="profile-mobile"><Menu size={20}/></button></div></header>
        <div className="content">
          <section className="welcome"><div className="welcome-copy"><div className="eyebrow"><span/> A FRESH PAGE, A FRESH START</div><h1>Make today<br/>a little <em>brighter.</em></h1><p>Drop in your notes. We’ll help the important things stick.</p></div><div className="sunrise-art" aria-hidden="true"><div className="sun"/><div className="cloud cloud-one"/><div className="cloud cloud-two"/><div className="horizon h-back"/><div className="horizon h-front"/></div><span className="welcome-note">one page at a time <span>✳</span></span></section>
          <div className="section-intro"><div><div className="section-title-row"><h2>Start a study set</h2><span className="step-tag"><span>01</span> OF 02</span></div><p>Choose how you’d like to practice.</p></div><span className="quiet-note">Good things take practice <span>↗</span></span></div>
          <div className="type-grid">{types.map(({ id, title, detail, icon: Icon }) => <button key={id} className={`type-card ${selected === id ? "chosen" : ""}`} onClick={() => setSelected(id)}><span className="type-icon"><Icon size={19}/></span><span className="type-text"><strong>{title}</strong><small>{detail}</small></span>{selected === id && <span className="check-icon"><Check size={13} strokeWidth={3}/></span>}</button>)}</div>
          <section className={`upload-zone ${dragging ? "dragging" : ""} ${file ? "has-file" : ""}`} onDragOver={(e) => {e.preventDefault();setDragging(true);}} onDragLeave={() => setDragging(false)} onDrop={(e) => {e.preventDefault();setDragging(false);selectFile(e.dataTransfer.files[0]);}} onClick={() => !file && input.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && input.current?.click()}>
            <input ref={input} type="file" accept=".pdf,.docx,.txt,.md" hidden onChange={(e) => selectFile(e.target.files?.[0])}/>
            <span className="upload-icon">{file ? <FileText size={22}/> : <CloudUpload size={23}/>}</span><span className="upload-copy">{file ? <><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(2)} MB · ready to study</small></> : <><strong>Drop your study material here</strong><small>or <span className="browse-link">browse your files</span></small></>}</span>{file ? <button className="remove-file" title="Remove file" onClick={(e) => {e.stopPropagation();setFile(null);}}><X size={18}/></button> : <span className="format-hint">PDF, DOCX, TXT, MD <i>·</i> Max 15 MB</span>}
          </section>
          <div className="options-row"><button className={`web-toggle ${web ? "on" : ""}`} onClick={() => setWeb(!web)}><span className="toggle-track"><span/></span><Globe2 size={16}/><span>Enrich with the web</span><span className="optional-tag">OPTIONAL</span></button><button className="web-info" title="Searches the web for relevant context and includes source links with your results."><CircleHelp size={15}/></button></div>
          <div className="generate-row"><span className="privacy-note"><span className="privacy-dot"/> Sent to Google AI; avoid confidential notes.</span><button className="generate-button" onClick={generate} disabled={busy}>{busy ? <><span className="spinner"/> Making your study set…</> : <><Sparkles size={16}/> Make my study set <ChevronRight size={16}/></>}</button></div>
          {error && <div className="error-box"><CircleHelp size={16}/><span>{error}</span></div>}
          {result && <section className="result-panel"><div className="result-head"><div><div className="result-kicker"><span/> YOUR STUDY SET</div><h2>{result.title}</h2><p>{result.items.length} {types.find(t => t.id === result.type)?.title.toLowerCase()} · ready when you are</p></div><button className="plain-icon" title="Close study set" onClick={() => setResult(null)}><X size={18}/></button></div>
            <div className="study-card"><div className="study-card-top"><span className="flashcard-label">{result.type === "flashcards" ? "FLASHCARD" : types.find(t => t.id === result.type)?.title.toUpperCase()}</span><span className="card-number">{String(current + 1).padStart(2,"0")} <i>/</i> {String(items.length).padStart(2,"0")}</span></div><button className={`study-face ${revealed ? "is-revealed" : ""}`} onClick={() => setRevealed(!revealed)}><span className="face-label">{revealed ? (result.type === "flashcards" ? "THE ANSWER" : "ANSWER") : (result.type === "flashcards" ? "YOUR QUESTION" : "QUESTION")}</span><span className="face-question">{revealed ? cur.answer : cur.question}</span>{!revealed && cur.options && <span className="answer-options">{cur.options.map((opt, i) => <span key={opt}><i>{String.fromCharCode(65 + i)}</i>{opt}</span>)}</span>}{!revealed && <span className="tap-hint">Tap to reveal <span>↗</span></span>}</button>{revealed && cur.explanation && <p className="explanation">{cur.explanation}</p>}<div className="study-controls"><button className="control-button" onClick={() => {setCurrent((current - 1 + items.length) % items.length);setRevealed(false);}}><ChevronLeft size={16}/> Previous</button><span className="dots">{items.slice(0, Math.min(items.length, 7)).map((_, i) => <i key={i} className={i === current ? "dot-active" : ""}/>)}</span><button className="control-button next" onClick={() => {setCurrent((current + 1) % items.length);setRevealed(false);}}>Next <ChevronRight size={16}/></button></div>{result.sources?.length ? <div className="source-links"><Globe2 size={14}/><span>Sources:</span>{result.sources.map((s) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer">{s.title}</a>)}</div> : null}</div></section>}
          <section className="recent-section"><div className="recent-head"><div><div className="section-title-row"><h2>Your recent sets</h2><span className="recent-count">{sets.length}</span></div><p>Pick up where you left off.</p></div>{sets.length > 3 && <button className="see-all" onClick={() => setShowAll(!showAll)}>{showAll ? "Show less" : "See all"} <ChevronRight size={15}/></button>}</div><div className="recent-grid">{sets.slice(0, showAll ? sets.length : 3).map((s, i) => <button className="recent-card" key={`${s.title}-${i}`} onClick={() => {setResult({title:s.title,type:selected,items:examples});setCurrent(0);}}><span className={`recent-art art-${s.color}`}><BookOpen size={18}/><span className="art-orbit"/></span><span className="recent-info"><span className="subject-label">{s.subject}</span><strong>{s.title}</strong><small>{s.count} cards <i>·</i> {s.ago}</small></span><ChevronRight size={16} className="recent-arrow"/></button>)}</div><div className="bottom-note"><span>✳</span> Little by little, a little becomes a lot. <i>— A study reminder</i></div></section>
        </div>
      </section>
    </main>
  );
}
