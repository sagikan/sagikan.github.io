import { startTransition, useCallback, useEffect, useRef, useState } from "react";

// Roles and state attributes for each kind of group
const MODES = {
  tab: { group: "tablist", item: "tab", state: "aria-selected" },
  radio: { group: "radiogroup", item: "radio", state: "aria-checked" },
  toggle: { group: "group", item: undefined, state: "aria-pressed" }
};

// A row of options where the active ones, and the one under the pointer, wear a sliding marker
function PillGroup({ options, value, onChange, mode = "toggle", multiple = false, className = "", onHoverChange, ...groupProps }) {
  const groupRef = useRef(null);
  const itemRefs = useRef({});
  const [rects, setRects] = useState({});
  const [hovered, setHovered] = useState(null);
  const [ready, setReady] = useState(false);
  const [local, setLocal] = useState(value);
  const [seen, setSeen] = useState({ value, hovered: null, before: null, lit: null });
  const hoverFromKeys = useRef(false);
  const config = MODES[mode];
  const activeKeys = multiple ? local : [local];
  const lit = multiple ? hovered : hovered ?? local;

  /* State that follows props, settled during render: the parent's value, the option hovered before this
     one, and the last option the marker sat on (where it fades out) */
  if (seen.value !== value || seen.hovered !== hovered || (lit != null && seen.lit !== lit)) {
    if (seen.value !== value) {
      setLocal(value);
    }

    setSeen({
      value,
      hovered,
      before: seen.hovered !== hovered ? seen.hovered : seen.before,
      lit: lit ?? seen.lit
    });
  }

  // Reads where each option sits inside the group
  const measure = useCallback(() => {
    const next = {};

    for (const [key, node] of Object.entries(itemRefs.current)) {
      if (node) {
        next[key] = { x: node.offsetLeft, y: node.offsetTop, width: node.offsetWidth, height: node.offsetHeight };
      }
    }

    setRects(next);
  }, []);

  useEffect(() => {
    onHoverChange?.(hovered);
  }, [hovered, onHoverChange]);

  // Places the markers when the options change
  useEffect(() => {
    const frame = requestAnimationFrame(measure);

    return () => cancelAnimationFrame(frame);
  }, [measure, options]);

  useEffect(() => {
    // Turns the slide on a frame after the first placement, so the markers don't slide in from the corner
    const frames = [];

    frames.push(requestAnimationFrame(() => frames.push(requestAnimationFrame(() => setReady(true)))));
    document.fonts?.ready.then(measure);

    if (typeof ResizeObserver === "undefined") {
      return () => frames.forEach(cancelAnimationFrame);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(groupRef.current);

    return () => {
      frames.forEach(cancelAnimationFrame);
      observer.disconnect();
    };
  }, [measure]);

  /* In a multiple group the hover marker sits unseen under an active option, so it slides in and out of
     active options, but jumps when it arrives from outside the group or from one active option to
     another, so it never lights the inactive ones between them */
  const jumps = multiple && hovered != null && (seen.before == null || (activeKeys.includes(seen.before) && activeKeys.includes(hovered)));

  // Moves the marker at once and updates the parent at low priority, so a heavy re-render can't stall a slide
  const select = (key) => {
    setLocal(multiple ? (activeKeys.includes(key) ? activeKeys.filter((item) => item !== key) : [...activeKeys, key]) : key);
    startTransition(() => onChange(key));
  };

  // Places a marker over an option
  const place = (key) => {
    const rect = rects[key];

    return rect
      ? { transform: `translate(${rect.x}px, ${rect.y}px)`, width: rect.width, height: rect.height }
      : undefined;
  };

  // Places the marker of an active option in a multiple group, stretched to meet an active neighbour
  const placeActive = (index) => {
    const rect = rects[options[index].key];
    const next = rects[options[index + 1]?.key];
    const style = place(options[index].key);

    return style && next && joinsNext(index) ? { ...style, width: next.x - rect.x } : style;
  };

  // Checks whether an option and the one after it are both active
  const joinsNext = (index) => activeKeys.includes(options[index]?.key) && activeKeys.includes(options[index + 1]?.key);

  return (
    <div
      {...groupProps}
      ref={groupRef}
      role={config.group}
      className={`pill-group${ready ? " is-ready" : ""} ${className}`}
      onPointerLeave={() => setHovered(null)}
    >
      {multiple
        ? options.map(({ key }, index) => (
          <span
            key={key}
            className={`pill-marker${activeKeys.includes(key) ? " is-shown" : ""}${joinsNext(index) ? " join-next" : ""}${joinsNext(index - 1) ? " join-prev" : ""}`}
            style={placeActive(index)}
            aria-hidden="true"
          />
        ))
        : null}
      <span
        className={`pill-marker${multiple ? " pill-marker-hover" : ""}${lit != null && rects[lit] ? " is-shown" : ""}${jumps ? " jump" : ""}`}
        style={place(seen.lit)}
        aria-hidden="true"
      />
      {options.map(({ key, label }) => {
        const active = activeKeys.includes(key);

        return (
          <button
            key={key}
            ref={(node) => { itemRefs.current[key] = node; }}
            type="button"
            role={config.item}
            {...{ [config.state]: active }}
            className={`pill-item${key === lit || (multiple && active) ? " is-lit" : ""}`}
            onClick={() => select(key)}
            onPointerEnter={() => {
              hoverFromKeys.current = false;
              setHovered(key);
            }}
            onFocus={(event) => {
              if (event.target.matches(":focus-visible")) {
                hoverFromKeys.current = true;
                setHovered(key);
              }
            }}
            // Pressing an option blurs the previous one, which mustn't undo the pointer's hover
            onBlur={() => hoverFromKeys.current && setHovered(null)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export default PillGroup;
