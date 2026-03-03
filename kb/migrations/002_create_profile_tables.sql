-- ADR-0006: KB 프로필별 테이블 생성
-- main/free/paid 프로필별로 게시글/매뉴얼 테이블 분리

-- ============================================================
-- MAIN 프로필 (통합 KB, 기존 sources_post 대체)
-- ============================================================

CREATE TABLE IF NOT EXISTS kb_main_post (
    post_id BIGINT PRIMARY KEY,
    cafe_id BIGINT NOT NULL,
    menu_id BIGINT NOT NULL,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    author TEXT,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    html TEXT,
    norm_text TEXT,
    text_hash TEXT,
    status TEXT DEFAULT 'clean',
    dedup_key TEXT,
    rule_id BIGINT,
    last_crawled_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kb_main_manual (
    doc_id BIGSERIAL PRIMARY KEY,
    slug TEXT,
    title TEXT NOT NULL,
    body_md TEXT NOT NULL,
    summary TEXT,
    level TEXT,
    status TEXT DEFAULT 'draft',
    version INTEGER DEFAULT 1,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- FREE 프로필 (무료강의 KB)
-- ============================================================

CREATE TABLE IF NOT EXISTS kb_free_post (
    post_id BIGINT PRIMARY KEY,
    cafe_id BIGINT NOT NULL,
    menu_id BIGINT NOT NULL,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    author TEXT,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    html TEXT,
    norm_text TEXT,
    text_hash TEXT,
    status TEXT DEFAULT 'clean',
    dedup_key TEXT,
    rule_id BIGINT,
    last_crawled_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kb_free_manual (
    doc_id BIGSERIAL PRIMARY KEY,
    slug TEXT,
    title TEXT NOT NULL,
    body_md TEXT NOT NULL,
    summary TEXT,
    level TEXT,
    status TEXT DEFAULT 'draft',
    version INTEGER DEFAULT 1,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- PAID 프로필 (유료강의 KB)
-- ============================================================

CREATE TABLE IF NOT EXISTS kb_paid_post (
    post_id BIGINT PRIMARY KEY,
    cafe_id BIGINT NOT NULL,
    menu_id BIGINT NOT NULL,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    author TEXT,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    html TEXT,
    norm_text TEXT,
    text_hash TEXT,
    status TEXT DEFAULT 'clean',
    dedup_key TEXT,
    rule_id BIGINT,
    last_crawled_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kb_paid_manual (
    doc_id BIGSERIAL PRIMARY KEY,
    slug TEXT,
    title TEXT NOT NULL,
    body_md TEXT NOT NULL,
    summary TEXT,
    level TEXT,
    status TEXT DEFAULT 'draft',
    version INTEGER DEFAULT 1,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- 인덱스 생성
-- ============================================================

-- main
CREATE INDEX IF NOT EXISTS idx_kb_main_post_menu ON kb_main_post(menu_id);
CREATE INDEX IF NOT EXISTS idx_kb_main_post_created ON kb_main_post(created_at);
CREATE INDEX IF NOT EXISTS idx_kb_main_post_status ON kb_main_post(status);

-- free
CREATE INDEX IF NOT EXISTS idx_kb_free_post_menu ON kb_free_post(menu_id);
CREATE INDEX IF NOT EXISTS idx_kb_free_post_created ON kb_free_post(created_at);
CREATE INDEX IF NOT EXISTS idx_kb_free_post_status ON kb_free_post(status);

-- paid
CREATE INDEX IF NOT EXISTS idx_kb_paid_post_menu ON kb_paid_post(menu_id);
CREATE INDEX IF NOT EXISTS idx_kb_paid_post_created ON kb_paid_post(created_at);
CREATE INDEX IF NOT EXISTS idx_kb_paid_post_status ON kb_paid_post(status);

-- 코멘트
COMMENT ON TABLE kb_main_post IS 'KB main 프로필 게시글 (ADR-0006)';
COMMENT ON TABLE kb_free_post IS 'KB free 프로필 게시글 - 무료강의 (ADR-0006)';
COMMENT ON TABLE kb_paid_post IS 'KB paid 프로필 게시글 - 유료강의 (ADR-0006)';
