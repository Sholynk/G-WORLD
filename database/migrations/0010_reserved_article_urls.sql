-- Slug-history URLs belong to their existing redirect, not to the next author
-- who asks for them. Repository suffixing handles normal collisions; these
-- triggers close the race between its preflight query and the eventual write.
CREATE TRIGGER articles_reserved_slug_insert
BEFORE INSERT ON articles
WHEN EXISTS (SELECT 1 FROM redirects WHERE old_slug = NEW.slug)
BEGIN
  SELECT RAISE(ABORT, 'article slug is reserved by URL history');
END;

CREATE TRIGGER articles_reserved_slug_update
BEFORE UPDATE OF slug ON articles
WHEN OLD.slug IS NOT NEW.slug
 AND EXISTS (SELECT 1 FROM redirects WHERE old_slug = NEW.slug)
BEGIN
  SELECT RAISE(ABORT, 'article slug is reserved by URL history');
END;
