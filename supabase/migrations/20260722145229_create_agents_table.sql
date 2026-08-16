/*
# Create agents table (single-tenant, no auth)

1. New Tables
- `agents`
  - `id` (text, primary key) — the agent id (e.g. "a1", "a101")
  - `data` (jsonb) — the full Agent object as JSON
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

2. Security
- Enable RLS on `agents`.
- Allow anon + authenticated full CRUD (single-tenant, no sign-in).
*/

CREATE TABLE IF NOT EXISTS agents (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_agents" ON agents;
CREATE POLICY "anon_select_agents" ON agents FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_agents" ON agents;
CREATE POLICY "anon_insert_agents" ON agents FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_agents" ON agents;
CREATE POLICY "anon_update_agents" ON agents FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_agents" ON agents;
CREATE POLICY "anon_delete_agents" ON agents FOR DELETE
  TO anon, authenticated USING (true);
