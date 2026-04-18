export function stripUtf8Bom(raw: string): string {
  if (!raw) return raw;
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}
