from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterable, List, Optional

from src.utils.logger import get_service_logger, ServiceLogger

CommandFunc = Callable[[Any, List[str]], Any]


@dataclass
class CommandMeta:
    name: str
    description: str = ""
    roles: Optional[Iterable[str]] = None
    throttle: Optional[float] = None  # seconds
    last_called: Dict[str, float] = field(default_factory=dict)


class CommandRouter:
    """Minimal command router that dispatches prefixed messages."""

    def __init__(self, prefix: str = "!", logger: Optional[ServiceLogger] = None) -> None:
        self.prefix = prefix
        self.commands: Dict[str, CommandMeta] = {}
        self.handlers: Dict[str, CommandFunc] = {}
        self.logger = logger or get_service_logger("command_router")
        self._lock = threading.Lock()

    def register(
        self,
        name: str,
        handler: CommandFunc,
        description: str = "",
        roles: Optional[Iterable[str]] = None,
        throttle: Optional[float] = None,
    ) -> None:
        name = name.lower()
        with self._lock:
            self.commands[name] = CommandMeta(
                name=name,
                description=description,
                roles=list(roles) if roles else None,
                throttle=throttle,
            )
            self.handlers[name] = handler
        self.logger.info("명령어 등록", command=name, description=description)

    def dispatch(self, raw_text: str, context: Any = None, user_roles: Optional[Iterable[str]] = None) -> Optional[Any]:
        if not raw_text.startswith(self.prefix):
            return None
        parts = raw_text[len(self.prefix):].strip().split()
        if not parts:
            return None
        name, args = parts[0].lower(), parts[1:]
        meta = self.commands.get(name)
        handler = self.handlers.get(name)
        if not meta or not handler:
            self.logger.warning("등록되지 않은 명령어", command=name)
            return None
        if user_roles is None and hasattr(context, "roles"):
            user_roles = getattr(context, "roles")
        if not self._check_roles(meta, user_roles):
            self.logger.warning("권한 부족", command=name)
            return None
        if not self._check_throttle(meta, context):
            self.logger.warning("명령어 스로틀링", command=name)
            return None
        self.logger.info("명령어 실행", command=name, args=args)
        return handler(context, args)

    def _check_roles(self, meta: CommandMeta, user_roles: Optional[Iterable[str]]) -> bool:
        if not meta.roles:
            return True
        if user_roles is None:
            return False
        user_set = {role.lower() for role in user_roles}
        required = {role.lower() for role in meta.roles}
        return not required.isdisjoint(user_set)

    def _check_throttle(self, meta: CommandMeta, context: Any) -> bool:
        if meta.throttle is None:
            return True
        key = str(getattr(context, "sender", getattr(context, "user_id", "global")))
        now = time.monotonic()
        last = meta.last_called.get(key, 0)
        if now - last < meta.throttle:
            return False
        meta.last_called[key] = now
        return True

    def available_commands(self) -> List[CommandMeta]:
        return list(self.commands.values())


def command(
    name: str,
    description: str = "",
    roles: Optional[Iterable[str]] = None,
    throttle: Optional[float] = None,
):
    """Decorator that annotates a function with command metadata."""

    def decorator(func: CommandFunc) -> CommandFunc:
        setattr(func, "__command_meta__", CommandMeta(name=name, description=description, roles=roles, throttle=throttle))
        return func

    return decorator


def attach_commands(router: CommandRouter, target: Any) -> None:
    """Attach decorated methods on target to the router."""
    for attr in dir(target):
        handler = getattr(target, attr)
        meta = getattr(handler, "__command_meta__", None)
        if meta is None and hasattr(handler, "__func__"):
            meta = getattr(handler.__func__, "__command_meta__", None)
        if meta:
            router.register(meta.name, handler, meta.description, meta.roles, meta.throttle)


__all__ = [
    "CommandRouter",
    "command",
    "attach_commands",
    "CommandMeta",
]
