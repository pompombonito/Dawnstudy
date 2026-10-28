"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { BookOpen, Check, ChevronLeft, ChevronRight, CircleHelp, RotateCcw, Sparkles } from "lucide-react";

type SharedCard = { question: string; answer: string; options?: string[]; correct_answer?: string; explanation?: string; source_refs?: string[] };
type SharedSet = { title: string; type: string; items: SharedCard[]; sources?: { title: string; url: string }[] };
type AnswerState = { selected: string | null; selectedMany: string[]; revealed: boolean };
const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");
const emptyAnswer = (): AnswerState => ({ selected: null, selectedMany: [], revealed: false });

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
                  revealed: Boolean(responseState.revealed),
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

  const card = studySet?.items[index];
  const response = responses[index] || emptyAnswer();
  const rawExpectedAnswer = String(card?.correct_answer || card?.answer || "");
  const resolvedExpectedAnswers = resolveChoiceAnswers(rawExpectedAnswer, card?.options || []);
  const expectedAnswer = resolvedExpectedAnswers.length ? resolvedExpectedAnswers.join(" | ") : rawExpectedAnswer;
  const expectedAnswers = (resolvedExpectedAnswers.length ? resolvedExpectedAnswers : rawExpectedAnswer.split("|")).map(normalizedAnswer).filter(Boolean);
  const isCorrect = (option: string) => expectedAnswers.includes(normalizedAnswer(option));
  const checkboxMode = studySet?.type === "checkbox";
  const scoreableCount = studySet ? studySet.items.filter((item) => Boolean(item.options?.length)).length : 0;
  const answeredCount = studySet ? studySet.items.reduce((count, item, itemIndex) => count + (item.options?.length && responses[itemIndex]?.revealed ? 1 : 0), 0) : 0;
  const correctCount = studySet ? studySet.items.reduce((count, item, itemIndex) => {
    const saved = responses[itemIndex];
    if (!item.options?.length || !saved?.revealed) return count;
    const rawAnswers = String(item.correct_answer || item.answer || "");
    const resolvedAnswers = resolveChoiceAnswers(rawAnswers, item.options || []);
    const answers = (resolvedAnswers.length ? resolvedAnswers : rawAnswers.split("|")).map(normalizedAnswer).filter(Boolean);
    const correct = item.options.filter((option) => answers.includes(normalizedAnswer(option)));
    const picked = studySet.type === "checkbox" ? saved.selectedMany : saved.selected ? [saved.selected] : [];
    const right = picked.filter((option) => answers.includes(normalizedAnswer(option)));
    const isAnswerCorrect = studySet.type === "checkbox"
      ? right.length === correct.length && picked.length === correct.length
      : picked.length === 1 && right.length === 1;
    return count + (isAnswerCorrect ? 1 : 0);
  }, 0) : 0;

  function move(nextIndex: number) {
    if (!studySet) return;
    setIndex(Math.max(0, Math.min(studySet.items.length - 1, nextIndex)));
  }

  return <main className="shared-shell">
    <header className="shared-brand"><a href="/"><span className="brand-icon"><Sparkles size={18}/></span><span>dawn<span>study</span><small>shared study set</small></span></a><span className="shared-readonly">VIEW ONLY</span></header>
    {error ? <section className="shared-message"><CircleHelp size={23}/><h1>Can't open this set</h1><p>{error}</p><a href="/">Go to Dawnstudy</a></section> : !studySet || !card ? <section className="shared-message"><span className="spinner"/><p>Loading shared study set…</p></section> : <section className="shared-content">
      <div className="result-kicker"><span/> SHARED BY A CLASSMATE</div><h1>{studySet.title}</h1><p className="shared-subtitle">{studySet.items.length} questions · {studySet.type.replaceAll("_", " ")}</p>
      <div className="shared-quiz-summary"><span>{scoreableCount ? `Score ${correctCount}/${answeredCount} answered · ${answeredCount} of ${scoreableCount} scored questions` : `${responses.filter((item) => item.revealed).length} cards reviewed`}</span><button type="button" onClick={restartQuiz}><RotateCcw size={14}/> Restart quiz</button></div>
      <article className="shared-card"><div className="shared-card-top"><span>QUESTION {index + 1}</span><span>{String(index + 1).padStart(2, "0")} / {String(studySet.items.length).padStart(2, "0")}</span></div><h2>{card.question}</h2>
        {card.options?.length && checkboxMode ? <><div className="choice-options">{card.options.map((option, optionIndex) => {
          const correct = isCorrect(option);
          const wrong = response.selectedMany.includes(option) && !correct;
          const status = !response.revealed ? "" : correct ? "choice-correct" : wrong ? "choice-wrong" : "";
          return <button type="button" key={`${optionIndex}-${option}`} className={`choice-option ${status}`} disabled={response.revealed} aria-pressed={response.selectedMany.includes(option)} onClick={() => updateCurrentResponse({ ...response, selectedMany: response.selectedMany.includes(option) ? response.selectedMany.filter((item) => item !== option) : [...response.selectedMany, option] })}><i>{response.selectedMany.includes(option) ? "✓" : String.fromCharCode(65 + optionIndex)}</i><span>{option}</span>{response.revealed && correct && <Check size={16}/>}</button>;
        })}</div>{!response.revealed && <button className="action-button" onClick={() => updateCurrentResponse({ ...response, revealed: true })}>Check answers</button>}</> : card.options?.length ? <div className="choice-options">{card.options.map((option, optionIndex) => {
          const correct = isCorrect(option);
          const wrong = response.selected === option && !correct;
          const status = !response.revealed ? "" : correct ? "choice-correct" : wrong ? "choice-wrong" : "";
          return <button type="button" key={`${optionIndex}-${option}`} className={`choice-option ${status}`} disabled={response.revealed} aria-pressed={response.selected === option} onClick={() => updateCurrentResponse({ ...response, selected: option, revealed: true })}><i>{String.fromCharCode(65 + optionIndex)}</i><span>{option}</span>{response.revealed && correct && <Check size={16}/>}</button>;
        })}</div> : <button className={`shared-answer ${response.revealed ? "is-revealed" : ""}`} onClick={() => updateCurrentResponse({ ...response, revealed: !response.revealed })}>{response.revealed ? card.answer : "Tap to reveal the answer"}</button>}
        {response.revealed && card.options?.length && <p className={`shared-feedback ${checkboxMode ? expectedAnswers.length === response.selectedMany.filter((option) => isCorrect(option)).length && response.selectedMany.every(isCorrect) ? "correct" : "wrong" : isCorrect(response.selected || "") ? "correct" : "wrong"}`}>{checkboxMode ? expectedAnswers.length === response.selectedMany.filter((option) => isCorrect(option)).length && response.selectedMany.every(isCorrect) ? "Correct!" : `Correct answers: ${expectedAnswer}` : isCorrect(response.selected || "") ? "Correct!" : `Correct answer: ${expectedAnswer}`}</p>}
        {response.revealed && card.explanation && <p className="explanation">{card.explanation}</p>}
        {card.source_refs?.length ? <div className="material-citations"><strong>From the uploaded material</strong>{card.source_refs.map((source) => <span key={source}>{source}</span>)}</div> : null}
        <div className="study-controls"><button className="control-button" disabled={index === 0} onClick={() => move(index - 1)}><ChevronLeft size={15}/> Previous</button><button className="control-button next" disabled={index >= studySet.items.length - 1} onClick={() => move(index + 1)}>Next <ChevronRight size={15}/></button></div>
      </article>
      {studySet.sources?.length ? <div className="shared-sources"><strong>Web sources</strong>{studySet.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}</a>)}</div> : null}
      <p className="shared-footer"><BookOpen size={14}/> Your answers and score stay on this device for this quiz session. The owner can turn this link off at any time.</p>
    </section>}
  </main>;
}
