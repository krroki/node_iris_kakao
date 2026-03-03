import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

export function repoRoot(): string {
  return path.resolve(process.cwd(), "..");
}

export async function readJsonIfExists(filePath: string): Promise<{ exists: boolean; json: any | null; error?: string }> {
  try {
    const st = await fs.promises.stat(filePath).catch(() => null);
    if (!st) return { exists: false, json: null };
    const raw = await fs.promises.readFile(filePath, "utf8");
    const obj = JSON.parse(raw || "{}");
    return { exists: true, json: obj };
  } catch (e: any) {
    return { exists: true, json: null, error: String(e?.message || e) };
  }
}

export async function writeJsonAtomic(filePath: string, obj: any): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  const tmp = filePath + ".tmp";
  await fs.promises.writeFile(tmp, JSON.stringify(obj, null, 2), "utf8");
  await fs.promises.rename(tmp, filePath);
}

