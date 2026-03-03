export const runtime = "nodejs";

import { NextResponse } from "next/server";
import path from "path";
import { promises as fs } from "fs";
import { promisify } from "util";
import { execFile } from "child_process";

const ROOT = path.resolve(process.cwd(), "..");
const DEVICE_CACHE = path.join(ROOT, "data", "redroid_device.json");
const execFileAsync = promisify(execFile);

function safeString(v: unknown): string {
  return String(v ?? "").trim();
}

function normalizeDeviceInput(raw: string): string | null {
  const s = safeString(raw);
  if (!s) return null;
  // 허용: "ip" 또는 "ip:port"
  // - port 미지정 시 기본 5555(ADB)
  // - ip는 IPv4만 허용(운영 환경 기준)
  const m = s.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?$/);
  if (!m) return null;
  const ip = m[1]!;
  const port = m[2] ? Number(m[2]) : 5555;
  if (!Number.isFinite(port) || port <= 0 || port > 65535) return null;
  // ip 범위 체크(완전 엄격하진 않지만 0~255만 제한)
  const parts = ip.split(".").map((x) => Number(x));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null;
  return `${ip}:${port}`;
}

async function readCache(): Promise<{ device: string | null; updatedAt: string | null }> {
  try {
    let raw = await fs.readFile(DEVICE_CACHE, "utf-8");
    // PowerShell Set-Content -Encoding UTF8는 BOM이 붙을 수 있어, JSON.parse 전에 제거한다.
    raw = raw.replace(/^\uFEFF/, "");
    const j = JSON.parse(raw || "{}") as any;
    const device = typeof j?.device === "string" ? safeString(j.device) : null;
    const updatedAt = typeof j?.updatedAt === "string" ? safeString(j.updatedAt) : null;
    return { device: device || null, updatedAt: updatedAt || null };
  } catch {
    return { device: null, updatedAt: null };
  }
}

async function detectVmIp(): Promise<string | null> {
  const ps = "powershell.exe";
  const vmName = process.env.REDROID_VM_NAME || "redroid";
  const vmLit = `'${vmName.replace(/'/g, "''")}'`;
  const script = [
    `$vm=${vmLit};`,
    "$a=Get-VMNetworkAdapter -VMName $vm -ErrorAction SilentlyContinue | Select-Object -First 1;",
    "if(-not $a -or -not $a.MacAddress){ exit 0 }",
    "$mac=(($a.MacAddress).ToUpper() -replace '(.{2})','$1-').TrimEnd('-');",
    "$n=Get-NetNeighbor -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.LinkLayerAddress -and ($_.LinkLayerAddress.ToUpper() -eq $mac) } | Select-Object -First 1;",
    "if($n -and $n.IPAddress){ Write-Output $n.IPAddress }",
  ].join(" ");
  const cmd = ["-NoProfile", "-Command", script];
  try {
    const { stdout } = await execFileAsync(ps, cmd, { cwd: ROOT, timeout: 5000 });
    const ip = safeString(stdout).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || "";
    if (!ip) return null;
    const m = ip.match(/^(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (!m) return null;
    return m[1]!;
  } catch {
    return null;
  }
}

export async function GET() {
  const cache = await readCache();
  const irisUrl = process.env.IRIS_URL || "http://127.0.0.1:5050";
  const vmIp = await detectVmIp();
  const detectedDevice = vmIp ? `${vmIp}:5555` : null;
  return NextResponse.json({ ok: true, irisUrl, cachePath: DEVICE_CACHE, ...cache, vmIp, detectedDevice });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as any;
  const input = safeString(body?.device ?? body?.ip ?? "");
  const normalized = normalizeDeviceInput(input);
  if (!normalized) {
    return NextResponse.json(
      { ok: false, error: "device 형식이 올바르지 않습니다. 예) 172.192.204.123 또는 172.192.204.123:5555" },
      { status: 400 },
    );
  }

  const next = { device: normalized, updatedAt: new Date().toISOString() };
  await fs.mkdir(path.dirname(DEVICE_CACHE), { recursive: true });
  await fs.writeFile(DEVICE_CACHE, JSON.stringify(next, null, 2), "utf-8");
  const irisUrl = process.env.IRIS_URL || "http://127.0.0.1:5050";
  return NextResponse.json({ ok: true, irisUrl, cachePath: DEVICE_CACHE, ...next });
}
