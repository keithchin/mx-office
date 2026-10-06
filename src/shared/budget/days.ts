// Calendar days as YYYY-MM-DD strings, moved without time zones getting in the way.

/** `day` moved by `n` days. */
export function addDaysUtc(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
