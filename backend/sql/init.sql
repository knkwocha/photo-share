-- PhotoShare Database Schema
-- Run once against Azure PostgreSQL Flexible Server

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Users ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      VARCHAR(50)  UNIQUE NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(20)  NOT NULL DEFAULT 'consumer' CHECK (role IN ('creator', 'consumer', 'admin')),
  avatar_url    TEXT,
  bio           TEXT,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Photos ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS photos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title            VARCHAR(255) NOT NULL,
  caption          TEXT,
  location         VARCHAR(255),
  people_present   TEXT[],
  blob_url         TEXT NOT NULL,
  blob_name        TEXT NOT NULL,
  thumbnail_url    TEXT,
  tags             TEXT[],          -- from Azure Cognitive Services
  ai_description   TEXT,            -- from Azure Cognitive Services
  dominant_colors  TEXT[],
  is_adult_content BOOLEAN DEFAULT FALSE,
  view_count       INTEGER DEFAULT 0,
  average_rating   NUMERIC(3,2) DEFAULT 0,
  rating_count     INTEGER DEFAULT 0,
  is_published     BOOLEAN DEFAULT TRUE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_photos_creator ON photos(creator_id);
CREATE INDEX IF NOT EXISTS idx_photos_created ON photos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_photos_tags ON photos USING GIN(tags);

-- ─── Comments ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id   UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  sentiment  VARCHAR(20),   -- 'positive' | 'neutral' | 'negative'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_photo ON comments(photo_id);

-- ─── Ratings ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ratings (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id   UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating     SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(photo_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ratings_photo ON ratings(photo_id);

-- ─── Trigger: auto-update updated_at ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER users_updated_at
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER photos_updated_at
  BEFORE UPDATE ON photos FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Trigger: keep average_rating in sync ─────────────────────────────────────
CREATE OR REPLACE FUNCTION update_photo_rating()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE photos SET
    average_rating = (SELECT COALESCE(AVG(rating), 0) FROM ratings WHERE photo_id = COALESCE(NEW.photo_id, OLD.photo_id)),
    rating_count   = (SELECT COUNT(*) FROM ratings WHERE photo_id = COALESCE(NEW.photo_id, OLD.photo_id))
  WHERE id = COALESCE(NEW.photo_id, OLD.photo_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER ratings_after_change
  AFTER INSERT OR UPDATE OR DELETE ON ratings
  FOR EACH ROW EXECUTE FUNCTION update_photo_rating();

-- ─── Seed: default admin/creator account ─────────────────────────────────────
-- Password: Admin@1234  (bcrypt hash — change immediately in production)
INSERT INTO users (username, email, password_hash, role) VALUES
  ('admin', 'admin@photoshare.local', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj/RK.s5u1K2', 'admin'),
  ('demo_creator', 'creator@photoshare.local', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj/RK.s5u1K2', 'creator')
ON CONFLICT DO NOTHING;
