import crypto from "crypto";
import { z } from "zod";

import { getSql } from "@/lib/storeDb";

export type CourseRow = {
  id: string;
  courseKey: string;
  clubId: string | null;
  sheetId: string;
  actionsTab: string;
  cafeUrl: string | null;
  openchatChatRoomId: string | null;
  openchatNoticeRoomId: string | null;
  premiumEnabled: boolean;
  openchatPremiumRoomId: string | null;
  vipEnabled: boolean;
  openchatVipRoomId: string | null;
};

export type ActionStateRow = {
  actionKey: string;
  courseId: string;
  status: "대기" | "확인 대기" | "완료(검증됨)" | "미해결(재확인)" | "확인 불가(데이터 미완전)";
  handledBy: string | null;
  handledAt: string | null;
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

const CreateCourseBody = z
  .object({
    courseKey: z.string().trim().min(1),
    clubId: z.string().trim().optional().default(""),
    sheetIdOrUrl: z.string().trim().min(1),
    actionsTab: z.string().trim().min(1),
    cafeUrl: z.string().trim().optional().default(""),
    openchatChatRoomId: z.string().trim().min(1),
    openchatNoticeRoomId: z.string().trim().min(1),
    premiumEnabled: z.boolean().optional().default(true),
    openchatPremiumRoomId: z.string().trim().optional().default(""),
    vipEnabled: z.boolean().optional().default(false),
    openchatVipRoomId: z.string().trim().optional().default(""),
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

function parseSheetId(raw: string) {
  const s = String(raw || "").trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return (m ? m[1] : s).trim();
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
    async listCourses(): Promise<CourseRow[]> {
      try {
        const rows = await sql<
          {
            id: string;
            course_key: string;
            club_id: string | null;
            sheet_id: string;
            actions_tab: string;
            cafe_url: string | null;
            openchat_chat_room_id: string | null;
            openchat_notice_room_id: string | null;
            premium_enabled: boolean | null;
            openchat_premium_room_id: string | null;
            vip_enabled: boolean | null;
            openchat_vip_room_id: string | null;
          }[]
        >`select id, course_key, club_id, sheet_id, actions_tab, cafe_url, openchat_chat_room_id, openchat_notice_room_id, premium_enabled, openchat_premium_room_id, vip_enabled, openchat_vip_room_id from courseops_courses order by course_key asc`;
        return rows.map((r) => ({
          id: r.id,
          courseKey: r.course_key,
          clubId: r.club_id,
          sheetId: r.sheet_id,
          actionsTab: r.actions_tab,
          cafeUrl: r.cafe_url,
          openchatChatRoomId: r.openchat_chat_room_id,
          openchatNoticeRoomId: r.openchat_notice_room_id,
          premiumEnabled: r.premium_enabled ?? true,
          openchatPremiumRoomId: r.openchat_premium_room_id,
          vipEnabled: r.vip_enabled ?? false,
          openchatVipRoomId: r.openchat_vip_room_id,
        }));
      } catch {
        // 구버전 스키마( club_id 컬럼이 없던 시점 ) 호환
        const rows = await sql<
          {
            id: string;
            course_key: string;
            sheet_id: string;
            actions_tab: string;
            cafe_url: string | null;
            openchat_chat_room_id: string | null;
            openchat_notice_room_id: string | null;
            premium_enabled: boolean | null;
            openchat_premium_room_id: string | null;
            vip_enabled: boolean | null;
            openchat_vip_room_id: string | null;
          }[]
        >`select id, course_key, sheet_id, actions_tab, cafe_url, openchat_chat_room_id, openchat_notice_room_id, premium_enabled, openchat_premium_room_id, vip_enabled, openchat_vip_room_id from courseops_courses order by course_key asc`;
        return rows.map((r) => ({
          id: r.id,
          courseKey: r.course_key,
          clubId: null,
          sheetId: r.sheet_id,
          actionsTab: r.actions_tab,
          cafeUrl: r.cafe_url,
          openchatChatRoomId: r.openchat_chat_room_id,
          openchatNoticeRoomId: r.openchat_notice_room_id,
          premiumEnabled: r.premium_enabled ?? true,
          openchatPremiumRoomId: r.openchat_premium_room_id,
          vipEnabled: r.vip_enabled ?? false,
          openchatVipRoomId: r.openchat_vip_room_id,
        }));
      }
    },
    async getCourse(courseId: string): Promise<CourseRow | null> {
      try {
        const rows = await sql<
          {
            id: string;
            course_key: string;
            club_id: string | null;
            sheet_id: string;
            actions_tab: string;
            cafe_url: string | null;
            openchat_chat_room_id: string | null;
            openchat_notice_room_id: string | null;
            premium_enabled: boolean | null;
            openchat_premium_room_id: string | null;
            vip_enabled: boolean | null;
            openchat_vip_room_id: string | null;
          }[]
        >`select id, course_key, club_id, sheet_id, actions_tab, cafe_url, openchat_chat_room_id, openchat_notice_room_id, premium_enabled, openchat_premium_room_id, vip_enabled, openchat_vip_room_id from courseops_courses where id=${courseId} limit 1`;
        const r = rows[0];
        return r
          ? {
              id: r.id,
              courseKey: r.course_key,
              clubId: r.club_id,
              sheetId: r.sheet_id,
              actionsTab: r.actions_tab,
              cafeUrl: r.cafe_url,
              openchatChatRoomId: r.openchat_chat_room_id,
              openchatNoticeRoomId: r.openchat_notice_room_id,
              premiumEnabled: r.premium_enabled ?? true,
              openchatPremiumRoomId: r.openchat_premium_room_id,
              vipEnabled: r.vip_enabled ?? false,
              openchatVipRoomId: r.openchat_vip_room_id,
            }
          : null;
      } catch {
        const rows = await sql<
          {
            id: string;
            course_key: string;
            sheet_id: string;
            actions_tab: string;
            cafe_url: string | null;
            openchat_chat_room_id: string | null;
            openchat_notice_room_id: string | null;
            premium_enabled: boolean | null;
            openchat_premium_room_id: string | null;
            vip_enabled: boolean | null;
            openchat_vip_room_id: string | null;
          }[]
        >`select id, course_key, sheet_id, actions_tab, cafe_url, openchat_chat_room_id, openchat_notice_room_id, premium_enabled, openchat_premium_room_id, vip_enabled, openchat_vip_room_id from courseops_courses where id=${courseId} limit 1`;
        const r = rows[0];
        return r
          ? {
              id: r.id,
              courseKey: r.course_key,
              clubId: null,
              sheetId: r.sheet_id,
              actionsTab: r.actions_tab,
              cafeUrl: r.cafe_url,
              openchatChatRoomId: r.openchat_chat_room_id,
              openchatNoticeRoomId: r.openchat_notice_room_id,
              premiumEnabled: r.premium_enabled ?? true,
              openchatPremiumRoomId: r.openchat_premium_room_id,
              vipEnabled: r.vip_enabled ?? false,
              openchatVipRoomId: r.openchat_vip_room_id,
            }
          : null;
      }
    },
    async createCourse(input: z.infer<typeof CreateCourseBody>): Promise<CourseRow> {
      const data = CreateCourseBody.parse(input);
      const courseId = id("course");
      const sheetId = parseSheetId(data.sheetIdOrUrl);
      const clubId = parseClubId(data.clubId || data.cafeUrl);
      try {
        await sql`
          insert into courseops_courses (
            id, course_key, club_id, sheet_id, actions_tab,
            cafe_url,
            openchat_chat_room_id, openchat_notice_room_id,
            premium_enabled, openchat_premium_room_id,
            vip_enabled, openchat_vip_room_id
          )
          values (
            ${courseId}, ${data.courseKey}, ${clubId || null}, ${sheetId}, ${data.actionsTab},
            ${data.cafeUrl || null},
            ${data.openchatChatRoomId || null}, ${data.openchatNoticeRoomId || null},
            ${Boolean(data.premiumEnabled)}, ${data.openchatPremiumRoomId || null},
            ${Boolean(data.vipEnabled)}, ${data.openchatVipRoomId || null}
          )
        `;
      } catch (e: any) {
        const msg = String(e?.message || "");
        if (msg.includes("club_id") && msg.includes("does not exist")) {
          throw new Error("DB 스키마 업데이트가 필요해요. 관리자에게 `npm run db:init`을 요청해 주세요.");
        }
        throw e;
      }
      return {
        id: courseId,
        courseKey: data.courseKey,
        clubId: clubId || null,
        sheetId,
        actionsTab: data.actionsTab,
        cafeUrl: data.cafeUrl || null,
        openchatChatRoomId: data.openchatChatRoomId || null,
        openchatNoticeRoomId: data.openchatNoticeRoomId || null,
        premiumEnabled: Boolean(data.premiumEnabled),
        openchatPremiumRoomId: data.openchatPremiumRoomId || null,
        vipEnabled: Boolean(data.vipEnabled),
        openchatVipRoomId: data.openchatVipRoomId || null,
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
          memo: string | null;
        }[]
      >`select action_key, course_id, status, handled_by, handled_at, memo from courseops_action_state where course_id=${courseId} and action_key = any(${actionKeys}::text[])`;

      return rows.map((r) => ({
        actionKey: r.action_key,
        courseId: r.course_id,
        status: (r.status as ActionStateRow["status"]) || "대기",
        handledBy: r.handled_by,
        handledAt: r.handled_at ? r.handled_at.toISOString() : null,
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
        await sql`
          insert into courseops_job_events (id, job_id, level, message, ts)
          values (${eid}, ${input.jobId}, ${ev.level}, ${ev.message}, now())
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
