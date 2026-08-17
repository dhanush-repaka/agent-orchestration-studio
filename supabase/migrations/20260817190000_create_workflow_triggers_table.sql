/*
# Queue inbound webhook and schedule triggers

1. New Tables
- `workflow_triggers`
  - `id` (text, primary key)
  - `workflow_id` (text)
  - `kind` (text) — webhook | schedule
  - `payload` (jsonb)
  - `status` (text) — queued | consumed
  - `created_at` / `consumed_at` (timestamptz)

2. Security
- Enable RLS. Anon + authenticated full CRUD (single-tenant).
*/

CREATE TABLE IF NOT EXISTS workflow_triggers (
  id text PRIMARY KEY,
  workflow_id text NOT NULL,
  kind text NOT NULL DEFAULT 'webhook',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued',
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz
);

CREATE INDEX IF NOT EXISTS workflow_triggers_queued_idx
  ON workflow_triggers (status, created_at);

ALTER TABLE workflow_triggers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_workflow_triggers" ON workflow_triggers;
CREATE POLICY "anon_select_workflow_triggers" ON workflow_triggers FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_workflow_triggers" ON workflow_triggers;
CREATE POLICY "anon_insert_workflow_triggers" ON workflow_triggers FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_workflow_triggers" ON workflow_triggers;
CREATE POLICY "anon_update_workflow_triggers" ON workflow_triggers FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_workflow_triggers" ON workflow_triggers;
CREATE POLICY "anon_delete_workflow_triggers" ON workflow_triggers FOR DELETE
  TO anon, authenticated USING (true);
