-- The credentials lock-down revoked table-level SELECT and never re-granted
-- INSERT/UPDATE/DELETE, so the Credentials page cannot save a PAT.

GRANT INSERT, UPDATE, DELETE ON credentials TO anon, authenticated;
