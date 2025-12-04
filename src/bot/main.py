from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import logging
import os
import signal
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Optional

from iris import Bot, ChatContext

from src.services.broadcast_scheduler import BroadcastScheduler, BroadcastTask
from src.services.command_router import CommandRouter
from src.services.message_store import MessageStore
from src.services.room_manager import RoomManager
from src.services.welcome_handler import WelcomeHandler
from src.utils.logger import ServiceLogger, get_service_logger, log_execution_time, setup_global_logging


class IRISConnectionManager:
    """IRIS 연결을 재시도하면서 Bot 인스턴스를 생성한다."""

    def __init__(self, iris_url: str, max_reconnect_attempts: int = 5, base_delay: float = 5.0) -> None:
        self.iris_url = iris_url
        self.max_reconnect_attempts = max(1, max_reconnect_attempts)
        self.base_delay = max(1.0, base_delay)
        self.current_attempts = 0
        self.is_running = True
        self.logger = logging.getLogger(__name__)

    def _validate_url(self) -> None:
        host, sep, port = self.iris_url.partition(":")
        if not sep:
            raise ValueError(f"IRIS URL must include host:port, got '{self.iris_url}'")
        if not port.isdigit():
            raise ValueError(f"IRIS URL port must be numeric, got '{port}'")
        port_num = int(port)
        if not (0 < port_num < 65536):
            raise ValueError(f"IRIS URL port out of range: {port_num}")
        if not host:
            raise ValueError("IRIS URL host is empty")

    async def connect_with_retry(self) -> Bot:
        """IRIS Bot 인스턴스를 만들고 실패 시 지수 백오프로 재시도한다."""
        self._validate_url()
        self.current_attempts = 0
        while self.current_attempts < self.max_reconnect_attempts and self.is_running:
            try:
                bot = Bot(self.iris_url)
                self.logger.info("IRIS 연결 성공", extra={"attempt": self.current_attempts + 1})
                self.current_attempts = 0
                return bot
            except Exception as exc:  # pylint: disable=broad-except
                self.current_attempts += 1
                delay = min(self.base_delay * (2 ** (self.current_attempts - 1)), 300.0)
                self.logger.warning(
                    "IRIS 연결 실패, 재시도 대기",
                    extra={"attempt": self.current_attempts, "error": repr(exc), "delay": delay},
                )
                await asyncio.sleep(delay)
        raise ConnectionError("IRIS 연결 재시도 횟수를 초과했습니다.")

    def should_reconnect(self) -> bool:
        return self.is_running


@dataclass
class BotContext:
    message_store: MessageStore
    welcome_handler: WelcomeHandler
    room_manager: RoomManager
    command_router: CommandRouter
    broadcast_scheduler: BroadcastScheduler
    logger: ServiceLogger
    broadcast_interval: float
    broadcast_max_attempts: int


def register_default_commands(ctx: BotContext) -> None:
    """봇 기본 명령어를 CommandRouter에 등록한다."""

    def ping(_: ChatContext, __: list[str]) -> str:
        return "pong"

    def help_command(_: ChatContext, __: list[str]) -> str:
        descriptions = [
            f"{meta.name} - {meta.description}".strip()
            for meta in ctx.command_router.available_commands()
        ]
        return "\n".join(descriptions) if descriptions else "등록된 명령어가 없습니다."

    def rooms(_: ChatContext, __: list[str]) -> str:
        rooms = ctx.room_manager.get_active_rooms()
        if not rooms:
            return "등록된 방이 없습니다."
        preview = [
            f"{room['id']} - {room.get('name', 'unknown')} (status={room.get('status', 'active')})"
            for room in rooms[:10]
        ]
        if len(rooms) > 10:
            preview.append(f"...외 {len(rooms) - 10}개")
        return "\n".join(preview)

    ctx.command_router.register("ping", ping, description="봇 상태 확인")
    ctx.command_router.register("help", help_command, description="명령어 목록")
    ctx.command_router.register("rooms", rooms, description="등록된 방 목록 조회", roles=None, throttle=5.0)


def configure_bot_handlers(bot: Bot, ctx: BotContext) -> None:
    """IRIS 이벤트 핸들러를 설정한다."""

    @bot.on_event("message")
    def on_message(chat: ChatContext) -> None:
        text = getattr(chat.message, "msg", "") or ""
        payload = {
            "type": "message",
            "text": text,
            "attachment": getattr(chat.message, "attachment", {}),
        }
        ctx.message_store.record(chat, payload)
        ctx.room_manager.auto_register_room(int(chat.room.id), getattr(chat.room, "name", "unknown"))

        user_roles: Optional[Iterable[str]] = getattr(chat.sender, "roles", None)
        result = ctx.command_router.dispatch(text, context=chat, user_roles=user_roles)
        if result is None:
            return
        if isinstance(result, (dict, list)):
            reply_text = json.dumps(result, ensure_ascii=False, indent=2)
        else:
            reply_text = str(result)
        chat.reply(reply_text)

    @bot.on_event("new_member")
    def on_new_member(chat: ChatContext) -> None:
        ctx.room_manager.auto_register_room(int(chat.room.id), getattr(chat.room, "name", "unknown"))
        payload = ctx.welcome_handler.prepare_welcome_payload(chat)
        ctx.message_store.record(chat, {"type": "join", **payload})
        if payload.get("auto_reply"):
            chat.reply(payload["auto_reply"])
        ctx.logger.log_event(
            "member_joined",
            room_id=str(chat.room.id),
            user_id=str(chat.sender.id),
            auto_reply_sent=bool(payload.get("auto_reply")),
        )

    @bot.on_event("del_member")
    def on_del_member(chat: ChatContext) -> None:
        ctx.message_store.record(chat, {"type": "leave"})
        ctx.logger.log_event(
            "member_left",
            room_id=str(chat.room.id),
            user_id=str(chat.sender.id),
        )

    @bot.on_event("unknown")
    def on_unknown(chat: ChatContext) -> None:
        ctx.message_store.record(chat, {"type": "unknown"})
        ctx.logger.log_event(
            "unknown_event",
            room_id=str(getattr(chat.room, "id", "unknown")),
            user_id=str(getattr(chat.sender, "id", "unknown")),
        )


async def broadcast_worker(bot: Bot, ctx: BotContext) -> None:
    """브로드캐스트 큐를 polling 하여 메시지를 전송한다."""
    send_func = _resolve_send_function(bot)
    while True:
        try:
            tasks = ctx.broadcast_scheduler.fetch_pending()
            if not tasks:
                await asyncio.sleep(ctx.broadcast_interval)
                continue
            if send_func is None:
                ctx.logger.warning("IRIS 전송 함수가 없어 방송을 처리할 수 없습니다.")
                for task in tasks:
                    ctx.broadcast_scheduler.mark_retry(task.id, "NO_SEND_FUNCTION", ctx.broadcast_max_attempts)
                await asyncio.sleep(ctx.broadcast_interval)
                continue
            for task in tasks:
                await _dispatch_broadcast_task(send_func, task, ctx)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # pylint: disable=broad-except
            ctx.logger.log_error_with_context(
                error=exc,
                context={"stage": "broadcast_worker", "note": "retry-after-error"},
            )
            await asyncio.sleep(ctx.broadcast_interval)


async def _dispatch_broadcast_task(
    send_func: Any,
    task: BroadcastTask,
    ctx: BotContext,
) -> None:
    """SQLite 큐 작업을 하나씩 전송하고 결과를 기록한다."""
    success_channels: list[str] = []
    for channel in task.channels:
        try:
            result = send_func(channel, task.payload)
            success_channels.append(channel)
            ctx.logger.log_event(
                "broadcast_sent",
                room_id=channel,
                task_id=str(task.id),
                payload=json.dumps(task.payload, ensure_ascii=False)[:200],
                result=str(result)[:120] if result is not None else "ok",
            )
        except Exception as exc:  # pylint: disable=broad-except
            ctx.broadcast_scheduler.mark_retry(task.id, repr(exc), ctx.broadcast_max_attempts)
            ctx.logger.log_error_with_context(
                error=exc,
                context={
                    "task_id": task.id,
                    "room_id": channel,
                    "operation": "broadcast_send",
                },
            )
            return
    ctx.broadcast_scheduler.mark_success(task.id)
    ctx.logger.info(
        "브로드캐스트 완료",
        task_id=task.id,
        success_channels=",".join(success_channels),
    )


def _resolve_send_function(bot: Bot) -> Optional[Any]:
    """IRIS Bot 객체에서 사용 가능한 전송 함수를 찾는다."""
    for candidate in ("send_text", "send_message", "broadcast"):
        func = getattr(bot, candidate, None)
        if callable(func):
            return func
    return None


def create_context(
    log_dir: Path,
    command_prefix: str,
    broadcast_db: Path,
    broadcast_interval: float,
    broadcast_max_attempts: int,
) -> BotContext:
    message_store = MessageStore(log_dir)
    welcome_handler = WelcomeHandler(template_dir=Path("config/templates/welcome"))
    room_manager = RoomManager()
    imported = room_manager.import_rooms_from_config("config/rooms.json")

    command_router = CommandRouter(prefix=command_prefix)
    broadcast_scheduler = BroadcastScheduler(broadcast_db)
    logger = get_service_logger("iris_bot")

    ctx = BotContext(
        message_store=message_store,
        welcome_handler=welcome_handler,
        room_manager=room_manager,
        command_router=command_router,
        broadcast_scheduler=broadcast_scheduler,
        logger=logger,
        broadcast_interval=broadcast_interval,
        broadcast_max_attempts=int(broadcast_max_attempts),
    )
    register_default_commands(ctx)
    logger.info("방 설정 로드 완료", imported_rooms=imported)
    return ctx


def run_dry_run(ctx: BotContext, iris_url: str) -> None:
    bot = Bot(iris_url)
    configure_bot_handlers(bot, ctx)
    dummy_chat = ChatContext(
        {"id": 1000, "name": "dry-run-room"},
        {"id": 500, "name": "dry-run-user"},
        {"msg": "!ping", "attachment": {}},
    )
    for handler in bot.handlers.get("message", []):
        handler(dummy_chat)
    ctx.logger.info("Dry-run 완료")


@log_execution_time()
async def run_bot_with_connection_manager(iris_url: str, ctx: BotContext) -> None:
    max_attempts = int(os.getenv("IRIS_MAX_RECONNECT_ATTEMPTS", "5"))
    base_delay = float(os.getenv("IRIS_RECONNECT_DELAY", "5.0"))
    connection_manager = IRISConnectionManager(iris_url, max_attempts, base_delay)

    loop = asyncio.get_running_loop()
    stop_event = asyncio.Event()

    def _signal_handler(sig: int, __: Any) -> None:
        ctx.logger.info("종료 신호 수신", signal=sig)
        connection_manager.is_running = False
        stop_event.set()

    signal.signal(signal.SIGINT, _signal_handler)
    signal.signal(signal.SIGTERM, _signal_handler)

    ctx.logger.info("IRIS 봇 실행 시작", iris_url=iris_url)

    while connection_manager.should_reconnect():
        try:
            bot = await connection_manager.connect_with_retry()
        except ConnectionError as exc:
            ctx.logger.log_error_with_context(
                error=exc,
                context={"stage": "connect", "attempts": connection_manager.current_attempts},
            )
            break

        configure_bot_handlers(bot, ctx)
        worker_task = asyncio.create_task(broadcast_worker(bot, ctx))

        try:
            await loop.run_in_executor(None, bot.run)
        except Exception as exc:  # pylint: disable=broad-except
            ctx.logger.log_error_with_context(
                error=exc,
                context={"stage": "bot.run"},
            )
        finally:
            worker_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await worker_task

        if stop_event.is_set():
            break
        await asyncio.sleep(base_delay)

    ctx.logger.info("IRIS 봇 실행 종료")


def build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="IRIS 기반 KakaoTalk 봇 실행기")
    parser.add_argument("iris_url", nargs="?", default=os.getenv("IRIS_URL", ""), help="IRIS 서버 주소 (host:port)")
    parser.add_argument("--dry-run", action="store_true", help="IRIS 연결 없이 로컬 핸들러만 실행")
    parser.add_argument("--log-dir", default=os.getenv("IRIS_LOG_DIR", "logs"), help="로그 저장 경로")
    parser.add_argument("--log-level", default=os.getenv("LOG_LEVEL", "INFO"), help="전역 로그 레벨")
    parser.add_argument("--command-prefix", default=os.getenv("COMMAND_PREFIX", "!"), help="명령어 접두사")
    parser.add_argument("--broadcast-db", default=os.getenv("BROADCAST_DB", "data/broadcast_queue.sqlite"), help="브로드캐스트 큐 SQLite 경로")
    parser.add_argument("--broadcast-interval", type=float, default=float(os.getenv("BROADCAST_INTERVAL", "1.0")), help="브로드캐스트 폴링 주기(초)")
    parser.add_argument("--broadcast-max-attempts", type=int, default=int(os.getenv("BROADCAST_MAX_ATTEMPTS", "3")), help="브로드캐스트 재시도 최대 횟수")
    return parser


def main() -> None:
    parser = build_argument_parser()
    args = parser.parse_args()

    if not args.iris_url and not args.dry_run:
        raise SystemExit("IRIS URL을 지정하거나 --dry-run 옵션을 사용하세요.")

    log_dir = Path(args.log_dir)
    setup_global_logging(args.log_level, str(log_dir))
    ctx = create_context(
        log_dir=log_dir,
        command_prefix=args.command_prefix,
        broadcast_db=Path(args.broadcast_db),
        broadcast_interval=max(0.5, args.broadcast_interval),
        broadcast_max_attempts=max(1, args.broadcast_max_attempts),
    )

    if args.dry_run:
        iris_url = args.iris_url or "127.0.0.1:3000"
        run_dry_run(ctx, iris_url)
        return

    try:
        asyncio.run(run_bot_with_connection_manager(args.iris_url, ctx))
    except KeyboardInterrupt:
        ctx.logger.info("사용자 중단으로 종료합니다.")
    except Exception as exc:  # pylint: disable=broad-except
        ctx.logger.log_error_with_context(
            error=exc,
            context={"stage": "main"},
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
