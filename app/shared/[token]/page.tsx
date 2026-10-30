"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowUpRight, BookOpen, Check, ChevronLeft, ChevronRight, CircleHelp, ExternalLink, Maximize2, Minimize2, Moon, RotateCcw, Share2, Sun } from "lucide-react";

type SharedCard = { question: string; answer: string; options?: string[]; correct_answer?: string; explanation?: string; source_refs?: string[] };
type SharedSet = { title: string; type: string; items: SharedCard[]; sources?: { title: string; url: string }[] };
type AnswerState = { selected: string | null; selectedMany: string[]; revealed: boolean };
const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");
const emptyAnswer = (): AnswerState => ({ selected: null, selectedMany: [], revealed: false });
const typeNames: Record<string, string> = { flashcards: "Flashcards", multiple_choice: "Multiple choice", checkbox: "Select all that apply", identification: "Identification" };

function normalizedAnswer(value: unknown) {
  return String(value ?? "").toLocaleLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function resolveChoiceAnswers(answer: unknown, options: string[]) {
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

export default function SharedStudySetPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [studySet, setStudySet] = useState<SharedSet | null>(null);
  const [error, setError] = useState("");
  const [index, setIndex] = useState(0);
  const [responses, setResponses] = useState<AnswerState[]>([]);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [fullscreen, setFullscreen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const quizPanel = useRef<HTMLElement>(null);

  useEffect(() => {
    let saved: "dark" | "light" = "dark";
    try { saved = localStorage.getItem("dawnstudy_theme_v1") === "light" ? "light" : "dark"; } catch { /* Device storage is optional. */ }
    setTheme(saved);
    document.documentElement.dataset.theme = saved;
    const onFullscreen = () => setFullscreen(document.fullscreenElement === quizPanel.current);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => document.removeEventListener("fullscreenchange", onFullscreen);
  }, []);

  useEffect(() => {
    if (!focusMode) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    quizPanel.current?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFocusMode(false);
      if (event.key === "Tab") {
        const controls = Array.from(quizPanel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]') || []);
        const first = controls[0], last = controls[controls.length - 1];
        if (!first) return;
        if (event.shiftKey && (document.activeElement === first || document.activeElement === quizPanel.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === quizPanel.current)) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", close);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", close); previousFocus?.focus(); };
  }, [focusMode]);

  useEffect(() => {
    setStudySet(null); setError(""); setIndex(0); setResponses([]);
    if (!token || !API_BASE) { setError("This share link is unavailable."); return; }
    fetch(`${API_BASE}/api/shared/${encodeURIComponent(token)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 404 ? "This link is invalid or the owner turned it off." : "The shared set could not be loaded. Please try again.");
        const data: SharedSet = await response.json();
        const defaults = Array.from({ length: data.items.length }, emptyAnswer);
        try {
          const saved = JSON.parse(sessionStorage.getItem(`dawnstudy_shared_progress_v1:${token}`) || "null");
          if (Array.isArray(saved)) {
            for (let item = 0; item < Math.min(saved.length, defaults.length); item += 1) {
              const responseState = saved[item];
              if (responseState && typeof responseState === "object") {
                defaults[item] = {
                  selected: typeof responseState.selected === "string" ? responseState.selected : null,
                  selectedMany: Array.isArray(responseState.selectedMany) ? responseState.selectedMany.filter((answer: unknown) => typeof answer === "string") : [],
                  revealed: Boolean(responseState.revealed) && (data.type !== "identification" || (typeof responseState.selected === "string" && Boolean(responseState.selected.trim()))),
                };
              }
            }
          }
        } catch { /* A damaged saved session starts a fresh quiz. */ }
        setResponses(defaults);
        setStudySet(data);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "The shared set could not be loaded."));
  }, [token]);

  function updateCurrentResponse(next: AnswerState) {
    const updated = responses.map((response, responseIndex) => responseIndex === index ? next : response);
    setResponses(updated);
    try { sessionStorage.setItem(`dawnstudy_shared_progress_v1:${token}`, JSON.stringify(updated)); }
    catch { /* The quiz still works when browser storage is unavailable. */ }
  }

  function restartQuiz() {
    if (!studySet) return;
    setIndex(0);
    setResponses(Array.from({ length: studySet.items.length }, emptyAnswer));
    try { sessionStorage.removeItem(`dawnstudy_shared_progress_v1:${token}`); }
    catch { /* Restarting the visible quiz does not depend on browser storage. */ }
  }

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("dawnstudy_theme_v1", next); } catch { /* The theme still changes when storage is unavailable. */ }
  }

  async function toggleFullscreen() {
    if (focusMode) { setFocusMode(false); return; }
    if (document.fullscreenElement === quizPanel.current) { await document.exitFullscreen(); return; }
    try {
      if (!quizPanel.current?.requestFullscreen) { setFocusMode(true); return; }
      await quizPanel.current.requestFullscreen();
    } catch { setFocusMode(true); }
  }

  function responseIsCorrect(item: SharedCard, saved: AnswerState | undefined) {
    if (!saved?.revealed || !studySet) return false;
    const raw = String(item.correct_answer || item.answer || "");
    const resolved = resolveChoiceAnswers(raw, item.options || []);
    const answers = (resolved.length ? resolved : raw.split("|")).map(normalizedAnswer).filter(Boolean);
    if (!item.options?.length) return studySet.type === "identification" && answers.includes(normalizedAnswer(saved.selected));
    const correct = item.options.filter((option) => answers.includes(normalizedAnswer(option)));
    const picked = studySet.type === "checkbox" ? saved.selectedMany : saved.selected ? [saved.selected] : [];
    const right = picked.filter((option) => answers.includes(normalizedAnswer(option)));
    return studySet.type === "checkbox" ? right.length === correct.length && picked.length === correct.length : picked.length === 1 && right.length === 1;
  }

  const card = studySet?.items[index];
  const response = responses[index] || emptyAnswer();
  const rawExpectedAnswer = String(card?.correct_answer || card?.answer || "");
  const resolvedExpectedAnswers = resolveChoiceAnswers(rawExpectedAnswer, card?.options || []);
  const expectedAnswer = resolvedExpectedAnswers.length ? resolvedExpectedAnswers.join(" | ") : rawExpectedAnswer;
  const expectedAnswers = (resolvedExpectedAnswers.length ? resolvedExpectedAnswers : rawExpectedAnswer.split("|")).map(normalizedAnswer).filter(Boolean);
  const isCorrect = (option: string) => expectedAnswers.includes(normalizedAnswer(option));
  const checkboxMode = studySet?.type === "checkbox";
  const identificationMode = studySet?.type === "identification";
  const scoreableCount = studySet ? studySet.items.filter((item) => Boolean(item.options?.length) || identificationMode).length : 0;
  const answeredCount = studySet ? studySet.items.reduce((count, item, itemIndex) => count + ((item.options?.length || identificationMode) && responses[itemIndex]?.revealed ? 1 : 0), 0) : 0;
  const reviewedCount = responses.filter((item) => item.revealed).length;
  const correctCount = studySet ? studySet.items.reduce((count, item, itemIndex) => count + (responseIsCorrect(item, responses[itemIndex]) ? 1 : 0), 0) : 0;
  const completedCount = scoreableCount ? answeredCount : reviewedCount;
  const progress = studySet?.items.length ? Math.round(completedCount / studySet.items.length * 100) : 0;
  const currentIsCorrect = card ? responseIsCorrect(card, response) : false;

  function move(nextIndex: number) {
    if (!studySet) return;
    setIndex(Math.max(0, Math.min(studySet.items.length - 1, nextIndex)));
  }

  return <main className="shared-shell">
    <header className="shared-site-header">
      <a className="shared-logo" href="/" aria-label="Dawnstudy home"><svg viewBox="0 0 42 42" aria-hidden="true"><path d="M6 27h30M9 33h24"/><path d="M11 25a10 10 0 0 1 20 0"/><path d="M21 5v4M7 11l3 3M35 11l-3 3M3 22h4M35 22h4"/></svg><span>dawn<strong>study</strong><small>Make learning stick.</small></span></a>
      <div className="shared-header-actions"><span className="shared-room-label"><Share2 size={15}/> A shared study room</span><button className="shared-icon-button" type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>{theme === "dark" ? <Sun size={19}/> : <Moon size={19}/>}</button><a className="shared-desk-link" href="/">My study desk <ArrowUpRight size={17}/></a></div>
    </header>
    {error ? <section className="shared-empty"><span className="shared-empty-icon"><CircleHelp size={29}/></span><p className="shared-eyebrow">LINK UNAVAILABLE</p><h1>This study room is closed.</h1><p>{error}</p><a className="shared-primary-button" href="/">Go to Dawnstudy <ArrowUpRight size={17}/></a></section> : !studySet || !card ? <section className="shared-empty"><span className="shared-loading-sun"/><p className="shared-eyebrow">GETTING THINGS READY</p><h1>A little focus is on its way.</h1><p>Opening your classmate’s study set…</p></section> : <div className="shared-workspace">
      <aside className="shared-progress-rail">
        <p className="shared-eyebrow">SHARED BY A CLASSMATE</p>
        <h1>{studySet.title}</h1>
        <p className="shared-set-meta">{studySet.items.length} questions <span/> {typeNames[studySet.type] || studySet.type.replaceAll("_", " ")}</p>
        <div className="shared-session-progress">
          <div className="shared-progress-ring"><svg viewBox="0 0 100 100" aria-hidden="true"><circle className="shared-ring-track" cx="50" cy="50" r="43"/><circle className="shared-ring-fill" cx="50" cy="50" r="43" strokeDasharray={270.18} strokeDashoffset={270.18 * (1 - progress / 100)}/></svg><strong>{progress}<span>%</span></strong></div>
          <div><small>YOUR SESSION</small><strong>{completedCount} <span>of {studySet.items.length}</span></strong><p>{scoreableCount ? "questions answered" : "cards reviewed"}</p></div>
        </div>
        {scoreableCount > 0 && <div className="shared-score-line"><span>Correct answers</span><strong>{correctCount}<small> / {answeredCount || "—"}</small></strong></div>}
        <div className="shared-question-map"><div className="shared-map-heading"><h2>Find a question</h2><span>{index + 1} / {studySet.items.length}</span></div><div className="shared-question-grid">{studySet.items.map((item, itemIndex) => {
          const saved = responses[itemIndex];
          const marked = saved?.revealed;
          const scoreable = Boolean(item.options?.length) || identificationMode;
          return <button type="button" key={itemIndex} className={[itemIndex === index ? "is-current" : "", marked ? "is-complete" : "", marked && scoreable ? responseIsCorrect(item, saved) ? "is-correct" : "is-wrong" : ""].filter(Boolean).join(" ")} aria-label={`Go to question ${itemIndex + 1}${marked ? ", answered" : ""}`} aria-current={itemIndex === index ? "step" : undefined} onClick={() => move(itemIndex)}>{String(itemIndex + 1).padStart(2, "0")}</button>;
        })}</div></div>
        <button className="shared-restart" type="button" onClick={restartQuiz}><RotateCcw size={17}/> Restart this quiz</button>
        <p className="shared-save-note"><BookOpen size={17}/><span>Your answers stay here when you go back to a previous question.</span></p>
      </aside>
      <section className="shared-quiz-column" aria-label="Shared quiz">
        <section ref={quizPanel} className={`shared-exercise ${focusMode ? "shared-focus-mode" : ""}`} tabIndex={-1} role={focusMode ? "dialog" : undefined} aria-modal={focusMode ? true : undefined} aria-label={focusMode ? "Quiz fullscreen" : "Quiz questions"}>
          <div className="shared-exercise-toolbar"><span><i/> {typeNames[studySet.type] || "Study session"}</span><button className="shared-fullscreen" type="button" onClick={() => void toggleFullscreen()} aria-pressed={fullscreen || focusMode}>{fullscreen || focusMode ? <Minimize2 size={18}/> : <Maximize2 size={18}/>}<span>{fullscreen || focusMode ? "Exit fullscreen" : "Quiz fullscreen"}</span></button></div>
          <article className="shared-question-card">
            <div className="shared-question-top"><span>QUESTION {String(index + 1).padStart(2, "0")}</span><span>{String(index + 1).padStart(2, "0")}<i>/</i>{String(studySet.items.length).padStart(2, "0")}</span></div>
            <h2>{card.question}</h2>
            <p className="shared-answer-hint">{card.options?.length ? checkboxMode ? "Select every answer that applies, then check your choices." : "Choose the best answer below." : identificationMode ? "Recall the term or concept and type your answer." : "Think it through, then reveal the answer when you’re ready."}</p>
            {card.options?.length ? <>
              <div className="shared-options" role="group" aria-label={checkboxMode ? "Select all correct answers" : "Choose an answer"}>{card.options.map((option, optionIndex) => {
                const correct = isCorrect(option);
                const picked = checkboxMode ? response.selectedMany.includes(option) : response.selected === option;
                const status = response.revealed ? correct ? "is-correct" : picked ? "is-wrong" : "" : picked ? "is-picked" : "";
                return <button type="button" key={`${optionIndex}-${option}`} className={`shared-option ${status}`} disabled={response.revealed} aria-pressed={picked} onClick={() => checkboxMode ? updateCurrentResponse({ ...response, selectedMany: picked ? response.selectedMany.filter((item) => item !== option) : [...response.selectedMany, option] }) : updateCurrentResponse({ ...response, selected: option, revealed: true })}><i className={checkboxMode ? "is-checkbox" : ""}>{checkboxMode && picked ? <Check size={16}/> : String.fromCharCode(65 + optionIndex)}</i><span>{option}</span>{response.revealed && correct && <Check size={19}/>}</button>;
              })}</div>
              {checkboxMode && !response.revealed && <button className="shared-primary-button shared-check-button" type="button" disabled={!response.selectedMany.length} onClick={() => updateCurrentResponse({ ...response, revealed: true })}>Check my answers <Check size={17}/></button>}
            </> : identificationMode ? <form className="shared-written-answer" onSubmit={(event) => { event.preventDefault(); if (response.selected?.trim() && !response.revealed) updateCurrentResponse({ ...response, revealed: true }); }}><label htmlFor="shared-identification">Your answer</label><input id="shared-identification" value={response.selected || ""} disabled={response.revealed} placeholder="Type the term or concept…" autoComplete="off" onChange={(event) => updateCurrentResponse({ ...response, selected: event.target.value })}/>{!response.revealed && <button className="shared-primary-button" type="submit" disabled={!response.selected?.trim()}>Check my answer <Check size={17}/></button>}</form> : <button className={`shared-reveal ${response.revealed ? "is-revealed" : ""}`} onClick={() => updateCurrentResponse({ ...response, revealed: !response.revealed })}><span>{response.revealed ? "THE ANSWER" : "READY WHEN YOU ARE"}</span><strong>{response.revealed ? card.answer : "Reveal the answer"}</strong>{!response.revealed && <ArrowUpRight size={22}/>}</button>}
            {response.revealed && (card.options?.length || identificationMode) && <div className={`shared-answer-feedback ${currentIsCorrect ? "is-correct" : "is-wrong"}`} role="status"><span>{currentIsCorrect ? <Check size={19}/> : <CircleHelp size={19}/>}</span><div><strong>{currentIsCorrect ? "You’ve got it." : "Keep this one in mind."}</strong>{!currentIsCorrect && <p>{checkboxMode ? "Correct answers: " : "Correct answer: "}{expectedAnswer}</p>}</div></div>}
            {response.revealed && card.explanation && <div className="shared-explanation"><span>WHY THIS ANSWER</span><p>{card.explanation}</p></div>}
            {card.source_refs?.length ? <div className="shared-citations"><span>FROM THE MATERIAL</span><div>{card.source_refs.map((source) => <small key={source}>{source}</small>)}</div></div> : null}
            <div className="shared-navigation"><button className="shared-nav-button" disabled={index === 0} onClick={() => move(index - 1)}><ChevronLeft size={18}/> Previous</button><span>{response.revealed ? <><Check size={14}/> Answer saved</> : "One question at a time."}</span><button className="shared-nav-button is-next" disabled={index >= studySet.items.length - 1} onClick={() => move(index + 1)}>Next question <ChevronRight size={18}/></button></div>
          </article>
        </section>
        {studySet.sources?.length ? <section className="shared-web-sources"><div><ExternalLink size={18}/><h2>Explore the source material</h2></div>{studySet.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer"><span>{source.title}</span><ArrowUpRight size={17}/></a>)}</section> : null}
        <p className="shared-session-note">Saved on this device for this quiz session. The owner can turn this link off at any time.</p>
      </section>
    </div>}
    <footer className="shared-site-footer"><span>Made for the next small breakthrough.</span><a href="/">dawnstudy <ArrowUpRight size={14}/></a></footer>
  </main>;
}
