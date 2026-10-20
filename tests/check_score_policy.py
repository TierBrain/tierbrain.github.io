#!/usr/bin/env python3
"""Explicit offline acceptance check for the score-contract migration.

Runs only against a new, task-labelled PostgreSQL container with no network and
no published ports. It never reads production rows, keys or connection settings.
Requires the pinned image to be cached; this script never pulls an image.

Run manually: python3 tests/check_score_policy.py --report /private/path/report.json
This is deliberately outside automatic unittest/pytest discovery: Docker is
required when this command is invoked explicitly, including its separate CI step.
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
FIXTURE = ROOT / "tests/fixtures/scores_baseline.sql"
MIGRATION = ROOT / "supabase/migrations/20261020171656_score_game_contracts.sql"
ROLLBACK = ROOT / "supabase/rollback/score_game_contracts.sql"
DOCKER = ["docker", "--host=unix:///var/run/docker.sock"]
TASK_LABEL = "tierbrain-score-policy-tests"


def literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def row(**values: object) -> dict:
    return {"quiz_id": "ordinary_quiz", "group_code": "SYNTHETIC",
            "name": "Synthetic rider", "correct": 10, "level": 2,
            "time_left": 120, **values}


def case(label: str, allowed: bool = True, sqlstate: str = "42501", **values: object) -> dict:
    return {"name": label, "allowed": allowed, "sqlstate": sqlstate, "row": row(**values)}


def regression_cases(allowed: bool) -> list[dict]:
    """Nine source-derived regressions, all synthetic and previously rejected."""
    return [
        case("piece-by-piece immediate correct", allowed, quiz_id="qc_piecebypiece", group_code="flags", correct=92, level=1),
        case("piece-by-piece zero correct", allowed, quiz_id="qc_piecebypiece", group_code="flags", correct=0, level=0),
        case("jigsaw Classic", allowed, quiz_id="qc_jigsaw", group_code="global", correct=24, level=2),
        case("jigsaw Tricky", allowed, quiz_id="qc_jigsaw", group_code="global", correct=35, level=3),
        case("jigsaw Master", allowed, quiz_id="qc_jigsaw", group_code="global", correct=48, level=4),
        case("brain-coaster streak five", allowed, quiz_id="qc_braincoaster", group_code="global", correct=5, level=5, time_left=0),
        case("brain-coaster streak twenty-one", allowed, quiz_id="qc_braincoaster", group_code="global", correct=21, level=21, time_left=0),
        case("piece-by-piece 24-character group", allowed, quiz_id="qc_piecebypiece", group_code="flags~" + "A" * 24, correct=8, level=1),
        case("jigsaw 24-character group", allowed, quiz_id="qc_jigsaw", group_code="global~" + "A" * 24, correct=12, level=1),
    ]


def allowed_cases() -> list[dict]:
    cases = regression_cases(True)
    cases += [
        case("ordinary lower bounds", quiz_id="Q", group_code="G", name="N", correct=0, level=1, time_left=-2147483648),
        case("ordinary upper bounds unchanged", quiz_id="Q" * 48, group_code="G" * 24, name="N" * 20, correct=20, level=4, time_left=2147483647),
        case("piece-by-piece unbounded successful rounds", quiz_id="qc_piecebypiece", group_code="objects~" + "A" * 24, correct=3000000, level=10000),
        case("piece-by-piece minimum points", quiz_id="qc_piecebypiece", group_code="animals", correct=8, level=1, time_left=0),
        case("piece-by-piece maximum points per answer", quiz_id="qc_piecebypiece", group_code="sports", correct=36800, level=100),
        case("piece-by-piece bigint arithmetic near integer limit", quiz_id="qc_piecebypiece", group_code="flags", correct=2147483647, level=10000000),
        case("jigsaw zero elapsed allowed", quiz_id="qc_jigsaw", group_code="global", correct=12, level=1, time_left=0),
        case("jigsaw integer elapsed upper bound", quiz_id="qc_jigsaw", group_code="global", correct=48, level=4, time_left=2147483647),
    ]
    for deck in ["flags", "planets", "animals", "objects", "sports"]:
        cases.append(case("piece-by-piece deck " + deck, quiz_id="qc_piecebypiece", group_code=deck, correct=92, level=1))
    for level, pieces in [(1, 12), (2, 24), (3, 35), (4, 48)]:
        cases.append(case("jigsaw exact tier pair " + str(level), quiz_id="qc_jigsaw", group_code="global~" + "A" * 24, correct=pieces, level=level))
    for suffix in ["", "_general", "_science", "_history", "_geo", "_sport", "_screen"]:
        cases.append(case("brain-coaster cumulative 170 " + (suffix or "mixed/finale"), quiz_id="qc_braincoaster" + suffix, group_code="global", correct=170, level=170, time_left=0))
    cases.append(case("brain-coaster maximum group code", quiz_id="qc_braincoaster", group_code="A" * 24, correct=5, level=1, time_left=0))
    return cases


def denied_cases() -> list[dict]:
    cases = []
    def deny(label: str, **values: object) -> None:
        cases.append(case(label, False, **values))
    for label, values in [
        ("ordinary too many correct", {"correct": 21}),
        ("ordinary negative correct", {"correct": -1}),
        ("ordinary zero level", {"level": 0}),
        ("ordinary high level", {"level": 5}),
        ("ordinary enlarged group not globally allowed", {"group_code": "G" * 25}),
        ("empty nickname", {"name": ""}),
        ("long nickname", {"name": "N" * 21}),
        ("empty quiz ID", {"quiz_id": ""}),
        ("long quiz ID", {"quiz_id": "Q" * 49}),
        ("empty ordinary group", {"group_code": ""}),
    ]:
        deny(label, **values)
    pbp = {"quiz_id": "qc_piecebypiece", "group_code": "flags", "correct": 92, "level": 1}
    for label, values in [
        ("negative points", {"correct": -1}),
        ("negative correct count", {"level": -1}),
        ("below points-per-answer minimum", {"correct": 7}),
        ("above points-per-answer maximum", {"correct": 369}),
        ("points with zero correct count", {"level": 0}),
        ("zero points with positive correct count", {"correct": 0}),
        ("negative elapsed", {"time_left": -1}),
        ("unknown deck", {"group_code": "unknown"}),
        ("lowercase shared group", {"group_code": "flags~abc"}),
        ("empty shared group suffix", {"group_code": "flags~"}),
        ("too-long shared group", {"group_code": "objects~" + "A" * 25}),
        ("punctuation in shared group", {"group_code": "objects~A.B"}),
        ("bigint comparison rejects impossible large count", {"correct": 2147483647, "level": 2147483647}),
    ]:
        deny("piece-by-piece " + label, **(pbp | values))
    jigsaw = {"quiz_id": "qc_jigsaw", "group_code": "global", "correct": 24, "level": 2}
    for label, values in [
        ("mismatched tier/pieces", {"correct": 12}),
        ("invalid piece count", {"correct": 25}),
        ("zero pieces", {"correct": 0}),
        ("invalid tier", {"level": 5}),
        ("negative elapsed", {"time_left": -1}),
        ("wrong public scope", {"group_code": "flags"}),
        ("too-long group", {"group_code": "global~" + "A" * 25}),
        ("lowercase group", {"group_code": "global~abc"}),
    ]:
        deny("jigsaw " + label, **(jigsaw | values))
    coaster = {"quiz_id": "qc_braincoaster", "group_code": "global", "correct": 21, "level": 21, "time_left": 0}
    for label, values in [
        ("zero hills", {"correct": 0, "level": 0}),
        ("negative hills", {"correct": -1}),
        ("above bank maximum", {"correct": 171}),
        ("zero best streak", {"level": 0}),
        ("streak exceeds hills", {"level": 22}),
        ("nonzero elapsed", {"time_left": 1}),
        ("negative elapsed", {"time_left": -1}),
        ("empty group", {"group_code": ""}),
        ("lowercase custom group", {"group_code": "group"}),
        ("prefixed group", {"group_code": "global~GROUP"}),
        ("too-long group", {"group_code": "A" * 25}),
        ("unknown suffix does not get expanded bounds", {"quiz_id": "qc_braincoaster_unknown"}),
    ]:
        deny("brain-coaster " + label, **(coaster | values))
    for label, values, code in [
        ("integer points overflow", {"correct": "2147483648"}, "22003"),
        ("integer level overflow", {"level": "2147483648"}, "22003"),
        ("integer time overflow", {"time_left": "2147483648"}, "22003"),
        ("noninteger points", {"correct": "1.5"}, "22P02"),
        ("null points rejected by RLS before constraints", {"correct": None}, "42501"),
        ("null nickname rejected by RLS before constraints", {"name": None}, "42501"),
    ]:
        cases.append(case(label, False, code, **values))
    return cases


def case_sql(cases: list[dict], principal: str = "anon") -> str:
    assert principal in {"anon", "authenticated"}
    payload = json.dumps(cases, ensure_ascii=True)
    assert "$score_cases$" not in payload
    return """BEGIN;
SET LOCAL ROLE %s;
DO $check$
DECLARE c jsonb; observed_state text; accepted integer := 0; denied integer := 0;
BEGIN
  FOR c IN SELECT value FROM jsonb_array_elements($score_cases$%s$score_cases$::jsonb) LOOP
    BEGIN
      INSERT INTO public.scores(quiz_id,group_code,name,correct,level,time_left)
      VALUES(c->'row'->>'quiz_id', c->'row'->>'group_code', c->'row'->>'name',
             (c->'row'->>'correct')::integer, (c->'row'->>'level')::integer,
             (c->'row'->>'time_left')::integer);
      IF NOT (c->>'allowed')::boolean THEN
        RAISE EXCEPTION 'Unexpected accepted case: %%', c->>'name';
      END IF;
      accepted := accepted + 1;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS observed_state = RETURNED_SQLSTATE;
      IF (c->>'allowed')::boolean OR observed_state <> c->>'sqlstate' THEN
        RAISE EXCEPTION 'Case %%: unexpected SQLSTATE %% (expected allowed=%%, SQLSTATE=%%)',
          c->>'name', observed_state, c->>'allowed', c->>'sqlstate';
      END IF;
      denied := denied + 1;
    END;
  END LOOP;
  RAISE NOTICE 'Cases passed: accepted=%% denied=%%', accepted, denied;
END
$check$;
ROLLBACK;
""" % (principal, payload)


AUDIT_SQL = """SELECT jsonb_build_object(
 'rows', (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.scores s),
 'table', (SELECT jsonb_build_object('owner',pg_get_userbyid(relowner),'acl',relacl::text,
             'rls',relrowsecurity,'forced',relforcerowsecurity)
           FROM pg_class WHERE oid='public.scores'::regclass),
 'columns', (SELECT jsonb_agg(jsonb_build_object('name',attname,'type',format_type(atttypid,atttypmod),
             'not_null',attnotnull,'identity',attidentity) ORDER BY attnum)
             FROM pg_attribute WHERE attrelid='public.scores'::regclass AND attnum>0 AND NOT attisdropped),
 'policies', (SELECT jsonb_agg(jsonb_build_object('name',polname,'command',polcmd,
             'permissive',polpermissive,'roles',polroles::text,
             'using',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid)) ORDER BY polname)
             FROM pg_policy WHERE polrelid='public.scores'::regclass),
 'schema_acl', (SELECT nspacl::text FROM pg_namespace WHERE nspname='public'),
 'sequence_acl', (SELECT relacl::text FROM pg_class WHERE oid='public.scores_id_seq'::regclass),
 'constraints', (SELECT jsonb_agg(pg_get_constraintdef(oid) ORDER BY conname) FROM pg_constraint WHERE conrelid='public.scores'::regclass),
 'indexes', (SELECT jsonb_agg(pg_get_indexdef(indexrelid) ORDER BY indexrelid) FROM pg_index WHERE indrelid='public.scores'::regclass)
);
"""


def run_checks(report_path: Path) -> dict:
    env = {key: value for key, value in os.environ.items()
           if key not in {"DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"}}
    name = "tierbrain-score-rls-" + secrets.token_hex(6)
    container_id = None
    report = {"format": "tierbrain-score-policy-tests-v1", "passed": False,
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
    def assert_unchanged(expected: dict, observed: dict, changed_insert_check: bool = False) -> None:
        expected = json.loads(json.dumps(expected))
        observed = json.loads(json.dumps(observed))
        if changed_insert_check:
            for value in [expected, observed]:
                next(p for p in value["policies"] if p["name"] == "add scores")["check"] = "<expected policy change>"
        if expected != observed:
            raise AssertionError("Migration changed unexpected seed/schema/policy/grant metadata")
    try:
        for path in [FIXTURE, MIGRATION, ROLLBACK]:
            if not path.is_file():
                raise AssertionError("Required test input missing: " + str(path))
        report["input_sha256"] = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
                                   for p in [FIXTURE, MIGRATION, ROLLBACK]}
        docker(["info", "--format", "{{.ServerVersion}}"])
        docker(["image", "inspect", IMAGE])  # Cached image only; never pull.
        with tempfile.TemporaryDirectory(prefix="tierbrain-score-rls-") as temporary:
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
                ready = subprocess.run(DOCKER + ["exec", name, "pg_isready", "-U", "postgres"],
                                       text=True, capture_output=True, env=env, timeout=5)
                if ready.returncode == 0:
                    break
                if time.monotonic() >= deadline:
                    raise AssertionError("Isolated PostgreSQL did not become ready")
                time.sleep(0.2)
            info = json.loads(docker(["inspect", name]))[0]
            assert info["Id"] == container_id
            assert info["Config"]["Labels"]["codex.task"] == TASK_LABEL
            assert info["HostConfig"]["NetworkMode"] == "none"
            assert not info["HostConfig"]["PortBindings"]
            assert sql("SHOW listen_addresses;").strip() == ""
            report["postgres_version"] = sql("SELECT version();").strip()
            report["network_isolation"] = {"network_mode": "none", "published_ports": [], "tcp_listen_addresses": ""}
            record("isolated local PostgreSQL ready")
            sql("BEGIN;\n" + FIXTURE.read_text() + "\nCOMMIT;")
            sql("""INSERT INTO public.scores(quiz_id,group_code,name,correct,level,time_left,created_at) VALUES
              ('ordinary_quiz','SYNTHETIC','Synthetic ordinary',7,2,10,'2026-01-01T00:00:00Z'),
              ('qc_piecebypiece','flags','Synthetic legacy',7,1,10,'2026-01-01T00:00:00Z'),
              ('qc_jigsaw','global','Synthetic legacy',20,1,10,'2026-01-01T00:00:00Z');""")
            baseline = audit()
            assert len(baseline["rows"]) == 3
            sql(case_sql(regression_cases(False)))
            record("baseline rejects all nine source regressions", cases=9)
            auth_case = [case("authenticated insert remains denied", False)]
            sql(case_sql(auth_case, "authenticated"))
            record("baseline authenticated insert denied", cases=1)
            sql("BEGIN;\n" + MIGRATION.read_text() + "\nCOMMIT;")
            repaired = audit()
            assert_unchanged(baseline, repaired, changed_insert_check=True)
            assert next(p for p in baseline["policies"] if p["name"] == "add scores")["check"] != next(p for p in repaired["policies"] if p["name"] == "add scores")["check"]
            record("migration changes only intended INSERT predicate and preserves three synthetic legacy rows")
            allowed = allowed_cases()
            denied = denied_cases()
            sql(case_sql(allowed + denied))
            assert_unchanged(repaired, audit())
            record("repaired anon INSERT acceptance and rejection matrix", accepted=len(allowed), denied=len(denied),
                   cases=[{"name": c["name"], "expected": "accept" if c["allowed"] else c["sqlstate"]} for c in allowed + denied])
            sql(case_sql(auth_case, "authenticated"))
            for principal, expected_rows in [("anon", 3), ("authenticated", 0)]:
                sql("""BEGIN; SET LOCAL ROLE %s;
DO $check$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM public.scores;
 IF n <> %d THEN RAISE EXCEPTION 'Unexpected SELECT visibility'; END IF;
 UPDATE public.scores SET name='Unexpected mutation';
 GET DIAGNOSTICS n = ROW_COUNT;
 IF n <> 0 THEN RAISE EXCEPTION 'UPDATE was unexpectedly allowed'; END IF;
 DELETE FROM public.scores;
 GET DIAGNOSTICS n = ROW_COUNT;
 IF n <> 0 THEN RAISE EXCEPTION 'DELETE was unexpectedly allowed'; END IF;
END $check$; ROLLBACK;""" % (principal, expected_rows))
            assert_unchanged(repaired, audit())
            record("anon SELECT preserved; authenticated still denied; both roles cannot UPDATE or DELETE")
            sql("BEGIN;\n" + ROLLBACK.read_text() + "\nCOMMIT;")
            assert_unchanged(baseline, audit())
            sql(case_sql(regression_cases(False)))
            record("rollback restores exact baseline and rejects all nine regressions again", cases=9)
            for label, modification, message in [
                ("changed validation predicate", 'ALTER POLICY "add scores" ON public.scores WITH CHECK (true);', "Score validation changed since review"),
                ("extra INSERT policy", 'CREATE POLICY unexpected_write ON public.scores FOR INSERT TO anon WITH CHECK (true);', "Additional score write policies exist"),
                ("extra ALL policy", 'CREATE POLICY unexpected_all ON public.scores FOR ALL TO anon USING (true) WITH CHECK (true);', "Additional score write policies exist"),
                ("changed policy role", 'ALTER POLICY "add scores" ON public.scores TO authenticated;', "Unexpected score INSERT policy scope"),
                ("disabled RLS", 'ALTER TABLE public.scores DISABLE ROW LEVEL SECURITY;', "scores RLS must already be enabled"),
            ]:
                sql("BEGIN;\n" + modification + "\n" + MIGRATION.read_text() + "\nCOMMIT;", message)
                assert_unchanged(baseline, audit())
                record("preflight aborts and rolls back: " + label)
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
    parser.add_argument("--report", type=Path, default=Path("/tmp/tierbrain-score-policy-tests.json"))
    args = parser.parse_args()
    report = run_checks(args.report.resolve())
    print(json.dumps({"passed": report["passed"], "checks": len(report["tests"]),
                      "cleanup_completed": report["cleanup_completed"], "report": str(args.report.resolve())}))
    if not report["passed"]:
        print(report.get("error", report.get("cleanup_error", "Unknown test failure")))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
