import pytest


def test_make_mention_attachment_single_sender():
    from server.app import _make_mention_attachment

    msg = "@노래하는 춘식이 어서오세요~"
    mentionees = [{"name": "노래하는 춘식이", "userId": "5148110123409137308"}]
    att = _make_mention_attachment(msg, mentionees)
    assert att == {
        "mentions": [
            {"user_id": 5148110123409137308, "at": [1], "len": 8},
        ]
    }


def test_make_mention_attachment_orders_by_message_position():
    from server.app import _make_mention_attachment

    msg = "@뚜뚜찌 @덕구 어서오세요~ 하트스샷 부탁드립니다!"
    # 일부러 역순으로 넣어도, 메시지 내 등장 순서대로 at=1/2가 매겨져야 한다.
    mentionees = [
        {"name": "덕구", "userId": "6424125706418624187"},
        {"name": "뚜뚜찌", "userId": "6520371736181243261"},
    ]
    att = _make_mention_attachment(msg, mentionees)
    assert att == {
        "mentions": [
            {"user_id": 6520371736181243261, "at": [1], "len": 3},
            {"user_id": 6424125706418624187, "at": [2], "len": 2},
        ]
    }


def test_make_mention_attachment_requires_token_in_text():
    from server.app import _make_mention_attachment

    msg = "안녕하세요"
    mentionees = [{"name": "홍길동", "userId": "123"}]
    with pytest.raises(ValueError):
        _make_mention_attachment(msg, mentionees)


def test_make_mention_attachment_same_user_multiple_mentions_collapses_at_list():
    from server.app import _make_mention_attachment

    msg = "@덕구 @덕구 어서오세요~"
    mentionees = [
        {"name": "덕구", "userId": "6424125706418624187"},
        {"name": "덕구", "userId": "6424125706418624187"},
    ]
    att = _make_mention_attachment(msg, mentionees)
    assert att == {
        "mentions": [
            {"user_id": 6424125706418624187, "at": [1, 2], "len": 2},
        ]
    }


def test_make_mention_attachment_len_is_utf16_code_units_for_emoji():
    from server.app import _make_mention_attachment

    msg = "@A😀 hi"
    mentionees = [{"name": "A😀", "userId": "123"}]
    att = _make_mention_attachment(msg, mentionees)
    assert att == {"mentions": [{"user_id": 123, "at": [1], "len": 3}]}
