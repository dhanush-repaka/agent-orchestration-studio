/*
# Create tool_configs table (single-tenant, no auth)

1. New Tables
- `tool_configs`
  - `id` (text, primary key) — the integration id (e.g. "int-azure-devops")
  - `name` (text) — the integration/tool name
  - `endpoint` (text) — API endpoint URL
  - `auth_method` (text) — one of: none, api-key, oauth, basic, bearer
  - `api_key` (text) — masked credential value
  - `input_schema` (text) — JSON schema string for tool input
  - `output_schema` (text) — JSON schema string for tool output
  - `timeout_sec` (integer) — request timeout in seconds
  - `retry_count` (integer) — number of retries on failure
  - `permission_level` (text) — one of: read, write, admin
  - `description` (text) — free-form description of the integration
  - `updated_at` (timestamptz) — last modification timestamp

2. Security
- Enable RLS on `tool_configs`.
- Allow anon + authenticated full CRUD (single-tenant, no sign-in).
*/

CREATE TABLE IF NOT EXISTS tool_configs (
  id text PRIMARY KEY,
  name text NOT NULL,
  endpoint text NOT NULL DEFAULT '',
  auth_method text NOT NULL DEFAULT 'api-key',
  api_key text NOT NULL DEFAULT '',
  input_schema text NOT NULL DEFAULT '',
  output_schema text NOT NULL DEFAULT '',
  timeout_sec integer NOT NULL DEFAULT 30,
  retry_count integer NOT NULL DEFAULT 2,
  permission_level text NOT NULL DEFAULT 'read',
  description text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tool_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_tool_configs" ON tool_configs;
CREATE POLICY "anon_select_tool_configs" ON tool_configs FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_tool_configs" ON tool_configs;
CREATE POLICY "anon_insert_tool_configs" ON tool_configs FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_tool_configs" ON tool_configs;
CREATE POLICY "anon_update_tool_configs" ON tool_configs FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_tool_configs" ON tool_configs;
CREATE POLICY "anon_delete_tool_configs" ON tool_configs FOR DELETE
  TO anon, authenticated USING (true);
