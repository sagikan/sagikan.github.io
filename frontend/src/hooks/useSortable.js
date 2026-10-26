import { useLayoutEffect, useRef, useState } from "react";

const INTERACTIVE = "input, textarea, select, button, a, label, .cv-diff-field";
const DRAG_SLOP = 6;
const STEPS = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 };

/* Lets the user reorder a list by dragging items, or with the arrow keys. "flow" is for items laid
   out side by side that wrap onto new lines (like tags): they move in both directions, in reading order */
export function useSortable(items, onReorder, { flow = false } = {}) {
  const nodes = useRef([]);
  const latest = useRef({ items, onReorder });
  const drag = useRef(null);
  const [dragging, setDragging] = useState(null);

  // After every draw, refreshes the list the drag logic reads and puts the dragged item back under the pointer
  useLayoutEffect(() => {
    latest.current = { items, onReorder };

    if (drag.current) {
      drag.current.pending = false;
      follow();
    }
  });

  /* Keeps the dragged item under the pointer, at the spot where it was grabbed. Item positions are
     converted into pointer units, and the pointer distance into the item's own pixels, using the
     units found when the drag began */
  function follow() {
    const current = drag.current;
    if (!current) return;
    const node = nodes.current[current.index];

    nodes.current.forEach((other) => {
      if (other && other !== node) other.style.transform = "";
    });

    if (!node) return;
    node.style.transform = "";
    const rect = node.getBoundingClientRect();
    const x = flow ? (current.pointerX - current.grabX - rect.left * current.k) / current.perPx : 0;
    const y = (current.pointerY - current.grabY - rect.top * current.k) / current.perPx;

    node.style.transform = `translate(${x}px, ${y}px)`;
  }

  /* Finds how pointer positions relate to an item's measurements. The page may be zoomed, and some browsers
     report item positions already divided by the zoom while pointer positions stay in screen pixels. So
     it checks which of the two a point inside the item lands under, then moves the item a known distance
     to see how far it travels. Returns "k" (pointer pixels per measured pixel) and "perPx" (pointer
     pixels per pixel of transform) */
  function measureUnits(node) {
    if (!node) return { k: 1, perPx: 1 };
    const rect = node.getBoundingClientRect();
    const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;

    // Counts how many of four points inside the item are over the item when read in the given units
    const hits = (k) => {
      let count = 0;

      for (const fx of [0.25, 0.75]) {
        for (const fy of [0.25, 0.75]) {
          const found = document.elementFromPoint((rect.left + rect.width * fx) * k, (rect.top + rect.height * fy) * k);
          if (found && node.contains(found)) count++;
        }
      }

      return count;
    };

    const k = zoom !== 1 && hits(zoom) > hits(1) ? zoom : 1;

    node.style.transform = "translateY(100px)";
    const moved = node.getBoundingClientRect().top - rect.top;
    node.style.transform = "";

    return { k, perPx: moved ? (moved * k) / 100 : k };
  }

  /* Checks whether another item comes before the dragged one in the list's order. Rows are compared by
     their middles; in a flow, items on the same line are compared left to right */
  function isBefore(other, dragged) {
    const otherMiddleY = other.top + other.height / 2;

    if (!flow) return dragged.top + dragged.height / 2 > otherMiddleY;
    if (otherMiddleY < dragged.top) return true;
    if (otherMiddleY > dragged.bottom) return false;

    return dragged.left + dragged.width / 2 > other.left + other.width / 2;
  }

  // Moves the item at one position to another
  function move(from, to) {
    const list = latest.current.items;
    if (to < 0 || to >= list.length || from === to) return;
    const next = [...list];
    const [item] = next.splice(from, 1);

    next.splice(to, 0, item);
    latest.current.onReorder(next);

    // Until the new order is drawn, the measurements of the items are out of date
    if (drag.current) {
      drag.current.pending = true;
      setTimeout(() => {
        if (drag.current) drag.current.pending = false;
      }, 120);
    }
  }

  // Starts dragging an item and follows the pointer until release, swapping it past the items it crosses
  function begin(index, pointerX, pointerY) {
    const node = nodes.current[index];
    const rect = node ? node.getBoundingClientRect() : { left: pointerX, top: pointerY };
    const { k, perPx } = measureUnits(node);

    drag.current = {
      index,
      pointerX,
      pointerY,
      grabX: pointerX - rect.left * k,
      grabY: pointerY - rect.top * k,
      k,
      perPx,
      pending: false
    };
    setDragging(index);
    document.body.classList.add("is-sorting");

    // Puts the dragged item after every other item that comes before it on screen
    const onMove = (moveEvent) => {
      const current = drag.current;
      const count = latest.current.items.length;
      const dragged = nodes.current[current.index];
      let target = 0;

      current.pointerX = moveEvent.clientX;
      current.pointerY = moveEvent.clientY;
      if (current.pending) return;
      follow();
      if (!dragged) return;
      const draggedRect = dragged.getBoundingClientRect();

      for (let i = 0; i < count; i++) {
        const other = nodes.current[i];
        if (i === current.index || !other) continue;
        if (isBefore(other.getBoundingClientRect(), draggedRect)) target++;
      }

      if (target !== current.index) {
        move(current.index, target);
        current.index = target;
        setDragging(target);
      }
    };

    // Ends the drag and lets the item settle into its place
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.classList.remove("is-sorting");
      nodes.current.forEach((other) => {
        if (other) other.style.transform = "";
      });
      drag.current = null;
      setDragging(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  /* Starts a drag once a press in a text field moves mostly up or down. Moving sideways selects text
     as usual, and a plain click still edits the field */
  function beginOnVerticalMove(event, index) {
    const startX = event.clientX;
    const startY = event.clientY;

    // Stops watching the press
    const cancel = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", cancel);
      window.removeEventListener("pointercancel", cancel);
    };

    // Decides between dragging and selecting once the pointer has moved a little
    const onMove = (moveEvent) => {
      const dx = Math.abs(moveEvent.clientX - startX);
      const dy = Math.abs(moveEvent.clientY - startY);
      if (dx < DRAG_SLOP && dy < DRAG_SLOP) return;
      cancel();
      if (dx >= dy) return;
      document.activeElement?.blur();
      window.getSelection()?.removeAllRanges();
      begin(index, startX, startY);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", cancel);
    window.addEventListener("pointercancel", cancel);
  }

  // Returns the ref callback for the item at a position
  function itemRef(index) {
    return (node) => {
      nodes.current[index] = node;
    };
  }

  /* Returns the props that start dragging the item at a position. "textField" waits for an up or down
     move, "skipInteractive" ignores presses on fields and buttons inside, and "altKeys" needs Alt with the arrows */
  function dragProps(index, { textField = false, skipInteractive = false, altKeys = false } = {}) {
    return {
      onPointerDown: (event) => {
        if (event.button !== 0) return;
        if (skipInteractive && event.target.closest(INTERACTIVE)) return;

        if (textField) {
          beginOnVerticalMove(event, index);

          return;
        }

        event.preventDefault();
        begin(index, event.clientX, event.clientY);
      },
      onKeyDown: (event) => {
        const step = STEPS[event.key];
        if (!step || (!flow && (event.key === "ArrowLeft" || event.key === "ArrowRight"))) return;
        if (altKeys !== event.altKey) return;
        if (skipInteractive && event.target !== event.currentTarget) return;
        event.preventDefault();
        move(index, index + step);
      }
    };
  }

  return { dragging, itemRef, dragProps };
}
