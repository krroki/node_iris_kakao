import { messageStore } from "../services";

export function extractMentionNames(text: string): string[] {
  const names: string[] = [];
  if (typeof text !== 'string' || !text) return names;
  const seen = new Set<string>();
  const re = /@([^\s,]+)(\s*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const nm = String(m[1] || '').trim();
    if (!nm || seen.has(nm)) continue;
    seen.add(nm);
    names.push(nm);
  }
  return names;
}

export function mapNamesToIds(roomId: string, names: string[]): Array<{ name: string; userId: string }> {
  try {
    const out: Array<{ name: string; userId: string }> = [];
    const seen = new Set<string>();
    const recent = messageStore.getRecent(roomId) || [];
    for (let i = recent.length - 1; i >= 0; i--) {
      const r: any = recent[i];
      const snap = r?.snapshot || {};
      const nm = String(snap?.senderName || '').trim();
      const uid = String(snap?.senderId || '').trim();
      if (!nm || !uid) continue;
      if (!names.includes(nm) || seen.has(nm)) continue;
      out.push({ name: nm, userId: uid });
      seen.add(nm);
      if (seen.size >= names.length) break;
    }
    return out;
  } catch {
    return [];
  }
}

