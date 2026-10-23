-- Deliberately data-preserving and access-preserving. This cutover only removes
-- unsafe legacy ACLs/policies; restoring them would reopen the repaired defect.
-- Repair a secured API/client forward. Never redeploy an old unrestricted client
-- or GRANT the legacy tables back as an automatic rollback.
DO $safe_rollback$
BEGIN
  RAISE NOTICE 'Legacy access remains closed; no rows, APIs, grants or policies changed. Repair secured clients/APIs forward.';
END
$safe_rollback$;
