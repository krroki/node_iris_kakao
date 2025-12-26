#!/usr/bin/env python3
"""
KakaoTalk 앱에서 Talk-API 인증에 필요한 헤더 쌍을 캡처한다.

배경
- TalkApi(naijun0403/TalkApi)는 Authorization 헤더를 "accessToken-deviceUUID"로 받아서,
  Kakao 내부 API로 요청할 때 다음 헤더로 변환한다:
  - Authorization: <accessToken>
  - Duuid: <deviceUUID>
- 따라서 "KakaoTalk이 실제로 보내는 Authorization/Duuid 값"이 필요하다.

보안/운영 원칙
- 캡처된 값은 콘솔에 그대로 출력하지 않는다(레드랙트만 출력).
- 결과는 기본적으로 `data/talkapi_auth.txt`에만 저장한다(커밋 금지).

주의
- 이 스크립트는 **사용자 디바이스/계정에 대한 디버깅 목적**으로만 사용해야 한다.
- 서비스 약관/정책을 위반하는 자동화/남용은 금지.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import urllib.request
import hashlib


def _redact(s: str) -> str:
    s = str(s or "").strip()
    if not s:
        return ""
    if len(s) <= 8:
        return "***"
    return s[:4] + "..." + s[-4:]


def _snapshot_auth_file(out_path: Path, auth_header: str) -> None:
    """authHeader 스냅샷을 data/ 하위에 저장한다(커밋 금지)."""
    try:
        auth_header = str(auth_header or "").strip()
        if not auth_header:
            return
        snap_dir = out_path.parent / "talkapi_auth_snapshots"
        snap_dir.mkdir(parents=True, exist_ok=True)
        latest_path = snap_dir / "latest.json"

        h = hashlib.sha256(auth_header.encode("utf-8")).hexdigest()
        prev_hash = ""
        try:
            if latest_path.exists():
                prev = json.loads(latest_path.read_text(encoding="utf-8") or "{}")
                prev_hash = str(prev.get("hash") or "")
        except Exception:
            prev_hash = ""

        if prev_hash and prev_hash == h:
            return

        ts = time.strftime("%Y%m%d_%H%M%S")
        snap_file = snap_dir / f"talkapi_auth.{ts}.txt"
        snap_file.write_text(auth_header + "\n", encoding="utf-8")

        parts = auth_header.split("-", 1)
        authorization = parts[0] if parts else ""
        duuid = parts[1] if len(parts) > 1 else ""

        meta = {
            "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "sourceFile": str(out_path),
            "snapshot": str(snap_file),
            "hash": h,
            "redacted": {"authorization": _redact(authorization), "duuid": _redact(duuid)},
        }
        latest_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except Exception:
        # snapshot은 best-effort이며 캡처 플로우를 막지 않는다.
        return


def _require_cmd(name: str) -> None:
    from shutil import which

    if which(name) is None:
        raise SystemExit(f"[오류] 필수 명령을 찾을 수 없습니다: {name} (PATH를 확인하세요)")


def _adb(serial: str, *args: str, timeout: int = 30) -> str:
    cmd = ["adb"]
    if serial:
        cmd += ["-s", serial]
    cmd += list(args)
    out = subprocess.check_output(cmd, stderr=subprocess.STDOUT, timeout=timeout)
    return out.decode("utf-8", errors="ignore")


def _resolve_serial(preferred: str | None) -> str:
    if preferred and preferred.strip():
        return preferred.strip()
    out = _adb("", "devices", timeout=10)
    lines = [ln.strip() for ln in out.splitlines() if ln.strip()]
    devices: list[str] = []
    for ln in lines:
        if ln.lower().startswith("list of devices"):
            continue
        if ln.endswith("\tdevice"):
            devices.append(ln.split("\t", 1)[0].strip())
    if not devices:
        raise SystemExit("[오류] adb devices 에 연결된 디바이스가 없습니다.")
    return devices[0]


def _ensure_root(serial: str) -> None:
    try:
        uid = _adb(serial, "shell", "su", "0", "id", "-u", timeout=10).strip().splitlines()[:1]
    except Exception as e:
        raise SystemExit(f"[오류] su(0) 확인 실패: {e}")
    if not uid or uid[0].strip() != "0":
        raise SystemExit(f"[오류] su(0) root 권한 확보 실패: id -u={uid[0] if uid else ''}")


def _device_abi(serial: str) -> str:
    return _adb(serial, "shell", "getprop", "ro.product.cpu.abi", timeout=10).strip().splitlines()[0].strip()


def _start_frida_server(serial: str, local_bin: Path) -> None:
    remote_bin = "/data/local/tmp/frida-server"
    # push + chmod
    _adb(serial, "push", str(local_bin), remote_bin, timeout=60)
    _adb(serial, "shell", "su", "0", "chmod", "755", remote_bin, timeout=10)

    # already running?
    try:
        out = _adb(serial, "shell", "su", "0", "sh", "-c", "pidof frida-server || true", timeout=10).strip()
        if out:
            return
    except Exception:
        pass

    # start in background
    _adb(
        serial,
        "shell",
        "su",
        "0",
        "sh",
        "-c",
        f"{remote_bin} >/data/local/tmp/frida-server.log 2>&1 &",
        timeout=10,
    )
    time.sleep(1.0)


def _adb_forward_frida(serial: str) -> None:
    _adb(serial, "forward", "tcp:27042", "tcp:27042", timeout=10)


def _apply_runtime(realtime_base: str, auth_header: str) -> None:
    url = realtime_base.rstrip("/") + "/runtime"
    body = json.dumps({"talkApi": {"authHeader": auth_header}}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, method="POST")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, data=body, timeout=6) as resp:
        _ = resp.read()


def _pick_frida_server_binary(abi: str) -> Path:
    abi = (abi or "").strip()
    root = Path(__file__).resolve().parent.parent
    candidates: list[Tuple[str, str]] = [
        ("x86_64", "frida-server-17.5.0-android-x86_64"),
        ("arm64-v8a", "frida-server-17.5.0-android-arm64"),
        ("arm64", "frida-server-17.5.0-android-arm64"),
    ]
    for needle, name in candidates:
        if needle in abi:
            p = root / name
            if p.exists():
                return p
            raise SystemExit(f"[오류] frida-server 바이너리를 찾지 못했습니다: {p}")
    raise SystemExit(f"[오류] 지원하지 않는 ABI: {abi} (x86_64/arm64-v8a만 지원)")


def _load_frida() -> Any:
    try:
        import frida  # type: ignore

        return frida
    except Exception:
        raise SystemExit(
            "[오류] Python 모듈 frida를 찾지 못했습니다.\n"
            "  - 설치: python -m pip install frida==17.* frida-tools==14.*\n"
            "  - (권장) 별도 venv에서 설치 후 실행하세요."
        )


def _load_java_bridge_source() -> str:
    try:
        import frida_tools  # type: ignore

        p = Path(frida_tools.__file__).parent / "bridges" / "java.js"
        if not p.exists():
            raise FileNotFoundError(str(p))
        return p.read_text(encoding="utf-8")
    except Exception as e:
        raise SystemExit(
            "[오류] frida-tools의 Java bridge(java.js)를 로드하지 못했습니다.\n"
            "  - 설치: python -m pip install frida-tools==14.*\n"
            f"  - 상세: {e}"
        )


HOOK_JS = r"""
Java.perform(function () {
  var hookStatus = [];
  function note(name, ok, err) {
    try {
      hookStatus.push({ name: String(name || ""), ok: !!ok, err: err ? String(err) : "" });
    } catch (e) {}
  }

  // 일부 앱은 ClassLoader가 달라 기본 Java.use가 실패할 수 있어(특히 split APK/동적 로딩),
  // currentApplication()의 ClassLoader로 classFactory를 고정한다.
  try {
    var ActivityThread = Java.use("android.app.ActivityThread");
    var app = ActivityThread.currentApplication();
    if (app) {
      Java.classFactory.loader = app.getClassLoader();
      note("appClassLoader", true, String(Java.classFactory.loader));
    } else {
      note("appClassLoader", false, "currentApplication() returned null");
    }
  } catch (e) { note("appClassLoader", false, e); }

  var seenPair = {};
  var seenAuth = {};
  var seenDuuid = {};
  var MAX_SEEN = 120;

  function seenPut(map, key) {
    try {
      if (!key) return false;
      if (map[key]) return false;
      var n = Object.keys(map).length;
      if (n >= MAX_SEEN) return false;
      map[key] = true;
      return true;
    } catch (e) {}
    return false;
  }

  function emitPartial(name, value, url, where) {
    try {
      var n = String(name || "").toLowerCase();
      if (n !== "authorization" && n !== "duuid") return;
      value = String(value || "");
      if (!value.length) return;

      var ok = false;
      if (n === "authorization") ok = seenPut(seenAuth, value);
      if (n === "duuid") ok = seenPut(seenDuuid, value);
      if (!ok) return;

      send({ type: "header_seen", name: n, value: value, url: String(url || ""), where: where });
    } catch (e) {}
  }

  function emitPair(auth, duuid, url, where) {
    try {
      if (!auth || !duuid) return;

      auth = String(auth);
      duuid = String(duuid);
      if (!auth.length || !duuid.length) return;

      var key = auth + "|" + duuid;
      if (seenPair[key]) return;
      seenPair[key] = true;

      send({ type: "talkapi_auth", auth: auth, duuid: duuid, url: String(url || ""), where: where });
    } catch (e) {}
  }

  // --- OkHttp3 (일부 환경에서 존재) ---
  try {
    var RB = Java.use("okhttp3.Request$Builder");
    note("okhttp3.Request$Builder", true);
    if (RB.addHeader) {
      RB.addHeader.overload("java.lang.String", "java.lang.String").implementation = function (name, value) {
        emitPartial(name, value, "", "okhttp3.Request$Builder.addHeader");
        return this.addHeader(name, value);
      };
    }
    if (RB.header) {
      RB.header.overload("java.lang.String", "java.lang.String").implementation = function (name, value) {
        emitPartial(name, value, "", "okhttp3.Request$Builder.header");
        return this.header(name, value);
      };
    }
    RB.build.implementation = function () {
      var req = this.build();
      try {
        var headers = req.headers();
        var auth = headers.get("Authorization");
        var duuid = headers.get("Duuid");
        var url = "";
        try { url = String(req.url().toString()); } catch (e) {}
        if (auth) emitPartial("authorization", auth, url, "Request.Builder.build");
        if (duuid) emitPartial("duuid", duuid, url, "Request.Builder.build");
        emitPair(auth, duuid, url, "Request.Builder.build");
      } catch (e) {}
      return req;
    };
  } catch (e) { note("okhttp3.Request$Builder", false, e); }

  // okhttp3.Headers$Builder (header addition point)
  var hbMap = {};
  function hbKey(obj) {
    try { return String(obj.hashCode()); } catch (e) {}
    try { return String(obj.toString()); } catch (e) {}
    return "" + obj;
  }
  function updateHb(obj, name, value, where) {
    try {
      var k = hbKey(obj);
      if (!k) return;
      var n = String(name || "").toLowerCase();
      if (n !== "authorization" && n !== "duuid") return;

      emitPartial(n, value, "", where);

      var e = hbMap[k];
      if (!e) e = { auth: null, duuid: null };
      if (n === "authorization") e.auth = String(value || "");
      if (n === "duuid") e.duuid = String(value || "");
      hbMap[k] = e;
      if (e.auth && e.duuid) {
        emitPair(e.auth, e.duuid, "", where);
        delete hbMap[k];
      }
    } catch (e) {}
  }

  try {
    var HB = Java.use("okhttp3.Headers$Builder");
    note("okhttp3.Headers$Builder", true);
    HB.add.overload("java.lang.String", "java.lang.String").implementation = function (name, value) {
      updateHb(this, name, value, "okhttp3.Headers$Builder.add");
      return this.add(name, value);
    };
    if (HB.set) {
      HB.set.overload("java.lang.String", "java.lang.String").implementation = function (name, value) {
        updateHb(this, name, value, "okhttp3.Headers$Builder.set");
        return this.set(name, value);
      };
    }
    if (HB.addLenient) {
      try {
        HB.addLenient.overload("java.lang.String", "java.lang.String").implementation = function (name, value) {
          updateHb(this, name, value, "okhttp3.Headers$Builder.addLenient");
          return this.addLenient(name, value);
        };
      } catch (e) {}
      try {
        HB.addLenient.overload("java.lang.String").implementation = function (line) {
          try {
            var s = String(line || "");
            var idx = s.indexOf(":");
            if (idx > 0) {
              var n = s.substring(0, idx);
              var v = s.substring(idx + 1).trim();
              updateHb(this, n, v, "okhttp3.Headers$Builder.addLenient(line)");
            }
          } catch (e) {}
          return this.addLenient(line);
        };
      } catch (e) {}
    }
  } catch (e) { note("okhttp3.Headers$Builder", false, e); }

  // catch-all: RealInterceptorChain.proceed(Request)
  try {
    var Chain = Java.use("okhttp3.internal.http.RealInterceptorChain");
    note("okhttp3.internal.http.RealInterceptorChain", true);
    Chain.proceed.overload("okhttp3.Request").implementation = function (request) {
      try {
        var headers = request.headers();
        var auth = headers.get("Authorization");
        var duuid = headers.get("Duuid");
        var url = "";
        try { url = String(request.url().toString()); } catch (e) {}
        if (auth) emitPartial("authorization", auth, url, "RealInterceptorChain.proceed");
        if (duuid) emitPartial("duuid", duuid, url, "RealInterceptorChain.proceed");
        emitPair(auth, duuid, url, "RealInterceptorChain.proceed");
      } catch (e) {}
      return this.proceed(request);
    };
  } catch (e) { note("okhttp3.internal.http.RealInterceptorChain", false, e); }

  // --- com.android.okhttp (내장 OkHttp 계열) ---
  try {
    var HB2 = Java.use("com.android.okhttp.Headers$Builder");
    note("com.android.okhttp.Headers$Builder", true);
    HB2.add.overload("java.lang.String", "java.lang.String").implementation = function (name, value) {
      updateHb(this, name, value, "com.android.okhttp.Headers$Builder.add");
      return this.add(name, value);
    };
    if (HB2.set) {
      HB2.set.overload("java.lang.String", "java.lang.String").implementation = function (name, value) {
        updateHb(this, name, value, "com.android.okhttp.Headers$Builder.set");
        return this.set(name, value);
      };
    }
  } catch (e) { note("com.android.okhttp.Headers$Builder", false, e); }

  // --- LOCO Job 컨텍스트에서 oauthToken/duuid 직접 캡처 ---
  // LLp/O.e(..)의 디스어셈블 결과:
  // - duuid == LFp/U0;->e():String
  // - oauthToken == LFp/U0;->b():String
  // 그리고 LFp/U0 인스턴스는 LocoJob.i() 반환값으로 전달된다.
  // 따라서 특정 HTTP 경로를 트리거하지 못하더라도, 앱이 LocoJob을 수행하는 순간 토큰/duuid를 직접 얻을 수 있다.
  try {
    var LocoJob = Java.use("com.kakao.talk.core.loco.protocol.job.LocoJob");
    var U0 = Java.use("Fp.U0");
    note("LocoJob.i()", true);
    var li = LocoJob.i.overload();
    var locoSeen = {};
    li.implementation = function () {
      var ret = li.call(this);
      try {
        try {
          var cn = "";
          try { cn = String(ret.getClass().getName()); } catch (e) {}
          if (cn && !locoSeen[cn] && Object.keys(locoSeen).length < 40) {
            locoSeen[cn] = true;
            send({ type: "loco_i", className: cn });
          }
        } catch (e) {}
        var u0 = Java.cast(ret, U0);
        var duuid = null;
        var token = null;
        try { duuid = u0.e(); } catch (e) {}
        try { token = u0.b(); } catch (e) {}
        if (duuid) emitPartial("duuid", duuid, "", "LocoJob.i()->Fp.U0.e(duuid)");
        if (token) emitPartial("authorization", token, "", "LocoJob.i()->Fp.U0.b(oauthToken)");
        emitPair(token, duuid, "", "LocoJob.i()->Fp.U0");
      } catch (e) {}
      return ret;
    };
  } catch (e) { note("LocoJob.i()", false, e); }

  // --- Fp.U0 생성 시점에서 oauthToken/duuid 캡처 ---
  // LFp/U0; 는 (oauthToken=b(), duuid=e())를 포함하는 데이터 객체이며, 생성 시 생성자 인자로 모두 전달된다.
  // 앱이 초기화/재접속 과정에서 LFp/U0; 를 새로 만들 때 한 번만 잡아도 authHeader를 만들 수 있다.
  try {
    var U0Ctor = Java.use("Fp.U0");
    note("Fp.U0.<init>", true);
    var ctor = U0Ctor.$init.overload(
      "java.lang.String",
      "java.lang.String",
      "java.lang.String",
      "java.lang.String",
      "java.lang.String",
      "int",
      "java.lang.String",
      "int",
      "java.util.List",
      "java.util.List",
      "long",
      "int",
      "short",
      "short",
      "boolean",
      "java.lang.String"
    );
    ctor.implementation = function (a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p) {
      try {
        if (e) emitPartial("duuid", e, "", "Fp.U0.<init>(duuid)");
        if (b) emitPartial("authorization", b, "", "Fp.U0.<init>(oauthToken)");
        emitPair(b, e, "", "Fp.U0.<init>");
      } catch (err) {}
      return ctor.call(this, a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p);
    };
  } catch (e) { note("Fp.U0.<init>", false, e); }

  // --- KakaoTalk 내부 네트워크 스택(난독화된 OkHttp 래퍼) ---
  // 최신 KakaoTalk(base.apk) 분석 결과 'duuid'/'oauthToken'을 *RequestBuilder*#h(String,Object) 형태로 주입하는 코드가 존재한다.
  // Talk-API 공개 서버 관점에서는 oauthToken == accessToken(Authorization 값)일 가능성이 높아, 이를 authorization으로 취급해 캡처한다.
  function hookParamBuilder(className) {
    try {
      var Cls = Java.use(className);
      note(className, true);
      if (!Cls.h) return;
      var h = Cls.h.overload("java.lang.String", "java.lang.Object");
      var watched = {
        "appver": true,
        "prtver": true,
        "os": true,
        "lang": true,
        "duuid": true,
        "oauthtoken": true,
        "ntype": true,
        "lbk": true,
        "bg": true,
        "rp": true,
        "revision": true,
        "mccmnc": true,
        "chatids": true,
        "maxids": true,
        "lasttokenid": true,
      };
      var seenWatched = {};
      function emitKeyOnce(k) {
        try {
          var kk = String(k || "").toLowerCase();
          if (!watched[kk]) return;
          if (seenWatched[kk]) return;
          seenWatched[kk] = true;
          send({ type: "param_key", name: String(k || ""), where: className + ".h" });
        } catch (e) {}
      }
      h.implementation = function (name, value) {
        try {
          var k = String(name || "");
          var kl = k.toLowerCase();
          emitKeyOnce(k);
          if (k === "oauthToken") {
            updateHb(this, "authorization", value, className + ".h(oauthToken)");
          } else if (kl === "authorization") {
            updateHb(this, "authorization", value, className + ".h(Authorization)");
          } else if (kl === "duuid") {
            updateHb(this, "duuid", value, className + ".h(duuid)");
          }
        } catch (e) {}
        return h.call(this, name, value);
      };
    } catch (e) { note(className, false, e); }
  }

  // 설치된 KakaoTalk(2025-12 기준)에서 관측된 후보들(버전/난독화에 따라 달라질 수 있어 실패는 허용).
  hookParamBuilder("Jp.j$a");
  hookParamBuilder("Mp.k$a");

  // --- HttpURLConnection (Redroid/일부 Android에서 주로 사용) ---
  var connMap = {};
  function connKey(conn) {
    try { return String(conn.hashCode()); } catch (e) {}
    try { return String(conn.toString()); } catch (e) {}
    return "" + conn;
  }
  function updateConn(conn, name, value, where) {
    try {
      var k = connKey(conn);
      if (!k) return;
      var n = String(name || "").toLowerCase();
      if (n !== "authorization" && n !== "duuid") return;

      emitPartial(n, value, "", where);

      var e = connMap[k];
      if (!e) e = { auth: null, duuid: null, url: "" };
      if (n === "authorization") e.auth = String(value || "");
      if (n === "duuid") e.duuid = String(value || "");
      if (!e.url) {
        try { e.url = String(conn.getURL().toString()); } catch (err) {}
      }
      connMap[k] = e;
      if (e.auth && e.duuid) {
        emitPair(e.auth, e.duuid, e.url, where);
        delete connMap[k];
      }
    } catch (e) {}
  }

  function hookUrlConnection(className) {
    try {
      var C = Java.use(className);
      note(className, true);
      if (C.setRequestProperty) {
        C.setRequestProperty.overload("java.lang.String", "java.lang.String").implementation = function (name, value) {
          updateConn(this, name, value, className + ".setRequestProperty");
          return this.setRequestProperty(name, value);
        };
      }
      if (C.addRequestProperty) {
        C.addRequestProperty.overload("java.lang.String", "java.lang.String").implementation = function (name, value) {
          updateConn(this, name, value, className + ".addRequestProperty");
          return this.addRequestProperty(name, value);
        };
      }
    } catch (e) { note(className, false, e); }
  }

  hookUrlConnection("java.net.URLConnection");
  hookUrlConnection("java.net.HttpURLConnection");
  hookUrlConnection("com.android.okhttp.internal.huc.HttpURLConnectionImpl");
  hookUrlConnection("com.android.okhttp.internal.huc.HttpsURLConnectionImpl");

  send({ type: "hook_status", hooks: hookStatus });
  send({ type: "ready" });
});
"""


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="KakaoTalk Authorization/Duuid 캡처 (Talk-API authHeader 생성)")
    ap.add_argument("--serial", default="", help="adb serial (미지정 시 첫 번째 device 사용)")
    ap.add_argument("--package", default="com.kakao.talk", help="대상 패키지명(기본 com.kakao.talk)")
    ap.add_argument("--out-file", default="data/talkapi_auth.txt", help="성공 시 authHeader 저장 경로")
    ap.add_argument("--partials-file", default="data/talkapi_auth_partials.json", help="부분 캡처(Authorization/Duuid) 저장 경로")
    ap.add_argument("--timeout-s", type=int, default=180, help="캡처 대기 시간(초)")
    ap.add_argument("--debug", action="store_true", help="Authorization/Duuid가 보이면 레드랙트로 즉시 출력")
    ap.add_argument("--apply-runtime", action="store_true", help="성공 시 Realtime API(/runtime)에 반영")
    ap.add_argument("--realtime-api-base", default="http://127.0.0.1:8650", help="Realtime API base URL")
    args = ap.parse_args(argv)

    _require_cmd("adb")
    serial = _resolve_serial(args.serial)
    print(f"[INFO] ADB 디바이스: {serial}")
    _ensure_root(serial)
    print("[INFO] 루트 권한 OK(su 0)")

    abi = _device_abi(serial)
    print(f"[INFO] 디바이스 ABI: {abi}")
    frida_bin = _pick_frida_server_binary(abi)
    print(f"[INFO] frida-server 바이너리: {frida_bin.name}")

    _start_frida_server(serial, frida_bin)
    _adb_forward_frida(serial)
    print("[INFO] frida-server 실행 및 포트포워딩 OK(tcp:27042)")

    frida = _load_frida()

    device = frida.get_device_manager().add_remote_device("127.0.0.1:27042")

    # attach/spawn
    session = None
    pid: Optional[int] = None
    try:
        session = device.attach(args.package)
        print(f"[INFO] attach 성공: {args.package}")
    except Exception:
        # 일부 환경에서는 프로세스명이 패키지명과 다를 수 있어(예: KakaoTalk) PID로 재시도
        try:
            procs = device.enumerate_processes()
            hit = next((p for p in procs if str(p.name).lower() == "kakaotalk"), None)
            if hit is not None:
                session = device.attach(hit.pid)
                print(f"[INFO] attach 성공: {hit.name} (pid={hit.pid})")
            else:
                raise RuntimeError("process not found by name")
        except Exception:
            try:
                pid = device.spawn([args.package])
                session = device.attach(pid)
                device.resume(pid)
                print(f"[INFO] spawn+attach 성공: {args.package} (pid={pid})")
            except Exception as e:
                raise SystemExit(f"[오류] attach/spawn 실패: {e}")

    found: Dict[str, str] = {}
    auth_candidates: Dict[str, Dict[str, str]] = {}
    duuid_candidates: Dict[str, Dict[str, str]] = {}
    done = threading.Event()
    min_auth_len = 20
    best_auth: Optional[str] = None
    best_duuid: Optional[str] = None

    def _finish_capture(auth: str, duuid: str, where: str, url: str) -> None:
        nonlocal found, best_auth, best_duuid

        if done.is_set():
            return

        auth = str(auth or "").strip()
        duuid = str(duuid or "").strip()
        if not auth or not duuid:
            return

        auth_header = f"{auth}-{duuid}"
        out_path = Path(args.out_file)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(auth_header + "\n", encoding="utf-8")
        _snapshot_auth_file(out_path, auth_header)

        print(
            "[OK] authHeader 캡처 완료: "
            f"{out_path} (Authorization={_redact(auth)}, Duuid={_redact(duuid)}, where={where}, url={url[:80]})"
        )

        if args.apply_runtime:
            try:
                _apply_runtime(args.realtime_api_base, auth_header)
                print("[OK] Realtime API(/runtime) authHeader 반영 완료")
            except Exception as e:
                print(f"[WARN] Realtime API(/runtime) 반영 실패: {e}")

        found = {"auth": auth, "duuid": duuid, "authHeader": auth_header}
        best_auth = auth
        best_duuid = duuid
        done.set()

    def on_message(message: Dict[str, Any], data: Any) -> None:
        nonlocal found, best_auth, best_duuid
        try:
            if message.get("type") != "send":
                # script error 등
                if message.get("type") == "error":
                    print(f"[WARN] frida error: {message.get('stack') or message}")
                return
            payload = message.get("payload") or {}
            if payload.get("type") == "ready":
                print("[INFO] 훅 설치 완료. KakaoTalk에서 네트워크 동작(예: 채팅방 진입/메시지 전송)을 1회 수행하세요.")
                return
            if payload.get("type") == "hook_status":
                if args.debug:
                    hooks = payload.get("hooks") or []
                    ok = [h for h in hooks if bool(getattr(h, "get", lambda *_: None)("ok"))]  # type: ignore
                    bad = [h for h in hooks if not bool(getattr(h, "get", lambda *_: None)("ok"))]  # type: ignore
                    print(f"[DEBUG] 훅 상태: ok={len(ok)} fail={len(bad)}")
                    for h in hooks:
                        try:
                            name = str(h.get("name") or "")
                            hok = bool(h.get("ok"))
                            if hok:
                                print(f"[DEBUG]  - OK   {name}")
                            else:
                                err = str(h.get("err") or "")
                                print(f"[DEBUG]  - FAIL {name}: {err[:120]}")
                        except Exception:
                            continue
                return
            if payload.get("type") == "header_seen":
                name = str(payload.get("name") or "").strip().lower()
                value = str(payload.get("value") or "").strip()
                url = str(payload.get("url") or "")
                where = str(payload.get("where") or "")
                if not name or not value:
                    return
                if name == "authorization":
                    auth_candidates.setdefault(value, {"value": value, "where": where, "url": url})
                    if args.debug:
                        print(f"[DEBUG] Authorization 발견: {_redact(value)} (where={where}, url={url[:80]})")
                    # talkapi_auth 이벤트가 늦게 오거나 일부 훅 포인트가 깨진 경우에도
                    # Authorization/Duuid를 각각 관찰해서 authHeader를 구성할 수 있다.
                    if len(value) >= min_auth_len and "-" not in value:
                        best_auth = value
                elif name == "duuid":
                    duuid_candidates.setdefault(value, {"value": value, "where": where, "url": url})
                    if args.debug:
                        print(f"[DEBUG] Duuid 발견: {_redact(value)} (where={where}, url={url[:80]})")
                    if len(value) >= 8 and "-" not in value:
                        best_duuid = value

                if best_auth and best_duuid:
                    _finish_capture(best_auth, best_duuid, where=where, url=url)
                return
            if payload.get("type") == "param_key":
                if args.debug:
                    n = str(payload.get("name") or "")
                    where = str(payload.get("where") or "")
                    print(f"[DEBUG] param key 감지: {n} (where={where})")
                return
            if payload.get("type") == "loco_i":
                if args.debug:
                    cn = str(payload.get("className") or "")
                    print(f"[DEBUG] LocoJob.i() 반환 타입: {cn}")
                return
            if payload.get("type") != "talkapi_auth":
                return

            auth = str(payload.get("auth") or "").strip()
            duuid = str(payload.get("duuid") or "").strip()
            url = str(payload.get("url") or "")
            where = str(payload.get("where") or "")
            if not auth or not duuid:
                return

            # 일부 훅 포인트(Fp.U0.<init>)에서는 oauthToken이 아직 초기화되지 않아
            # 너무 짧은 값(예: "", "0", "1")이 먼저 잡힐 수 있다.
            # Talk-API accessToken은 보통 충분히 길기 때문에, 너무 짧은 값은 무시하고 계속 대기한다.
            if len(auth) < min_auth_len:
                if args.debug:
                    print(f"[DEBUG] authHeader 후보 무시(auth 너무 짧음 len={len(auth)}): {_redact(auth)} (where={where})")
                return
            if len(duuid) < 8:
                if args.debug:
                    print(f"[DEBUG] authHeader 후보 무시(duuid 너무 짧음 len={len(duuid)}): {_redact(duuid)} (where={where})")
                return

            # TalkApi(공개 서버) 구현 특성: '-'로 split 하므로, auth/duuid에 '-'가 포함되면 깨질 수 있음.
            if "-" in auth:
                print(
                    "[WARN] Authorization 값에 '-'가 포함되어 Talk-API 공개 서버(split(\"-\"))에서 깨질 수 있습니다. "
                    "자체 호스팅(TalkApi 포크) 또는 다른 캡처 타이밍을 고려하세요."
                )
            if "-" in duuid:
                print("[WARN] Duuid 값에 '-'가 포함되어 Talk-API 공개 서버에서 깨질 수 있습니다. (가공/재캡처 필요)")

            auth_header = f"{auth}-{duuid}"
            out_path = Path(args.out_file)
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_text(auth_header + "\n", encoding="utf-8")
            _snapshot_auth_file(out_path, auth_header)

            print(
                "[OK] authHeader 캡처 완료: "
                f"{out_path} (Authorization={_redact(auth)}, Duuid={_redact(duuid)}, where={where}, url={url[:80]})"
            )

            if args.apply_runtime:
                try:
                    _apply_runtime(args.realtime_api_base, auth_header)
                    print("[OK] Realtime API(/runtime) authHeader 반영 완료")
                except Exception as e:
                    print(f"[WARN] Realtime API(/runtime) 반영 실패: {e}")

            found = {"auth": auth, "duuid": duuid, "authHeader": auth_header}
            done.set()
        except Exception as e:
            print(f"[WARN] on_message 처리 실패: {e}")

    java_bridge = _load_java_bridge_source()
    # Python API는 frida-tools REPL과 달리 Java bridge를 자동 로드하지 않으므로,
    # java.js를 선행 로드하고 globalThis.Java를 주입한 뒤 훅을 설치한다.
    full_js = (
        "(function () {\n"
        + java_bridge
        + "\nObject.defineProperty(globalThis, 'Java', { value: bridge });\n"
        + "})();\n"
        + HOOK_JS
    )

    script = session.create_script(full_js)
    script.on("message", on_message)
    script.load()

    if not done.wait(timeout=max(1, int(args.timeout_s))):
        print("[ERROR] 제한 시간 내 authHeader를 캡처하지 못했습니다.", file=sys.stderr)
        print("  - KakaoTalk에서 채팅방 진입/메시지 전송 등 네트워크 동작을 1회 수행한 뒤 다시 시도하세요.", file=sys.stderr)
        try:
            outp = Path(args.partials_file)
            outp.parent.mkdir(parents=True, exist_ok=True)
            outp.write_text(
                json.dumps(
                    {
                        "capturedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
                        "authorization": list(auth_candidates.values())[:200],
                        "duuid": list(duuid_candidates.values())[:200],
                    },
                    ensure_ascii=False,
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )
            if args.debug:
                print(f"[DEBUG] 부분 캡처 저장: {outp} (Authorization={len(auth_candidates)}, Duuid={len(duuid_candidates)})")
        except Exception as e:
            if args.debug:
                print(f"[DEBUG] 부분 캡처 저장 실패: {e}")
        return 2

    try:
        script.unload()
    except Exception:
        pass
    try:
        session.detach()
    except Exception:
        pass

    # 성공 케이스에서도 partials 파일을 남겨 디버깅에 활용할 수 있게 한다(콘솔 미출력).
    try:
        outp = Path(args.partials_file)
        outp.parent.mkdir(parents=True, exist_ok=True)
        outp.write_text(
            json.dumps(
                {
                    "capturedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "authorization": list(auth_candidates.values())[:200],
                    "duuid": list(duuid_candidates.values())[:200],
                    "talkApi": found,
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
    except Exception:
        pass

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
