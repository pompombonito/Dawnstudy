"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { BookOpen, Check, ChevronLeft, ChevronRight, CircleHelp, Sparkles } from "lucide-react";

type SharedCard = { question: string; answer: string; options?: string[]; correct_answer?: string; explanation?: string; source_refs?: string[] };
type SharedSet = { title: string; type: string; items: SharedCard[]; sources?: { title: string; url: string }[] };
const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

export default function SharedStudySetPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [studySet, setStudySet] = useState<SharedSet | null>(null);
  const [error, setError] = useState("");
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedMany, setSelectedMany] = useState<string[]>([]);

  useEffect(() => {
    if (!token || !API_BASE) { setError("This share link is unavailable."); return; }
    fetch(`${API_BASE}/api/shared/${encodeURIComponent(token)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 404 ? "This link is invalid or the owner turned it off." : "The shared set could not be loaded. Please try again.");
        setStudySet(await response.json());
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "The shared set could not be loaded."));
  }, [token]);

  function move(nextIndex: number) {
    if (!studySet) return;
    setIndex((nextIndex + studySet.items.length) % studySet.items.length);
    setRevealed(false); setSelected(null); setSelectedMany([]);
  }

  const card = studySet?.items[index];
  const expectedAnswer = card?.correct_answer || card?.answer || "";
  const expectedAnswers = expectedAnswer.split("|").map((answer) => answer.trim().toLocaleLowerCase());
  const isCorrect = (option: string) => expectedAnswers.includes(option.trim().toLocaleLowerCase());
  const checkboxMode = studySet?.type === "checkbox";

  return <main className="shared-shell">
    <header className="shared-brand"><a href="/"><span className="brand-icon"><Sparkles size={18}/></span><span>dawn<span>study</span><small>shared study set</small></span></a><span className="shared-readonly">VIEW ONLY</span></header>
    {error ? <section className="shared-message"><CircleHelp size={23}/><h1>Can't open this set</h1><p>{error}</p><a href="/">Go to Dawnstudy</a></section> : !studySet || !card ? <section className="shared-message"><span className="spinner"/><p>Loading shared study set…</p></section> : <section className="shared-content">
      <div className="result-kicker"><span/> SHARED BY A CLASSMATE</div><h1>{studySet.title}</h1><p className="shared-subtitle">{studySet.items.length} questions · {studySet.type.replaceAll("_", " ")}</p>
      <article className="shared-card"><div className="shared-card-top"><span>QUESTION {index + 1}</span><span>{String(index + 1).padStart(2, "0")} / {String(studySet.items.length).padStart(2, "0")}</span></div><h2>{card.question}</h2>
        {card.options?.length && checkboxMode ? <><div className="choice-options">{card.options.map((option, optionIndex) => {
          const correct = isCorrect(option);
          const wrong = selectedMany.includes(option) && !correct;
          const status = !revealed ? "" : correct ? "choice-correct" : wrong ? "choice-wrong" : "";
          return <button type="button" key={`${optionIndex}-${option}`} className={`choice-option ${status}`} disabled={revealed} aria-pressed={selectedMany.includes(option)} onClick={() => setSelectedMany((old) => old.includes(option) ? old.filter((item) => item !== option) : [...old, option])}><i>{selectedMany.includes(option) ? "✓" : String.fromCharCode(65 + optionIndex)}</i><span>{option}</span>{revealed && correct && <Check size={16}/>}</button>;
        })}</div>{!revealed && <button className="action-button" onClick={() => setRevealed(true)}>Check answers</button>}</> : card.options?.length ? <div className="choice-options">{card.options.map((option, optionIndex) => {
          const correct = isCorrect(option);
          const wrong = selected === option && !correct;
          const status = !revealed ? "" : correct ? "choice-correct" : wrong ? "choice-wrong" : "";
          return <button type="button" key={`${optionIndex}-${option}`} className={`choice-option ${status}`} disabled={revealed} onClick={() => { setSelected(option); setRevealed(true); }}><i>{String.fromCharCode(65 + optionIndex)}</i><span>{option}</span>{revealed && correct && <Check size={16}/>}</button>;
        })}</div> : <button className={`shared-answer ${revealed ? "is-revealed" : ""}`} onClick={() => setRevealed(!revealed)}>{revealed ? card.answer : "Tap to reveal the answer"}</button>}
        {revealed && card.options?.length && <p className={`shared-feedback ${checkboxMode ? expectedAnswers.length === selectedMany.filter((option) => isCorrect(option)).length && selectedMany.every(isCorrect) ? "correct" : "wrong" : isCorrect(selected || "") ? "correct" : "wrong"}`}>{checkboxMode ? expectedAnswers.length === selectedMany.filter((option) => isCorrect(option)).length && selectedMany.every(isCorrect) ? "Correct!" : `Correct answers: ${expectedAnswer}` : isCorrect(selected || "") ? "Correct!" : `Correct answer: ${expectedAnswer}`}</p>}
        {revealed && card.explanation && <p className="explanation">{card.explanation}</p>}
        {card.source_refs?.length ? <div className="material-citations"><strong>From the uploaded material</strong>{card.source_refs.map((source) => <span key={source}>{source}</span>)}</div> : null}
        <div className="study-controls"><button className="control-button" onClick={() => move(index - 1)}><ChevronLeft size={15}/> Previous</button><button className="control-button next" onClick={() => move(index + 1)}>Next <ChevronRight size={15}/></button></div>
      </article>
      {studySet.sources?.length ? <div className="shared-sources"><strong>Web sources</strong>{studySet.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}</a>)}</div> : null}
      <p className="shared-footer"><BookOpen size={14}/> Shared link access. The owner can turn this link off at any time.</p>
    </section>}
  </main>;
}
