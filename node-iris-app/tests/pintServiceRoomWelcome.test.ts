import { describe, expect, it } from "vitest";

import {
  PINT_SERVICE_ROOM_ID,
  buildPintServiceRoomWelcomeMessage,
  extractPintWelcomeMetrics,
  isPintServiceRoomWelcomeOnlyEnabled,
  resolvePintNaturalLanguageCommand,
} from "../src/utils/pintServiceRoomWelcome";

describe("pint service room welcome", () => {
  it("returns false for other rooms even when the toggle is enabled", () => {
    const out = isPintServiceRoomWelcomeOnlyEnabled(
      {
        features: {
          roomA: {
            pintServiceWelcomeOnly: true,
          },
        },
      },
      "roomA",
    );

    expect(out).toBe(false);
  });

  it("returns true only for the dedicated room with the dedicated toggle", () => {
    const out = isPintServiceRoomWelcomeOnlyEnabled(
      {
        features: {
          [PINT_SERVICE_ROOM_ID]: {
            welcome: true,
            pintServiceWelcomeOnly: true,
          },
        },
      },
      PINT_SERVICE_ROOM_ID,
    );

    expect(out).toBe(true);
  });

  it("returns false when the dedicated toggle is off", () => {
    const out = isPintServiceRoomWelcomeOnlyEnabled(
      {
        features: {
          [PINT_SERVICE_ROOM_ID]: {
            welcome: true,
          },
        },
      },
      PINT_SERVICE_ROOM_ID,
    );

    expect(out).toBe(false);
  });

  it("extracts metrics from cached Pint home data", () => {
    const metrics = extractPintWelcomeMetrics(
      {
        hotVideos: [{}, {}, {}],
        rookies: [
          { firstSeenDate: "2026-03-06" },
          { firstSeenDate: "2026-03-06" },
          { firstSeenDate: "2026-03-05" },
        ],
        trendingTopics: [{}, {}],
      },
      new Date("2026-03-06T03:00:00.000Z"),
    );

    expect(metrics).toEqual({
      hotVideoCount: 3,
      rookieCount: 2,
      issueCount: 2,
    });
  });

  it("builds a single-line greeting without CTA or metric hooks", () => {
    const message = buildPintServiceRoomWelcomeMessage({
      entrancePlaceholder: "루이",
      metrics: {
        hotVideoCount: 12,
        rookieCount: 4,
        issueCount: 2,
      },
      now: new Date("2026-03-06T13:30:00+09:00"),
    });

    expect(message).toContain("루이");
    expect(message).toContain("🍺");
    expect(message).not.toContain("\n");
    expect(message).not.toContain("!핫영상");
    expect(message).not.toContain("요즘 뭐 떠");
    expect(message).not.toContain("12개");
  });

  it("uses slot-specific friendly copy when the slot pool is selected", () => {
    const morning = buildPintServiceRoomWelcomeMessage({
      entrancePlaceholder: "루이",
      now: new Date("2026-03-06T08:30:00+09:00"),
    });
    const evening = buildPintServiceRoomWelcomeMessage({
      entrancePlaceholder: "루이",
      now: new Date("2026-03-06T19:30:00+09:00"),
    });

    expect(morning).toMatch(/좋은 아침|굿모닝|아침부터 부지런|오늘도 좋은 하루|어서오세요|반가워요|환영해요/);
    expect(evening).toMatch(/수고하셨어요|퇴근하셨어요|좋은 저녁|오늘 하루도 수고|편한 저녁|어서오세요|반가워요|환영해요/);
  });

  it("uses the event seed to avoid fixing the same copy for an entire time slot", () => {
    const now = new Date("2026-03-06T13:30:00+09:00");
    const first = buildPintServiceRoomWelcomeMessage({
      now,
      seedKey: "uid-a:1000",
    });
    const second = buildPintServiceRoomWelcomeMessage({
      now,
      seedKey: "uid-b:2000",
    });

    expect(first).toBe("{entrance}님 왔다! 반가워요 🍺");
    expect(second).toBe("{entrance}님 환영해요! 🍺");
    expect(first).not.toBe(second);
  });

  it("maps Pint natural-language prompts to commands", () => {
    expect(resolvePintNaturalLanguageCommand("요즘 뭐 떠?")).toBe("핫영상");
    expect(resolvePintNaturalLanguageCommand("뭐떠")).toBe("핫영상");
    expect(resolvePintNaturalLanguageCommand("지금 뭐 뜸?")).toBe("핫영상");
    expect(resolvePintNaturalLanguageCommand("밤새 뭐 올랐어")).toBe("밤새");
    expect(resolvePintNaturalLanguageCommand("밤새 뭐 뜸")).toBe("밤새");
    expect(resolvePintNaturalLanguageCommand("오늘 이슈 뭐야?")).toBe("이슈");
    expect(resolvePintNaturalLanguageCommand("이슈 뭐야")).toBe("이슈");
    expect(resolvePintNaturalLanguageCommand("신규 뭐 있어?")).toBe("신규");
    expect(resolvePintNaturalLanguageCommand("루키 뭐 있어")).toBe("신규");
    expect(resolvePintNaturalLanguageCommand("급상승 뭐 있어?")).toBe("급상승");
    expect(resolvePintNaturalLanguageCommand("채널 뭐 떠")).toBe("급상승");
    expect(resolvePintNaturalLanguageCommand("핀트 뭐 할 수 있어")).toBe("도움말");
  });

  it("ignores long or unrelated natural-language inputs", () => {
    expect(resolvePintNaturalLanguageCommand("이건 자연어 별칭으로 처리하면 안 되는 긴 문장 테스트입니다")).toBeNull();
    expect(resolvePintNaturalLanguageCommand("아무 말")).toBeNull();
  });
});
