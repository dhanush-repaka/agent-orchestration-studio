/*
# Lock down credentials.value column

## What this does

The `credentials` table currently allows anyone with the public anon key to
read the full secret value (PAT, API keys, etc.) directly from the browser.
This is a serious security problem.

This migration fixes it by:

1. Revoking the default `SELECT` privilege on the `value` column from the
   `anon` and `authenticated` roles, so the browser can never read the actual
   secret.
2. Creating a view `credentials_safe` that exposes everything EXCEPT the
   `value` column, so the frontend can still list and display metadata.
3. Keeping INSERT/UPDATE/DELETE policies as-is so the frontend can still
   write/update/delete credentials (including the value) — the browser can
   write but not read back the secret.
4. The edge function reads `value` using the service role key (server-side
   only), which bypasses RLS entirely.

## Tables affected
- `credentials` — no schema changes, only column-level privilege revocation.
- `credentials_safe` (new view) — metadata-only projection of `credentials`.

## Security changes
- REVOKE SELECT on `credentials.value` from `anon` and `authenticated`.
- Existing RLS policies on `credentials` remain (CRUD still works for
  metadata columns).
- The `credentials_safe` view inherits RLS from the underlying table.

## Important notes
1. The frontend must stop selecting from `credentials` directly and use
   `credentials_safe` instead, otherwise the `value` column will come back
   as null/empty.
2. Writes (INSERT/UPDATE) still go to the `credentials` table directly —
   the view is read-only by nature (simple projection).
3. The edge function uses the service role key, which bypasses RLS and
   column privileges, so it can read `value` without issue.
*/

-- Revoke column-level SELECT on the sensitive value column from anon and authenticated.
-- This prevents the browser (which uses the anon key) from ever reading the secret.
REVOKE SELECT (value) ON credentials FROM anon;
REVOKE SELECT (value) ON credentials FROM authenticated;

-- Create a safe view that exposes everything except the value column.
-- The frontend uses this for listing/displaying credentials.
CREATE OR REPLACE VIEW credentials_safe AS
SELECT
  id,
  name,
  type,
  environment,
  updated_at
FROM credentials;

-- Views in Supabase run with the privileges of the view owner (security definer
-- by default for views). We want the view to respect RLS, so we set it to
-- SECURITY INVOKER — the caller's permissions apply, and since we revoked
-- SELECT on `value`, the view won't expose it.
ALTER VIEW credentials_safe SET (security_invoker = true);

-- Grant SELECT on the safe view to anon and authenticated so the frontend
-- can list credential metadata.
GRANT SELECT ON credentials_safe TO anon, authenticated;