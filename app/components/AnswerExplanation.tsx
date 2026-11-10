export type ExplanationCard = {
  explanation?: string;
  explanation_origin?: "provided" | "ai";
  explanation_pending?: boolean;
  import_notices?: string[];
};

/** Keep rationale and import metadata out of the DOM until an answer is checked. */
export default function AnswerExplanation({ card, revealed, className = "explanation" }: {
  card: ExplanationCard; revealed: boolean; className?: string;
}) {
  if (!revealed) return null;
  const explanation = typeof card.explanation === "string" ? card.explanation.trim() : "";
  const notices = [...new Set((card.import_notices || []).filter((notice) => typeof notice === "string" && notice.trim()).map((notice) => notice.trim()))];
  if (!explanation && !notices.length && !card.explanation_pending) return null;
  const label = card.explanation_origin === "provided" ? "Explanation from your material"
    : card.explanation_origin === "ai" ? "AI explanation · review for accuracy" : "Why this answer";
  return <div className={`answer-explanation ${className}`}>
    {explanation && <div className="answer-rationale"><strong>{label}</strong><p>{explanation}</p></div>}
    {!explanation && card.explanation_pending && <p className="answer-explanation-pending" role="status">This explanation is still being prepared. Your supplied answer is kept.</p>}
    {notices.length > 0 && <div className="answer-import-notices" role="note"><strong>Import notes</strong><ul>{notices.map((notice) => <li key={notice}>{notice}</li>)}</ul></div>}
  </div>;
}
