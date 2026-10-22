import { useCallback, useRef, useState } from "react";
import TagInput from "./TagInput";
import { wordDiff } from "../../utils/resume/wordDiff";
import { basePositions } from "../../utils/resume/cvChanges";
import { useDismiss } from "../../hooks/useDismiss";
import { LIMITS, MONTHS, digitsOnly, formatMonth, isEntryComplete, parseMonth, titleCase } from "../../utils/resume/resumeRules";

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 46 }, (_, i) => String(CURRENT_YEAR + 1 - i));

let nextId = 0;
const newId = (prefix) => `${prefix}-new-${++nextId}`;
const filled = (value) => String(value ?? "").trim() !== "";
const textOf = (item) => (typeof item === "string" ? item : item.text);

function RemoveButton({ label, onClick, className = "" }) {
  return (
    <button type="button" className={`icon-btn icon-btn-danger ${className}`} onClick={onClick} aria-label={label} title={label}>
      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
        <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </button>
  );
}

export function Required() {
  return <span className="req" aria-hidden="true"> *</span>;
}

function Field({ label, required = false, className = "", children }) {
  return (
    <label className={`field ${className}`}>
      {label !== null && <span>{label}{required && <Required />}</span>}
      {children}
    </label>
  );
}

export function Count({ count, max }) {
  return <span className={`cv-count${count > max ? " cv-count-over" : ""}`}>{count}/{max}</span>;
}

function SectionHeader({ title, count, max, addLabel, onAdd }) {
  const full = count >= max;

  return (
    <div className="cv-section-header">
      <h3>{title} {max !== undefined && <Count count={count} max={max} />}</h3>
      {onAdd && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={full}
          title={full ? `You can add up to ${max}.` : ""}
          onClick={onAdd}
        >
          + {addLabel}
        </button>
      )}
    </div>
  );
}

function MonthField({ label, value, onChange, allowPresent = false, monthOptional = false, required = true }) {
  const parsed = parseMonth(value);
  let monthValue = "";

  if (parsed.present) monthValue = "present";
  else if (parsed.month >= 0) monthValue = String(parsed.month);
  else if (monthOptional && parsed.year) monthValue = "none";

  return (
    <div className="field field-compact">
      <span>{label}{required && <Required />}</span>
      <div className="month-field">
        <select
          required={required && !monthOptional}
          aria-label={`${label} month`}
          value={monthValue}
          onChange={(event) => {
            const next = event.target.value;
            if (next === "present") onChange("Present");
            else if (next === "") onChange(formatMonth({ ...parsed, present: false, month: -1 }));
            else onChange(formatMonth({ ...parsed, present: false, month: next === "none" ? -1 : Number(next) }));
          }}
        >
          <option value="" disabled={required}>Month</option>
          {allowPresent && <option value="present">Present</option>}
          {monthOptional && <option value="none">No month</option>}
          {MONTHS.map((month, index) => <option key={month} value={index}>{month}</option>)}
        </select>
        {!parsed.present && (
          <select
            required={required}
            aria-label={`${label} year`}
            value={YEARS.includes(parsed.year) ? parsed.year : ""}
            onChange={(event) => onChange(formatMonth({ ...parsed, year: event.target.value }))}
          >
            <option value="" disabled={required}>Year</option>
            {YEARS.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}

function DiffField({ before, after, show, className, label, children }) {
  const [editing, setEditing] = useState(false);

  if (!show || editing || before === after) {
    return children({ autoFocus: editing, onBlur: () => setEditing(false) });
  }

  return (
    <div
      className={`${className} cv-diff-field`}
      role="textbox"
      tabIndex={0}
      aria-label={label}
      title="Click to edit"
      onFocus={() => setEditing(true)}
    >
      {wordDiff(before, after).map((part, i) => (
        part.type === "add" ? <ins key={i}>{part.text}</ins>
          : part.type === "del" ? <del key={i}>{part.text}</del>
            : <span key={i}>{part.text}</span>
      ))}
    </div>
  );
}

const ARROW_UP = (
  <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true">
    <path d="M10 15V5M5.5 9.5L10 5l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ARROW_DOWN = (
  <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true">
    <path d="M10 5v10M5.5 10.5L10 15l4.5-4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const RESTORE_ICON = (
  <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
    <path d="M4.5 9.5a5.75 5.75 0 1 1 1.7 4.1M4.5 4.75V9.5h4.75" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const RESTORE_MARK = (
  <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true">
    <path d="M4.5 9.5a5.75 5.75 0 1 1 1.7 4.1M4.5 4.75V9.5h4.75" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const PLUS_ICON = (
  <svg viewBox="0 0 20 20" width="11" height="11" aria-hidden="true">
    <path d="M10 4.5v11M4.5 10h11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

function AddSkillTag({ skill, groups, onAdd }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const asks = groups.length > 1;

  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref);

  return (
    <span className="cv-skill-add" ref={ref}>
      <button
        type="button"
        className="cv-skill-suggested"
        title={`Add "${skill}" to your skills`}
        aria-haspopup={asks ? "menu" : undefined}
        aria-expanded={asks ? open : undefined}
        onClick={() => (asks ? setOpen((value) => !value) : onAdd(0))}
      >
        {PLUS_ICON}
        <span>{skill}</span>
      </button>
      {open && (
        <span className="cv-skill-menu" role="menu">
          {groups.map((name, index) => (
            <button
              key={index}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onAdd(index);
              }}
            >
              {name || "Untitled group"}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

function Bullets({
  items, max, onChange, editable, label = "bullet", showChanges = false, removed = [], onRestore = null, onRemoveItem = null,
  baseOrder = null,
  flagged = new Set(), onDone
}) {
  const filledCount = items.filter((item) => filled(textOf(item))).length;
  const hasEmpty = items.some((item) => !filled(textOf(item)));
  const full = items.length >= max;

  const positions = showChanges && baseOrder ? basePositions(items, baseOrder) : new Map();

  return (
    <div className="cv-bullets">
      {items.map((item, i) => {
        const text = textOf(item);
        const changed = showChanges && typeof item === "object" && item.original !== undefined && item.original !== item.text;
        const was = positions.get(item.id);
        const moved = was !== undefined && was !== i ? (was > i ? "up" : "down") : null;
        const restored = showChanges && typeof item === "object" && item.restored;

        return (
          <div key={item.id || i} className="cv-bullet">
            {moved ? (
              <span className="cv-bullet-mark cv-bullet-moved" title={`Moved ${moved}`}>
                {moved === "up" ? ARROW_UP : ARROW_DOWN}
                <span className="visually-hidden">Moved {moved}</span>
              </span>
            ) : restored ? (
              <span className="cv-bullet-mark cv-bullet-restored" title="Restored">
                {RESTORE_MARK}
                <span className="visually-hidden">Restored</span>
              </span>
            ) : (
              <span className="cv-bullet-mark" aria-hidden="true">•</span>
            )}
            <div className="cv-bullet-body">
              <DiffField
                show={changed}
                before={item.original}
                after={text}
                className={`cv-text${item.id && flagged.has(item.id) ? " cv-flagged" : ""}`}
                label={`${label} ${i + 1}`}
              >
                {(fieldProps) => (
                  <textarea
                    className={`cv-text${item.id && flagged.has(item.id) ? " cv-flagged" : ""}`}
                    rows={1}
                    value={text}
                    maxLength={editable ? LIMITS.bullet : undefined}
                    aria-label={`${label} ${i + 1}`}
                    onChange={(event) => onChange(items.map((other, j) => (
                      j !== i ? other : typeof other === "string" ? event.target.value : { ...other, text: event.target.value }
                    )))}
                    {...fieldProps}
                  />
                )}
              </DiffField>
            </div>
            <RemoveButton
              label={`Remove ${label}`}
              onClick={() => (onRemoveItem ? onRemoveItem(item, i) : onChange(items.filter((_, j) => j !== i)))}
            />
          </div>
        );
      })}

      {showChanges && removed.map((bullet) => (
        <div key={`removed-${bullet.id}`} className="cv-bullet cv-left-out">
          <span className="cv-bullet-mark" aria-hidden="true">−</span>
          <span className="visually-hidden">Left out: </span>
          <div className="cv-bullet-body">
            <p className="cv-left-out-text">{bullet.text}</p>
          </div>
          {onRestore ? (
            <button
              type="button"
              className="icon-btn cv-restore"
              onClick={() => onRestore(bullet)}
              aria-label={`Restore ${label}`}
              title={`Restore ${label}`}
            >
              {RESTORE_ICON}
            </button>
          ) : (
            <span className="cv-bullet-spacer" aria-hidden="true" />
          )}
        </div>
      ))}

      {editable && (
        <div className="cv-bullets-footer">
          <button
            type="button"
            className="link-btn cv-add"
            disabled={full || hasEmpty}
            onClick={() => onChange([...items, label === "bullet" ? { id: newId("b"), text: "" } : ""])}
          >
            + Add {label}
          </button>
          <Count count={filledCount} max={max} />
          {hasEmpty && !full && <span className="hint">Fill in the empty {label} first.</span>}
          {onDone && <button type="button" className="link-btn cv-done" onClick={onDone}>Done</button>}
        </div>
      )}
    </div>
  );
}

function placeAfter(current, order, item) {
  const target = order.indexOf(item);
  let at = 0;

  current.forEach((other, i) => {
    const position = order.indexOf(other);
    if (position !== -1 && position < target) at = i + 1;
  });

  return at;
}

function CvEditor({ cv, onChange, mode = "base", showChanges = false, original = null, flags = [], suggestions = [] }) {
  const base = mode === "base";
  const flagged = new Set(flags);
  const compare = showChanges && !base && original;

  const fieldChanged = (field) => Boolean(compare && original[field] && original[field] !== cv[field]);

  const [removedHere, setRemovedHere] = useState({});
  const remember = (key, value) => setRemovedHere((current) => ({ ...current, [key]: value }));
  const forget = (key) => setRemovedHere((current) => {
    const next = { ...current };
    delete next[key];
    return next;
  });

  const baseEntryOf = (section, entry) => (compare ? original[section].find((other) => other.id === entry.id) : null);

  function removedBullets(section, entry) {
    const baseEntry = baseEntryOf(section, entry);
    return baseEntry
      ? baseEntry.bullets.filter((bullet) => !entry.bullets.some((kept) => kept.id === bullet.id))
      : [];
  }

  function removeBullet(section, index, bullet, position) {
    const entry = cv[section][index];
    remember(`${section}:${entry.id}:${bullet.id}`, { bullet, position });
    setEntry(section, index, { bullets: entry.bullets.filter((_, i) => i !== position) });
  }

  function restoreBullet(section, index, bullet) {
    const entry = cv[section][index];
    const key = `${section}:${entry.id}:${bullet.id}`;

    if (removedHere[key]) {
      const bullets = [...entry.bullets];
      bullets.splice(Math.min(removedHere[key].position, bullets.length), 0, removedHere[key].bullet);
      forget(key);
      setEntry(section, index, { bullets });
      return;
    }

    const order = baseEntryOf(section, entry)?.bullets.map((other) => other.id) ?? [];
    const target = order.indexOf(bullet.id);
    let at = 0;

    entry.bullets.forEach((kept, i) => {
      const position = order.indexOf(kept.id);
      if (position !== -1 && position < target) at = i + 1;
    });

    const bullets = [...entry.bullets];
    bullets.splice(at, 0, { id: bullet.id, text: bullet.text, original: bullet.text, restored: true });
    setEntry(section, index, { bullets });
  }

  const leftOutProjects = compare
    ? original.projects.filter((entry) => !cv.projects.some((kept) => kept.id === entry.id))
    : [];
  const keptSkills = new Set(cv.skills.flatMap((group) => group.items).map((skill) => skill.toLowerCase()));
  const leftOutSkills = compare
    ? original.skills.flatMap((group) => group.items).filter((skill) => !keptSkills.has(skill.toLowerCase()))
    : [];
  // Short skill names only: older tailorings may hold whole sentences, which don't fit a skills list.
  const suggestedSkills = base ? [] : suggestions.filter((skill) => (
    skill.length <= 40 && skill.trim().split(/\s+/).length <= 4 && !keptSkills.has(skill.toLowerCase())
  ));

  const [collapsed, setCollapsed] = useState(() => new Set(
    [...cv.experience, ...cv.projects, ...cv.education].map((entry) => entry.id)
  ));

  function toggle(id) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function entryCard(section, entry, index, { label, title, sub, bullets, fields }) {
    const isCollapsed = collapsed.has(entry.id);
    const complete = isEntryComplete(section, entry);
    const period = [entry.start, entry.end].filter(Boolean).join(" – ");

    return (
      <div className={`cv-entry ${isCollapsed ? "cv-entry-collapsed" : "cv-entry-open"}`} key={entry.id}>
        <div className="cv-entry-actions">
          <RemoveButton label={`Remove ${label}`} onClick={() => removeEntry(section, index)} />
          <button
            type="button"
            className="icon-btn"
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed ? `Expand ${label}` : `Collapse ${label}`}
            title={isCollapsed ? "Expand" : "Collapse"}
            onClick={() => toggle(entry.id)}
          >
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" className="cv-chevron">
              <path d="M5 12.5l5-5 5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {isCollapsed ? (
          <button type="button" className="cv-entry-summary" onClick={() => toggle(entry.id)}>
            <span className="cv-entry-summary-text">
              <strong>{title || `New ${label}`}</strong>
              {sub && <span className="muted"> · {sub}</span>}
            </span>
            {complete
              ? period && <span className="cv-entry-period">{period}</span>
              : <span className="cv-entry-warning">Missing details</span>}
          </button>
        ) : (
          <>
            {fields}
            {bullets ? (
              <Bullets {...bulletProps(section, index, bullets)} onDone={() => toggle(entry.id)} />
            ) : (
              <div className="cv-entry-done">
                <button type="button" className="link-btn cv-done" onClick={() => toggle(entry.id)}>Done</button>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  function set(field, value) {
    onChange({ ...cv, [field]: value });
  }

  function addSkill(skill, groupIndex) {
    if (cv.skills.length === 0) {
      set("skills", [{ category: "Skills", items: [skill] }]);
    } else {
      set("skills", cv.skills.map((group, i) => (i === groupIndex ? { ...group, items: [...group.items, skill] } : group)));
    }
  }

  function restoreSkill(skill) {
    const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
    const baseIndex = original.skills.findIndex((group) => group.items.includes(skill));
    const baseGroup = original.skills[baseIndex];
    const index = cv.skills.findIndex((group) => sameName(group.category, baseGroup.category));

    if (index >= 0) {
      const items = [...cv.skills[index].items];
      items.splice(placeAfter(items, baseGroup.items, skill), 0, skill);
      set("skills", cv.skills.map((group, i) => (i === index ? { ...group, items } : group)));
      return;
    }

    let at = 0;
    cv.skills.forEach((group, i) => {
      const position = original.skills.findIndex((other) => sameName(other.category, group.category));
      if (position !== -1 && position < baseIndex) at = i + 1;
    });

    const skills = [...cv.skills];
    skills.splice(at, 0, { category: baseGroup.category, items: [skill] });
    set("skills", skills);
  }

  function removeProject(index) {
    const project = cv.projects[index];
    remember(`projects:${project.id}`, { project, position: index });
    removeEntry("projects", index);
  }

  function restoreProject(project) {
    const key = `projects:${project.id}`;

    if (removedHere[key]) {
      const projects = [...cv.projects];
      projects.splice(Math.min(removedHere[key].position, projects.length), 0, removedHere[key].project);
      forget(key);
      set("projects", projects);
      return;
    }

    const order = original.projects.map((entry) => entry.id);
    const projects = [...cv.projects];
    projects.splice(placeAfter(projects.map((entry) => entry.id), order, project.id), 0, {
      ...project,
      restored: true,
      bullets: project.bullets.map((bullet) => ({ ...bullet, original: bullet.text }))
    });
    set("projects", projects);
  }

  function setEntry(section, index, patch) {
    set(section, cv[section].map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
  }

  function removeEntry(section, index) {
    set(section, cv[section].filter((_, i) => i !== index));
  }

  function entryInput(section, index, field, { label, required = false, format, className = "", ...props } = {}) {
    const entry = cv[section][index];

    return (
      <Field label={label} required={required} className={className}>
        <input
          value={entry[field] ?? ""}
          required={required}
          onChange={(event) => setEntry(section, index, { [field]: format ? format(event.target.value) : event.target.value })}
          {...props}
        />
      </Field>
    );
  }

  function dates(section, index, { monthOptional = false, required = true } = {}) {
    const entry = cv[section][index];

    return (
      <>
        <MonthField
          label="Start"
          value={entry.start}
          monthOptional={monthOptional}
          required={required}
          onChange={(start) => setEntry(section, index, { start })}
        />
        <MonthField
          label="End"
          value={entry.end}
          allowPresent
          monthOptional={monthOptional}
          required={required}
          onChange={(end) => setEntry(section, index, { end })}
        />
      </>
    );
  }

  const bulletProps = (section, index, max) => ({
    items: cv[section][index].bullets,
    max,
    editable: base,
    showChanges,
    removed: removedBullets(section, cv[section][index]),
    onRestore: base ? null : (bullet) => restoreBullet(section, index, bullet),
    onRemoveItem: base ? null : (bullet, position) => removeBullet(section, index, bullet, position),
    baseOrder: baseEntryOf(section, cv[section][index])?.bullets.map((bullet) => bullet.id) ?? null,
    flagged,
    onChange: (bullets) => setEntry(section, index, { bullets })
  });

  function tailoredTitle(section, entry, index) {
    const order = compare ? basePositions(cv[section], original[section].map((other) => other.id)) : new Map();
    const was = order.get(entry.id);
    const moved = was !== undefined && was !== index ? (was > index ? "up" : "down") : null;

    return (
      <div className="cv-entry-title">
        {moved ? (
          <span className="cv-entry-moved" title={`Moved ${moved}`}>
            {moved === "up" ? ARROW_UP : ARROW_DOWN}
            <span className="visually-hidden">Moved {moved}</span>
          </span>
        ) : compare && entry.restored && (
          <span className="cv-entry-moved cv-entry-restored" title="Restored">
            {RESTORE_MARK}
            <span className="visually-hidden">Restored</span>
          </span>
        )}
        <strong>{entry.title || entry.name}</strong>
        {entry.company && <span> · {entry.company}</span>}
        {section === "projects" && (
          <RemoveButton className="cv-entry-remove" label="Remove project" onClick={() => removeProject(index)} />
        )}
      </div>
    );
  }

  const links = cv.links;
  const emptyLink = links.some((link) => !filled(link.url));

  return (
    <div className="cv-editor">
      <section className="cv-section">
        {base && (
          <>
            <div className="cv-fields">
              <Field label="Name" required>
                <input value={cv.name} required autoComplete="name" onChange={(event) => set("name", titleCase(event.target.value))} />
              </Field>
              <Field label="Email" required>
                <input type="email" value={cv.email} required autoComplete="email" onChange={(event) => set("email", event.target.value.trim())} />
              </Field>
              <Field label="Phone">
                <input
                  value={cv.phone}
                  inputMode="numeric"
                  autoComplete="tel"
                  placeholder="0501234567"
                  onChange={(event) => set("phone", digitsOnly(event.target.value))}
                />
              </Field>
            </div>
            <div className="cv-fields">
              <Field label="Location">
                <input value={cv.location} onChange={(event) => set("location", event.target.value)} placeholder="Tel Aviv, Israel" />
              </Field>
              <Field label="Headline" className="field-wide">
                <input value={cv.headline} maxLength={LIMITS.headline} onChange={(event) => set("headline", event.target.value)} />
              </Field>
            </div>

            <div className="field">
              <span>Links <Count count={links.filter((link) => filled(link.url)).length} max={LIMITS.links} /></span>
              {links.map((link, index) => (
                <div className="cv-row" key={index}>
                  <input
                    value={link.url}
                    aria-label={`Link ${index + 1}`}
                    placeholder="linkedin.com/in/your-name"
                    onChange={(event) => set("links", links.map((other, i) => (i === index ? { ...other, url: event.target.value.trim() } : other)))}
                  />
                  <RemoveButton label="Remove link" onClick={() => set("links", links.filter((_, i) => i !== index))} />
                </div>
              ))}
              {links.length < LIMITS.links && (
                <button
                  type="button"
                  className="link-btn cv-add"
                  disabled={emptyLink}
                  title={emptyLink ? "Fill in the empty link first." : ""}
                  onClick={() => set("links", [...links, { label: "", url: "" }])}
                >
                  + Add link
                </button>
              )}
            </div>
          </>
        )}

        {!base && <SectionHeader title="Summary" count={cv.summary.length} max={LIMITS.summary} />}
        <Field label={base ? <>Summary <Count count={cv.summary.length} max={LIMITS.summary} /></> : null}>
          <DiffField
            show={fieldChanged("summary")}
            before={original?.summary}
            after={cv.summary}
            className={`cv-text${flagged.has("summary") ? " cv-flagged" : ""}`}
            label="Summary"
          >
            {(fieldProps) => (
              <textarea
                className={`cv-text${flagged.has("summary") ? " cv-flagged" : ""}`}
                rows={3}
                aria-label="Summary"
                value={cv.summary}
                maxLength={base ? LIMITS.summary : undefined}
                onChange={(event) => set("summary", event.target.value)}
                {...fieldProps}
              />
            )}
          </DiffField>
        </Field>
      </section>

      {(base || cv.experience.length > 0) && (
        <section className="cv-section">
          <SectionHeader
            title="Experience"
            count={cv.experience.length}
            max={base ? LIMITS.experience : undefined}
            addLabel="Add experience"
            onAdd={base && (() => set("experience", [
              ...cv.experience,
              { id: newId("x"), title: "", company: "", location: "", start: "", end: "", bullets: [] }
            ]))}
          />
          {cv.experience.map((entry, index) => (base ? entryCard("experience", entry, index, {
            label: "experience",
            title: entry.title,
            sub: entry.company,
            bullets: LIMITS.experienceBullets,
            fields: (
              <>
                <div className="cv-fields">
                  {entryInput("experience", index, "title", { label: "Title", required: true })}
                  {entryInput("experience", index, "company", { label: "Company", required: true })}
                </div>
                <div className="cv-fields">
                  {entryInput("experience", index, "location", { label: "Location" })}
                  {dates("experience", index)}
                </div>
              </>
            )
          }) : (
            <div className="cv-entry" key={entry.id}>
              {tailoredTitle("experience", entry, index)}
              <Bullets {...bulletProps("experience", index, LIMITS.experienceBullets)} />
            </div>
          )))}
        </section>
      )}

      {(base || cv.projects.length > 0 || leftOutProjects.length > 0) && (
        <section className="cv-section">
          <SectionHeader
            title="Projects"
            count={cv.projects.length}
            max={base ? LIMITS.projects : undefined}
            addLabel="Add project"
            onAdd={base && (() => set("projects", [
              ...cv.projects,
              { id: newId("p"), name: "", link: "", start: "", end: "", bullets: [] }
            ]))}
          />
          {cv.projects.map((entry, index) => (base ? entryCard("projects", entry, index, {
            label: "project",
            title: entry.name,
            bullets: LIMITS.projectBullets,
            fields: (
              <>
                <div className="cv-fields">
                  {entryInput("projects", index, "name", {
                    label: "Name",
                    required: true,
                    maxLength: 150,
                    placeholder: "Job Tracker | React, Node.js"
                  })}
                  {dates("projects", index, { required: false })}
                </div>
                <div className="cv-fields">
                  {entryInput("projects", index, "link", { label: "Link", placeholder: "github.com/you/project" })}
                </div>
              </>
            )
          }) : (
            <div className="cv-entry" key={entry.id}>
              {tailoredTitle("projects", entry, index)}
              <Bullets {...bulletProps("projects", index, LIMITS.projectBullets)} />
            </div>
          )))}
          {leftOutProjects.map((project) => (
            <div className="cv-entry cv-entry-left-out" key={`left-out-${project.id}`}>
              <div className="cv-entry-title">
                <strong>{project.name}</strong>
                <button
                  type="button"
                  className="icon-btn cv-restore cv-entry-remove"
                  onClick={() => restoreProject(project)}
                  aria-label={`Restore ${project.name}`}
                  title="Restore project"
                >
                  {RESTORE_ICON}
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {base && (
        <section className="cv-section">
          <SectionHeader
            title="Education"
            count={cv.education.length}
            max={LIMITS.education}
            addLabel="Add education"
            onAdd={() => set("education", [
              ...cv.education,
              { id: newId("e"), degree: "", major: "", school: "", location: "", start: "", end: "", gpa: "" }
            ])}
          />
          {cv.education.map((entry, index) => entryCard("education", entry, index, {
            label: "education",
            title: [entry.degree, entry.major].filter(Boolean).join(" in "),
            sub: entry.school,
            fields: (
            <>
              <div className="cv-fields">
                {entryInput("education", index, "degree", { label: "Degree", required: true, placeholder: "B.Sc." })}
                {entryInput("education", index, "major", { label: "Major", placeholder: "Computer Science" })}
                {entryInput("education", index, "school", { label: "School", required: true, format: titleCase })}
                <div className="field field-gpa">
                  <span>
                    GPA
                    <span className="info">
                      <button type="button" className="info-button" aria-label="What is GPA?" aria-describedby={`gpa-help-${index}`}>?</button>
                      <span id={`gpa-help-${index}`} role="tooltip" className="info-tip">Grade Point Average</span>
                    </span>
                  </span>
                  <input
                    value={entry.gpa ?? ""}
                    maxLength={10}
                    placeholder="88"
                    aria-label="GPA"
                    onChange={(event) => setEntry("education", index, { gpa: event.target.value })}
                  />
                </div>
              </div>
              <div className="cv-fields">
                {entryInput("education", index, "location", { label: "Location" })}
                {dates("education", index, { monthOptional: true })}
              </div>
            </>
            )
          }))}
        </section>
      )}

      <section className="cv-section">
        <SectionHeader
          title="Skills"
          count={cv.skills.length}
          max={LIMITS.skillGroups}
          addLabel="Add skill group"
          onAdd={base && (() => set("skills", [...cv.skills, { category: "", items: [] }]))}
        />
        {cv.skills.map((group, index) => (
          <div className="cv-skill-row" key={index}>
            <input
              className="cv-skill-category"
              value={group.category}
              placeholder="Group, e.g. Languages"
              aria-label="Skill group name"
              onChange={(event) => set("skills", cv.skills.map((g, i) => (i === index ? { ...g, category: event.target.value } : g)))}
            />
            <TagInput
              values={group.items}
              max={LIMITS.skillsPerGroup}
              splitOnComma
              label={`Skills in ${group.category || "this group"}`}
              placeholder="Type a skill and press Enter"
              onChange={(items) => set("skills", cv.skills.map((g, i) => (i === index ? { ...g, items } : g)))}
            />
            <Count count={group.items.length} max={LIMITS.skillsPerGroup} />
            <RemoveButton label="Remove skill group" onClick={() => set("skills", cv.skills.filter((_, i) => i !== index))} />
          </div>
        ))}
        {leftOutSkills.length > 0 && (
          <div className="cv-skills-left-out">
            {leftOutSkills.map((skill) => (
              <button
                type="button"
                className="cv-skill-left-out"
                key={skill}
                title={`Add "${skill}" back`}
                onClick={() => restoreSkill(skill)}
              >
                {PLUS_ICON}
                <span>{skill}</span>
              </button>
            ))}
          </div>
        )}
        {suggestedSkills.length > 0 && (
          <div className="cv-skills-suggested">
            {suggestedSkills.map((skill) => (
              <AddSkillTag
                key={skill}
                skill={skill}
                groups={cv.skills.map((group) => group.category)}
                onAdd={(index) => addSkill(skill, index)}
              />
            ))}
          </div>
        )}
      </section>

      {base && (
        <section className="cv-section">
          <SectionHeader
            title="Other sections"
            count={cv.extras.length}
            max={LIMITS.extras}
            addLabel="Add section"
            onAdd={() => set("extras", [...cv.extras, { title: "", items: [] }])}
          />
          {cv.extras.map((group, index) => (
            <div className="cv-entry" key={index}>
              <RemoveButton className="cv-entry-remove" label="Remove section" onClick={() => removeEntry("extras", index)} />
              <div className="cv-fields">
                <Field label="Title">
                  <input
                    value={group.title}
                    placeholder="Languages, Certifications…"
                    onChange={(event) => set("extras", cv.extras.map((g, i) => (i === index ? { ...g, title: event.target.value } : g)))}
                  />
                </Field>
              </div>
              <Bullets
                items={group.items}
                max={LIMITS.extraItems}
                label="item"
                editable
                onChange={(items) => set("extras", cv.extras.map((g, i) => (i === index ? { ...g, items } : g)))}
              />
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

export default CvEditor;
