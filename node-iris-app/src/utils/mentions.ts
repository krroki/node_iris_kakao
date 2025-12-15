export type Mentionee = { name?: string };

/**
 * Talk-API/SDK 멘션 전송이 실패하여 "텍스트 폴백"으로 내려갈 때,
 * 카카오톡 UI에서 실제 멘션으로 렌더링되지 않는 `@닉네임`이 혼란을 주므로
 * `@닉네임` → `닉네임`으로 치환한다.
 */
export function stripAtMentionsForFallback(text: string, mentionees: Mentionee[] = []): string {
  if (!text) return text;
  const names = Array.from(
    new Set(
      (Array.isArray(mentionees) ? mentionees : [])
        .map((m) => (m && typeof m.name === "string" ? m.name.trim() : ""))
        .filter(Boolean),
    ),
  ).sort((a, b) => b.length - a.length); // prevent prefix overlap

  if (names.length === 0) return text;
  let out = text;
  for (const name of names) {
    out = out.split(`@${name}`).join(name);
  }
  return out;
}

