/** Preserve a clinical calendar date without applying the browser's timezone. */
export function dateOnly(value: unknown): string {
  if (typeof value === "string") {
    const isoDate = value.match(/^(\d{4}-\d{2}-\d{2})(?:$|T|\s)/);
    if (isoDate) return isoDate[1];
  }
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

/** Return today's local clinical calendar date without a UTC day shift. */
export function localDateToday(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
