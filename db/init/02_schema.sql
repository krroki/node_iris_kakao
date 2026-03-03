-- Core tables for cafe knowledge base
CREATE TABLE IF NOT EXISTS sources_post (
  post_id       BIGINT PRIMARY KEY,
  cafe_id       BIGINT NOT NULL,
  menu_id       BIGINT NOT NULL,
  url           TEXT NOT NULL,
  title         TEXT NOT NULL,
  author        TEXT,
  created_at    TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ,
  html          TEXT,
  norm_text     TEXT,
  text_hash     TEXT,
  status        TEXT CHECK (status IN ('raw','clean','filtered','error')) DEFAULT 'raw',
  dedup_key     TEXT,
  rule_id       BIGINT,
  last_crawled_at TIMESTAMPTZ,
  UNIQUE (text_hash),
  UNIQUE (dedup_key)
);

CREATE TABLE IF NOT EXISTS sources_comment (
  comment_id    BIGINT PRIMARY KEY,
  post_id       BIGINT REFERENCES sources_post(post_id) ON DELETE CASCADE,
  author        TEXT,
  created_at    TIMESTAMPTZ,
  text          TEXT,
  text_hash     TEXT,
  status        TEXT CHECK (status IN ('raw','clean','filtered','error')) DEFAULT 'raw'
);

CREATE TABLE IF NOT EXISTS attachments (
  att_id        BIGSERIAL PRIMARY KEY,
  post_id       BIGINT REFERENCES sources_post(post_id) ON DELETE CASCADE,
  type          TEXT CHECK (type IN ('image','file','link')) NOT NULL,
  url           TEXT,
  local_path    TEXT,
  mime          TEXT,
  width         INT,
  height        INT,
  phash         TEXT,
  ocr_text      TEXT,
  caption       TEXT,
  status        TEXT CHECK (status IN ('ok','skipped','error')) DEFAULT 'ok'
);

CREATE TABLE IF NOT EXISTS ruleset (
  rule_id       BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  yaml          TEXT NOT NULL,
  enabled       BOOLEAN DEFAULT TRUE,
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS manual_doc (
  doc_id        BIGSERIAL PRIMARY KEY,
  slug          TEXT UNIQUE,
  title         TEXT NOT NULL,
  body_md       TEXT NOT NULL,
  summary       TEXT,
  level         TEXT CHECK (level IN ('beginner','advanced')),
  status        TEXT CHECK (status IN ('draft','reviewed','published')) DEFAULT 'draft',
  version       INT DEFAULT 1,
  source_span   JSONB,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS manual_link (
  doc_id        BIGINT REFERENCES manual_doc(doc_id) ON DELETE CASCADE,
  post_id       BIGINT REFERENCES sources_post(post_id) ON DELETE CASCADE,
  role          TEXT CHECK (role IN ('primary','supporting')) NOT NULL,
  PRIMARY KEY (doc_id, post_id)
);

-- Embeddings stored in pgvector
CREATE TABLE IF NOT EXISTS embeddings (
  obj_type      TEXT CHECK (obj_type IN ('manual','post')) NOT NULL,
  obj_id        BIGINT NOT NULL,
  model         TEXT NOT NULL,
  dim           INT NOT NULL,
  vec           VECTOR NOT NULL,
  updated_at    TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (obj_type, obj_id)
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_posts_menu_created ON sources_post(menu_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_text_hash ON sources_post(text_hash);
CREATE INDEX IF NOT EXISTS idx_posts_dedup ON sources_post(dedup_key);
CREATE INDEX IF NOT EXISTS idx_manuals_status ON manual_doc(status);
CREATE INDEX IF NOT EXISTS idx_embeddings_model ON embeddings(model);
-- Vector index (use ivfflat; requires setting lists after data volume known)
-- CREATE INDEX IF NOT EXISTS idx_embeddings_vec ON embeddings USING ivfflat (vec vector_l2_ops) WITH (lists = 100);

