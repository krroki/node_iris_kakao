import { afterEach, describe, expect, it, vi } from "vitest";
import os from "os";
import path from "path";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";

const createRuntime = async (cfg: any): Promise<string> => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "runtime-welcome-"));
  const configDir = path.join(tempDir, "config");
  await mkdir(configDir, { recursive: true });
  await writeFile(path.join(configDir, "runtime.json"), JSON.stringify(cfg, null, 2), "utf8");
  return tempDir;
};

const originalCwd = process.cwd();
const originalAppBase = process.env.IRIS_APP_BASE;
let currentTempDir: string | null = null;

afterEach(async () => {
  process.chdir(originalCwd);
  if (typeof originalAppBase === "string") process.env.IRIS_APP_BASE = originalAppBase;
  else delete process.env.IRIS_APP_BASE;
  vi.resetModules();
  if (currentTempDir) {
    await rm(currentTempDir, { recursive: true, force: true });
    currentTempDir = null;
  }
});

describe("welcome 템플릿 세트/기본닉 분기", () => {
  it("kakaoDefaultNicknameRegexes에 매칭되면 kakaoDefaultNickname 세트에서 선택한다", async () => {
    currentTempDir = await createRuntime({
      welcome: {
        templateSets: {
          kakaoDefaultNickname: ["A", "B"],
          customNickname: ["C", "D"],
        },
        templateSetPick: "random",
        kakaoDefaultNicknameRegexes: ["^인사하는\\s+프로도$"],
      },
    });
    process.chdir(currentTempDir);

    process.env.IRIS_APP_BASE = currentTempDir;
    vi.resetModules();
    const { resolveWelcomeTemplateSelection } = await import("../src/utils/welcomeTemplatePolicy");

    const sel = await resolveWelcomeTemplateSelection({ userName: "인사하는 프로도", senderId: "SENDER1" });
    expect(sel?.source).toBe("template_set");
    expect(sel?.nicknameClass).toBe("kakao_default_nickname");
    expect(sel?.setKey).toBe("kakaoDefaultNickname");
    expect(sel?.pick).toBe("random");
    expect(["A", "B"]).toContain(sel?.templateName);
  });

  it("최근 기본닉(니니즈/프렌즈/춘식이/죠르디 등)도 기본닉으로 분류한다", async () => {
    currentTempDir = await createRuntime({
      welcome: {
        templateSets: {
          kakaoDefaultNickname: ["A"],
          customNickname: ["C"],
        },
        templateSetPick: "hash_user_name",
        kakaoDefaultNicknameRegexes: [
          "^[가-힣0-9]{1,12}하는\\s+(라이언|어피치|무지|콘|튜브|프로도|네오|제이지|춘식이|프렌즈|니니즈|죠르디|앙몬드|스카피|팬더주니어|팬더 주니어|팬다|케로|베로니|케로&베로니|케로 & 베로니|콥|빠냐|콥&빠냐|콥 & 빠냐)$",
          "^[가-힣0-9]{1,12}\\s+(라이언|어피치|무지|콘|튜브|프로도|네오|제이지|춘식이|프렌즈|니니즈|죠르디|앙몬드|스카피|팬더주니어|팬더 주니어|팬다|케로|베로니|케로&베로니|케로 & 베로니|콥|빠냐|콥&빠냐|콥 & 빠냐)$",
          "^[가-힣0-9]{1,12}(?:\\s+[가-힣0-9]{1,12}){1,3}\\s+(라이언|어피치|무지|콘|튜브|프로도|네오|제이지|춘식이|프렌즈|니니즈|죠르디|앙몬드|스카피|팬더주니어|팬더 주니어|팬다|케로|베로니|케로&베로니|케로 & 베로니|콥|빠냐|콥&빠냐|콥 & 빠냐)$",
        ],
      },
    });
    process.chdir(currentTempDir);

    process.env.IRIS_APP_BASE = currentTempDir;
    vi.resetModules();
    const { resolveWelcomeTemplateSelection } = await import("../src/utils/welcomeTemplatePolicy");

    const recentDefaults = [
      "웃고있는 니니즈",
      "간식 먹는 프렌즈",
      "인사하는 춘식이",
      "집 지키는 죠르디",
      "평온한 앙몬드",
      "손 흔드는 팬더주니어",
    ];

    for (const name of recentDefaults) {
      const sel = await resolveWelcomeTemplateSelection({ userName: name, senderId: "SENDER1" });
      expect(sel?.nicknameClass).toBe("kakao_default_nickname");
      expect(sel?.templateName).toBe("A");
    }

    const custom = await resolveWelcomeTemplateSelection({ userName: "홍길동", senderId: "SENDER1" });
    expect(custom?.nicknameClass).toBe("custom_nickname");
    expect(custom?.templateName).toBe("C");
  });

  it("기본닉이 아니면 customNickname 세트에서 선택한다", async () => {
    currentTempDir = await createRuntime({
      welcome: {
        templateSets: {
          kakaoDefaultNickname: ["A"],
          customNickname: ["C"],
        },
        templateSetPick: "hash_sender_id",
        kakaoDefaultNicknameRegexes: ["^인사하는\\s+프로도$"],
      },
    });
    process.chdir(currentTempDir);

    process.env.IRIS_APP_BASE = currentTempDir;
    vi.resetModules();
    const { resolveWelcomeTemplateSelection } = await import("../src/utils/welcomeTemplatePolicy");

    const sel = await resolveWelcomeTemplateSelection({ userName: "홍길동", senderId: "SENDER1" });
    expect(sel?.source).toBe("template_set");
    expect(sel?.nicknameClass).toBe("custom_nickname");
    expect(sel?.setKey).toBe("customNickname");
    expect(sel?.templateName).toBe("C");
  });

  it("templateSets가 불완전하면 에러가 발생한다(스킵 유도)", async () => {
    currentTempDir = await createRuntime({
      welcome: {
        templateSets: {
          kakaoDefaultNickname: ["A"],
          // customNickname 누락
        },
        templateSetPick: "random",
        kakaoDefaultNicknameRegexes: ["^인사하는\\s+프로도$"],
      },
    });
    process.chdir(currentTempDir);

    process.env.IRIS_APP_BASE = currentTempDir;
    vi.resetModules();
    const { resolveWelcomeTemplateSelection } = await import("../src/utils/welcomeTemplatePolicy");

    await expect(
      resolveWelcomeTemplateSelection({ userName: "홍길동", senderId: "SENDER1" }),
    ).rejects.toThrow(/customNickname/);
  });

  it("kakaoDefaultNicknameRegexes에 잘못된 정규식이 있으면 에러가 발생한다", async () => {
    currentTempDir = await createRuntime({
      welcome: {
        templateSets: {
          kakaoDefaultNickname: ["A"],
          customNickname: ["C"],
        },
        templateSetPick: "random",
        kakaoDefaultNicknameRegexes: ["[unclosed"],
      },
    });
    process.chdir(currentTempDir);

    process.env.IRIS_APP_BASE = currentTempDir;
    vi.resetModules();
    const { resolveWelcomeTemplateSelection } = await import("../src/utils/welcomeTemplatePolicy");

    await expect(
      resolveWelcomeTemplateSelection({ userName: "홍길동", senderId: "SENDER1" }),
    ).rejects.toThrow(/invalid regex/);
  });

  it("세트 설정이 없으면 templateByFeature.welcome을 사용한다(레거시)", async () => {
    currentTempDir = await createRuntime({
      templateByFeature: {
        welcome: "LEGACY_WELCOME",
      },
    });
    process.chdir(currentTempDir);

    process.env.IRIS_APP_BASE = currentTempDir;
    vi.resetModules();
    const { resolveWelcomeTemplateSelection } = await import("../src/utils/welcomeTemplatePolicy");

    const sel = await resolveWelcomeTemplateSelection({ userName: "홍길동", senderId: "SENDER1" });
    expect(sel?.source).toBe("single_template");
    expect(sel?.templateName).toBe("LEGACY_WELCOME");
  });

  it("templateSetPick이 누락되면 에러가 발생한다(무작정 진행 금지)", async () => {
    currentTempDir = await createRuntime({
      welcome: {
        templateSets: {
          kakaoDefaultNickname: ["A"],
          customNickname: ["C"],
        },
        kakaoDefaultNicknameRegexes: ["^인사하는\\s+프로도$"],
      },
    });
    process.chdir(currentTempDir);

    process.env.IRIS_APP_BASE = currentTempDir;
    vi.resetModules();
    const { resolveWelcomeTemplateSelection } = await import("../src/utils/welcomeTemplatePolicy");

    await expect(
      resolveWelcomeTemplateSelection({ userName: "홍길동", senderId: "SENDER1" }),
    ).rejects.toThrow(/templateSetPick is required/i);
  });

  it("kakaoDefaultNicknameRegexes가 누락되면 에러가 발생한다(대충 기본닉 판단 금지)", async () => {
    currentTempDir = await createRuntime({
      welcome: {
        templateSets: {
          kakaoDefaultNickname: ["A"],
          customNickname: ["C"],
        },
        templateSetPick: "random",
      },
    });
    process.chdir(currentTempDir);

    process.env.IRIS_APP_BASE = currentTempDir;
    vi.resetModules();
    const { resolveWelcomeTemplateSelection } = await import("../src/utils/welcomeTemplatePolicy");

    await expect(
      resolveWelcomeTemplateSelection({ userName: "홍길동", senderId: "SENDER1" }),
    ).rejects.toThrow(/kakaoDefaultNicknameRegexes is required/i);
  });

  it("IRIS 기본/레거시 welcome 템플릿(숫자, welcome_default_*)은 자동 선택에서 제외된다", async () => {
    currentTempDir = await createRuntime({
      welcome: {
        templateSets: {
          kakaoDefaultNickname: ["1", "welcome_custom_1", "welcome_default_3"],
          customNickname: ["2", "welcome_custom_2", "welcome_default_4"],
        },
        templateSetPick: "hash_user_name",
        kakaoDefaultNicknameRegexes: ["^인사하는\\s+프로도$"],
      },
    });
    process.chdir(currentTempDir);

    process.env.IRIS_APP_BASE = currentTempDir;
    vi.resetModules();
    const { resolveWelcomeTemplateSelection } = await import("../src/utils/welcomeTemplatePolicy");

    const a = await resolveWelcomeTemplateSelection({ userName: "인사하는 프로도", senderId: "SENDER1" });
    expect(a?.templateName).toBe("welcome_custom_1");

    const b = await resolveWelcomeTemplateSelection({ userName: "닉네임_커스텀", senderId: "SENDER1" });
    expect(b?.templateName).toBe("welcome_custom_2");
  });

  it("차단 템플릿만 있으면 오류가 발생한다(폴백으로 기본 템플릿을 쓰지 않는다)", async () => {
    currentTempDir = await createRuntime({
      welcome: {
        templateSets: {
          kakaoDefaultNickname: ["1", "2"],
          customNickname: ["welcome_default_3"],
        },
        templateSetPick: "random",
        kakaoDefaultNicknameRegexes: ["^인사하는\\s+프로도$"],
      },
    });
    process.chdir(currentTempDir);

    process.env.IRIS_APP_BASE = currentTempDir;
    vi.resetModules();
    const { resolveWelcomeTemplateSelection } = await import("../src/utils/welcomeTemplatePolicy");

    await expect(
      resolveWelcomeTemplateSelection({ userName: "인사하는 프로도", senderId: "SENDER1" }),
    ).rejects.toThrow(/blocked|no allowed/i);
  });
});
