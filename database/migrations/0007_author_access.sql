-- Approval is independent of email verification and account suspension.
-- Existing accounts/content are deliberately not assigned to a new owner.
CREATE TABLE site_owner (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  confirmation_hash TEXT NOT NULL CHECK (length(confirmation_hash) >= 40),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TRIGGER site_owner_validate BEFORE INSERT ON site_owner
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM users u JOIN roles r ON r.id = u.role_id
    WHERE u.id = NEW.user_id AND u.email = 'sholabusari66@gmail.com' COLLATE NOCASE
      AND r.key = 'super_admin' AND u.status = 'active' AND u.email_verified_at IS NOT NULL
  ) THEN RAISE(ABORT, 'Owner must be the verified designated super admin') END;
END;
CREATE TRIGGER site_owner_no_delete BEFORE DELETE ON site_owner
BEGIN SELECT RAISE(ABORT, 'Owner identity cannot be removed'); END;
CREATE TRIGGER site_owner_no_transfer BEFORE UPDATE OF user_id ON site_owner
WHEN NEW.user_id <> OLD.user_id
BEGIN SELECT RAISE(ABORT, 'Owner identity cannot be transferred'); END;
CREATE TRIGGER site_owner_protect_user BEFORE UPDATE OF role_id, status, email ON users
WHEN EXISTS (SELECT 1 FROM site_owner WHERE user_id = OLD.id)
 AND (NEW.role_id <> OLD.role_id OR NEW.status <> 'active' OR NEW.email <> OLD.email COLLATE NOCASE)
BEGIN SELECT RAISE(ABORT, 'Owner account is protected'); END;

CREATE TABLE author_applications (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  author_id INTEGER NOT NULL UNIQUE REFERENCES authors(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'declined')),
  reviewed_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_author_applications_status ON author_applications(status, created_at);
