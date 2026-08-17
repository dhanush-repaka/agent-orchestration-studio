/*
# Create studio_catalogs table (single-tenant, no auth)

1. New Tables
- `studio_catalogs`
  - `id` (text, primary key) — catalog kind: prompts, credentials, integrations, evaluations, knowledgeConnections
  - `data` (jsonb) — the full array for that catalog
  - `created_at` / `updated_at` (timestamptz)

2. Security
- Enable RLS.
- Allow anon + authenticated full CRUD (single-tenant, no sign-in).
*/

CREATE TABLE IF NOT EXISTS studio_catalogs (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE studio_catalogs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_studio_catalogs" ON studio_catalogs;
CREATE POLICY "anon_select_studio_catalogs" ON studio_catalogs FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_studio_catalogs" ON studio_catalogs;
CREATE POLICY "anon_insert_studio_catalogs" ON studio_catalogs FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_studio_catalogs" ON studio_catalogs;
CREATE POLICY "anon_update_studio_catalogs" ON studio_catalogs FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_studio_catalogs" ON studio_catalogs;
CREATE POLICY "anon_delete_studio_catalogs" ON studio_catalogs FOR DELETE
  TO anon, authenticated USING (true);
