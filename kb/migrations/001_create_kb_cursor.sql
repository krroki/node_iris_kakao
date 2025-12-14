-- ADR-0006: KB 프로필 분리 + 백필 전략
-- 수집 커서 테이블: 프로필별/메뉴별 마지막 수집 시점 추적

CREATE TABLE IF NOT EXISTS kb_cursor (
    id SERIAL PRIMARY KEY,
    profile VARCHAR(20) NOT NULL,           -- 'main', 'free', 'paid'
    cafe_id BIGINT NOT NULL,
    menu_id BIGINT NOT NULL,
    last_post_id BIGINT,                    -- 마지막으로 수집한 post_id
    last_created_at TIMESTAMP WITH TIME ZONE,  -- 마지막으로 수집한 글의 작성일
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(profile, cafe_id, menu_id)
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_kb_cursor_profile ON kb_cursor(profile);
CREATE INDEX IF NOT EXISTS idx_kb_cursor_updated ON kb_cursor(updated_at);

COMMENT ON TABLE kb_cursor IS 'KB 백필용 수집 커서 (ADR-0006)';
COMMENT ON COLUMN kb_cursor.profile IS 'KB 프로필: main, free, paid';
COMMENT ON COLUMN kb_cursor.last_post_id IS '해당 메뉴에서 마지막으로 수집한 게시글 ID';
COMMENT ON COLUMN kb_cursor.last_created_at IS '마지막 수집 글의 작성 시각 (백필 범위 계산용)';
