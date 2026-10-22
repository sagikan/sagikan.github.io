export function wordDiff(before, after) {
  const a = tokens(before);
  const b = tokens(after);

  const lcs = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const steps = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      steps.push({ type: "same", text: a[i++] });
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      steps.push({ type: "del", text: a[i++] });
    } else {
      steps.push({ type: "add", text: b[j++] });
    }
  }
  while (i < a.length) steps.push({ type: "del", text: a[i++] });
  while (j < b.length) steps.push({ type: "add", text: b[j++] });

  return grouped(steps);
}

function grouped(steps) {
  const out = [];
  let removed = [];
  let added = [];
  let spaceBefore = false;
  let spaceBeforeChange = false;

  const emit = (type, text) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text;
    else out.push({ type, text });
  };

  const space = () => {
    const last = out[out.length - 1];
    if (last && !/\s$/.test(last.text)) emit("same", " ");
  };

  const flush = () => {
    if (!removed.length && !added.length) return;
    if (spaceBeforeChange) space();
    if (removed.length) emit("del", removed.join(" "));
    if (removed.length && added.length) emit("same", " ");
    if (added.length) emit("add", added.join(" "));
    removed = [];
    added = [];
  };

  for (const step of steps) {
    const isSpace = /^\s+$/.test(step.text);

    if (isSpace && step.text.includes("\n") && step.type !== "del") {
      flush();
      emit("same", "\n".repeat(step.text.split("\n").length - 1));
      spaceBefore = false;
    } else if (isSpace) {
      spaceBefore = true;
    } else if (step.type === "same") {
      flush();
      if (spaceBefore) space();
      emit("same", step.text);
      spaceBefore = false;
    } else {
      if (!removed.length && !added.length) spaceBeforeChange = spaceBefore;
      (step.type === "del" ? removed : added).push(step.text);
      spaceBefore = false;
    }
  }

  flush();
  return out;
}

function tokens(text) {
  return String(text || "").match(/\s+|\S+/g) || [];
}
