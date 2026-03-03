import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { coursesStore } from "@/lib/store";

function normalize(s: string) {
  return String(s || "")
    .normalize("NFKC")
    .replace(/[\s\u200b\u200c\u200d\ufeff\u2060]+/gu, "")
    .trim()
    .toLowerCase();
}

function toBool(v: unknown) {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "y" || s === "yes" || s === "o";
}

function splitList(raw: unknown): string[] {
  const s = String(raw ?? "").trim();
  if (!s) return [];
  return s
    .split(/[,，/]+/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function headerIndex(header: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!Array.isArray(header)) return out;
  for (let i = 0; i < header.length; i += 1) {
    const k = String(header[i] ?? "").trim();
    if (!k) continue;
    out[k] = i;
  }
  return out;
}

function cell(row: unknown, idx: number | undefined): string {
  if (!Array.isArray(row)) return "";
  if (idx === undefined) return "";
  return String(row[idx] ?? "").trim();
}

type PersonCourse = {
  courseId: string;
  courseKey: string;
  ssotPresent: boolean;
  inCafe: boolean;
  auditStatus: string;
  missingRooms: string[];
};

type PersonAgg = {
  key: string;
  ssotUserId: string | null;
  cafeUserId: string | null;
  ssotName: string | null;
  ssotNickname: string | null;
  cafeNickname: string | null;
  courses: Map<string, PersonCourse>;
};

function mergeAgg(into: PersonAgg, from: PersonAgg) {
  if (!into.ssotUserId && from.ssotUserId) into.ssotUserId = from.ssotUserId;
  if (!into.cafeUserId && from.cafeUserId) into.cafeUserId = from.cafeUserId;
  if (!into.ssotName && from.ssotName) into.ssotName = from.ssotName;
  if (!into.ssotNickname && from.ssotNickname) into.ssotNickname = from.ssotNickname;
  if (!into.cafeNickname && from.cafeNickname) into.cafeNickname = from.cafeNickname;
  for (const [cid, c] of from.courses.entries()) {
    if (!into.courses.has(cid)) into.courses.set(cid, c);
  }
}

export async function GET(req: Request) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const q = String(url.searchParams.get("q") || "").trim();
  const onlyIssues = String(url.searchParams.get("onlyIssues") || "") === "1";
  const includeArchived = String(url.searchParams.get("includeArchived") || "1") !== "0";
  const limit = Math.max(1, Math.min(2000, Number(url.searchParams.get("limit") || 500) || 500));

  const store = await coursesStore();
  const courses = await store.listCourses({ includeArchived });

  const pairs = await Promise.all(
    courses.map(async (course) => {
      const snap = await store.getCourseSnapshot(course.id);
      return { course, snap };
    }),
  );

  const agg = new Map<string, PersonAgg>();
  const bySsot = new Map<string, string>();
  const byCafe = new Map<string, string>();

  const ensure = (key: string): PersonAgg => {
    const found = agg.get(key);
    if (found) return found;
    const created: PersonAgg = {
      key,
      ssotUserId: null,
      cafeUserId: null,
      ssotName: null,
      ssotNickname: null,
      cafeNickname: null,
      courses: new Map(),
    };
    agg.set(key, created);
    return created;
  };

  for (const { course, snap } of pairs) {
    const payload = snap?.payload && typeof snap.payload === "object" ? snap.payload : null;
    const tables = payload && (payload as any).tables && typeof (payload as any).tables === "object" ? (payload as any).tables : {};

    // ssotRaw: ssotUserId -> {name,nickname}
    const ssotRaw = Array.isArray(tables?.ssotRaw) ? tables.ssotRaw : [];
    const ssotHeader = ssotRaw[0];
    const sIdx = headerIndex(ssotHeader);
    const ssotById = new Map<string, { name: string; nickname: string }>();
    for (const row of ssotRaw.slice(1)) {
      const id = cell(row, sIdx.ssotUserId);
      if (!id) continue;
      const name = cell(row, sIdx.ssotName);
      const nickname = cell(row, sIdx.ssotNickname);
      ssotById.set(id, { name, nickname });
    }

    const audit = Array.isArray(tables?.auditView) ? tables.auditView : [];
    if (audit.length < 2) continue;
    const aIdx = headerIndex(audit[0]);

    for (const [rowIndex, row] of audit.slice(1).entries()) {
      const courseKey = String(course.courseKey || "").trim();
      const auditKey = cell(row, aIdx.auditKey);
      const ssotUserId = cell(row, aIdx.ssotUserId) || null;
      const cafeUserId = cell(row, aIdx.cafeUserId) || null;
      const cafeNickname = cell(row, aIdx.cafeNickname) || null;
      const ssotPresent = toBool(cell(row, aIdx.ssotPresent));
      const inCafe = toBool(cell(row, aIdx.inCafe));
      const auditStatus = cell(row, aIdx.auditStatus);
      const missingRooms = splitList(cell(row, aIdx.missingRooms));

      let keyFromSsot: string | null = ssotUserId ? bySsot.get(ssotUserId) || null : null;
      let keyFromCafe: string | null = cafeUserId ? byCafe.get(cafeUserId) || null : null;

      if (keyFromSsot && keyFromCafe && keyFromSsot !== keyFromCafe) {
        const a = ensure(keyFromSsot);
        const b = ensure(keyFromCafe);
        mergeAgg(a, b);
        agg.delete(keyFromCafe);
        if (b.ssotUserId) bySsot.set(b.ssotUserId, keyFromSsot);
        if (b.cafeUserId) byCafe.set(b.cafeUserId, keyFromSsot);
        keyFromCafe = keyFromSsot;
      }

      const key =
        keyFromSsot ||
        keyFromCafe ||
        (ssotUserId
          ? `SSOT:${ssotUserId}`
          : cafeUserId
            ? `CAFE:${cafeUserId}`
            : auditKey
              ? `AUDIT:${auditKey}`
              : `ROW:${course.id}:${rowIndex}`);

      const p = ensure(key);
      if (ssotUserId) {
        p.ssotUserId = p.ssotUserId || ssotUserId;
        bySsot.set(ssotUserId, key);
        const sr = ssotById.get(ssotUserId) || null;
        if (sr) {
          if (!p.ssotName && sr.name) p.ssotName = sr.name;
          if (!p.ssotNickname && sr.nickname) p.ssotNickname = sr.nickname;
        }
      }
      if (cafeUserId) {
        p.cafeUserId = p.cafeUserId || cafeUserId;
        byCafe.set(cafeUserId, key);
      }
      if (!p.cafeNickname && cafeNickname) p.cafeNickname = cafeNickname;

      const prev = p.courses.get(course.id) || null;
      if (!prev) {
        p.courses.set(course.id, {
          courseId: course.id,
          courseKey,
          ssotPresent,
          inCafe,
          auditStatus,
          missingRooms,
        });
      } else {
        p.courses.set(course.id, {
          ...prev,
          ssotPresent: prev.ssotPresent || ssotPresent,
          inCafe: prev.inCafe || inCafe,
          auditStatus: prev.auditStatus || auditStatus,
          missingRooms: prev.missingRooms.length > 0 ? prev.missingRooms : missingRooms,
        });
      }
    }
  }

  const term = normalize(q);
  const list = Array.from(agg.values()).map((p) => {
    const coursesArr = Array.from(p.courses.values());
    const ssotCount = coursesArr.filter((c) => c.ssotPresent).length;
    const inCafeCount = coursesArr.filter((c) => c.inCafe).length;
    const issues = coursesArr.filter((c) => (c.missingRooms && c.missingRooms.length > 0) || (c.auditStatus && c.auditStatus !== "OK" && c.auditStatus !== "STAFF")).length;
    const displayName = p.ssotName || p.cafeNickname || p.ssotNickname || "어떤 분";

    return {
      key: p.key,
      displayName,
      ssotUserId: p.ssotUserId,
      cafeUserId: p.cafeUserId,
      ssotName: p.ssotName,
      ssotNickname: p.ssotNickname,
      cafeNickname: p.cafeNickname,
      counts: { courses: coursesArr.length, ssotPresent: ssotCount, inCafe: inCafeCount, issues },
      courses: coursesArr,
    };
  });

  const filtered = list
    .filter((p) => {
      if (!term) return true;
      const fields = [
        p.displayName,
        p.ssotName || "",
        p.ssotNickname || "",
        p.cafeNickname || "",
        p.ssotUserId || "",
        p.cafeUserId || "",
      ];
      return fields.some((f) => normalize(f).includes(term));
    })
    .filter((p) => (onlyIssues ? p.counts.issues > 0 : true))
    .sort((a, b) => {
      if (b.counts.ssotPresent !== a.counts.ssotPresent) return b.counts.ssotPresent - a.counts.ssotPresent;
      if (b.counts.courses !== a.counts.courses) return b.counts.courses - a.counts.courses;
      return a.displayName.localeCompare(b.displayName, "ko-KR");
    });

  return NextResponse.json({
    ok: true,
    updatedAt: new Date().toISOString(),
    stats: { courses: courses.length, peopleTotal: agg.size, returned: Math.min(limit, filtered.length) },
    people: filtered.slice(0, limit),
  });
}
