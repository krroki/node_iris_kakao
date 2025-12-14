import {
  BatchScheduler,
  Bootstrap,
  BootstrapController,
  Logger,
} from "@tsuki-chat/node-iris";
import { isSafeMode } from "../utils/guard";

@BootstrapController
class CustomBootstrapController {
  private logger: Logger;

  constructor() {
    this.logger = new Logger(CustomBootstrapController.name);
  }

  /**
   * 데이터베이스 초기화 (최고 우선순위)
   */
  @Bootstrap(1) // 낮은 숫자가 먼저 실행 (가장 먼저 실행)
  async initializeDatabase() {
    this.logger.info("Initializing database connection...");

    try {
      // 데이터베이스 연결 초기화
      // await this.connectToDatabase();

      // 기존에 저장된 스케줄된 메시지들을 로드
      const savedSchedules = await this.loadSchedulesFromDatabase();

      const scheduler = BatchScheduler.getInstance();
      for (const schedule of savedSchedules) {
        scheduler.scheduleMessage(
          schedule.id,
          schedule.roomId,
          schedule.message,
          schedule.scheduledTime,
          { key: "reminder", ...schedule.metadata }
        );
      }

      this.logger.info(
        `Loaded ${savedSchedules.length} saved schedules from database`
      );
    } catch (error) {
      this.logger.error("Database initialization failed:", error);
    }
  }

  /**
   * 봇 설정 로드 (중간 우선순위)
   */
  @Bootstrap(10) // 중간 우선순위
  async loadConfiguration() {
    this.logger.info("Loading bot configuration...");

    try {
      // 설정 파일이나 환경변수에서 설정을 로드
      const config = {
        batchSize: parseInt(process.env.BATCH_SIZE || "100"),
        scheduleInterval: parseInt(process.env.SCHEDULE_INTERVAL || "5000"),
        enableReminders: process.env.ENABLE_REMINDERS === "true",
        enableNotifications: process.env.ENABLE_NOTIFICATIONS === "true",
      };

      this.logger.info("Configuration loaded:", config);

      // 글로벌 설정을 어딘가에 저장하거나 다른 서비스에 전달
    } catch (error) {
      this.logger.error("Configuration loading failed:", error);
    }
  }

  /**
   * 주기적 작업 설정 (낮은 우선순위)
   */
  @Bootstrap(50) // 낮은 우선순위 (나중에 실행)
  async setupPeriodicTasks() {
    if ((process.env.ENABLE_BOOTSTRAP_EXAMPLE_SCHEDULES || "").toLowerCase() !== "true") {
      this.logger.info("Bootstrap example schedules disabled; skip periodic tasks");
      return;
    }
    if (await isSafeMode()) {
      this.logger.warn("SAFE_MODE on: skip scheduling periodic tasks");
      return;
    }
    this.logger.info("Setting up periodic tasks...");

    try {
      const scheduler = BatchScheduler.getInstance();

      // 예제 1: 매일 오전 9시에 일일 인사 메시지 스케줄
      const tomorrow9AM = new Date();
      tomorrow9AM.setDate(tomorrow9AM.getDate() + 1);
      tomorrow9AM.setHours(9, 0, 0, 0);

      scheduler.scheduleMessage(
        "daily-greeting",
        "your-room-id-here", // 실제 방 ID로 변경하세요
        "🌅 좋은 아침입니다! 오늘도 좋은 하루 되세요! 😊",
        tomorrow9AM.getTime(),
        {
          key: "reminder", // 이렇게 하면 CustomBatchController의 handleReminderMessages가 처리
          type: "daily",
          recurring: true,
          interval: 24 * 60 * 60 * 1000, // 24시간마다 반복
        }
      );

      // 예제 2: 매주 월요일 오전 10시에 주간 알림 스케줄
      const nextMonday10AM = this.getNextMonday();
      nextMonday10AM.setHours(10, 0, 0, 0);

      scheduler.scheduleMessage(
        "weekly-reminder",
        "your-room-id-here", // 실제 방 ID로 변경하세요
        "📅 새로운 한 주가 시작되었습니다! 이번 주 목표를 달성해보세요! 💪",
        nextMonday10AM.getTime(),
        {
          key: "reminder", // handleReminderMessages에서 처리
          type: "weekly",
          recurring: true,
          interval: 7 * 24 * 60 * 60 * 1000, // 일주일마다 반복
        }
      );

      // 예제 3: 시스템 시작 알림 (즉시 전송)
      scheduler.scheduleMessage(
        "system-startup",
        "your-room-id-here", // 실제 방 ID로 변경하세요
        "🤖 봇이 성공적으로 시작되었습니다! 모든 시스템이 정상 작동 중입니다.",
        Date.now() + 5000, // 5초 후 전송
        {
          key: "notification", // handleNotificationMessages에서 처리
          type: "system",
          priority: "important",
        }
      );

      // 예제 4: 정기 점검 알림 (매일 밤 11시)
      const tonight11PM = new Date();
      tonight11PM.setHours(23, 0, 0, 0);
      if (tonight11PM.getTime() < Date.now()) {
        tonight11PM.setDate(tonight11PM.getDate() + 1);
      }

      scheduler.scheduleMessage(
        "maintenance-check",
        "your-room-id-here", // 실제 방 ID로 변경하세요
        "🔧 일일 시스템 점검이 곧 시작됩니다. 잠시 후 서비스가 일시 중단될 수 있습니다.",
        tonight11PM.getTime(),
        {
          key: "notification",
          type: "system",
          priority: "normal",
          recurring: true,
          interval: 24 * 60 * 60 * 1000, // 매일 반복
        }
      );

      this.logger.info("Periodic tasks scheduled successfully");
    } catch (error) {
      this.logger.error("Failed to setup periodic tasks:", error);
    }
  }

  /**
   * 캐시 및 임시 데이터 정리 (가장 낮은 우선순위)
   */
  @Bootstrap(100) // 가장 높은 숫자 (가장 나중에 실행)
  async cleanupAndOptimize() {
    this.logger.info("Performing cleanup and optimization...");

    try {
      // 임시 파일 정리
      // await this.cleanupTempFiles();

      // 캐시 초기화
      // await this.initializeCache();

      // 메모리 최적화
      // this.optimizeMemoryUsage();

      this.logger.info("Cleanup and optimization completed");
    } catch (error) {
      this.logger.error("Cleanup and optimization failed:", error);
    }
  }

  /**
   * 데이터베이스에서 저장된 스케줄을 로드하는 헬퍼 메서드
   */
  private async loadSchedulesFromDatabase(): Promise<
    Array<{
      id: string;
      roomId: string;
      message: string;
      scheduledTime: number;
      metadata?: any;
    }>
  > {
    try {
      if (await isSafeMode()) return [];
      // TODO: 실제 구현에서는 DB에서 스케줄을 로드한다.
      // 운영 기본값은 "아무 스케줄도 자동 등록하지 않음" (예제/샘플 발송 금지).
      return [];
    } catch (error) {
      this.logger.error("Failed to load schedules from database:", error);
      return [];
    }
  }

  /**
   * 다음 월요일 날짜를 구하는 헬퍼 메서드
   */
  private getNextMonday(): Date {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const daysUntilMonday = (1 + 7 - dayOfWeek) % 7 || 7;

    const nextMonday = new Date(today);
    nextMonday.setDate(today.getDate() + daysUntilMonday);

    return nextMonday;
  }
}

export default CustomBootstrapController;
