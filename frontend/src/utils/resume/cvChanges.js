// Maps each item to its position in the base order
export function basePositions(items, baseOrder) {
  const kept = items
    .map((item) => item.id)
    .filter((id) => baseOrder.includes(id))
    .sort((x, y) => baseOrder.indexOf(x) - baseOrder.indexOf(y));

  return new Map(kept.map((id, index) => [id, index]));
}

// Counts the changes between a tailored resume and the original
export function countChanges(cv, original) {
  if (!cv || !original) {
    return 0;
  }

  let count = original.summary && original.summary !== cv.summary ? 1 : 0;

  for (const section of ["experience", "projects"]) {
    const baseEntries = original[section] ?? [];
    const entryOrder = basePositions(cv[section], baseEntries.map((entry) => entry.id));

    cv[section].forEach((entry, index) => {
      if (entryOrder.has(entry.id) && entryOrder.get(entry.id) !== index) count++;

      const baseEntry = baseEntries.find((other) => other.id === entry.id);
      if (!baseEntry) return;

      const bulletOrder = basePositions(entry.bullets, baseEntry.bullets.map((bullet) => bullet.id));
      entry.bullets.forEach((bullet, i) => {
        if (bullet.original !== undefined && bullet.original !== bullet.text) count++;
        if (bulletOrder.has(bullet.id) && bulletOrder.get(bullet.id) !== i) count++;
      });
      count += baseEntry.bullets.filter((bullet) => !entry.bullets.some((kept) => kept.id === bullet.id)).length;
    });

    count += baseEntries.filter((entry) => !cv[section].some((kept) => kept.id === entry.id)).length;
  }

  const keptSkills = new Set(cv.skills.flatMap((group) => group.items).map((skill) => skill.toLowerCase()));
  count += original.skills.flatMap((group) => group.items).filter((skill) => !keptSkills.has(skill.toLowerCase())).length;

  return count;
}
