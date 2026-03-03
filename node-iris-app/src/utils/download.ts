export async function downloadUrlAsBase64(url: string, timeoutMs = 15000): Promise<string> {
  const u = String(url || "").trim();
  if (!u) throw new Error("downloadUrlAsBase64: url required");

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const res = await fetch(u, { method: "GET", signal: ctrl.signal }).catch((e) => {
    throw e;
  });
  clearTimeout(t);

  if (!res.ok) {
    throw new Error(`downloadUrlAsBase64 non-OK: ${res.status}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab).toString("base64");
}

