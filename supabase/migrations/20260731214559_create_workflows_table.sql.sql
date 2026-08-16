/*
# Create workflows table (single-tenant, no auth)

1. New Tables
- `workflows`
  - `id` (text, primary key) — the workflow id (e.g. "w1", "w101")
  - `data` (jsonb) — the full Workflow object as JSON (nodes, edges, metadata)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

2. Security
- Enable RLS on `workflows`.
- Allow anon + authenticated full CRUD (single-tenant, no sign-in).
*/

CREATE TABLE IF NOT EXISTS workflows (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_workflows" ON workflows;
CREATE POLICY "anon_select_workflows" ON workflows FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_workflows" ON workflows;
CREATE POLICY "anon_insert_workflows" ON workflows FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_workflows" ON workflows;
CREATE POLICY "anon_update_workflows" ON workflows FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_workflows" ON workflows;
CREATE POLICY "anon_delete_workflows" ON workflows FOR DELETE
  TO anon, authenticated USING (true);
