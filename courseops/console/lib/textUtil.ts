export function normalizeNick(input: string) {
  return String(input || "")
    .normalize("NFKC")
    .replace(/[\s\u200b\u200c\u200d\ufeff\u2060]+/gu, "")
    .trim()
    .toLowerCase();
}

export function splitCsv(input: string) {
  return String(input || "")
    .split(/[,，]/g)
    .map((x) => x.trim())
    .filter(Boolean);
}
