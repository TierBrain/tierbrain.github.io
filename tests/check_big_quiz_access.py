#!/usr/bin/env python3
"""Isolated Big Quiz authorization and cross-edition SQL acceptance.

Applies the three deployed migrations before the new Big Quiz migration in a
fresh cached PostgreSQL 17 container with networking disabled. Identities and
rows are synthetic; the auth.uid() shim is driver-controlled, so this does not
replace real GoTrue/PostgREST or browser acceptance.
"""

from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import time
from uuid import uuid4

from check_show_access import DOCKER, IMAGE, LEGACY_AUDIT_SQL, PRIVATE_TABLES, literal, table_rows_sql, value_sql


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests/fixtures/big_quiz_auth_baseline.sql"
CASES = ROOT / "tests/fixtures/big_quiz_access_cases.sql"
ROLLBACK = ROOT / "supabase/rollback/secure_big_quiz_rooms.sql"
HISTORY = [ROOT / "supabase/migrations" / name for name in (
    "20261020180854_score_game_contracts.sql",
    "20261020221724_restrict_cleanup_execution.sql",
    "20261021062330_secure_show_rooms.sql",
)]
OPERATIONS = ("create_room", "host_resume", "begin_run", "host_publish", "host_members",
              "host_answers", "host_buzzes", "close_submissions", "award", "preview",
              "join", "my_membership", "heartbeat", "leave", "player_state", "answer", "buzz")
RPC_NAMES = {prefix + operation for prefix in ("show_", "bigquiz_") for operation in OPERATIONS}
TASK_LABEL = "tierbrain-big-quiz-access-tests"


def edition_audit_sql(schema: str) -> str:
    """Include definitions/privileges as well as every row, not just counts."""
    prefix = "show_" if schema == "show_private" else "bigquiz_"
    return """SELECT jsonb_build_object(
      'rows',%s,
      'schema',(SELECT jsonb_build_object('owner',pg_get_userbyid(nspowner),'acl',nspacl::text)
        FROM pg_namespace WHERE nspname=%s),
      'relations',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),
        'acl',c.relacl::text,'rls',c.relrowsecurity,'forced',c.relforcerowsecurity,
        'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,
          'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,
          'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
          FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
          WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
        'constraints',(SELECT jsonb_agg(pg_get_constraintdef(oid) ORDER BY conname)
          FROM pg_constraint WHERE conrelid=c.oid),
        'indexes',(SELECT jsonb_agg(pg_get_indexdef(indexrelid) ORDER BY indexrelid)
          FROM pg_index WHERE indrelid=c.oid),
        'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid=c.oid))
        ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=%s AND c.relkind IN ('r','S','v','m','f','p')),
      'functions',(SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,
        'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text)
        ORDER BY n.nspname,p.proname,p.oid::regprocedure::text)
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname=%s OR (n.nspname='public' AND left(p.proname,%d)=%s)),
      'defaults',(SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.oid),'[]'::jsonb)
        FROM pg_default_acl d)
    );""" % (table_rows_sql(schema, PRIVATE_TABLES), literal(schema), literal(schema),
             literal(schema), len(prefix), literal(prefix))


def run_checks(report_path: Path) -> dict:
    env = {key: value for key, value in os.environ.items()
           if key not in {"DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"}}
    name = "tierbrain-big-quiz-access-" + secrets.token_hex(6)
    container_id = None
    report = {"format": "tierbrain-big-quiz-access-tests-v1", "passed": False,
              "started_at": datetime.now(timezone.utc).isoformat(), "image": IMAGE,
              "limits": ["Driver-set synthetic auth.uid(); no JWT validation",
                         "No live database, Auth, HTTP gateway, browser or external network"],
              "tests": [], "cleanup_completed": False}
    actors: dict[str, str] = {}

    def docker(arguments: list[str], data: str | None = None) -> str:
        result = subprocess.run(DOCKER + arguments, input=data, text=True, capture_output=True,
                                env=env, timeout=60)
        if result.returncode:
            raise AssertionError("Isolated PostgreSQL operation failed:\n" + result.stderr)
        return result.stdout

    def sql(statement: str) -> str:
        return docker(["exec", "-i", name, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1",
                       "-U", "postgres", "-d", "postgres"], statement).strip()

    def context(actor: str | None, statement: str, role: str = "authenticated") -> str:
        if role not in {"anon", "authenticated", "service_role"}:
            raise ValueError("Unexpected test principal")
        return sql("BEGIN; SET LOCAL ROLE " + role + "; SET LOCAL request.jwt.claim.sub="
                   + literal(actors[actor] if actor is not None else "") + ";\n" + statement + "\nCOMMIT;")

    def expression(operation: str, arguments: dict, prefix: str = "bigquiz_") -> str:
        function = prefix + operation
        if function not in RPC_NAMES or any(not key.startswith("p_") or not key.replace("_", "").isalnum()
                                           for key in arguments):
            raise ValueError("Unexpected RPC or argument")
        return "public." + function + "(" + ",".join(key + "=>" + value_sql(value)
                                                     for key, value in arguments.items()) + ")"

    def rpc(actor: str, operation: str, prefix: str = "bigquiz_", **arguments: object) -> object:
        report["last_case"] = actor + " " + prefix + operation
        return json.loads(context(actor, "SELECT " + expression(operation, arguments, prefix) + ";") or "null")

    def rows() -> dict:
        return json.loads(sql("SELECT " + table_rows_sql("bigquiz_private", PRIVATE_TABLES) + ";"))

    def record(label: str, condition: bool = True) -> None:
        report["last_case"] = label
        if not condition:
            raise AssertionError(label)
        report["tests"].append({"name": label, "passed": True})
        print(label + ": passed", flush=True)

    def deny_raw(label: str, actor: str | None, statement: str, state: str = "42501",
                 role: str = "authenticated") -> None:
        report["last_case"] = label
        before = rows()
        block = """DO $denied$ DECLARE observed text; BEGIN
          BEGIN EXECUTE %s;
          EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS observed=RETURNED_SQLSTATE; END;
          IF observed IS DISTINCT FROM %s THEN
            RAISE EXCEPTION 'Expected SQLSTATE %s, observed %%',observed;
          END IF;
        END $denied$;""" % (literal(statement), literal(state), state)
        context(actor, block, role)
        record(label, rows() == before)

    def deny(label: str, actor: str | None, operation: str, state: str = "42501",
             role: str = "authenticated", prefix: str = "bigquiz_", **arguments: object) -> None:
        deny_raw(label, actor, "SELECT " + expression(operation, arguments, prefix), state, role)

    try:
        migrations = sorted((ROOT / "supabase/migrations").glob("*_secure_big_quiz_rooms.sql"))
        if len(migrations) != 1:
            raise AssertionError("Expected exactly one Big Quiz migration")
        migration = migrations[0]
        paths = [FIXTURE, CASES, *HISTORY, migration, ROLLBACK]
        report["input_sha256"] = {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
                                  for path in paths}
        docker(["info", "--format", "{{.ServerVersion}}"])
        docker(["image", "inspect", IMAGE])  # Cached only; never pull.
        with tempfile.TemporaryDirectory(prefix="tierbrain-big-quiz-access-") as temporary:
            password_file = Path(temporary) / "postgres.env"
            password_file.write_text("POSTGRES_PASSWORD=" + secrets.token_urlsafe(36) + "\n")
            password_file.chmod(0o600)
            container_id = docker(["run", "--detach", "--name", name, "--network", "none", "--memory", "512m",
                                   "--label", "codex.task=" + TASK_LABEL,
                                   "--tmpfs", "/var/lib/postgresql/data:rw,nosuid,size=256m",
                                   "--env-file", str(password_file), IMAGE, "postgres", "-c", "listen_addresses=",
                                   "-c", "shared_buffers=32MB", "-c", "max_connections=20"]).strip()
            until = time.monotonic() + 30
            while True:
                process = subprocess.run(DOCKER + ["exec", name, "cat", "/proc/1/comm"],
                                         text=True, capture_output=True, env=env, timeout=5)
                if process.returncode == 0 and process.stdout.strip() == "postgres":
                    ready = subprocess.run(DOCKER + ["exec", name, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1",
                                            "-U", "postgres", "-c", "SELECT 1"],
                                           text=True, capture_output=True, env=env, timeout=5)
                    if ready.returncode == 0 and ready.stdout.strip() == "1":
                        break
                if time.monotonic() >= until:
                    raise AssertionError("PostgreSQL did not become ready")
                time.sleep(0.2)
            info = json.loads(docker(["inspect", name]))[0]
            record("local container has no networking, TCP listener or published ports",
                   info["Id"] == container_id and info["Config"]["Labels"].get("codex.task") == TASK_LABEL
                   and info["HostConfig"]["NetworkMode"] == "none" and not info["HostConfig"]["PortBindings"]
                   and sql("SHOW listen_addresses;") == "")
            report["postgres_version"] = sql("SELECT version();")
            sql("BEGIN;\n" + FIXTURE.read_text() + "\n" + CASES.read_text() + "\nCOMMIT;")
            actors.update(json.loads(sql("SELECT jsonb_object_agg(actor,subject) FROM bigquiz_test.contexts;")))
            actors.update({"S": str(uuid4()), "SP": str(uuid4()), "B": str(uuid4())})
            templates = json.loads(sql("SELECT jsonb_object_agg(name,state) FROM bigquiz_test.states;"))
            for historical in HISTORY:
                sql("BEGIN;\n" + historical.read_text() + "\nCOMMIT;")
            record("all three deployed migrations apply sequentially to their guarded synthetic baseline")
            legacy = json.loads(sql(LEGACY_AUDIT_SQL))

            # Seed the already secured edition through its APIs. The before/after
            # audit below proves the new edition leaves its data and API intact.
            show = rpc("S", "create_room", prefix="show_", p_request_id=str(uuid4()))
            show_member = rpc("SP", "join", prefix="show_", p_code=show["code"], p_name="Show player", p_tag="youth")
            show = rpc("S", "begin_run", prefix="show_", p_code=show["code"], p_expected_version=0, p_request_id=str(uuid4()))
            bible_before = json.loads(sql(edition_audit_sql("show_private")))
            old_defaults = deepcopy(bible_before["defaults"])
            sql("BEGIN;\n" + migration.read_text() + "\nCOMMIT;")
            # New schema-specific defaults are expected; existing defaults must
            # remain byte-for-byte unchanged rather than auditing the whole list.
            new_schema_oid = json.loads(sql("SELECT to_jsonb(oid) FROM pg_namespace WHERE nspname='bigquiz_private'"))

            def unchanged(label: str) -> None:
                current = json.loads(sql(edition_audit_sql("show_private")))
                current["defaults"] = [d for d in current["defaults"]
                                       if d["defaclnamespace"] != new_schema_oid]
                record(label, current == bible_before and json.loads(sql(LEGACY_AUDIT_SQL)) == legacy)

            unchanged("migration leaves legacy and Bible Show rows, schemas, policies, owners, grants and functions unchanged")

            catalog = json.loads(sql("""SELECT jsonb_agg(jsonb_build_object('name',p.proname,'definer',p.prosecdef,
              'settings',p.proconfig,'anon',has_function_privilege('anon',p.oid,'EXECUTE'),
              'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
              'args',p.proargnames) ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND left(p.proname,8)='bigquiz_';"""))
            record("17 bounded authenticated-only SECURITY DEFINER APIs use empty search_path",
                   len(catalog) == 17 and {f["name"] for f in catalog} == {"bigquiz_" + x for x in OPERATIONS}
                   and all(f["definer"] and f["settings"] == ['search_path=""'] and not f["anon"]
                           and f["authenticated"] for f in catalog))
            args = {f["name"]: f["args"] for f in catalog}
            record("player APIs accept no caller-nominated identity, team, timestamp or score",
                   args["bigquiz_answer"] == ["p_code", "p_question_key", "p_choice"]
                   and args["bigquiz_buzz"] == ["p_code", "p_question_key"]
                   and args["bigquiz_join"] == ["p_code", "p_name", "p_tag"])
            deny("publishable key alone cannot create a room", "H", "create_room", role="anon", p_request_id=str(uuid4()))
            deny("authenticated role without verified subject cannot create a room", None, "create_room", p_request_id=str(uuid4()))
            for role in ("anon", "authenticated"):
                for table in PRIVATE_TABLES:
                    update = "code=code" if table == "rooms" else "operation=operation" if table == "requests" else "points=points" if table == "awards" else "id=id"
                    for statement in ("SELECT * FROM bigquiz_private." + table,
                                      "INSERT INTO bigquiz_private." + table + " DEFAULT VALUES",
                                      "UPDATE bigquiz_private." + table + " SET " + update,
                                      "DELETE FROM bigquiz_private." + table):
                        deny_raw(role + " cannot " + statement.split()[0] + " private " + table, "P1", statement, role=role)
                deny_raw(role + " cannot call private helpers", "P1", "SELECT bigquiz_private.uid()", role=role)
            record("all seven backing tables retain RLS with zero client policies",
                   sql("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='bigquiz_private' AND relkind='r' AND relrowsecurity") == "7"
                   and sql("SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='bigquiz_private'") == "0")

            record("Big Quiz cannot preview a Bible Show-only code", rpc("H", "preview", p_code=show["code"]) is None)
            request = str(uuid4())
            room = rpc("H", "create_room", p_request_id=request)
            code, expiry = room["code"], room["expires_at"]
            record("Big Quiz creates only team-labelled default state without Bible metadata",
                   room["state"] == {"teams": {"youth": "Team A", "adult": "Team B"}}
                   and room["version"] == 0 and room["run_id"] is None)
            before = rows()
            record("create acknowledgement replay does not create another room", rpc("H", "create_room", p_request_id=request) == room and rows() == before)
            record("Bible Show cannot preview a Big Quiz-only code", rpc("S", "preview", prefix="show_", p_code=code) is None)
            # Force the collision that independent random code namespaces may
            # eventually produce. The RPC edition, not the code, selects data.
            sql("UPDATE show_private.rooms SET code=" + literal(code) + " WHERE id=" + literal(show["id"]) + "::uuid;")
            show["code"] = code
            bible_before = json.loads(sql(edition_audit_sql("show_private")))
            bible_before["defaults"] = old_defaults
            deny("Big Quiz host cannot claim Bible Show sharing the same code", "H", "host_resume", prefix="show_", p_code=code)
            deny("Bible Show host cannot claim Big Quiz sharing the same code", "S", "host_resume", p_code=code)
            record("colliding codes keep edition-specific preview state separate",
                   set(rpc("O", "preview", p_code=code)["state"]) == {"teams"}
                   and rpc("O", "preview", prefix="show_", p_code=code)["state"]["bible"] == "KJV")
            deny("Bible-only member cannot read colliding Big Quiz room", "SP", "player_state", p_code=code)
            deny("Big Quiz-only member cannot read colliding Bible Show room", "P1", "player_state", prefix="show_", p_code=code)
            record("Bible Show membership survives new edition creation", rpc("SP", "my_membership", prefix="show_", p_code=code) == show_member)
            deny("room code alone does not grant host ownership", "O", "host_resume", p_code=code)
            deny("outsider cannot read full room or roster", "O", "player_state", p_code=code)
            deny("outsider cannot read host roster", "O", "host_members", p_code=code)

            p1 = rpc("P1", "join", p_code=code, p_name="Player One", p_tag="youth")
            p2 = rpc("P2", "join", p_code=code, p_name="Player Two", p_tag="adult")
            record("verified player identities receive distinct server-owned memberships", p1["id"] != p2["id"] and p1["score"] == p2["score"] == 0)
            record("reconnect cannot rewrite existing membership identity, name or team", rpc("P1", "join", p_code=code, p_name="Forged", p_tag="adult") == p1)
            record("heartbeat updates only the caller", rpc("P1", "heartbeat", p_code=code)["id"] == p1["id"] and rpc("P2", "my_membership", p_code=code) == p2)
            deny("player cannot claim host after joining", "P1", "host_resume", p_code=code)
            deny("join cannot nominate another member id", "P1", "join", state="42883", p_code=code, p_name="Forged", p_tag="youth", p_member_id=p2["id"])
            deny("join rejects oversized names", "O", "join", state="22023", p_code=code, p_name="X" * 17, p_tag="youth")
            deny("join rejects unknown teams", "O", "join", state="22023", p_code=code, p_name="Valid", p_tag="other")
            room = rpc("H", "begin_run", p_code=code, p_expected_version=0, p_request_id=str(uuid4()))
            run = room["run_id"]
            deny("stale host window cannot start over", "H", "begin_run", state="PT409", p_code=code, p_expected_version=0, p_request_id=str(uuid4()))

            def publish(phase: str, mode: str, ri: int, qi: int, state: dict) -> tuple[dict, dict]:
                nonlocal room
                key = room["run_id"] + ":p" + str(ri) + "q" + str(qi)
                arguments = {"p_code": code, "p_run_id": room["run_id"], "p_expected_version": room["version"],
                             "p_request_id": str(uuid4()), "p_patch": {"phase": phase, "round_type": mode,
                             "round_index": ri, "q_index": qi, "q_id": key, "state": deepcopy(state)}}
                room = rpc("H", "host_publish", **arguments)
                return room, arguments

            def close() -> dict:
                nonlocal room
                result = rpc("H", "close_submissions", p_code=code, p_run_id=room["run_id"], p_question_key=room["q_id"],
                             p_expected_version=room["version"], p_request_id=str(uuid4()))
                room = result["room"]
                return result

            def award(member: dict, points: int) -> dict:
                return rpc("H", "award", p_code=code, p_run_id=room["run_id"], p_question_key=room["q_id"], p_member_id=member["id"], p_points=points)

            rapid = deepcopy(templates["normal"])
            rapid["bible"] = "MUST_NOT_ESCAPE"
            room, publication = publish("question", "rapidfire", 0, 0, rapid)
            first_key = room["q_id"]
            record("active normal state strips correct answer, Bible and arbitrary private fields", "correct" not in room["state"] and "bible" not in room["state"] and "MUST_NOT_ESCAPE" not in json.dumps(room))
            before = rows()
            record("host publish replay returns same version without writing", rpc("H", "host_publish", **publication) == room and rows() == before)
            deny("host request UUID cannot be reused with a different payload", "H", "host_publish", state="22023", **(publication | {"p_patch": publication["p_patch"] | {"phase": "reveal"}}))
            for actor in ("P1", "O"):
                deny(actor + " cannot publish host state", actor, "host_publish", **publication)
                deny(actor + " cannot fetch host answers", actor, "host_answers", p_code=code, p_run_id=run, p_question_key=first_key)
                deny(actor + " cannot fetch host buzzes", actor, "host_buzzes", p_code=code, p_run_id=run, p_question_key=first_key)
            deny("room patch cannot change ownership or scores", "H", "host_publish", state="22023", p_code=code, p_run_id=run, p_expected_version=room["version"], p_request_id=str(uuid4()), p_patch={"host_user_id": actors["O"], "score": 999})
            deny("answer signature cannot nominate a victim player", "P1", "answer", state="42883", p_code=code, p_question_key=first_key, p_choice=2, p_member_id=p2["id"])
            deny("outsider cannot answer using code alone", "O", "answer", p_code=code, p_question_key=first_key, p_choice=2)
            deny("answer index is bounded", "P1", "answer", state="22023", p_code=code, p_question_key=first_key, p_choice=4)
            accepted = rpc("P1", "answer", p_code=code, p_question_key=first_key, p_choice=2)
            before = rows()
            record("answer identity and receipt time are canonical and identical retry is idempotent", accepted["player_id"] == p1["id"] and accepted["tag"] == "youth" and rpc("P1", "answer", p_code=code, p_question_key=first_key, p_choice=2) == accepted and rows() == before)
            deny("conflicting answer retry cannot rewrite choice", "P1", "answer", state="23505", p_code=code, p_question_key=first_key, p_choice=1)
            closed = close()
            record("close freezes accepted answer snapshot before grading", closed["answers"] == [accepted])
            deny("new late answer cannot enter closed snapshot", "P2", "answer", p_code=code, p_question_key=first_key, p_choice=2)
            for points in (9, 16):
                deny("normal award bound " + str(points), "H", "award", state="22023", p_code=code, p_run_id=run, p_question_key=first_key, p_member_id=p1["id"], p_points=points)
            record("normal lower award bound updates only target score", award(p1, 10)["score"] == 10 and rpc("P2", "my_membership", p_code=code)["score"] == 0)
            before = rows()
            record("normal award replay cannot increment score twice", award(p1, 10)["already_awarded"] and rows() == before)
            deny("conflicting award is rejected", "H", "award", state="23505", p_code=code, p_run_id=run, p_question_key=first_key, p_member_id=p1["id"], p_points=11)
            room, _ = publish("reveal", "rapidfire", 0, 0, rapid)
            record("normal reveal exposes correct index only after closure", rpc("P2", "player_state", p_code=code)["state"]["correct"] == 2)
            deny("closed question cannot reopen", "H", "host_publish", state="22023", **(publication | {"p_expected_version": room["version"], "p_request_id": str(uuid4())}))

            gap = deepcopy(templates["normal"])
            gap.update({"qnum": 12, "qtotal": 12, "qkind": "verse-blank", "prompt": "Fill the gap"})
            room, _ = publish("question", "verse", 1, 11, gap)
            gap_key = room["q_id"]
            record("Fill the Gap permits the twelfth question and maps to verse mode", room["q_index"] == 11 and room["state"]["qnum"] == 12)
            rpc("P1", "answer", p_code=code, p_question_key=gap_key, p_choice=2)
            close()
            record("Fill the Gap upper award bound is fifteen", award(p1, 15)["score"] == 25)
            invalid_patch = {"phase": "question", "round_type": "verse", "round_index": 1, "q_index": 12, "q_id": run + ":p1q12", "state": gap}
            deny("question index beyond twelve is rejected", "H", "host_publish", state="22023", p_code=code, p_run_id=run, p_expected_version=room["version"], p_request_id=str(uuid4()), p_patch=invalid_patch)
            deny("advanced old question cannot accept fresh member answers", "P2", "answer", p_code=code, p_question_key=first_key, p_choice=2)

            buzzer = deepcopy(templates["buzzer"])
            room, _ = publish("buzzer", "buzzer", 2, 0, buzzer)
            buzzer_key = room["q_id"]
            deny("armed buzzer does not accept buzzes", "P1", "buzz", p_code=code, p_question_key=buzzer_key)
            buzzer["bz"]["phase"] = "open"
            room, _ = publish("buzzer", "buzzer", 2, 0, buzzer)
            buzz = rpc("P1", "buzz", p_code=code, p_question_key=buzzer_key)
            before = rows()
            record("buzz derives identity and identical retry is idempotent", buzz["player_id"] == p1["id"] and rpc("P1", "buzz", p_code=code, p_question_key=buzzer_key) == buzz and rows() == before)
            invalid = deepcopy(buzzer)
            invalid["bz"]["lanes"]["adult"] = {"st": "answering", "bid": p2["id"], "out": []}
            deny("host cannot select a member who did not buzz", "H", "host_publish", state="22023", p_code=code, p_run_id=run, p_expected_version=room["version"], p_request_id=str(uuid4()), p_patch={"state": invalid})
            invalid["bz"]["lanes"]["adult"]["bid"] = p1["id"]
            deny("host cannot place another team player in the lane", "H", "host_publish", state="22023", p_code=code, p_run_id=run, p_expected_version=room["version"], p_request_id=str(uuid4()), p_patch={"state": invalid})
            buzzer["bz"]["lanes"]["youth"] = {"st": "answering", "bid": p1["id"], "out": []}
            room, _ = publish("buzzer", "buzzer", 2, 0, buzzer)
            deny("unselected player cannot submit buzzer answer", "P2", "answer", p_code=code, p_question_key=buzzer_key, p_choice=2)
            rpc("P1", "answer", p_code=code, p_question_key=buzzer_key, p_choice=2)
            deny("buzzer award requires exactly ten points", "H", "award", state="22023", p_code=code, p_run_id=run, p_question_key=buzzer_key, p_member_id=p1["id"], p_points=11)
            record("buzzer selected player receives fixed ten points", award(p1, 10)["score"] == 35)

            clues = deepcopy(templates["clues"])
            room, _ = publish("fiveclues", "fiveclues", 3, 0, clues)
            clue_key = room["q_id"]
            record("active clue state hides correct index and derives current points", room["state"]["fc"]["correct"] is None and room["state"]["fc"]["pointsNow"] == 5 and "MUST_NOT_ESCAPE" not in json.dumps(room))
            for actor in ("P1", "P2"):
                rpc(actor, "answer", p_code=code, p_question_key=clue_key, p_choice=2)
            record("clue close snapshot contains both accepted members", len(close()["answers"]) == 2)
            for points in (0, 6):
                deny("clue award bound " + str(points), "H", "award", state="22023", p_code=code, p_run_id=run, p_question_key=clue_key, p_member_id=p1["id"], p_points=points)
            record("clue award upper bound is five", award(p1, 5)["score"] == 40)
            rpc("P2", "leave", p_code=code)
            skipped = award(p2, 5)
            record("leaving before grading skips score without freezing host", skipped["skipped_member_left"] and skipped["points"] == 0)
            deny("left member cannot heartbeat", "P2", "heartbeat", p_code=code)
            old_p2 = p2
            p2 = rpc("P2", "join", p_code=code, p_name="Rejoined", p_tag="adult")
            record("rejoin creates fresh membership and preserves history", p2["id"] != old_p2["id"] and p2["score"] == 0 and any(a["member_id"] == old_p2["id"] for a in rows()["answers"]))
            room = rpc("H", "host_publish", p_code=code, p_run_id=run, p_expected_version=room["version"], p_request_id=str(uuid4()), p_patch={"phase": "final", "q_id": "", "state": templates["final"]})
            record("final totals derive from stored scores instead of host summary", room["state"]["fin"]["youth"]["total"] == 40 and room["state"]["fin"]["adult"]["total"] == 0)
            closing = {"teams": {"youth": "Team A", "adult": "Team B"}, "round": "Closing", "close": {"ref": "", "text": "Thanks for playing."}}
            room = rpc("H", "host_publish", p_code=code, p_run_id=run, p_expected_version=room["version"], p_request_id=str(uuid4()), p_patch={"phase": "closing", "q_id": "", "state": closing})
            record("general closing accepts its intentional empty reference", room["state"]["close"] == {"ref": "", "text": "Thanks for playing."})
            room = rpc("H", "begin_run", p_code=code, p_expected_version=room["version"], p_request_id=str(uuid4()))
            record("new run preserves owned roster scores and original fixed expiry", room["run_id"] != run and room["expires_at"] == expiry and rpc("P1", "my_membership", p_code=code)["score"] == 40)
            before = rows()
            record("old publication acknowledgement replay cannot reset new run", rpc("H", "host_publish", **publication)["run_id"] == run and rows() == before)
            deny("old run cannot be freshly republished", "H", "host_publish", state="22023", **(publication | {"p_expected_version": room["version"], "p_request_id": str(uuid4())}))

            # Explicit resource-budget cases use another synthetic room so the
            # real gameplay and cross-edition sentinels remain representative.
            budget = rpc("B", "create_room", p_request_id=str(uuid4()))
            for _ in range(4):
                rpc("B", "create_room", p_request_id=str(uuid4()))
            deny("sixth unexpired room for one identity is rejected", "B", "create_room", state="54000", p_request_id=str(uuid4()))
            budget_id = literal(budget["id"]) + "::uuid"
            sql("INSERT INTO bigquiz_private.members(room_id,user_id,name,tag) SELECT " + budget_id + ",gen_random_uuid(),'Synthetic','youth' FROM generate_series(1,200);")
            deny("active membership cap rejects the 201st member", "O", "join", state="54000", p_code=budget["code"], p_name="Overflow", p_tag="youth")
            sql("UPDATE bigquiz_private.members SET left_at=clock_timestamp() WHERE room_id=" + budget_id + "; INSERT INTO bigquiz_private.members(room_id,user_id,name,tag,left_at) SELECT " + budget_id + ",gen_random_uuid(),'Historical','adult',clock_timestamp() FROM generate_series(1,1800);")
            deny("historical membership budget rejects churn beyond 2000", "O", "join", state="54000", p_code=budget["code"], p_name="Overflow", p_tag="youth")
            sql("INSERT INTO bigquiz_private.requests(user_id,request_id,operation,room_id,payload_hash,response) SELECT " + literal(actors["B"]) + "::uuid,gen_random_uuid(),'synthetic'," + budget_id + ",sha256('synthetic'::bytea),'{}'::jsonb FROM generate_series(1,19999);")
            deny("host operation budget rejects mutation after 20000 recorded operations", "B", "begin_run", state="54000", p_code=budget["code"], p_expected_version=0, p_request_id=str(uuid4()))

            unchanged("all Big Quiz operations preserve Bible Show and legacy rows and access controls")
            sql("UPDATE bigquiz_private.rooms SET expires_at=clock_timestamp()-interval '1 second' WHERE code=" + literal(code) + ";")
            record("expired room preview is unavailable", rpc("O", "preview", p_code=code) is None)
            deny("expired host cannot resume", "H", "host_resume", p_code=code)
            deny("expired member cannot read room", "P1", "player_state", p_code=code)
            deny("expired request replay is blocked", "H", "create_room", p_request_id=request)
            retained = rows()
            sql("BEGIN;\n" + ROLLBACK.read_text() + "\nCOMMIT;")
            record("rollback retains all rooms, members, answers, buzzes, awards and requests", rows() == retained)
            disabled = json.loads(sql("SELECT jsonb_agg(has_function_privilege('authenticated',p.oid,'EXECUTE') OR has_function_privilege('anon',p.oid,'EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND left(p.proname,8)='bigquiz_'"))
            record("rollback disables all 17 Big Quiz APIs", len(disabled) == 17 and not any(disabled))
            deny("rollback blocks Big Quiz creates", "H", "create_room", p_request_id=str(uuid4()))
            record("Big Quiz rollback leaves Bible Show operational", rpc("S", "host_resume", prefix="show_", p_code=code)["id"] == show["id"])
            unchanged("rollback preserves Bible Show API grants and every legacy object")
            report["passed"] = True
    except Exception as error:
        report["error"] = str(error)
    finally:
        if container_id:
            try:
                info = json.loads(docker(["inspect", name]))[0]
                if info["Id"] != container_id or info["Config"]["Labels"].get("codex.task") != TASK_LABEL:
                    raise AssertionError("Refusing to remove unowned container")
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
    parser.add_argument("--report", type=Path, default=Path("/tmp/tierbrain-big-quiz-access-tests.json"))
    args = parser.parse_args()
    report = run_checks(args.report.resolve())
    print(json.dumps({"passed": report["passed"], "checks": len(report["tests"]), "cleanup_completed": report["cleanup_completed"], "report": str(args.report.resolve())}))
    if not report["passed"]:
        print("Failed case: " + report.get("last_case", "setup"))
        print(report.get("error", report.get("cleanup_error", "Unknown failure")))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
