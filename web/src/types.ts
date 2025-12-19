export type LogEntry = {
  ts: string;
  roomId: string;
  roomName: string;
  sender: string;
  text: string;
  mid?: string;
  mentions?: string[];
  // 서버 log_utils.py에서 생성하는 UID (dedup용) – 선택적
  uid?: string;
};

export type SSEPayload = {
  type: "snapshot" | "append" | string;
  rooms?: Record<string, LogEntry[]>;
  all?: LogEntry[];
};

export type StageKey = "device" | "bot" | "logStore" | "realtime" | "kb" | "ui";

export type PipelineStage = {
  key: StageKey;
  name: string;
  ok: boolean;
  detail: string;
  timestamp?: string | null;
};

export type PipelineStatus = {
  updatedAt: string;
  stages: Record<StageKey, PipelineStage>;
  latestLogTs?: string | null;
};

export type RoomInfo = {
  roomId: string;
  roomName: string;
  activeMembersCount?: number;
};

export type RoomMember = {
  userId: string;
  nickname: string;
};

export type RoomMembersResponse = {
  ok: boolean;
  roomId: string;
  activeMembersCount?: number;
  loadedMembersCount?: number;
  limit?: number;
  offset?: number;
  members?: RoomMember[];
  hint?: string | null;
  error?: string;
  detail?: string;
};

export type RoomAdminUser = {
  userId: string;
  nickname?: string | null;
};

export type RoomAdminsResponse = {
  ok: boolean;
  roomId: string;
  activeMembersCount?: number | null;
  loadedMembersCount?: number | null;
  host?: RoomAdminUser[];
  subhosts?: RoomAdminUser[];
  admins?: RoomAdminUser[];
  hint?: string | null;
  error?: string;
  detail?: string;
};

export type RoomFeatures = {
  welcome?: boolean;
  welcomeFollowUp?: boolean;
  broadcast?: boolean;
  schedules?: boolean;
  ai?: boolean;
  // 카카오 기본 닉네임 사용자에게 닉네임 변경 요청(멘션) 발신
  nicknameReminder?: boolean;
  // Gemini 웹 기반 이미지 생성/수정(!사진 / !사진수정)
  imageGen?: boolean;
  // Gemini 웹 기반 동영상 생성(!영상)
  videoGen?: boolean;
  chatSummary?: boolean;
  // 방별 명령어(FAQ) 기능
  commands?: boolean;
  // 무명령어 자동 FAQ(질문 트리거) 기능
  autoFaq?: boolean;
  // 강의 운영(카페/닉네임 검증) 기능
  courseRoom?: boolean;
  courseRoster?: boolean;
};

export type AutoFaqMatchType = "exact_norm" | "regex";
export type AutoFaqActionType = "static_text" | "kb_recent_posts" | "kb_recent_posts_filtered";

export type AutoFaqTrigger = {
  id: string;
  enabled?: boolean;
  label?: string;
  priority?: number;
  cooldownSec?: number; // 동일 사용자+트리거 쿨다운(초). 기본은 워커 기본값(예: 600초)
  match?: {
    type?: AutoFaqMatchType;
    patterns?: string[];
    negativePatterns?: string[];
    requireQuestionSignal?: boolean;
  };
  action?: {
    type?: AutoFaqActionType;
    menuIds?: string; // "23,42" 형태
    limit?: number;
    keywords?: string[];
    includeNormText?: boolean;
    responseText?: string; // static_text일 때
  };
  replyTemplate?: {
    titleLine?: string;
    bodyLines?: string[];
    footerLinksMode?: "none" | "kb_posts" | "explicit";
  };
  images?: string[]; // templates assets relative paths: "assets/auto_faq/<triggerId>/<file>"
};

export type AutoFaqConfig = {
  version?: number;
  updatedAt?: string;
  global?: {
    enabled?: boolean;
    triggers?: AutoFaqTrigger[];
  };
  lectures?: Record<
    string,
    {
      enabled?: boolean;
      title?: string;
      triggers?: AutoFaqTrigger[];
    }
  >;
  rooms?: Record<
    string,
    {
      enabled?: boolean;
      lectureId?: string;
      triggers?: AutoFaqTrigger[];
    }
  >;
};

export type CourseRosterRoomConfig = {
  enabled?: boolean;
  spreadsheetId?: string;
  rosterSheetName?: string;
  cafeSource?: "crawler" | "csv";
  cafeUrl?: string;
  cafeClubId?: string;
  crawlerRepoPath?: string;
  crawlerPythonExe?: string;
  crawlerSettingsPath?: string;
  cafeCsvPath?: string; // legacy
  joinUrl?: string;
};

export type CourseRosterConfig = {
  version?: number;
  rooms?: Record<string, CourseRosterRoomConfig>;
};

export type CourseMembershipAuditTabs = {
  cafeRaw?: string;
  openchatRaw?: string;
  rulesRaw?: string;
  audit?: string;
  auditLog?: string;
};

export type CourseMembershipAuditGradeRules = {
  premiumGrades?: string[];
  staffGrades?: string[];
};

export type CourseMembershipAuditCourse = {
  enabled?: boolean;
  clubId?: string;
  spreadsheetId?: string;
  joinUrl?: string;
  tabs?: CourseMembershipAuditTabs;
  gradeRules?: CourseMembershipAuditGradeRules;
  rooms?: {
    chat?: string;
    notice?: string;
    premium?: string;
  };
};

export type CourseMembershipAuditConfig = {
  version?: number;
  worker?: {
    enabled?: boolean;
    hotIntervalSec?: number;
    hotDays?: number;
    steadyIntervalSec?: number;
    crawler?: {
      repoPath?: string;
      pythonExe?: string;
      settingsPath?: string;
    };
  };
  courses?: Record<string, CourseMembershipAuditCourse>;
};

export type OpenchatMembersSheetsRoomConfig = {
  enabled?: boolean;
  spreadsheetId?: string;
  sheetName?: string;
  allowIncomplete?: boolean;
  serviceAccountJson?: string;
};

export type OpenchatMembersSheetsConfig = {
  version?: number;
  spreadsheetId?: string;
  sheetName?: string;
  serviceAccountJson?: string;
  worker?: {
    enabled?: boolean;
    intervalSec?: number;
  };
  rooms?: Record<string, OpenchatMembersSheetsRoomConfig>;
};

// FastAPI /logs/bulk 응답 형태
export type BulkLogsResponse = {
  rooms?: Record<string, LogEntry[]>;
  all?: LogEntry[];
};

// FastAPI /runtime 응답 최소 형태 (UI에서 사용하는 필드만 정의)
export type RuntimeConfig = {
  safeMode?: boolean;
  allowedRoomIds?: string[];
  excludedRoomIds?: string[];
  features?: Record<string, RoomFeatures>;
  templateByFeature?: Record<string, string>;
  welcomeTemplateName?: string;
  // 서버에서 추가로 내려줄 수 있는 필드는 자유롭게 확장
  [key: string]: unknown;
};
