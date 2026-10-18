-- Ownership is a stable account ID, never inferred from mutable names/bylines.
-- Legacy records remain NULL and owner-managed until explicitly reviewed.
ALTER TABLE articles ADD COLUMN owner_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE images ADD COLUMN owner_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE authors ADD COLUMN social_links_json TEXT NOT NULL DEFAULT '{}';
CREATE INDEX idx_articles_owner ON articles(owner_user_id, status, id);
CREATE INDEX idx_images_owner ON images(owner_user_id, id);
CREATE TRIGGER articles_immutable_owner BEFORE UPDATE OF owner_user_id ON articles
WHEN OLD.owner_user_id IS NOT NEW.owner_user_id
BEGIN SELECT RAISE(ABORT, 'Article ownership is immutable'); END;
CREATE TRIGGER images_immutable_owner BEFORE UPDATE OF owner_user_id ON images
WHEN OLD.owner_user_id IS NOT NEW.owner_user_id
BEGIN SELECT RAISE(ABORT, 'Media ownership is immutable'); END;

-- Normalize profiles created during the gated onboarding milestone. Account ID
-- prefixes contain underscores, which are not valid editorial URL slugs.
UPDATE articles SET author_slug = lower(replace(author_slug, '_', '-'))
 WHERE author_slug IN (SELECT p.slug FROM authors p JOIN author_applications a ON a.author_id = p.id)
 AND (instr(author_slug, '_') > 0 OR author_slug <> lower(author_slug));
UPDATE authors SET slug = lower(replace(slug, '_', '-'))
 WHERE id IN (SELECT author_id FROM author_applications) AND (instr(slug, '_') > 0 OR slug <> lower(slug));
