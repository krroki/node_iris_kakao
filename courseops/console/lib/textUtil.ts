export function normalizeNick(input: string) {
  return String(input || "")
    .replace(/\s+/gu, "")
    .trim();
}

export function splitCsv(input: string) {
  return String(input || "")
    .split(/[,，]/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

