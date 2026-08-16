/*
# Create workflow_runs table (single-tenant, no auth)

1. New Tables
- `workflow_runs`
  - `id` (text, primary key) — the run id (e.g. "r1", "r101")
  - `data` (jsonb) — the full WorkflowRun object as JSON (status, tokens, cost, nodeExecutions, logs, etc.)
  - `created_at` (timestamptz) — when the run record was created
  - `updated_at` (timestamptz) — when the run record was last updated

2. Security
- Enable RLS on `workflow_runs`.
- Allow anon + authenticated full CRUD (single-tenant, no sign-in).
*/

CREATE TABLE IF NOT EXISTS workflow_runs (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_workflow_runs" ON workflow_runs;
CREATE POLICY "anon_select_workflow_runs" ON workflow_runs FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_workflow_runs" ON workflow_runs;
CREATE POLICY "anon_insert_workflow_runs" ON workflow_runs FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_workflow_runs" ON workflow_runs;
CREATE POLICY "anon_update_workflow_runs" ON workflow_runs FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_workflow_runs" ON workflow_runs;
CREATE POLICY "anon_delete_workflow_runs" ON workflow_runs FOR DELETE
  TO anon, authenticated USING (true);
