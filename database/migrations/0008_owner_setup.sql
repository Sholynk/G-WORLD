-- Only the operator bootstrap command inserts into this table. The trigger
-- creates the reserved account/profile in the SAME SQL statement atomically.
CREATE TABLE owner_enrollment (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  bootstrap_password_hash TEXT NOT NULL CHECK(length(bootstrap_password_hash) >= 40),
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TRIGGER owner_enrollment_validate BEFORE INSERT ON owner_enrollment
BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM site_owner)
    THEN RAISE(ABORT, 'Owner setup has already completed') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM users WHERE email = 'sholabusari66@gmail.com' COLLATE NOCASE)
    THEN RAISE(ABORT, 'Reserved owner email already exists; operator review required') END;
END;
CREATE TRIGGER owner_enrollment_create AFTER INSERT ON owner_enrollment
BEGIN
  INSERT INTO users(id, email, password_hash, role_id, status)
    VALUES (NEW.user_id, 'sholabusari66@gmail.com', NEW.bootstrap_password_hash,
      (SELECT id FROM roles WHERE key = 'super_admin'), 'pending_verification');
  INSERT INTO user_profiles(user_id, display_name) VALUES (NEW.user_id, 'Oluwashola Busari');
END;
CREATE TRIGGER owner_enrollment_no_transfer BEFORE UPDATE OF user_id ON owner_enrollment
WHEN NEW.user_id <> OLD.user_id
BEGIN SELECT RAISE(ABORT, 'Owner enrollment cannot be transferred'); END;

CREATE TABLE owner_security_tokens (
  token_hash TEXT PRIMARY KEY CHECK(length(token_hash) = 64),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK(purpose IN ('setup', 'code_recovery')),
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_owner_security_tokens_expiry ON owner_security_tokens(expires_at);
