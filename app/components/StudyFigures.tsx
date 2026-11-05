import { studyFigures, type StudyFigureCard } from "../study-figures";

export default function StudyFigures({ card }: { card: StudyFigureCard }) {
  const figures = studyFigures(card);
  if (!figures.length) return null;
  const missingSourceLabels = figures.length > 1 && figures.some(figure => !figure.sourceLabel);
  return <div className="study-figures">
    <div className="study-figure-list">{figures.map((figure, index) => <figure key={index}>
      <img src={figure.image} alt={`${figure.label} from the uploaded study material`} loading="lazy"/>
      <figcaption>{figure.label}</figcaption>
    </figure>)}</div>
    {missingSourceLabels && <p className="study-figure-notice" role="note">Multiple images are attached without complete source labels. Check the original page to identify the image referenced by this question.</p>}
  </div>;
}
