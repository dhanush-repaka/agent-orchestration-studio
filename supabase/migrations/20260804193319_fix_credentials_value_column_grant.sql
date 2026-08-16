/*
# Lock down credentials.value column — fix table-level grant

The previous migration revoked column-level SELECT on `value`, but
anon/authenticated still had table-level SELECT which implicitly
covers all columns. This migration fixes that by:

1. Revoking the table-level SELECT privilege from anon and authenticated.
2. Re-granting SELECT on only the non-sensitive columns (id, name, type,
   environment, updated_at) at the column level.
3. Keeping INSERT/UPDATE/DELETE at the table level so the frontend can
   still write/update/delete credentials (including the value column).

After this, the browser (anon key) can read metadata but NOT the value
column. The edge function uses the service role key which bypasses RLS
and has full access.
*/

-- Revoke all table-level SELECT from anon and authenticated
REVOKE SELECT ON credentials FROM anon;
REVOKE SELECT ON credentials FROM authenticated;

-- Re-grant SELECT on only the safe columns (everything except value)
GRANT SELECT (id, name, type, environment, updated_at) ON credentials TO anon;
GRANT SELECT (id, name, type, environment, updated_at) ON credentials TO authenticated;