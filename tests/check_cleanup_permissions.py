#!/usr/bin/env python3
"""Explicit offline acceptance check for cleanup execution permissions.

Uses a fresh, task-labelled PostgreSQL container with no network or published
ports. Only synthetic rows and passive cron metadata are created. The pinned
image must already be cached; this command never pulls it or contacts Supabase.

Run manually: python3 tests/check_cleanup_permissions.py --report /private/path/report.json
Docker is required only for this explicit command, outside test discovery.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import time


ROOT = Path(__file__).resolve().parents[1]
IMAGE = "postgres@sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826"
FIXTURE = ROOT / "tests/fixtures/cleanup_baseline.sql"
ROLLBACK = ROOT / "supabase/rollback/restrict_cleanup_execution.sql"
DEFINITION_MD5 = "12c3777638ef854b65ddc06cec78a36b"
DOCKER = ["docker", "--host=unix:///var/run/docker.sock"]
TASK_LABEL = "tierbrain-cleanup-permission-tests"
EVENT_TABLES = ("answers", "buzzes", "players", "rooms")
TABLES = EVENT_TABLES + ("scores", "legends")


ROWS_SQL = "jsonb_build_object(" + ",".join(
    "'%s',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.%s t)" % (table, table)
    for table in TABLES
) + ")"

AUDIT_SQL = """SELECT jsonb_build_object(
 'rows', %s,
 'function', (SELECT jsonb_build_object(
   'definition',replace(pg_get_functiondef(p.oid),E'\\r\\n',E'\\n'),
   'definition_md5',md5(replace(pg_get_functiondef(p.oid),E'\\r\\n',E'\\n')),
   'owner',pg_get_userbyid(p.proowner),'language',l.lanname,
   'security_definer',p.prosecdef,'settings',p.proconfig,
   'acl',(SELECT jsonb_agg(jsonb_build_object(
     'grantee',pg_get_userbyid(a.grantee),'grantor',pg_get_userbyid(a.grantor),
     'privilege',a.privilege_type,'grantable',a.is_grantable)
     ORDER BY pg_get_userbyid(a.grantee),a.privilege_type)
     FROM aclexplode(p.proacl) a))
   FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
   WHERE p.oid='public.cleanup_old_events()'::regprocedure),
 'effective',jsonb_build_object(
   'anon',has_function_privilege('anon','public.cleanup_old_events()','EXECUTE'),
   'authenticated',has_function_privilege('authenticated','public.cleanup_old_events()','EXECUTE'),
   'postgres',has_function_privilege('postgres','public.cleanup_old_events()','EXECUTE'),
   'service_role',has_function_privilege('service_role','public.cleanup_old_events()','EXECUTE')),
 'cron',(SELECT jsonb_agg(to_jsonb(j) ORDER BY jobid) FROM cron.job j),
 'tables',(SELECT jsonb_agg(jsonb_build_object(
   'schema',n.nspname,'name',c.relname,'owner',pg_get_userbyid(c.relowner),
   'acl',c.relacl::text,'rls',c.relrowsecurity,'forced',c.relforcerowsecurity,
   'columns',(SELECT jsonb_agg(jsonb_build_object(
     'name',attname,'type',format_type(atttypid,atttypmod),'not_null',attnotnull,
     'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY attnum)
     FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
     WHERE a.attrelid=c.oid AND attnum>0 AND NOT attisdropped),
   'constraints',(SELECT jsonb_agg(pg_get_constraintdef(oid) ORDER BY conname)
     FROM pg_constraint WHERE conrelid=c.oid),
   'indexes',(SELECT jsonb_agg(pg_get_indexdef(indexrelid) ORDER BY indexrelid)
     FROM pg_index WHERE indrelid=c.oid)) ORDER BY n.nspname,c.relname)
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE c.relkind='r' AND n.nspname IN ('public','cron')),
 'schemas',(SELECT jsonb_agg(jsonb_build_object('name',nspname,'owner',pg_get_userbyid(nspowner),
   'acl',nspacl::text) ORDER BY nspname) FROM pg_namespace WHERE nspname IN ('public','cron')),
 'memberships',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'role',pg_get_userbyid(roleid),'member',pg_get_userbyid(member),
   'admin',admin_option,'inherit',inherit_option,'set',set_option)
   ORDER BY roleid,member),'[]'::jsonb) FROM pg_auth_members)
);
""" % ROWS_SQL


def cleanup_case_sql(principal: str, allowed: bool) -> str:
    """Stable transaction time proves the strict six-hour boundary exactly."""
    if principal not in {"anon", "authenticated", "postgres", "service_role"}:
        raise ValueError("Unexpected synthetic role")
    seed = "\n".join(
        "TRUNCATE public.%s; INSERT INTO public.%s(id,created_at) VALUES "
        "('old',now()-interval '6 hours'-interval '1 second'),"
        "('boundary',now()-interval '6 hours'),('fresh',now()-interval '5 hours');" % (table, table)
        for table in EVENT_TABLES
    )
    invocation = "PERFORM public.cleanup_old_events();" if allowed else """
  BEGIN
    PERFORM public.cleanup_old_events();
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS observed_state = RETURNED_SQLSTATE;
  END;
  IF observed_state IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'Expected SQLSTATE 42501, observed %', observed_state;
  END IF;
"""
    return """BEGIN;
%s
CREATE TEMP TABLE cleanup_case_before AS SELECT %s AS payload;
SET LOCAL ROLE %s;
DO $invoke$
DECLARE observed_state text;
BEGIN
  IF current_user <> '%s' THEN RAISE EXCEPTION 'Wrong invocation role'; END IF;
  %s
END
$invoke$;
RESET ROLE;
DO $verify$
DECLARE before_rows jsonb; after_rows jsonb; table_name text; expected jsonb;
BEGIN
  SELECT payload INTO before_rows FROM cleanup_case_before;
  SELECT %s INTO after_rows;
  FOREACH table_name IN ARRAY ARRAY['answers','buzzes','players','rooms','scores','legends'] LOOP
    expected := before_rows->table_name;
    IF %s AND table_name IN ('answers','buzzes','players','rooms') THEN
      SELECT jsonb_agg(value ORDER BY value->>'id') INTO expected
      FROM jsonb_array_elements(expected) WHERE value->>'id' <> 'old';
    END IF;
    IF after_rows->table_name IS DISTINCT FROM expected THEN
      RAISE EXCEPTION 'Unexpected synthetic rows after cleanup: %%', table_name;
    END IF;
  END LOOP;
END
$verify$;
ROLLBACK;
""" % (seed, ROWS_SQL, principal, principal, invocation, ROWS_SQL, str(allowed).lower())


def assert_unchanged(expected: dict, observed: dict) -> None:
    if expected != observed:
        raise AssertionError("Unexpected synthetic row, function, grant, table, or cron change")


def assert_repaired(baseline: dict, repaired: dict) -> None:
    expected = json.loads(json.dumps(baseline))
    expected["function"]["acl"] = [grant for grant in expected["function"]["acl"]
                                      if grant["grantee"] != "authenticated"]
    expected["effective"]["authenticated"] = False
    assert_unchanged(expected, repaired)


def assert_baseline(baseline: dict) -> None:
    function = baseline["function"]
    if (function["definition_md5"] != DEFINITION_MD5 or function["owner"] != "postgres"
            or function["language"] != "sql" or not function["security_definer"]
            or function["settings"] != ["search_path=public"]):
        raise AssertionError("Synthetic function does not match the reviewed production definition")
    expected_acl = [{"grantee": role, "grantor": "postgres", "privilege": "EXECUTE", "grantable": False}
                    for role in ["authenticated", "postgres", "service_role"]]
    if function["acl"] != expected_acl:
        raise AssertionError("Synthetic function does not match the reviewed baseline ACL")
    if baseline["effective"] != {"anon": False, "authenticated": True,
                                 "postgres": True, "service_role": True}:
        raise AssertionError("Unexpected baseline effective privileges")
    if baseline["cron"] != [{"jobid": 1, "schedule": "0 * * * *",
                             "command": "select public.cleanup_old_events()", "database": "postgres",
                             "username": "postgres", "active": True, "jobname": "tierbrain-cleanup"}]:
        raise AssertionError("Synthetic cron metadata does not match the reviewed baseline")
    if any(len(baseline["rows"][table]) != 2 for table in TABLES):
        raise AssertionError("Expected two fixed synthetic sentinels per table")


def run_checks(report_path: Path) -> dict:
    env = {key: value for key, value in os.environ.items()
           if key not in {"DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"}}
    name = "tierbrain-cleanup-permissions-" + secrets.token_hex(6)
    container_id = None
    report = {"format": "tierbrain-cleanup-permission-tests-v1", "passed": False,
              "started_at": datetime.now(timezone.utc).isoformat(), "image": IMAGE,
              "source": "Synthetic fixture only; no Supabase or application network requests",
              "tests": [], "cleanup_completed": False}

    def docker(args: list[str], data: str | None = None, expected_failure: str | None = None) -> str:
        result = subprocess.run(DOCKER + args, input=data, text=True, capture_output=True,
                                env=env, timeout=60)
        if expected_failure is not None:
            if result.returncode == 0 or expected_failure not in result.stderr:
                raise AssertionError("Expected guarded failure not observed: " + expected_failure + "\n" + result.stderr)
        elif result.returncode:
            raise AssertionError("Isolated Docker/PostgreSQL operation failed:\n" + result.stderr)
        return result.stdout

    def sql(text: str, expected_failure: str | None = None) -> str:
        return docker(["exec", "-i", name, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1",
                       "-U", "postgres", "-d", "postgres"], text, expected_failure)

    def record(label: str, **details: object) -> None:
        report["tests"].append({"name": label, "passed": True, **details})
        print(label + ": passed", flush=True)

    def audit() -> dict:
        return json.loads(sql(AUDIT_SQL))

    try:
        migrations = sorted((ROOT / "supabase/migrations").glob("*_restrict_cleanup_execution.sql"))
        if len(migrations) != 1:
            raise AssertionError("Expected exactly one cleanup execution migration")
        migration = migrations[0]
        inputs = [FIXTURE, migration, ROLLBACK]
        for path in inputs:
            if not path.is_file():
                raise AssertionError("Required test input missing: " + str(path))
        report["input_sha256"] = {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
                                  for path in inputs}
        migration_sql = migration.read_text()
        rollback_sql = ROLLBACK.read_text()
        docker(["info", "--format", "{{.ServerVersion}}"])
        docker(["image", "inspect", IMAGE])  # Cached image only; never pull.
        with tempfile.TemporaryDirectory(prefix="tierbrain-cleanup-permissions-") as temporary:
            password_file = Path(temporary) / "local-postgres.env"
            password_file.write_text("POSTGRES_PASSWORD=" + secrets.token_urlsafe(36) + "\n")
            password_file.chmod(0o600)
            container_id = docker(["run", "--detach", "--name", name, "--network", "none",
                                   "--memory", "512m", "--label", "codex.task=" + TASK_LABEL,
                                   "--tmpfs", "/var/lib/postgresql/data:rw,nosuid,size=256m",
                                   "--env-file", str(password_file), IMAGE, "postgres",
                                   "-c", "listen_addresses=", "-c", "shared_buffers=32MB",
                                   "-c", "max_connections=20"]).strip()
            deadline = time.monotonic() + 30
            while True:
                # The image's temporary initialization server can answer SQL
                # just before stopping. Require PID 1 to be the final server.
                process = subprocess.run(DOCKER + ["exec", name, "cat", "/proc/1/comm"],
                                         text=True, capture_output=True, env=env, timeout=5)
                ready = None
                if process.returncode == 0 and process.stdout.strip() == "postgres":
                    ready = subprocess.run(DOCKER + ["exec", name, "psql", "-X", "-qAt",
                                            "-v", "ON_ERROR_STOP=1", "-U", "postgres",
                                            "-d", "postgres", "-c", "SELECT 1"],
                                           text=True, capture_output=True, env=env, timeout=5)
                if ready is not None and ready.returncode == 0 and ready.stdout.strip() == "1":
                    break
                if time.monotonic() >= deadline:
                    raise AssertionError("Isolated PostgreSQL did not become ready")
                time.sleep(0.2)
            info = json.loads(docker(["inspect", name]))[0]
            if (info["Id"] != container_id or info["Config"]["Labels"].get("codex.task") != TASK_LABEL
                    or info["HostConfig"]["NetworkMode"] != "none" or info["HostConfig"]["PortBindings"]
                    or sql("SHOW listen_addresses;").strip() != ""):
                raise AssertionError("Isolated container identity or network settings differ")
            report["postgres_version"] = sql("SELECT version();").strip()
            report["network_isolation"] = {"network_mode": "none", "published_ports": [], "tcp_listen_addresses": ""}
            record("isolated local PostgreSQL ready")
            sql("BEGIN;\n" + FIXTURE.read_text() + "\nCOMMIT;")
            baseline = audit()
            assert_baseline(baseline)
            record("fixture matches reviewed normalized definition, exact grants, and passive cron metadata")
            for principal, allowed in [("anon", False), ("authenticated", True)]:
                sql(cleanup_case_sql(principal, allowed))
                assert_unchanged(baseline, audit())
                record("baseline " + principal + (" execution allowed" if allowed else " execution denied"),
                       sqlstate=None if allowed else "42501")
            sql("BEGIN;\n" + migration_sql + "\nCOMMIT;")
            repaired = audit()
            assert_repaired(baseline, repaired)
            record("migration changes only authenticated EXECUTE; all rows, definition, and cron preserved")
            for principal in ["anon", "authenticated"]:
                sql(cleanup_case_sql(principal, False))
                assert_unchanged(repaired, audit())
                record("repaired " + principal + " execution denied with all synthetic rows unchanged", sqlstate="42501")
            for principal in ["postgres", "service_role"]:
                sql(cleanup_case_sql(principal, True))
                assert_unchanged(repaired, audit())
                record("repaired " + principal + " deletes only events older than six hours",
                       deleted_per_table=1, preserved=["exact six-hour boundary", "fresh events", "scores", "legends"],
                       transaction_rolled_back=True)
            sql("BEGIN;\n" + rollback_sql + "\nCOMMIT;")
            assert_unchanged(baseline, audit())
            sql(cleanup_case_sql("authenticated", True))
            assert_unchanged(baseline, audit())
            record("rollback restores exact baseline ACL and authenticated execution")

            changed_body = baseline["function"]["definition"].replace("interval '6 hours'", "interval '5 hours'")
            guard_cases = [
                ("changed function body", changed_body + ";", "Cleanup definition changed since review"),
                ("unexpected anon grant", "GRANT EXECUTE ON FUNCTION public.cleanup_old_events() TO anon;",
                 "Cleanup execution grants changed since review"),
                ("unexpected PUBLIC grant", "GRANT EXECUTE ON FUNCTION public.cleanup_old_events() TO PUBLIC;",
                 "Cleanup execution grants changed since review"),
                ("changed cron execution role", "UPDATE cron.job SET username='authenticated' WHERE jobname='tierbrain-cleanup';",
                 "Cleanup schedule changed since review"),
                ("cron command missing SELECT whitespace", "UPDATE cron.job SET command='selectpublic.cleanup_old_events()' WHERE jobname='tierbrain-cleanup';",
                 "Cleanup schedule changed since review"),
                ("cron command with internal semicolon", "UPDATE cron.job SET command='select public.cleanup_old_events(;)' WHERE jobname='tierbrain-cleanup';",
                 "Cleanup schedule changed since review"),
                ("inherited anon execution", "GRANT service_role TO anon;", "Unexpected effective cleanup privileges"),
            ]
            for label, modification, message in guard_cases:
                sql("BEGIN;\n" + modification + "\n" + migration_sql + "\nCOMMIT;", message)
                assert_unchanged(baseline, audit())
                record("migration guard aborts atomically: " + label)

            # Rollback must also reject drift before restoring the privilege.
            sql("BEGIN;\n" + migration_sql + "\nCOMMIT;")
            assert_unchanged(repaired, audit())
            for label, modification, message in guard_cases[:-1]:
                sql("BEGIN;\n" + modification + "\n" + rollback_sql + "\nCOMMIT;", message)
                assert_unchanged(repaired, audit())
                record("rollback guard aborts atomically: " + label)
            sql("BEGIN;\n" + rollback_sql + "\nCOMMIT;")
            assert_unchanged(baseline, audit())
            record("final rollback restores baseline after all guard probes")
            report["passed"] = True
    except Exception as error:
        report["error"] = str(error)
    finally:
        if container_id:
            try:
                info = json.loads(docker(["inspect", name]))[0]
                if info["Id"] != container_id or info["Config"]["Labels"].get("codex.task") != TASK_LABEL:
                    raise AssertionError("Refusing to remove a container without this test's identity/label")
                docker(["rm", "--force", "--volumes", container_id])
                report["cleanup_completed"] = True
            except Exception as error:
                report["passed"] = False
                report["cleanup_error"] = str(error)
        else:
            report["cleanup_completed"] = True
        report["finished_at"] = datetime.now(timezone.utc).isoformat()
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(report, indent=2) + "\n")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, default=Path("/tmp/tierbrain-cleanup-permission-tests.json"))
    args = parser.parse_args()
    report = run_checks(args.report.resolve())
    print(json.dumps({"passed": report["passed"], "checks": len(report["tests"]),
                      "cleanup_completed": report["cleanup_completed"], "report": str(args.report.resolve())}))
    if not report["passed"]:
        print(report.get("error", report.get("cleanup_error", "Unknown test failure")))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
