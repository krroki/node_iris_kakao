"""환영 메시지/이미지 전송 로직의 스켈레톤."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

try:
    from iris import ChatContext
except ImportError:  # pragma: no cover
    ChatContext = Any  # type: ignore


class WelcomeHandler:
    """템플릿 로딩과 자동 응답 메시지를 준비한다."""

    def __init__(self, template_dir: Path) -> None:
        self.template_dir = Path(template_dir)
        self.template_dir.mkdir(parents=True, exist_ok=True)

    def _load_template(self, room_id: int) -> Dict[str, Any]:
        room_template = self.template_dir / f"{room_id}.json"
        default_template = self.template_dir / "default.json"
        target = room_template if room_template.exists() else default_template

        if target.exists():
            return json.loads(target.read_text(encoding="utf-8"))

        # 기본 텍스트 템플릿 초기화
        default_template.write_text(
            json.dumps({"auto_reply": "환영합니다! 채팅방 규칙을 확인해주세요."}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return {"auto_reply": "환영합니다! 채팅방 규칙을 확인해주세요."}

    def prepare_welcome_payload(self, chat: ChatContext) -> Dict[str, Any]:
        """환영 템플릿과 신규 멤버 메타 정보를 결합한다."""
        template = self._load_template(int(chat.room.id))
        return {
            "auto_reply": template.get("auto_reply"),
            "member": {
                "id": int(chat.sender.id),
                "name": getattr(chat.sender, "name", None),
            },
        }
