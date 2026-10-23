# Final legacy multiplayer access cutover

This migration completes the ownership repair after every secured client has
been deployed and verified. It closes direct access to `public.rooms`,
`public.players`, `public.answers`, `public.buzzes` and `public.legends` for
`PUBLIC`, `anon` and `authenticated`. It removes their 13 reviewed permissive
policies, explicit column grants and privileges on sequences owned by those
tables. RLS stays enabled. It does not delete or rewrite application rows.

The secured Show, Big Quiz, Throne and Party RPCs keep their authenticated
execution grants. Their private backing tables remain inaccessible to clients.
Throne's narrow Hall RPC can still read the appropriate edition/group from the
historical legends table. The score contracts and Wall of Fame remain unchanged.
The postgres-owned cleanup function, hourly cron, existing retention and
service-role permissions are unchanged.

## Prerequisites

1. Verify all nine remaining editions and the previously secured Bible Show.
   Include host and phone pages, Bible query modes, reconnect, leave, normal
   finish, ambiguous acknowledgement retry and outsider denial. The old
   `creak-multi 5.html` must redirect to the canonical secured page, preserving
   query and hash.
2. Verify deployed assets match the reviewed source. A static scan of a local
   worktree is supporting evidence, not proof of what a browser receives.
3. Capture fresh application rows, schema/ACL/policy/function metadata and a
   verified recoverable application backup. Include `show_private`,
   `bigquiz_private`, `throne_private` and `party_private`; the 20 October backup
   predates those schemas. The application backup does not cover Auth users,
   Storage objects or account settings.
4. Recheck actual exposed schemas, view dependencies, grants and callable APIs.
   The migration guards the reviewed API families, direct and transitive view
   aliases (including column-only reads and owner views over inaccessible inner
   views), table owners/RLS and exact policies, then verifies effective app
   privileges. An
   unexpected grant inherited through another role causes transaction rollback.
   Unexpected `public.moves` also aborts; it is not created or silently granted.
   `public.host_leads` is outside this migration.

Apply transactionally as postgres only after those prerequisites. A three-second
lock timeout prevents a blocked cutover from waiting indefinitely. This is a
PostgreSQL 17 migration, including the `MAINTAIN` privilege check. Do not blindly
rerun an already recorded migration or use a database push to reconcile unrelated
history.

## Verification

Run `python tests/check_legacy_retirement.py` in a disposable local environment
or the dedicated GitHub Actions workflow. The harness creates only synthetic
data and passive cron metadata in a networkless pinned PostgreSQL container.
It checks drift rollback, table/column/owned-sequence denial, preservation of
all unrelated rows and metadata, the historical Hall bridge, owned-room resumes,
and both accepted and rejected score contracts. It does not establish JWT,
HTTP or browser correctness; the separate family checks cover those boundaries.

After production application, verify effective privileges and non-mutating HTTP
denial probes for both anonymous and authenticated clients. Verify narrow game
APIs and score reads still work, and compare transaction-consistent row and
metadata fingerprints. Do not hard-code a historical score count: legitimate
new scores and normal scheduled cleanup can occur between observations.

Cached older clients intentionally lose their unrestricted endpoints. Ask players
to refresh their game pages and start fresh rooms. Existing codes or saved
browser player IDs are not evidence of ownership and are not imported.

## Recovery

The accompanying rollback script is intentionally a diagnostic no-op. It keeps
all data and legacy access closed. Restoring the old broad grants or policies
would reopen the repaired defect; repair secured API/client compatibility
forward instead. Do not automatically redeploy an unrestricted historical client
or grant every public table/function back to application roles.
