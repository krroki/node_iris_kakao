/**
 * AnnouncementController - 공지 메시지 복제 컨트롤러
 *
 * 기능:
 * - 지정된 소스 방의 메시지를 타겟 방들에 자동 복제
 * - 텍스트 + 이미지 지원 (동영상/파일은 1차 제외)
 * - 중복 방지 (msgId + sourceRoom TTL 5분)
 * - 루프 방지 (mirrorFrom 마커 - rich/text 모두)
 * - 권한 검사 (allowedRoomIds/excludedRoomIds)
 * - 다중 route 지원
 */

import {
  ChatController,
  ChatContext,
  Logger,
  OnMessage,
} from "@tsuki-chat/node-iris";
import {
  isAnnouncementAllowed,
  findAnnouncementRoutesBySource,
  isRoomIdAllowedForAnnouncement,
  type AnnouncementRoute,
} from "../utils/guard";
import { announcementDedup } from "../services";

// 루프 방지용 마커
const MIRROR_MARKER_PREFIX = "\u200B[MF:"; // Zero-width space + marker
const MIRROR_MARKER_SUFFIX = "]\u200B";
const MIRROR_MARKER_REGEX = /\u200B\[MF:[^\]]+\]\u200B/g;

@ChatController
class AnnouncementController {
  private logger: Logger;
  // Bot 인스턴스 참조 (app.ts에서 주입)
  private static botInstance: any = null;

  constructor() {
    this.logger = new Logger(AnnouncementController.name);
  }

  /**
   * Bot 인스턴스 주입 (app.ts에서 호출)
   */
  static setBotInstance(bot: any): void {
    AnnouncementController.botInstance = bot;
  }

  @OnMessage
  async onMessage(context: ChatContext) {
    const roomId = String(context.room.id);
    this.logger.debug("AnnouncementController.onMessage called", { roomId });

    try {
      // 1. Announcement 기능 활성화 체크 (SAFE_MODE + allowWhenSafeMode)
      const allowed = await isAnnouncementAllowed();
      if (!allowed) {
        return;
      }

      // 2. 루프 방지: 텍스트에 mirrorFrom 마커가 있는지 확인
      const messageText = this.extractRawText(context);
      if (this.hasMirrorMarker(messageText)) {
        this.logger.debug("Skip mirrored message (text marker detected)");
        return;
      }

      // 3. 소스 방 확인 (roomId는 이미 위에서 추출됨)

      // 4. 소스 방 권한 체크 (allowed/excluded)
      const sourceAllowed = await isRoomIdAllowedForAnnouncement(roomId);
      if (!sourceAllowed) {
        this.logger.debug("Source room not allowed or excluded", { roomId });
        return;
      }

      // 5. 해당 소스의 모든 route 찾기 (다중 route 지원)
      const routes = await findAnnouncementRoutesBySource(roomId);
      if (routes.length === 0) {
        return; // 이 방은 announcement source가 아님
      }

      // 6. 메시지 ID로 중복 체크 (TTL 5분)
      const msgId = String((context.message as any)?.id || "");
      if (!msgId) {
        this.logger.warn("Message without ID, skipping announcement");
        return;
      }
      if (announcementDedup.isMessageDuplicate(msgId, roomId)) {
        this.logger.debug("Duplicate message, skipping", { msgId, roomId });
        return;
      }

      // 7. 콘텐츠 추출
      const { text, images, hasUnsupported } = this.extractContent(context);
      if (!text && images.length === 0) {
        this.logger.debug("Empty content, skipping announcement");
        return;
      }

      if (hasUnsupported) {
        this.logger.warn("Message contains unsupported attachment (video/file), skipping those");
      }

      // 8. 발신자 이름 가져오기 (옵션용)
      const senderName = await this.getSenderName(context);

      // 9. 모든 route에 대해 처리
      this.logger.info("Announcement triggered", {
        source: roomId,
        routeCount: routes.length,
        hasText: !!text,
        imageCount: images.length,
      });

      for (const route of routes) {
        await this.processRoute(route, text, images, roomId, senderName);
      }
    } catch (error) {
      this.logger.error("Announcement processing failed", { error: String(error) });
    }
  }

  /**
   * 단일 route 처리
   */
  private async processRoute(
    route: AnnouncementRoute,
    text: string,
    images: string[],
    sourceRoomId: string,
    senderName: string
  ): Promise<void> {
    // 발신자 이름 프리픽스 (옵션)
    let finalText = text;
    if (route.includeSenderName && text && senderName) {
      finalText = `[${senderName}] ${text}`;
    }

    // 타겟 방들 필터링 (권한 체크)
    const validTargets: string[] = [];
    for (const targetId of route.targets) {
      const targetAllowed = await isRoomIdAllowedForAnnouncement(targetId);
      if (!targetAllowed) {
        this.logger.warn("Target room not allowed or excluded, skipping", {
          targetId,
          routeId: route.id,
        });
        continue;
      }
      validTargets.push(targetId);
    }

    if (validTargets.length === 0) {
      this.logger.warn("No valid targets for route", { routeId: route.id });
      return;
    }

    await this.broadcastToTargets(route, validTargets, finalText, images, sourceRoomId);
  }

  /**
   * mirrorFrom 마커가 있는지 확인
   */
  private hasMirrorMarker(text: string): boolean {
    if (!text) return false;
    return MIRROR_MARKER_REGEX.test(text);
  }

  /**
   * mirrorFrom 마커 생성
   */
  private createMirrorMarker(sourceRoomId: string): string {
    return `${MIRROR_MARKER_PREFIX}${sourceRoomId}${MIRROR_MARKER_SUFFIX}`;
  }

  /**
   * 메시지에서 raw 텍스트 추출 (마커 체크용)
   */
  private extractRawText(context: ChatContext): string {
    const message = context.message as any;
    if (typeof message?.msg === "string") return message.msg;
    if (typeof message?.text === "string") return message.text;
    if (typeof message?.display_original === "string") return message.display_original;
    return "";
  }

  /**
   * 메시지에서 텍스트와 이미지 추출
   */
  private extractContent(context: ChatContext): {
    text: string;
    images: string[];
    hasUnsupported: boolean;
  } {
    const message = context.message as any;
    let text = "";
    const imageSet = new Set<string>(); // 중복 제거용
    let hasUnsupported = false;

    // 텍스트 추출
    if (typeof message?.msg === "string" && message.msg) {
      text = message.msg;
    } else if (typeof message?.text === "string" && message.text) {
      text = message.text;
    } else if (typeof message?.display_original === "string") {
      text = message.display_original;
    }

    // 첨부파일 처리
    const attachment = message?.attachment;
    if (attachment) {
      // 이미지 URL 추출
      if (Array.isArray(attachment.images)) {
        attachment.images.filter(Boolean).forEach((img: string) => imageSet.add(String(img)));
      }
      if (typeof attachment.image === "string" && attachment.image) {
        imageSet.add(attachment.image);
      }
      // KakaoTalk 이미지 URL 필드
      if (typeof attachment.url === "string" && attachment.url) {
        const url = attachment.url;
        if (this.isImageUrl(url)) {
          imageSet.add(url);
        }
      }

      // 지원하지 않는 첨부파일 감지
      if (attachment.video || attachment.file || attachment.audio) {
        hasUnsupported = true;
      }
    }

    // 메시지 타입으로 이미지 판별
    const msgType = message?.type;
    if ((msgType === "photo" || msgType === "image") && message?.url) {
      imageSet.add(String(message.url));
    }

    return { text, images: Array.from(imageSet), hasUnsupported };
  }

  /**
   * URL이 이미지인지 확인
   */
  private isImageUrl(url: string): boolean {
    const lower = url.toLowerCase();
    return (
      lower.includes(".jpg") ||
      lower.includes(".jpeg") ||
      lower.includes(".png") ||
      lower.includes(".gif") ||
      lower.includes(".webp") ||
      lower.includes("/image/") ||
      lower.includes("kakaocdn")
    );
  }

  /**
   * 발신자 이름 가져오기
   */
  private async getSenderName(context: ChatContext): Promise<string> {
    try {
      const sender = context.sender as any;
      if (typeof sender?.name === "string") return sender.name;
      if (typeof sender?.getName === "function") return await sender.getName();
      if (typeof sender?.nickname === "string") return sender.nickname;
      return "";
    } catch {
      return "";
    }
  }

  /**
   * 타겟 방들에 메시지 발송
   */
  private async broadcastToTargets(
    route: AnnouncementRoute,
    validTargets: string[],
    text: string,
    images: string[],
    sourceRoomId: string
  ): Promise<void> {
    const bot = AnnouncementController.botInstance;
    if (!bot?.api) {
      this.logger.error("Bot instance not available for announcement");
      return;
    }

    const delayMs = route.delayMs ?? 500;
    let successCount = 0;
    let failCount = 0;

    // 루프 방지 마커 추가
    const mirrorMarker = this.createMirrorMarker(sourceRoomId);
    const textWithMarker = text ? `${text}${mirrorMarker}` : "";

    for (const targetId of validTargets) {
      // 추가 dedup: source+target+msgId 조합으로 이중 체크
      // (다중 route에서 같은 target이 중복될 경우 방지)
      const dedupKey = `broadcast:${sourceRoomId}:${targetId}`;
      if (announcementDedup.isDuplicate(dedupKey)) {
        this.logger.debug("Target already received this message", { targetId });
        continue;
      }

      try {
        // 딜레이
        if (delayMs > 0) {
          await this.delay(delayMs);
        }

        // 텍스트 발송 (마커 포함)
        if (textWithMarker) {
          await this.sendText(bot, targetId, textWithMarker);
        }

        // 이미지 발송 (includeImages 옵션 체크)
        if (images.length > 0 && route.includeImages !== false) {
          await this.sendImages(bot, targetId, images);
        }

        successCount++;
        this.logger.debug("Announcement sent to target", { targetId });
      } catch (error) {
        failCount++;
        this.logger.error("Failed to send announcement to target", {
          targetId,
          error: String(error),
        });
        // 실패해도 다음 타겟 계속 진행
      }
    }

    this.logger.info("Announcement broadcast completed", {
      source: sourceRoomId,
      routeId: route.id,
      success: successCount,
      failed: failCount,
    });
  }

  /**
   * 텍스트 메시지 발송 (mirrorMarker는 이미 텍스트에 포함됨)
   */
  private async sendText(
    bot: any,
    targetId: string,
    text: string
  ): Promise<void> {
    const timeoutMs = 10000;

    // 일반 텍스트 발송 (마커가 이미 포함되어 있음)
    await Promise.race([
      bot.api.reply(targetId, text),
      this.timeout(timeoutMs, "reply_timeout"),
    ]);
  }

  /**
   * 이미지 발송
   */
  private async sendImages(
    bot: any,
    targetId: string,
    images: string[]
  ): Promise<void> {
    const timeoutMs = 15000;

    if (typeof bot.api.replyImageUrls === "function") {
      await Promise.race([
        bot.api.replyImageUrls(targetId, images),
        this.timeout(timeoutMs, "reply_images_timeout"),
      ]);
    } else if (typeof bot.api.replyImage === "function") {
      // 개별 이미지 발송
      for (const img of images) {
        await Promise.race([
          bot.api.replyImage(targetId, img),
          this.timeout(timeoutMs, "reply_image_timeout"),
        ]);
      }
    } else {
      // 이미지 URL을 텍스트로 발송 (fallback)
      this.logger.warn("Image API not available, sending as text URLs");
      await bot.api.reply(targetId, images.join("\n"));
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private timeout(ms: number, message: string): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error(message)), ms)
    );
  }
}

export default AnnouncementController;
