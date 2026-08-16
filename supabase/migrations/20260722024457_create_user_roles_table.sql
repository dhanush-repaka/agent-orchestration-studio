/*
# Create user_roles table (single-tenant, no auth)

1. New Tables
- `user_roles`
  - `id` (text, primary key) — the user id (e.g. "u1")
  - `name` (text) — display name of the user
  - `email` (text) — user email
  - `role` (text) — one of: Administrator, Agent Designer, Workflow Designer, Operator, Approver, Viewer
  - `updated_at` (timestamptz)

2. Security
- Enable RLS on `user_roles`.
- Allow anon + authenticated full CRUD (single-tenant, no sign-in).
*/

CREATE TABLE IF NOT EXISTS user_roles (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'Viewer',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_user_roles" ON user_roles;
CREATE POLICY "anon_select_user_roles" ON user_roles FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_user_roles" ON user_roles;
CREATE POLICY "anon_insert_user_roles" ON user_roles FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_user_roles" ON user_roles;
CREATE POLICY "anon_update_user_roles" ON user_roles FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_user_roles" ON user_roles;
CREATE POLICY "anon_delete_user_roles" ON user_roles FOR DELETE
  TO anon, authenticated USING (true);
