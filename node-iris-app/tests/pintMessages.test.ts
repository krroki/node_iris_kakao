import { describe, expect, it } from "vitest";

import { buildPintHotVideosMessage, buildPintIssuesMessage, buildPintRookiesMessage, buildPintTopChannelsMessage } from "../src/services/pintMessages";

describe("pintMessages", () => {
  it("excludes whale channels from hot video responses when top channel subscriber data is available", () => {
    const text = buildPintHotVideosMessage({
      origin: "https://pint.kr",
      mode: "now",
      videos: [
        {
          youtubeVideoId: "v1",
          channelTitle: "김프로KIMPRO",
          title: "고래 영상",
          viewsWindow: 1_000_000,
          viewsPerHour: 100_000,
          isShorts: true,
          contentFormat: "shorts",
          publishedAt: "2026-03-06T00:00:00.000Z",
          snapshotHour: "2026-03-06T09:00:00.000Z",
          channelId: "whale-1",
        } as any,
        {
          youtubeVideoId: "v2",
          channelTitle: "작은채널",
          title: "중소형 영상",
          viewsWindow: 500_000,
          viewsPerHour: 50_000,
          isShorts: true,
          contentFormat: "shorts",
          publishedAt: "2026-03-06T00:00:00.000Z",
          snapshotHour: "2026-03-06T09:00:00.000Z",
          channelId: "small-1",
        } as any,
      ],
      topChannels: [
        { id: "whale-1", youtube_channel_id: "yt-whale", title: "김프로KIMPRO", subscriber_count: 131_000_000, daily_views: 1 },
        { id: "small-1", youtube_channel_id: "yt-small", title: "작은채널", subscriber_count: 120_000, daily_views: 1 },
      ],
    });

    expect(text).not.toContain("김프로KIMPRO");
    expect(text).toContain("작은채널");
  });

  it("keeps only discovery-sized creator channels and sorts them by growth ratio", () => {
    const text = buildPintTopChannelsMessage({
      origin: "https://pint.kr",
      topChannels: [
        { id: "sus-1", youtube_channel_id: "yt-sus", title: "Savannah888", subscriber_count: 119_000, daily_views: 189_370_785, content_format: "shorts" },
        { id: "corp-1", youtube_channel_id: "yt-corp", title: "Brand Official", subscriber_count: 25_000, daily_views: 5_000_000, content_format: "shorts" },
        { id: "large-1", youtube_channel_id: "yt-large", title: "BuildAlchemy", subscriber_count: 465_000, daily_views: 42_276_752, content_format: "shorts" },
        { id: "small-1", youtube_channel_id: "yt-small", title: "작은채널", subscriber_count: 100_000, daily_views: 25_000_000, content_format: "shorts" },
        { id: "small-2", youtube_channel_id: "yt-small-2", title: "TANKER", subscriber_count: 212_000, daily_views: 46_689_476, content_format: "shorts" },
      ],
    });

    expect(text).not.toContain("Savannah888");
    expect(text).not.toContain("Brand Official");
    expect(text).not.toContain("BuildAlchemy");
    expect(text).toContain("오늘 발굴할 급상승 채널 2개");
    expect(text.indexOf("작은채널")).toBeLessThan(text.indexOf("TANKER"));
    expect(text).toContain("구독 대비 24h 조회 250배");
    expect(text).toContain("TANKER");
    expect(text).toContain("구독 대비 24h 조회 220배");
    expect(text).not.toContain("shorts");
  });

  it("filters weak issue rows, sorts by comment reaction, and shows views/comments instead of mention counts", () => {
    const text = buildPintIssuesMessage({
      origin: "https://pint.kr",
      window: "24h",
      topics: [
        {
          id: "topic-3",
          title: "댓글 적은 이슈",
          mentionCount: 5,
          uniqueSources: 2,
          sourceCounts: { pgr21: 2 },
          firstSeenAt: "2026-03-06T00:00:00.000Z",
          lastSeenAt: "2026-03-06T00:10:00.000Z",
          deltas: {
            views1h: 1,
            comments1h: 0,
            recommends1h: null,
            views24h: 3_414,
            comments24h: 9,
            recommends24h: null,
          },
          totals: {
            views: 4_901,
            comments: 173,
            recommends: 0,
          },
        },
        {
          id: "topic-1",
          title: "강한 이슈",
          mentionCount: 1,
          uniqueSources: 1,
          sourceCounts: { pgr21: 1 },
          firstSeenAt: "2026-03-06T00:00:00.000Z",
          lastSeenAt: "2026-03-06T00:10:00.000Z",
          deltas: {
            views1h: 10,
            comments1h: 1,
            recommends1h: null,
            views24h: 5_711,
            comments24h: 49,
            recommends24h: null,
          },
          totals: {
            views: 8_299,
            comments: 66,
            recommends: 38,
          },
        },
        {
          id: "topic-2",
          title: "약한 이슈",
          mentionCount: 10,
          uniqueSources: 5,
          sourceCounts: { pgr21: 5 },
          firstSeenAt: "2026-03-06T00:00:00.000Z",
          lastSeenAt: "2026-03-06T00:10:00.000Z",
          deltas: {
            views1h: 1,
            comments1h: 0,
            recommends1h: null,
            views24h: 436,
            comments24h: 9,
            recommends24h: null,
          },
          totals: {
            views: 4_901,
            comments: 173,
            recommends: 0,
          },
        },
      ] as any,
    });

    expect(text).toContain("오늘 댓글 반응이 많이 붙은 이슈만 바로 볼게요");
    expect(text).toContain("24h 조회 5,711, 댓글 49");
    expect(text.indexOf("강한 이슈")).toBeLessThan(text.indexOf("댓글 적은 이슈"));
    expect(text).not.toContain("약한 이슈");
    expect(text).not.toContain("언급");
    expect(text).not.toContain("커뮤니티");
  });

  it("adds a fallback CTA when no rookie channels are found", () => {
    const result = buildPintRookiesMessage({
      origin: "https://pint.kr",
      rookies: [],
      todayKst: "2026-03-06",
    });

    expect(result.hasNew).toBe(false);
    expect(result.text).toContain("대신 !급상승");
  });
});
