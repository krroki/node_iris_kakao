import crypto from "crypto";
import { z } from "zod";

import { getSql } from "@/lib/storeDb";

export type CourseRow = {
  id: string;
  courseKey: string;
  clubId: string | null;
  archived: boolean;
  archivedAt: string | null;
  archivedBy: string | null;
  cafeUrl: string | null;
  openchatChatRoomId: string | null;
  openchatNoticeRoomId: string | null;
  premiumEnabled: boolean;
  openchatPremiumRoomId: string | null;
  vipEnabled: boolean;
  openchatVipRoomId: string | null;
  paymentSheetId: string | null;
  paymentSheetName: string | null;
  paymentHeaderRow: number;
  paymentGradeCol: string;
  paymentNicknameCol: string;
  paymentNameCol: string;
  paymentIdCol: string;
  paymentKindCol: string;
  paymentExcludeKinds: string;
};

export type ActionStateRow = {
  actionKey: string;
  courseId: string;
  status: "대기" | "확인 대기" | "완료(검증됨)" | "미해결(재확인)" | "확인 불가(데이터 미완전)";
  handledBy: string | null;
  handledAt: string | null;
  hidden: boolean;
  hiddenBy: string | null;
  hiddenAt: string | null;
  memo: string | null;
};

export type JobRow = {
  id: string;
  courseId: string;
  kind: "SYNC_FULL" | "REVERIFY_PENDING";
  status: "QUEUED" | "RUNNING" | "DONE" | "FAILED";
  requestedBy: string;
  requestedAt: string;
  progressPct: number | null;
  progressMessage: string | null;
  updatedAt: string | null;
};

export type UserRow = {
  name: string;
  enabled: boolean;
  canSync: boolean;
  createdAt: string;
  updatedAt: string | null;
};

export type CourseSnapshotRow = {
  courseId: string;
  fetchedAt: string | null;
  payload: any;
  updatedAt: string;
};

export type GlobalSnapshotRow = {
  key: string;
  fetchedAt: string | null;
  payload: any;
  updatedAt: string;
};

export type OpenchatWatchRow = {
  roomId: string;
  pinned: boolean;
  hidden: boolean;
  sortOrder: number;
  updatedAt: string | null;
};

export type AgentRequestRow = {
  key: string;
  requestedAt: string;
  requestedBy: string | null;
  updatedAt: string | null;
};

const CreateCourseBody = z
  .object({
    courseKey: z.string().trim().min(1),
    clubId: z.string().trim().optional().default(""),
    cafeUrl: z.string().trim().optional().default(""),
    openchatChatRoomId: z.string().trim().min(1),
    openchatNoticeRoomId: z.string().trim().min(1),
    premiumEnabled: z.boolean().optional().default(true),
    openchatPremiumRoomId: z.string().trim().optional().default(""),
    vipEnabled: z.boolean().optional().default(false),
    openchatVipRoomId: z.string().trim().optional().default(""),
    paymentSheetId: z.string().trim().optional().default(""),
    paymentSheetName: z.string().trim().optional().default(""),
    paymentHeaderRow: z.coerce.number().int().min(1).optional().default(19),
    paymentGradeCol: z.string().trim().optional().default("카페 등급"),
    paymentNicknameCol: z.string().trim().optional().default("닉네임"),
    paymentNameCol: z.string().trim().optional().default("성함"),
    paymentIdCol: z.string().trim().optional().default("아이디"),
    paymentKindCol: z.string().trim().optional().default("구분"),
    paymentExcludeKinds: z.string().trim().optional().default("환불"),
  })
  .superRefine((data, ctx) => {
    const cid = parseClubId(data.clubId || data.cafeUrl);
    if (!cid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["clubId"],
        message: "카페 clubId를 입력해 주세요.",
      });
    }
    if (data.premiumEnabled && !String(data.openchatPremiumRoomId || "").trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["openchatPremiumRoomId"],
        message: "프리미엄방 ID를 입력해 주세요.",
      });
    }
    if (data.vipEnabled && !String(data.openchatVipRoomId || "").trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["openchatVipRoomId"],
        message: "VIP방 ID를 입력해 주세요.",
      });
    }
  });

function id(prefix: string) {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function parseClubId(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const m1 = s.match(/[?&]clubid=(\d+)/i);
  if (m1) return String(m1[1] || "").trim();
  const m2 = s.match(/\/ca-fe\/cafes\/(\d+)(?:\/|$)/i);
  if (m2) return String(m2[1] || "").trim();
  const m3 = s.match(/\/cafes\/(\d+)(?:\/|$)/i);
  if (m3) return String(m3[1] || "").trim();
  const m4 = s.match(/^\d+$/);
  if (m4) return s;
  return "";
}

export async function coursesStore() {
  const sql = getSql();
  await sql`select 1`;
  return {
    async listCourses(opts: { includeArchived?: boolean } = {}): Promise<CourseRow[]> {
      const includeArchived = Boolean(opts.includeArchived);
      try {
        const rows = await sql<
          {
            id: string;
            course_key: string;
            club_id: string | null;
            archived: boolean | null;
            archived_at: Date | null;
            archived_by: string | null;
            cafe_url: string | null;
            openchat_chat_room_id: string | null;
            openchat_notice_room_id: string | null;
            premium_enabled: boolean | null;
            openchat_premium_room_id: string | null;
            vip_enabled: boolean | null;
            openchat_vip_room_id: string | null;
            payment_sheet_id: string | null;
            payment_sheet_name: string | null;
            payment_header_row: number | null;
            payment_grade_col: string | null;
            payment_nickname_col: string | null;
            payment_name_col: string | null;
            payment_id_col: string | null;
            payment_kind_col: string | null;
            payment_exclude_kinds: string | null;
          }[]
        >`select id, course_key, club_id, archived, archived_at, archived_by, cafe_url, openchat_chat_room_id, openchat_notice_room_id, premium_enabled, openchat_premium_room_id, vip_enabled, openchat_vip_room_id, payment_sheet_id, payment_sheet_name, payment_header_row, payment_grade_col, payment_nickname_col, payment_name_col, payment_id_col, payment_kind_col, payment_exclude_kinds from courseops_courses where (${includeArchived} or archived=false) order by course_key asc`;
        return rows.map((r) => ({
          id: r.id,
          courseKey: r.course_key,
          clubId: r.club_id,
          archived: r.archived ?? false,
          archivedAt: r.archived_at ? r.archived_at.toISOString() : null,
          archivedBy: r.archived_by,
          cafeUrl: r.cafe_url,
          openchatChatRoomId: r.openchat_chat_room_id,
          openchatNoticeRoomId: r.openchat_notice_room_id,
          premiumEnabled: r.premium_enabled ?? true,
          openchatPremiumRoomId: r.openchat_premium_room_id,
          vipEnabled: r.vip_enabled ?? false,
          openchatVipRoomId: r.openchat_vip_room_id,
          paymentSheetId: r.payment_sheet_id,
          paymentSheetName: r.payment_sheet_name,
          paymentHeaderRow: Number(r.payment_header_row ?? 19),
          paymentGradeCol: String(r.payment_grade_col ?? "카페 등급"),
          paymentNicknameCol: String(r.payment_nickname_col ?? "닉네임"),
          paymentNameCol: String(r.payment_name_col ?? "성함"),
          paymentIdCol: String(r.payment_id_col ?? "아이디"),
          paymentKindCol: String(r.payment_kind_col ?? "구분"),
          paymentExcludeKinds: String(r.payment_exclude_kinds ?? "환불"),
        }));
      } catch {
        // 구버전 스키마 호환
        const rows = await sql<
          {
            id: string;
            course_key: string;
            cafe_url: string | null;
            openchat_chat_room_id: string | null;
            openchat_notice_room_id: string | null;
            premium_enabled: boolean | null;
            openchat_premium_room_id: string | null;
            vip_enabled: boolean | null;
            openchat_vip_room_id: string | null;
          }[]
        >`select id, course_key, cafe_url, openchat_chat_room_id, openchat_notice_room_id, premium_enabled, openchat_premium_room_id, vip_enabled, openchat_vip_room_id from courseops_courses order by course_key asc`;
        return rows.map((r) => ({
          id: r.id,
          courseKey: r.course_key,
          clubId: null,
          archived: false,
          archivedAt: null,
          archivedBy: null,
          cafeUrl: r.cafe_url,
          openchatChatRoomId: r.openchat_chat_room_id,
          openchatNoticeRoomId: r.openchat_notice_room_id,
          premiumEnabled: r.premium_enabled ?? true,
          openchatPremiumRoomId: r.openchat_premium_room_id,
          vipEnabled: r.vip_enabled ?? false,
          openchatVipRoomId: r.openchat_vip_room_id,
          paymentSheetId: null,
          paymentSheetName: null,
          paymentHeaderRow: 19,
          paymentGradeCol: "카페 등급",
          paymentNicknameCol: "닉네임",
          paymentNameCol: "성함",
          paymentIdCol: "아이디",
          paymentKindCol: "구분",
          paymentExcludeKinds: "환불",
        }));
      }
    },
    async getCourse(courseId: string, opts: { includeArchived?: boolean } = {}): Promise<CourseRow | null> {
      const includeArchived = Boolean(opts.includeArchived);
      try {
        const rows = await sql<
          {
            id: string;
            course_key: string;
            club_id: string | null;
            archived: boolean | null;
            archived_at: Date | null;
            archived_by: string | null;
            cafe_url: string | null;
            openchat_chat_room_id: string | null;
            openchat_notice_room_id: string | null;
            premium_enabled: boolean | null;
            openchat_premium_room_id: string | null;
            vip_enabled: boolean | null;
            openchat_vip_room_id: string | null;
            payment_sheet_id: string | null;
            payment_sheet_name: string | null;
            payment_header_row: number | null;
            payment_grade_col: string | null;
            payment_nickname_col: string | null;
            payment_name_col: string | null;
            payment_id_col: string | null;
            payment_kind_col: string | null;
            payment_exclude_kinds: string | null;
          }[]
        >`select id, course_key, club_id, archived, archived_at, archived_by, cafe_url, openchat_chat_room_id, openchat_notice_room_id, premium_enabled, openchat_premium_room_id, vip_enabled, openchat_vip_room_id, payment_sheet_id, payment_sheet_name, payment_header_row, payment_grade_col, payment_nickname_col, payment_name_col, payment_id_col, payment_kind_col, payment_exclude_kinds from courseops_courses where id=${courseId} and (${includeArchived} or archived=false) limit 1`;
        const r = rows[0];
        return r
          ? {
              id: r.id,
              courseKey: r.course_key,
              clubId: r.club_id,
              archived: r.archived ?? false,
              archivedAt: r.archived_at ? r.archived_at.toISOString() : null,
              archivedBy: r.archived_by,
              cafeUrl: r.cafe_url,
              openchatChatRoomId: r.openchat_chat_room_id,
              openchatNoticeRoomId: r.openchat_notice_room_id,
              premiumEnabled: r.premium_enabled ?? true,
              openchatPremiumRoomId: r.openchat_premium_room_id,
              vipEnabled: r.vip_enabled ?? false,
              openchatVipRoomId: r.openchat_vip_room_id,
              paymentSheetId: r.payment_sheet_id,
              paymentSheetName: r.payment_sheet_name,
              paymentHeaderRow: Number(r.payment_header_row ?? 19),
              paymentGradeCol: String(r.payment_grade_col ?? "카페 등급"),
              paymentNicknameCol: String(r.payment_nickname_col ?? "닉네임"),
              paymentNameCol: String(r.payment_name_col ?? "성함"),
              paymentIdCol: String(r.payment_id_col ?? "아이디"),
              paymentKindCol: String(r.payment_kind_col ?? "구분"),
              paymentExcludeKinds: String(r.payment_exclude_kinds ?? "환불"),
            }
          : null;
      } catch {
        const rows = await sql<
          {
            id: string;
            course_key: string;
            cafe_url: string | null;
            openchat_chat_room_id: string | null;
            openchat_notice_room_id: string | null;
            premium_enabled: boolean | null;
            openchat_premium_room_id: string | null;
            vip_enabled: boolean | null;
            openchat_vip_room_id: string | null;
          }[]
        >`select id, course_key, cafe_url, openchat_chat_room_id, openchat_notice_room_id, premium_enabled, openchat_premium_room_id, vip_enabled, openchat_vip_room_id from courseops_courses where id=${courseId} limit 1`;
        const r = rows[0];
        return r
          ? {
              id: r.id,
              courseKey: r.course_key,
              clubId: null,
              archived: false,
              archivedAt: null,
              archivedBy: null,
              cafeUrl: r.cafe_url,
              openchatChatRoomId: r.openchat_chat_room_id,
              openchatNoticeRoomId: r.openchat_notice_room_id,
              premiumEnabled: r.premium_enabled ?? true,
              openchatPremiumRoomId: r.openchat_premium_room_id,
              vipEnabled: r.vip_enabled ?? false,
              openchatVipRoomId: r.openchat_vip_room_id,
              paymentSheetId: null,
              paymentSheetName: null,
              paymentHeaderRow: 19,
              paymentGradeCol: "카페 등급",
              paymentNicknameCol: "닉네임",
              paymentNameCol: "성함",
              paymentIdCol: "아이디",
              paymentKindCol: "구분",
              paymentExcludeKinds: "환불",
            }
          : null;
      }
    },
    async createCourse(input: z.infer<typeof CreateCourseBody>): Promise<CourseRow> {
      const data = CreateCourseBody.parse(input);
      const courseId = id("course");
      const clubId = parseClubId(data.clubId || data.cafeUrl);
      const paymentSheetId = String(data.paymentSheetId || "").trim();
      const paymentSheetName = String(data.paymentSheetName || "").trim() || (paymentSheetId ? "종합" : "");
      const paymentHeaderRow = Number(data.paymentHeaderRow || 19) || 19;
      const paymentExcludeKinds = String(data.paymentExcludeKinds || "").trim() || "환불";
      try {
        await sql`
          insert into courseops_courses (
            id, course_key, club_id, sheet_id,
            cafe_url,
            openchat_chat_room_id, openchat_notice_room_id,
            premium_enabled, openchat_premium_room_id,
            vip_enabled, openchat_vip_room_id,
            payment_sheet_id, payment_sheet_name, payment_header_row,
            payment_grade_col, payment_nickname_col, payment_name_col,
            payment_id_col, payment_kind_col, payment_exclude_kinds
          )
          values (
            ${courseId}, ${data.courseKey}, ${clubId || null}, 'DISABLED',      
            ${data.cafeUrl || null},
            ${data.openchatChatRoomId || null}, ${data.openchatNoticeRoomId || null},
            ${Boolean(data.premiumEnabled)}, ${data.openchatPremiumRoomId || null},
            ${Boolean(data.vipEnabled)}, ${data.openchatVipRoomId || null},
            ${paymentSheetId || null}, ${paymentSheetName || null}, ${paymentHeaderRow},
            ${String(data.paymentGradeCol || "카페 등급")}, ${String(data.paymentNicknameCol || "닉네임")}, ${String(data.paymentNameCol || "성함")},
            ${String(data.paymentIdCol || "아이디")}, ${String(data.paymentKindCol || "구분")}, ${paymentExcludeKinds}
          )
        `;
      } catch (e: any) {
        const msg = String(e?.message || "");
        if (msg.includes("duplicate") && msg.includes("course_key")) {
          throw new Error("이미 등록된 강의 이름이에요. 기존 강의를 수정해 주세요.");
        }
        if (msg.includes("does not exist") && (msg.includes("club_id") || msg.includes("payment_") || msg.includes("archived"))) {
          throw new Error("DB 스키마 업데이트가 필요해요. 관리자에게 `npm run db:init`을 요청해 주세요.");
        }
        throw e;
      }
      return {
        id: courseId,
        courseKey: data.courseKey,
        clubId: clubId || null,
        archived: false,
        archivedAt: null,
        archivedBy: null,
        cafeUrl: data.cafeUrl || null,
        openchatChatRoomId: data.openchatChatRoomId || null,
        openchatNoticeRoomId: data.openchatNoticeRoomId || null,
        premiumEnabled: Boolean(data.premiumEnabled),
        openchatPremiumRoomId: data.openchatPremiumRoomId || null,
        vipEnabled: Boolean(data.vipEnabled),
        openchatVipRoomId: data.openchatVipRoomId || null,
        paymentSheetId: paymentSheetId || null,
        paymentSheetName: paymentSheetName || null,
        paymentHeaderRow: paymentHeaderRow,
        paymentGradeCol: String(data.paymentGradeCol || "카페 등급"),
        paymentNicknameCol: String(data.paymentNicknameCol || "닉네임"),
        paymentNameCol: String(data.paymentNameCol || "성함"),
        paymentIdCol: String(data.paymentIdCol || "아이디"),
        paymentKindCol: String(data.paymentKindCol || "구분"),
        paymentExcludeKinds: paymentExcludeKinds,
      };
    },
    async updateCourse(courseId: string, patch: Partial<z.infer<typeof CreateCourseBody>>): Promise<CourseRow> {
      const prev = await this.getCourse(courseId, { includeArchived: true });
      if (!prev) throw new Error("강의를 찾지 못했어요.");

      const merged = {
        courseKey: patch.courseKey ?? prev.courseKey,
        clubId: patch.clubId ?? prev.clubId ?? "",
        cafeUrl: patch.cafeUrl ?? prev.cafeUrl ?? "",
        openchatChatRoomId: patch.openchatChatRoomId ?? prev.openchatChatRoomId ?? "",
        openchatNoticeRoomId: patch.openchatNoticeRoomId ?? prev.openchatNoticeRoomId ?? "",
        premiumEnabled: patch.premiumEnabled ?? prev.premiumEnabled ?? true,
        openchatPremiumRoomId: patch.openchatPremiumRoomId ?? prev.openchatPremiumRoomId ?? "",
        vipEnabled: patch.vipEnabled ?? prev.vipEnabled ?? false,
        openchatVipRoomId: patch.openchatVipRoomId ?? prev.openchatVipRoomId ?? "",
        paymentSheetId: patch.paymentSheetId ?? prev.paymentSheetId ?? "",
        paymentSheetName: patch.paymentSheetName ?? prev.paymentSheetName ?? "",
        paymentHeaderRow: patch.paymentHeaderRow ?? prev.paymentHeaderRow ?? 19,
        paymentGradeCol: patch.paymentGradeCol ?? prev.paymentGradeCol ?? "카페 등급",
        paymentNicknameCol: patch.paymentNicknameCol ?? prev.paymentNicknameCol ?? "닉네임",
        paymentNameCol: patch.paymentNameCol ?? prev.paymentNameCol ?? "성함",
        paymentIdCol: patch.paymentIdCol ?? prev.paymentIdCol ?? "아이디",
        paymentKindCol: patch.paymentKindCol ?? prev.paymentKindCol ?? "구분",
        paymentExcludeKinds: patch.paymentExcludeKinds ?? prev.paymentExcludeKinds ?? "환불",
      };

      const data = CreateCourseBody.parse(merged);
      const clubId = parseClubId(data.clubId || data.cafeUrl);
      const paymentSheetId = String(data.paymentSheetId || "").trim();
      const paymentSheetName = String(data.paymentSheetName || "").trim() || (paymentSheetId ? "종합" : "");
      const paymentHeaderRow = Number(data.paymentHeaderRow || 19) || 19;
      const paymentExcludeKinds = String(data.paymentExcludeKinds || "").trim() || "환불";

      try {
        await sql`
          update courseops_courses
          set course_key=${data.courseKey},
              club_id=${clubId || null},
              cafe_url=${data.cafeUrl || null},
              openchat_chat_room_id=${data.openchatChatRoomId || null},
              openchat_notice_room_id=${data.openchatNoticeRoomId || null},
              premium_enabled=${Boolean(data.premiumEnabled)},
              openchat_premium_room_id=${data.openchatPremiumRoomId || null},
              vip_enabled=${Boolean(data.vipEnabled)},
              openchat_vip_room_id=${data.openchatVipRoomId || null},
              payment_sheet_id=${paymentSheetId || null},
              payment_sheet_name=${paymentSheetName || null},
              payment_header_row=${paymentHeaderRow},
              payment_grade_col=${String(data.paymentGradeCol || "카페 등급")},
              payment_nickname_col=${String(data.paymentNicknameCol || "닉네임")},
              payment_name_col=${String(data.paymentNameCol || "성함")},
              payment_id_col=${String(data.paymentIdCol || "아이디")},
              payment_kind_col=${String(data.paymentKindCol || "구분")},
              payment_exclude_kinds=${paymentExcludeKinds}
          where id=${courseId}
        `;
      } catch (e: any) {
        const msg = String(e?.message || "");
        if (msg.includes("duplicate") && msg.includes("course_key")) {
          throw new Error("이미 등록된 강의 이름이에요. 다른 이름으로 바꿔 주세요.");
        }
        throw e;
      }

      const updated = await this.getCourse(courseId, { includeArchived: true });
      if (!updated) throw new Error("저장 후 강의를 다시 불러오지 못했어요.");
      return updated;
    },
    async setCourseArchived(input: { courseId: string; archived: boolean; by: string }): Promise<CourseRow> {
      const cid = String(input.courseId || "").trim();
      if (!cid) throw new Error("courseId is required");
      const by = String(input.by || "").trim();
      if (!by) throw new Error("by is required");

      if (input.archived) {
        await sql`
          update courseops_courses
          set archived=true, archived_at=now(), archived_by=${by}
          where id=${cid}
        `;
      } else {
        await sql`
          update courseops_courses
          set archived=false, archived_at=null, archived_by=null
          where id=${cid}
        `;
      }
      const out = await this.getCourse(cid, { includeArchived: true });
      if (!out) throw new Error("강의를 찾지 못했어요.");
      return out;
    },
    async getCourseSnapshot(courseId: string): Promise<CourseSnapshotRow | null> {
      const cid = String(courseId || "").trim();
      if (!cid) return null;
      try {
        const rows = await sql<
          {
            course_id: string;
            fetched_at: Date | null;
            payload: any;
            updated_at: Date;
          }[]
        >`select course_id, fetched_at, payload, updated_at from courseops_course_snapshots where course_id=${cid} limit 1`;
        const r = rows[0];
        if (!r) return null;
        const payload = typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload;
        return {
          courseId: r.course_id,
          fetchedAt: r.fetched_at ? r.fetched_at.toISOString() : null,
          payload,
          updatedAt: r.updated_at ? r.updated_at.toISOString() : new Date().toISOString(),
        };
      } catch {
        return null;
      }
    },
    async upsertCourseSnapshot(input: { courseId: string; fetchedAt?: string | null; payload: any }) {
      const cid = String(input.courseId || "").trim();
      if (!cid) throw new Error("courseId is required");
      const fetchedAt = input.fetchedAt ? String(input.fetchedAt) : null;
      const payload = input.payload ?? {};
      await sql`
          insert into courseops_course_snapshots (course_id, fetched_at, payload, updated_at)
          values (${cid}, ${fetchedAt}, ${JSON.stringify(payload)}, now())
          on conflict (course_id) do update set
            fetched_at=excluded.fetched_at,
            payload=excluded.payload,
            updated_at=now()
        `;
      return this.getCourseSnapshot(cid);
    },
    async getGlobalSnapshot(key: string): Promise<GlobalSnapshotRow | null> {
      const k = String(key || "").trim();
      if (!k) return null;
      try {
        const rows = await sql<
          {
            key: string;
            fetched_at: Date | null;
            payload: any;
            updated_at: Date;
          }[]
        >`select key, fetched_at, payload, updated_at from courseops_global_snapshots where key=${k} limit 1`;
        const r = rows[0];
        if (!r) return null;
        const payload = typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload;
        return {
          key: r.key,
          fetchedAt: r.fetched_at ? r.fetched_at.toISOString() : null,
          payload,
          updatedAt: r.updated_at ? r.updated_at.toISOString() : new Date().toISOString(),
        };
      } catch {
        return null;
      }
    },
    async upsertGlobalSnapshot(input: { key: string; fetchedAt?: string | null; payload: any }) {
      const k = String(input.key || "").trim();
      if (!k) throw new Error("key is required");
      const fetchedAt = input.fetchedAt ? String(input.fetchedAt) : null;
      const payload = input.payload ?? {};
      await sql`
          insert into courseops_global_snapshots (key, fetched_at, payload, updated_at)
          values (${k}, ${fetchedAt}, ${JSON.stringify(payload)}, now())
          on conflict (key) do update set
            fetched_at=excluded.fetched_at,
            payload=excluded.payload,
            updated_at=now()
        `;
      return this.getGlobalSnapshot(k);
    },
    async listOpenchatWatchlist(): Promise<OpenchatWatchRow[]> {
      const rows = await sql<
        {
          room_id: string;
          pinned: boolean | null;
          hidden: boolean | null;
          sort_order: number | null;
          updated_at: Date | null;
        }[]
      >`select room_id, pinned, hidden, sort_order, updated_at from courseops_openchat_watchlist`;
      return rows.map((r) => ({
        roomId: String(r.room_id),
        pinned: Boolean(r.pinned),
        hidden: Boolean(r.hidden),
        sortOrder: Number(r.sort_order ?? 0),
        updatedAt: r.updated_at ? r.updated_at.toISOString() : null,
      }));
    },
    async ensureOpenchatWatchlistRooms(roomIds: string[]): Promise<void> {
      const ids = Array.from(
        new Set(
          (Array.isArray(roomIds) ? roomIds : [])
            .map((x) => String(x || "").trim())
            .filter(Boolean),
        ),
      );
      if (ids.length === 0) return;

      const existing = await sql<{ room_id: string }[]>`
        select room_id from courseops_openchat_watchlist where room_id = any(${ids}::text[])
      `;
      const existingSet = new Set(existing.map((r) => String(r.room_id)));
      const missing = ids.filter((id) => !existingSet.has(id));
      if (missing.length === 0) return;

      const maxRow = await sql<{ max_order: number | null }[]>`
        select max(sort_order) as max_order from courseops_openchat_watchlist
      `;
      const start = Number(maxRow?.[0]?.max_order ?? 0) + 1;

      await sql`
        insert into courseops_openchat_watchlist (room_id, pinned, hidden, sort_order, updated_at)
        select u.room_id, false, false, ${start} + u.ord - 1, now()
        from unnest(${missing}::text[]) with ordinality as u(room_id, ord)
        on conflict (room_id) do nothing
      `;
    },
    async updateOpenchatWatchlist(input: { roomId: string; pinned?: boolean; hidden?: boolean }) {
      const roomId = String(input.roomId || "").trim();
      if (!roomId) throw new Error("roomId is required");

      const cur = await sql<
        { room_id: string; pinned: boolean | null; hidden: boolean | null }[]
      >`select room_id, pinned, hidden from courseops_openchat_watchlist where room_id=${roomId} limit 1`;

      if (cur.length === 0) {
        await sql`
          insert into courseops_openchat_watchlist (room_id, pinned, hidden, sort_order, updated_at)
          values (${roomId}, ${Boolean(input.pinned)}, ${Boolean(input.hidden)}, 0, now())
          on conflict (room_id)
          do update set pinned=excluded.pinned, hidden=excluded.hidden, updated_at=now()
        `;
        return;
      }

      const nextPinned = typeof input.pinned === "boolean" ? input.pinned : Boolean(cur[0].pinned);
      const nextHidden = typeof input.hidden === "boolean" ? input.hidden : Boolean(cur[0].hidden);
      await sql`
        update courseops_openchat_watchlist
        set pinned=${nextPinned}, hidden=${nextHidden}, updated_at=now()
        where room_id=${roomId}
      `;
    },
    async reorderOpenchatWatchlist(input: { pinned: boolean; roomIds: string[] }) {
      const pinned = Boolean(input.pinned);
      const roomIds = Array.from(
        new Set(
          (Array.isArray(input.roomIds) ? input.roomIds : [])
            .map((x) => String(x || "").trim())
            .filter(Boolean),
        ),
      );
      if (roomIds.length === 0) return;

      await sql`
        update courseops_openchat_watchlist w
        set sort_order = u.ord, updated_at = now()
        from unnest(${roomIds}::text[]) with ordinality as u(room_id, ord)
        where w.room_id = u.room_id and w.pinned = ${pinned}
      `;
    },
    async getAgentRequest(key: string): Promise<AgentRequestRow | null> {
      const k = String(key || "").trim();
      if (!k) return null;
      const rows = await sql<
        { key: string; requested_at: Date; requested_by: string | null; updated_at: Date | null }[]
      >`select key, requested_at, requested_by, updated_at from courseops_agent_requests where key=${k} limit 1`;
      if (rows.length === 0) return null;
      return {
        key: rows[0].key,
        requestedAt: rows[0].requested_at.toISOString(),
        requestedBy: rows[0].requested_by,
        updatedAt: rows[0].updated_at ? rows[0].updated_at.toISOString() : null,
      };
    },
    async listAgentRequestsByPrefix(
      input: string | { prefix: string; limit?: number },
      limitFallback = 50,
    ): Promise<AgentRequestRow[]> {
      const p =
        typeof input === "string" ? String(input || "").trim() : String(input?.prefix || "").trim();
      if (!p) return [];
      const max =
        typeof input === "string"
          ? Math.max(1, Math.min(200, Number(limitFallback || 50)))
          : Math.max(1, Math.min(200, Number(input.limit ?? 50) || 50));
      const like = `${p}%`;
      const rows = await sql<
        { key: string; requested_at: Date; requested_by: string | null; updated_at: Date | null }[]
      >`select key, requested_at, requested_by, updated_at from courseops_agent_requests where key like ${like} order by requested_at asc limit ${max}`;
      return rows.map((r) => ({
        key: r.key,
        requestedAt: r.requested_at.toISOString(),
        requestedBy: r.requested_by,
        updatedAt: r.updated_at ? r.updated_at.toISOString() : null,
      }));
    },
    async deleteAgentRequest(key: string) {
      const k = String(key || "").trim();
      if (!k) return;
      await sql`delete from courseops_agent_requests where key=${k}`;
    },
    async upsertAgentRequest(input: { key: string; requestedBy?: string | null }): Promise<AgentRequestRow> {
      const key = String(input.key || "").trim();
      if (!key) throw new Error("key is required");
      const requestedBy = input.requestedBy ? String(input.requestedBy).trim() : null;
      const rows = await sql<
        { key: string; requested_at: Date; requested_by: string | null; updated_at: Date | null }[]
      >`
        insert into courseops_agent_requests (key, requested_at, requested_by, updated_at)
        values (${key}, now(), ${requestedBy}, now())
        on conflict (key)
        do update set requested_at=now(), requested_by=excluded.requested_by, updated_at=now()
        returning key, requested_at, requested_by, updated_at
      `;
      return {
        key: rows[0].key,
        requestedAt: rows[0].requested_at.toISOString(),
        requestedBy: rows[0].requested_by,
        updatedAt: rows[0].updated_at ? rows[0].updated_at.toISOString() : null,
      };
    },
    async getActionStates(courseId: string, actionKeys: string[]): Promise<ActionStateRow[]> {
      if (!actionKeys || actionKeys.length === 0) return [];
      const rows = await sql<
        {
          action_key: string;
          course_id: string;
          status: string;
          handled_by: string | null;
          handled_at: Date | null;
          hidden: boolean | null;
          hidden_by: string | null;
          hidden_at: Date | null;
          memo: string | null;
        }[]
      >`select action_key, course_id, status, handled_by, handled_at, hidden, hidden_by, hidden_at, memo from courseops_action_state where course_id=${courseId} and action_key = any(${actionKeys}::text[])`;

      return rows.map((r) => ({
        actionKey: r.action_key,
        courseId: r.course_id,
        status: (r.status as ActionStateRow["status"]) || "대기",
        handledBy: r.handled_by,
        handledAt: r.handled_at ? r.handled_at.toISOString() : null,
        hidden: r.hidden ?? false,
        hiddenBy: r.hidden_by,
        hiddenAt: r.hidden_at ? r.hidden_at.toISOString() : null,
        memo: r.memo,
      }));
    },
    async markActionDone(input: { courseId: string; actionKey: string; handledBy: string; memo: string }) {
      const now = new Date();
      const status: ActionStateRow["status"] = "확인 대기";
      await sql`
        insert into courseops_action_state (action_key, course_id, status, handled_by, handled_at, memo)
        values (${input.actionKey}, ${input.courseId}, ${status}, ${input.handledBy}, ${now}, ${input.memo})
        on conflict (action_key) do update set
          status=excluded.status,
          handled_by=excluded.handled_by,
          handled_at=excluded.handled_at,
          memo=excluded.memo
      `;
    },
    async setActionHidden(input: { courseId: string; actionKey: string; hidden: boolean; by: string }) {
      const courseId = String(input.courseId || "").trim();
      const actionKey = String(input.actionKey || "").trim();
      const by = String(input.by || "").trim();
      if (!courseId) throw new Error("courseId is required");
      if (!actionKey) throw new Error("actionKey is required");
      if (!by) throw new Error("by is required");

      if (input.hidden) {
        const now = new Date();
        await sql`
          insert into courseops_action_state (action_key, course_id, status, hidden, hidden_by, hidden_at, created_at)
          values (${actionKey}, ${courseId}, '대기', true, ${by}, ${now}, now())
          on conflict (action_key) do update set
            hidden=true,
            hidden_by=excluded.hidden_by,
            hidden_at=excluded.hidden_at
          where courseops_action_state.course_id=excluded.course_id
        `;
        return;
      }

      await sql`
        update courseops_action_state
        set hidden=false, hidden_by=null, hidden_at=null
        where action_key=${actionKey} and course_id=${courseId}
      `;
    },
    async enqueueJob(input: { courseId: string; kind: JobRow["kind"]; requestedBy: string; payload: unknown }) {
      const jobId = id("job");
      await sql`
        insert into courseops_jobs (id, course_id, kind, status, requested_by, payload, requested_at)
        values (${jobId}, ${input.courseId}, ${input.kind}, 'QUEUED', ${input.requestedBy}, ${JSON.stringify(input.payload)}, now())
      `;
      return this.getLatestJob(input.courseId);
    },
    async getLatestJob(courseId: string): Promise<JobRow | null> {
      const rows = await sql<
        {
          id: string;
          course_id: string;
          kind: string;
          status: string;
          requested_by: string;
          requested_at: Date;
          progress_pct: number | null;
          progress_message: string | null;
          updated_at: Date | null;
        }[]
      >`select id, course_id, kind, status, requested_by, requested_at, progress_pct, progress_message, updated_at from courseops_jobs where course_id=${courseId} order by requested_at desc limit 1`;
      const r = rows[0];
      if (!r) return null;
      return {
        id: r.id,
        courseId: r.course_id,
        kind: r.kind as JobRow["kind"],
        status: r.status as JobRow["status"],
        requestedBy: r.requested_by,
        requestedAt: r.requested_at.toISOString(),
        progressPct: r.progress_pct,
        progressMessage: r.progress_message,
        updatedAt: r.updated_at ? r.updated_at.toISOString() : null,
      };
    },
    async listJobEvents(jobId: string, limit = 80): Promise<Array<{ level: "INFO" | "WARN" | "ERROR"; message: string; ts: string }>> {
      const max = Math.max(1, Math.min(200, Number(limit || 80)));
      const rows = await sql<
        {
          level: string;
          message: string;
          ts: Date;
        }[]
      >`select level, message, ts from courseops_job_events where job_id=${jobId} order by ts desc limit ${max}`;
      return rows
        .map((r) => ({
          level: (r.level as "INFO" | "WARN" | "ERROR") || "INFO",
          message: r.message,
          ts: r.ts.toISOString(),
        }))
        .reverse();
    },
    async claimNextJob(agentName: string): Promise<(JobRow & { payload: any }) | null> {
      // 에이전트가 멈춰서 heartbeat가 오래 갱신되지 않은 RUNNING 작업은,
      // 자동으로 다시 QUEUED로 되돌려서 다음 폴링에서 재시도되게 한다.
      // (웹/운영에서 “멈춘 작업”을 사람이 수동으로 정리하지 않게 하는 목적)
      const staleSec = 7 * 60;
      await sql`
        update courseops_jobs
        set status='QUEUED',
            requested_at=now(),
            started_at=null,
            finished_at=null,
            updated_at=now(),
            agent_name=null,
            last_heartbeat_at=null,
            progress_pct=null,
            progress_message=null,
            result_message=null
        where status='RUNNING'
          and last_heartbeat_at is not null
          and last_heartbeat_at < now() - (${staleSec} * interval '1 second')
      `;

      const rows = await sql<
        {
          id: string;
          course_id: string;
          kind: string;
          status: string;
          requested_by: string;
          requested_at: Date;
          payload: any;
        }[]
      >`
        with next as (
          select id from courseops_jobs
          where status='QUEUED'
          order by requested_at asc
          limit 1
          for update skip locked
        )
        update courseops_jobs
        set status='RUNNING', started_at=now(), updated_at=now(), agent_name=${agentName}, last_heartbeat_at=now()
        where id in (select id from next)
        returning id, course_id, kind, status, requested_by, requested_at, payload
      `;
      const r = rows[0];
      if (!r) return null;
      return {
        id: r.id,
        courseId: r.course_id,
        kind: r.kind as JobRow["kind"],
        status: r.status as JobRow["status"],
        requestedBy: r.requested_by,
        requestedAt: r.requested_at.toISOString(),
        progressPct: null,
        progressMessage: null,
        updatedAt: null,
        payload: r.payload || {},
      };
    },
    async updateJobProgress(input: {
      jobId: string;
      status: "RUNNING" | "DONE" | "FAILED";
      progressPct?: number | null;
      progressMessage?: string | null;
      actionUpdates?: Array<{
        actionKey: string;
        status: "확인 대기" | "완료(검증됨)" | "미해결(재확인)" | "확인 불가(데이터 미완전)";
      }>;
      events?: Array<{ level: "INFO" | "WARN" | "ERROR"; message: string; ts?: string }>;
      resultMessage?: string;
    }) {
      const pct = typeof input.progressPct === "number" ? input.progressPct : null;
      const msg = input.progressMessage ? String(input.progressMessage) : null;
      const status = input.status === "DONE" ? "DONE" : input.status === "FAILED" ? "FAILED" : "RUNNING";
      const finished = status === "DONE" || status === "FAILED";
      await sql`
        update courseops_jobs
        set status=${status},
            progress_pct=${pct},
            progress_message=${msg},
            updated_at=now(),
            last_heartbeat_at=now(),
            finished_at=case when ${finished} then now() else finished_at end,
            result_message=case when ${finished} then ${String(input.resultMessage || "")} else result_message end
        where id=${input.jobId}
      `;
      const evs = Array.isArray(input.events) ? input.events : [];
      for (const ev of evs.slice(0, 30)) {
        const eid = id("ev");
        let ts = new Date();
        const rawTs = typeof ev.ts === "string" ? ev.ts.trim() : "";
        if (rawTs) {
          const parsed = new Date(rawTs);
          if (!Number.isNaN(parsed.getTime())) ts = parsed;
        }
        await sql`
          insert into courseops_job_events (id, job_id, level, message, ts)
          values (${eid}, ${input.jobId}, ${ev.level}, ${ev.message}, ${ts})
        `;
      }

      const ups = Array.isArray(input.actionUpdates) ? input.actionUpdates : [];
      if (ups.length > 0) {
        const jrows = await sql<{ course_id: string }[]>`select course_id from courseops_jobs where id=${input.jobId} limit 1`;
        const courseId = jrows[0]?.course_id;
        if (courseId) {
          for (const u of ups.slice(0, 200)) {
            await sql`
              insert into courseops_action_state (action_key, course_id, status, created_at)
              values (${u.actionKey}, ${courseId}, ${u.status}, now())
              on conflict (action_key) do update set status=excluded.status
            `;
          }
        }
      }
    },

    async hasAnyUsers(): Promise<boolean> {
      try {
        const rows = await sql<{ name: string }[]>`select name from courseops_users limit 1`;
        return Boolean(rows[0]?.name);
      } catch {
        return false;
      }
    },

    async getUser(name: string): Promise<UserRow | null> {
      const n = String(name || "").trim();
      if (!n) return null;
      try {
        const rows = await sql<
          {
            name: string;
            enabled: boolean | null;
            can_sync: boolean | null;
            created_at: Date;
            updated_at: Date | null;
          }[]
        >`select name, enabled, can_sync, created_at, updated_at from courseops_users where name=${n} limit 1`;
        const r = rows[0];
        if (!r) return null;
        return {
          name: r.name,
          enabled: r.enabled ?? true,
          canSync: r.can_sync ?? true,
          createdAt: r.created_at.toISOString(),
          updatedAt: r.updated_at ? r.updated_at.toISOString() : null,
        };
      } catch {
        return null;
      }
    },

    async listUsers(): Promise<UserRow[]> {
      try {
        const rows = await sql<
          {
            name: string;
            enabled: boolean | null;
            can_sync: boolean | null;
            created_at: Date;
            updated_at: Date | null;
          }[]
        >`select name, enabled, can_sync, created_at, updated_at from courseops_users order by name asc`;
        return rows.map((r) => ({
          name: r.name,
          enabled: r.enabled ?? true,
          canSync: r.can_sync ?? true,
          createdAt: r.created_at.toISOString(),
          updatedAt: r.updated_at ? r.updated_at.toISOString() : null,
        }));
      } catch {
        return [];
      }
    },

    async upsertUser(input: { name: string; enabled: boolean; canSync: boolean }): Promise<UserRow> {
      const n = String(input.name || "").trim();
      if (!n) throw new Error("name is required");
      const enabled = Boolean(input.enabled);
      const canSync = Boolean(input.canSync);
      await sql`
        insert into courseops_users (name, enabled, can_sync, updated_at)
        values (${n}, ${enabled}, ${canSync}, now())
        on conflict (name) do update set
          enabled=excluded.enabled,
          can_sync=excluded.can_sync,
          updated_at=now()
      `;
      const out = await this.getUser(n);
      if (!out) throw new Error("failed to upsert user");
      return out;
    },

    async deleteUser(name: string) {
      const n = String(name || "").trim();
      if (!n) return;
      try {
        await sql`delete from courseops_users where name=${n}`;
      } catch {}
    },
  };
}
