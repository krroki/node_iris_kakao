from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from src.services.command_router import CommandRouter, attach_commands, command


class DummyContext:
    def __init__(self, user_id: str, roles: list[str] | None = None) -> None:
        self.user_id = user_id
        self.roles = roles or []


class SampleCommands:
    @command(name="ping", description="Simple ping")
    def ping(self, context: DummyContext, args: list[str]) -> str:
        return "pong"

    @command(name="secret", roles=["admin"], throttle=1.0)
    def secret(self, context: DummyContext, args: list[str]) -> str:
        return "shh"


def test_attach_and_dispatch() -> None:
    router = CommandRouter(prefix="!")
    sample = SampleCommands()
    attach_commands(router, sample)

    result = router.dispatch("!ping", DummyContext("u1"))
    assert result == "pong"

    # 권한 없음
    assert router.dispatch("!secret", DummyContext("u1")) is None

    # 권한 부여 후 동작
    assert router.dispatch("!secret", DummyContext("u2", roles=["admin"])) == "shh"

    # 스로틀링 테스트: 즉시 재실행하면 None
    assert router.dispatch("!secret", DummyContext("u2", roles=["admin"])) is None
