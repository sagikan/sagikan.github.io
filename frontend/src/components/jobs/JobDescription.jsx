import { useMemo, useState } from "react";
import PillGroup from "../ui/PillGroup";
import { PixelDigit } from "../layout/Logo";
import { parseDescription, textDirection } from "../../utils/jobs/jobDescription";

// The section shown first, when the description has one: what the job asks for is what's read first
const DEFAULT_SECTION = "requirements";

// Shows a section's paragraphs, lists and subheadings
function Blocks({ blocks }) {
  return blocks.map((block, index) => {
    if (block.type === "list") {
      return (
        <ul key={index} className="job-desc-list">
          {block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}
        </ul>
      );
    }

    if (block.type === "subheading") {
      return <h4 key={index} className="job-desc-subheading">{block.text}</h4>;
    }

    return <p key={index}>{block.text}</p>;
  });
}

// Shows a job description sorted into the same sections for every job, one section at a time, requirements first
function JobDescription({ description, position, company }) {
  const sections = useMemo(() => parseDescription(description, position, company), [description, position, company]);
  const tabs = useMemo(() => sections.map((section) => ({ key: section.key, label: section.tab })), [sections]);
  const direction = useMemo(() => textDirection(description), [description]);
  const [chosen, setChosen] = useState(null);

  if (sections.length === 0) {
    return <p className="muted">No description was saved for this job. Use "View posting" to read it on the original site.</p>;
  }

  const picked = sections.findIndex((section) => section.key === (chosen ?? DEFAULT_SECTION));
  const index = Math.max(picked, 0);
  const shown = sections[index];

  return (
    <div className="job-desc">
      {sections.length > 1 && (
        <div className="job-desc-track">
          <PillGroup className="job-desc-tabs" mode="tab" aria-label="Description sections" options={tabs} value={shown.key} onChange={setChosen} />
        </div>
      )}
      <section key={shown.key} className="job-desc-panel" role={sections.length > 1 ? "tabpanel" : undefined} aria-label={shown.title}>
        <h3 className="job-desc-title">
          {/* There are seven sections at most, and pixel digits run from 0 to 6 */}
          <PixelDigit digit={index} crisp height="0.7em" className="job-desc-num" />
          {shown.title}
        </h3>
        <div className="job-desc-body" dir={direction}>
          <Blocks blocks={shown.blocks} />
        </div>
      </section>
    </div>
  );
}

export default JobDescription;
