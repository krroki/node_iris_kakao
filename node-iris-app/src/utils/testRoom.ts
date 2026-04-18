export const DEFAULT_TEST_OPENCHAT_ROOM_ID = "18475752914588021";

/**
 * 테스트/운영 진단 로그는 항상 "test open chat"로만 보낸다.
 *
 * - 오발송 방지를 위해 roomId는 코드 레벨에서 고정한다.
 */
export function getTestOpenChatRoomId(): string {
  return DEFAULT_TEST_OPENCHAT_ROOM_ID;
}

export function getOpsLogRoomId(): string {
  return getTestOpenChatRoomId();
}

export function getTestCommandRoomId(): string {
  return getTestOpenChatRoomId();
}
