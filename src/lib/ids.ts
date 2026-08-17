export function uniquePrefixedId(prefix: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  let max = 0;
  for (const id of set) {
    if (!id.startsWith(prefix)) continue;
    const n = Number(id.slice(prefix.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  let next = max + 1;
  let id = `${prefix}${next}`;
  while (set.has(id)) {
    next += 1;
    id = `${prefix}${next}`;
  }
  return id;
}
