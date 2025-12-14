import { NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const service = body.service as string;

    if (!["kb", "postgres", "fastapi"].includes(service)) {
      return NextResponse.json({ ok: false, error: "invalid service" }, { status: 400 });
    }

    const root = path.resolve(process.cwd(), "..");
    let cmd: string;
    let args: string[];
    let cwd = root;

    switch (service) {
      case "kb":
        cmd = "powershell.exe";
        args = ["-ExecutionPolicy", "Bypass", "-File", path.join(root, "windows", "kb_service.ps1")];
        break;
      case "postgres":
        cmd = "docker";
        args = ["compose", "up", "-d", "postgres"];
        break;
      case "fastapi":
        cmd = "powershell.exe";
        args = ["-ExecutionPolicy", "Bypass", "-File", path.join(root, "windows", "start_api.ps1")];
        break;
      default:
        return NextResponse.json({ ok: false, error: "unknown service" }, { status: 400 });
    }

    // Spawn detached process
    const child = spawn(cmd, args, {
      cwd,
      detached: true,
      stdio: "ignore",
      shell: true,
    });
    child.unref();

    return NextResponse.json({
      ok: true,
      service,
      message: `${service} start initiated`,
      pid: child.pid,
    });
  } catch (e: any) {
    console.error("service start error:", e);
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
