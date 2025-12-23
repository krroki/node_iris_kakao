import crypto from "crypto";
import { z } from "zod";

import { getSql } from "@/lib/storeDb";

export type CourseRow = {
  id: string;
  courseKey: string;
  sheetId: string;
  actionsTab: string;
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

const CreateCourseBody = z.object({
  courseKey: z.string().trim().min(1),
  sheetIdOrUrl: z.string().trim().min(1),
  actionsTab: z.string().trim().min(1),
});

function id(prefix: string) {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function parseSheetId(raw: string) {
  const s = String(raw || "").trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return (m ? m[1] : s).trim();
}

export async function coursesStore() {
  const sql = getSql();
  await sql`select 1`;
  return {
    async listCourses(): Promise<CourseRow[]> {
      const rows = await sql<
        { id: string; course_key: string; sheet_id: string; actions_tab: string }[]
      >`select id, course_key, sheet_id, actions_tab from courseops_courses order by course_key asc`;
      return rows.map((r) => ({ id: r.id, courseKey: r.course_key, sheetId: r.sheet_id, actionsTab: r.actions_tab }));
    },
    async getCourse(courseId: string): Promise<CourseRow | null> {
      const rows = await sql<
        { id: string; course_key: string; sheet_id: string; actions_tab: string }[]
      >`select id, course_key, sheet_id, actions_tab from courseops_courses where id=${courseId} limit 1`;
      const r = rows[0];
      return r ? { id: r.id, courseKey: r.course_key, sheetId: r.sheet_id, actionsTab: r.actions_tab } : null;
    },
    async createCourse(input: z.infer<typeof CreateCourseBody>): Promise<CourseRow> {
      const data = CreateCourseBody.parse(input);
      const courseId = id("course");
      const sheetId = parseSheetId(data.sheetIdOrUrl);
      await sql`insert into courseops_courses (id, course_key, sheet_id, actions_tab) values (${courseId}, ${data.courseKey}, ${sheetId}, ${data.actionsTab})`;
      return { id: courseId, courseKey: data.courseKey, sheetId, actionsTab: data.actionsTab };
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
  };
}
