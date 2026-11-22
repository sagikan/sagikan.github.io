// Runs a task on every item, at most `limit` at a time
async function eachLimited(items, limit, task) {
  let next = 0;

  // Takes items until none are left
  const worker = async () => {
    while (next < items.length) {
      await task(items[next++]);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

module.exports = { eachLimited };
