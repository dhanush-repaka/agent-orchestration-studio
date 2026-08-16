/*
# Create credentials table (single-tenant, no auth)

1. New Tables
- `credentials`
  - `id` (text, primary key) — the credential id (e.g. "cr1")
  - `name` (text) — display name of the credential
  - `type` (text) — one of: api-key, oauth, basic, bearer, connection-string
  - `value` (text) — the actual secret value (stored as-is)
  - `environment` (text) — one of: development, qa, uat, production
  - `updated_at` (timestamptz) — last modification timestamp

2. Security
- Enable RLS on `credentials`.
- Allow anon + authenticated full CRUD (single-tenant, no sign-in).
*/

CREATE TABLE IF NOT EXISTS credentials (
  id text PRIMARY KEY,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'api-key',
  value text NOT NULL DEFAULT '',
  environment text NOT NULL DEFAULT 'production',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_credentials" ON credentials;
CREATE POLICY "anon_select_credentials" ON credentials FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_credentials" ON credentials;
CREATE POLICY "anon_insert_credentials" ON credentials FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_credentials" ON credentials;
CREATE POLICY "anon_update_credentials" ON credentials FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_credentials" ON credentials;
CREATE POLICY "anon_delete_credentials" ON credentials FOR DELETE
  TO anon, authenticated USING (true);
