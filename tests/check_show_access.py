#!/usr/bin/env python3
"""Explicit isolated SQL acceptance for the secured Show-room RPC protocol.

Runs a pinned, cached PostgreSQL image with no network, TCP listener, or published
ports. All actors, claims, legacy rows and room events are synthetic. The fixture's
auth.uid() shim trusts a driver-set subject: these tests DO NOT establish GoTrue
JWT validation, Auth configuration, PostgREST schema exposure, or browser behavior.
Those require separate full-stack acceptance with real independently issued JWTs.

Run: python3 tests/check_show_access.py --report /private/path/show-access.json
This explicit Docker command is outside automatic unittest/pytest discovery.
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


ROOT = Path(__file__).resolve().parents[1]
IMAGE = "postgres@sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826"
DOCKER = ["docker", "--host=unix:///var/run/docker.sock"]
TASK_LABEL = "tierbrain-show-access-tests"
FIXTURE = ROOT / "tests/fixtures/show_auth_baseline.sql"
CASES = ROOT / "tests/fixtures/show_access_cases.sql"
ROLLBACK = ROOT / "supabase/rollback/secure_show_rooms.sql"
LEGACY_TABLES = ("rooms", "players", "answers", "buzzes", "scores", "legends")
PRIVATE_TABLES = ("rooms", "members", "questions", "answers", "buzzes", "awards", "requests")
RPC_NAMES = ("show_create_room", "show_host_resume", "show_begin_run", "show_host_publish",
             "show_host_members", "show_host_answers", "show_host_buzzes", "show_close_submissions",
             "show_award", "show_preview", "show_join", "show_my_membership", "show_heartbeat",
             "show_leave", "show_player_state", "show_answer", "show_buzz")


def literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def value_sql(value: object) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return str(value).lower()
    if isinstance(value, int):
        return str(value)
    if isinstance(value, (dict, list)):
        return literal(json.dumps(value, separators=(",", ":"))) + "::jsonb"
    return literal(str(value))


def rpc_sql(name: str, arguments: dict) -> str:
    if name not in RPC_NAMES or any(not key.startswith("p_") or not key.replace("_", "").isalnum()
                                    for key in arguments):
        raise ValueError("Unexpected test RPC or argument")
    return "public." + name + "(" + ",".join(key + "=>" + value_sql(value)
                                               for key, value in arguments.items()) + ")"


def table_rows_sql(schema: str, tables: tuple[str, ...]) -> str:
    return "jsonb_build_object(" + ",".join(
        literal(table) + ",(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) "
        "FROM " + schema + "." + table + " t)" for table in tables
    ) + ")"


LEGACY_AUDIT_SQL = """SELECT jsonb_build_object(
 'rows',%s,
 'relations',(SELECT jsonb_agg(jsonb_build_object(
   'name',c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,
   'rls',c.relrowsecurity,'forced',c.relforcerowsecurity,
   'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,
      'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,
      'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
   'constraints',(SELECT jsonb_agg(pg_get_constraintdef(oid) ORDER BY conname)
      FROM pg_constraint WHERE conrelid=c.oid),
   'indexes',(SELECT jsonb_agg(pg_get_indexdef(indexrelid) ORDER BY indexrelid)
      FROM pg_index WHERE indrelid=c.oid),
   'policies',(SELECT jsonb_agg(jsonb_build_object('name',polname,'roles',polroles::text,
      'command',polcmd,'permissive',polpermissive,'using',pg_get_expr(polqual,polrelid),
      'check',pg_get_expr(polwithcheck,polrelid)) ORDER BY polname)
      FROM pg_policy WHERE polrelid=c.oid),
   'triggers',(SELECT jsonb_agg(pg_get_triggerdef(oid) ORDER BY tgname)
      FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal)) ORDER BY c.relname)
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'),
 'public_schema',(SELECT jsonb_build_object('owner',pg_get_userbyid(nspowner),'acl',nspacl::text)
   FROM pg_namespace WHERE nspname='public'),
 'legacy_function',(SELECT jsonb_build_object('definition',pg_get_functiondef(oid),'acl',proacl::text,
   'owner',pg_get_userbyid(proowner)) FROM pg_proc WHERE oid='public.cleanup_old_events()'::regprocedure),
 'auth_shim',(SELECT jsonb_build_object('definition',pg_get_functiondef(oid),'acl',proacl::text)
   FROM pg_proc WHERE oid='auth.uid()'::regprocedure),
 'cron',(SELECT jsonb_agg(to_jsonb(j) ORDER BY jobid) FROM cron.job j),
 'legacy_sequence',(SELECT jsonb_build_object('last_value',last_value,'is_called',is_called)
   FROM public.synthetic_legacy_sequence),
 'memberships',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member),'[]'::jsonb) FROM pg_auth_members m)
);
""" % table_rows_sql("public", LEGACY_TABLES)


def run_checks(report_path: Path) -> dict:
    env = {key: value for key, value in os.environ.items()
           if key not in {"DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"}}
    name = "tierbrain-show-access-" + secrets.token_hex(6)
    container_id = None
    report = {"format": "tierbrain-show-access-tests-v1", "passed": False,
              "started_at": datetime.now(timezone.utc).isoformat(), "image": IMAGE,
              "source": "Synthetic PostgreSQL fixture only; no external requests",
              "limits": ["Driver-set auth.uid() subject; no GoTrue JWT validation",
                         "No HTTP/PostgREST schema or gateway acceptance",
                         "No browser or real Auth/session acceptance"],
              "tests": [], "cleanup_completed": False}
    actors: dict[str, str] = {}

    def docker(args: list[str], data: str | None = None) -> str:
        result = subprocess.run(DOCKER + args, input=data, text=True, capture_output=True,
                                env=env, timeout=60)
        if result.returncode:
            raise AssertionError("Isolated Docker/PostgreSQL operation failed:\n" + result.stderr)
        return result.stdout

    def sql(statement: str) -> str:
        return docker(["exec", "-i", name, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1",
                       "-U", "postgres", "-d", "postgres"], statement).strip()

    def context(actor: str | None, statement: str, role: str = "authenticated") -> str:
        if role not in {"anon", "authenticated", "service_role"}:
            raise ValueError("Unexpected synthetic principal")
        subject = actors[actor] if actor is not None else ""
        return sql("BEGIN; SET LOCAL ROLE " + role + "; SET LOCAL request.jwt.claim.sub="
                   + literal(subject) + ";\n" + statement + "\nCOMMIT;")

    def rpc(actor: str, function: str, **arguments: object) -> object:
        report["last_case"] = actor + " " + function
        return json.loads(context(actor, "SELECT " + rpc_sql(function, arguments) + ";") or "null")

    def private_rows() -> dict:
        return json.loads(sql("SELECT " + table_rows_sql("show_private", PRIVATE_TABLES) + ";"))

    def record(label: str, condition: bool = True, **details: object) -> None:
        report["last_case"] = label
        if not condition:
            raise AssertionError(label)
        report["tests"].append({"name": label, "passed": True, **details})
        print(label + ": passed", flush=True)

    def deny_raw(label: str, actor: str | None, statement: str, state: str = "42501",
                 role: str = "authenticated") -> None:
        report["last_case"] = label
        before = private_rows()
        block = """DO $denied$
DECLARE observed text;
BEGIN
 BEGIN
  EXECUTE %s;
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS observed=RETURNED_SQLSTATE;
 END;
 IF observed IS DISTINCT FROM %s THEN
   RAISE EXCEPTION 'Expected SQLSTATE %s, observed %%',observed;
 END IF;
END $denied$;""" % (literal(statement), literal(state), state)
        context(actor, block, role)
        record(label, private_rows() == before, sqlstate=state, private_rows_unchanged=True)

    def deny(label: str, actor: str | None, function: str, state: str = "42501",
             role: str = "authenticated", **arguments: object) -> None:
        deny_raw(label, actor, "SELECT " + rpc_sql(function, arguments), state, role)

    def check_legacy(label: str, baseline: dict) -> None:
        record(label, json.loads(sql(LEGACY_AUDIT_SQL)) == baseline)

    try:
        migrations = sorted((ROOT / "supabase/migrations").glob("*_secure_show_rooms.sql"))
        if len(migrations) != 1:
            raise AssertionError("Expected exactly one secure Show-room migration")
        migration = migrations[0]
        paths = [FIXTURE, CASES, migration, ROLLBACK]
        for path in paths:
            if not path.is_file():
                raise AssertionError("Required test input missing: " + str(path))
        report["input_sha256"] = {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
                                  for path in paths}
        docker(["info", "--format", "{{.ServerVersion}}"])
        docker(["image", "inspect", IMAGE])  # Cached image only. Never pull.
        with tempfile.TemporaryDirectory(prefix="tierbrain-show-access-") as temporary:
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
                    or sql("SHOW listen_addresses;") != ""):
                raise AssertionError("Isolated container identity or network settings differ")
            report["postgres_version"] = sql("SELECT version();")
            report["network_isolation"] = {"network_mode": "none", "published_ports": [], "tcp_listen_addresses": ""}
            record("isolated local PostgreSQL ready")
            sql("BEGIN;\n" + FIXTURE.read_text() + "\n" + CASES.read_text() + "\nCOMMIT;")
            actors.update(json.loads(sql("SELECT jsonb_object_agg(actor,subject) FROM show_test.contexts;")))
            templates = json.loads(sql("SELECT jsonb_object_agg(name,state) FROM show_test.states;"))
            legacy = json.loads(sql(LEGACY_AUDIT_SQL))
            sql("BEGIN;\n" + migration.read_text() + "\nCOMMIT;")
            check_legacy("migration preserves every legacy fixture row, policy, grant, relation, function, and cron job", legacy)

            catalog = json.loads(sql("""SELECT jsonb_agg(jsonb_build_object(
              'name',p.proname,'definer',p.prosecdef,'settings',p.proconfig,
              'anon',has_function_privilege('anon',p.oid,'EXECUTE'),
              'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
              'arguments',p.proargnames) ORDER BY p.proname)
              FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname LIKE 'show\\_%' ESCAPE '\\';"""))
            record("all 17 public RPCs require authenticated role and fixed empty search_path",
                   len(catalog) == 17 and {f["name"] for f in catalog} == set(RPC_NAMES)
                   and all(f["definer"] and f["settings"] == ['search_path=""']
                           and not f["anon"] and f["authenticated"] for f in catalog))
            args = {f["name"]: f["arguments"] for f in catalog}
            record("player submission signatures cannot nominate another identity, team, score, or timestamp",
                   args["show_answer"] == ["p_code", "p_question_key", "p_choice"]
                   and args["show_buzz"] == ["p_code", "p_question_key"]
                   and args["show_join"] == ["p_code", "p_name", "p_tag"])
            rpc_defaults = {"p_request_id": str(uuid4())}
            deny("publishable-key anon role cannot create a room even with a synthetic subject", "H",
                 "show_create_room", role="anon", **rpc_defaults)
            deny("authenticated role without a trusted subject cannot create a room", None,
                 "show_create_room", **rpc_defaults)

            # Direct-table tests deliberately target new data. Legacy public
            # permissions remain as captured above; actual HTTP routing is separate.
            for role in ["anon", "authenticated"]:
                statements = []
                for table in PRIVATE_TABLES:
                    statements.extend(["SELECT * FROM show_private." + table,
                                       "INSERT INTO show_private." + table + " DEFAULT VALUES",
                                       "UPDATE show_private." + table + " SET "
                                       + ("code=code" if table == "rooms" else
                                          "operation=operation" if table == "requests" else
                                          "points=points" if table == "awards" else "id=id"),
                                       "DELETE FROM show_private." + table])
                for statement in statements:
                    deny_raw(role + " direct table denied: " + statement.split(" ")[0] + " "
                             + statement.split("show_private.")[1].split(" ")[0], "P1", statement, role=role)
                deny_raw(role + " private helper denied", "P1", "SELECT show_private.uid()", role=role)
            hidden = json.loads(sql("""SELECT jsonb_build_object(
              'tables',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname='show_private' AND c.relkind='r' AND c.relrowsecurity),
              'policies',(SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
                JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='show_private'),
              'public_relations',(SELECT array_agg(c.relname ORDER BY c.relname) FROM pg_class c
                JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
                AND c.relkind IN ('r','p','v','m','f','S')));
            """))
            record("private tables retain RLS without client policies and no public relation mirrors are created",
                   hidden["tables"] == 7 and hidden["policies"] == 0
                   and hidden["public_relations"] == sorted(LEGACY_TABLES + ("synthetic_legacy_sequence",)))

            create_request = str(uuid4())
            room = rpc("H", "show_create_room", p_request_id=create_request)
            code = room["code"]
            expiry = room["expires_at"]
            record("host creates a canonical lobby with server-owned identity and fixed expiry",
                   room["version"] == 0 and room["run_id"] is None and room["phase"] == "lobby"
                   and len(code) == 5 and not {"host_user_id", "user_id"}.intersection(room))
            before = private_rows()
            record("create retry returns the same room without another row",
                   rpc("H", "show_create_room", p_request_id=create_request) == room and private_rows() == before)
            preview = rpc("O", "show_preview", p_code=" " + code.lower() + " ")
            record("prejoin preview contains only code, phase, team labels, and Bible version",
                   preview == {"code": code, "phase": "lobby", "state": room["state"]}
                   and set(preview["state"]) == {"teams", "bible"})
            record("unknown preview returns null", rpc("O", "show_preview", p_code="NOT-A-ROOM") is None)
            deny("knowing a code does not grant host ownership", "O", "show_host_resume", p_code=code)
            deny("prejoin outsider cannot read full room state", "O", "show_player_state", p_code=code)
            deny("prejoin outsider cannot read roster", "O", "show_host_members", p_code=code)
            other = rpc("O", "show_create_room", p_request_id=str(uuid4()))
            other_code = other["code"]
            other_member = rpc("O", "show_join", p_code=other_code, p_name="Other room", p_tag="youth")
            deny("one host cannot resume another host room", "H", "show_host_resume", p_code=other_code)

            p1 = rpc("P1", "show_join", p_code=code, p_name="Player One", p_tag="youth")
            p2 = rpc("P2", "show_join", p_code=code, p_name="Player Two", p_tag="adult")
            record("two separate player subjects obtain distinct server-owned memberships",
                   p1["id"] != p2["id"] and p1["score"] == p2["score"] == 0
                   and set(p1) == {"id", "name", "tag", "score", "joined_at", "last_seen"})
            record("reconnect cannot rewrite existing membership name, team, or score",
                   rpc("P1", "show_join", p_code=code, p_name="Replaced", p_tag="adult") == p1
                   and rpc("P1", "show_my_membership", p_code=code) == p1)
            heartbeat = rpc("P1", "show_heartbeat", p_code=code)
            record("heartbeat changes only caller activity", heartbeat["id"] == p1["id"]
                   and heartbeat["last_seen"] >= p1["last_seen"]
                   and rpc("P2", "show_my_membership", p_code=code) == p2)
            deny("member cannot claim host by joining or knowing room code", "P1", "show_host_resume", p_code=code)
            deny_raw("member cannot overwrite another membership or score", "P1",
                     "UPDATE show_private.members SET score=999,name='Forged' WHERE id=" + literal(p2["id"]))
            deny("join cannot accept a caller-chosen member identity", "P1", "show_join", state="42883",
                 p_code=code, p_name="Forged", p_tag="youth", p_member_id=p2["id"])

            begin_request = str(uuid4())
            room = rpc("H", "show_begin_run", p_code=code, p_expected_version=room["version"], p_request_id=begin_request)
            first_run = room["run_id"]
            record("begin run creates a server run UUID and preserves memberships", bool(first_run)
                   and room["version"] == 1 and len(rpc("H", "show_host_members", p_code=code)) == 2)
            deny("host request UUID cannot change payload", "H", "show_begin_run", state="22023",
                 p_code=code, p_expected_version=999, p_request_id=begin_request)
            deny("host request UUID cannot change operation", "H", "show_begin_run", state="22023",
                 p_code=code, p_expected_version=room["version"], p_request_id=create_request)
            deny("stale host version cannot overwrite room", "H", "show_begin_run", state="PT409",
                 p_code=code, p_expected_version=0, p_request_id=str(uuid4()))

            def publish(phase: str, mode: str, round_index: int, question_index: int,
                        state: dict, request_id: str | None = None) -> tuple[dict, dict]:
                nonlocal room
                key = room["run_id"] + ":p" + str(round_index) + "q" + str(question_index)
                patch = {"phase": phase, "round_type": mode, "round_index": round_index,
                         "q_index": question_index, "q_id": key, "state": deepcopy(state)}
                arguments = {"p_code": code, "p_run_id": room["run_id"], "p_patch": patch,
                             "p_expected_version": room["version"], "p_request_id": request_id or str(uuid4())}
                room = rpc("H", "show_host_publish", **arguments)
                return room, arguments

            room, first_publish = publish("question", "rapidfire", 0, 0, templates["normal"])
            first_key = room["q_id"]
            record("active normal question strips correct index and all unapproved state",
                   "correct" not in room["state"] and "MUST_NOT_ESCAPE" not in json.dumps(room)
                   and "full_question" not in room["state"])
            record("active prejoin preview reveals no question, answers, or roster",
                   rpc("O", "show_preview", p_code=code) == {"code": code, "phase": "question",
                                                              "state": {k: room["state"][k] for k in ("teams", "bible")}})
            for actor in ["P1", "O"]:
                deny(actor + " cannot publish host state", actor, "show_host_publish", **first_publish)
                deny(actor + " cannot read host answer list", actor, "show_host_answers",
                     p_code=code, p_run_id=first_run, p_question_key=first_key)
                deny(actor + " cannot read host buzz list", actor, "show_host_buzzes",
                     p_code=code, p_run_id=first_run, p_question_key=first_key)
                deny(actor + " cannot close submissions", actor, "show_close_submissions",
                     p_code=code, p_run_id=first_run, p_question_key=first_key,
                     p_expected_version=room["version"], p_request_id=str(uuid4()))
            deny("host cannot inject host ownership or a score in room patch", "H", "show_host_publish", state="22023",
                 p_code=code, p_run_id=first_run, p_patch={"host_user_id": actors["O"], "score": 999},
                 p_expected_version=room["version"], p_request_id=str(uuid4()))
            deny("outsider cannot submit using code alone", "O", "show_answer",
                 p_code=code, p_question_key=first_key, p_choice=0)
            deny("member cannot submit to a foreign room", "P1", "show_answer",
                 p_code=other_code, p_question_key=first_key, p_choice=0)
            deny("answer API cannot nominate a different player", "P1", "show_answer", state="42883",
                 p_code=code, p_question_key=first_key, p_choice=0, p_member_id=p2["id"])
            deny("invalid answer index is rejected", "P1", "show_answer", state="22023",
                 p_code=code, p_question_key=first_key, p_choice=4)
            answer = rpc("P1", "show_answer", p_code=code, p_question_key=first_key, p_choice=0)
            record("normal answer derives canonical member, team, and server timestamp",
                   answer["player_id"] == p1["id"] and answer["tag"] == "youth" and answer["choice"] == 0)
            before = private_rows()
            record("identical answer retry preserves first acknowledgement and event count",
                   rpc("P1", "show_answer", p_code=code, p_question_key=first_key, p_choice=0) == answer
                   and private_rows() == before)
            deny("conflicting answer retry cannot overwrite first choice", "P1", "show_answer", state="23505",
                 p_code=code, p_question_key=first_key, p_choice=1)
            deny("normal question cannot accept buzzes", "P1", "show_buzz", p_code=code, p_question_key=first_key)
            record("players cannot see other answers through room state",
                   "answers" not in rpc("P2", "show_player_state", p_code=code))
            close_args = {"p_code": code, "p_run_id": first_run, "p_question_key": first_key,
                          "p_expected_version": room["version"], "p_request_id": str(uuid4())}
            closed = rpc("H", "show_close_submissions", **close_args)
            room = closed["room"]
            record("close submissions freezes the accepted answer snapshot", closed["answers"] == [answer])
            before = private_rows()
            record("close request replay is stable and cannot change room or snapshot",
                   rpc("H", "show_close_submissions", **close_args) == closed and private_rows() == before)
            deny("new late answer cannot enter a frozen snapshot", "P2", "show_answer",
                 p_code=code, p_question_key=first_key, p_choice=1)
            record("accepted own answer still acknowledges after closure",
                   rpc("P1", "show_answer", p_code=code, p_question_key=first_key, p_choice=0) == answer)
            deny("closed question cannot become accepting again", "H", "show_host_publish", state="22023",
                 p_code=code, p_run_id=first_run, p_patch=first_publish["p_patch"],
                 p_expected_version=room["version"], p_request_id=str(uuid4()))
            for actor, member in [("P1", p1), ("O", p1)]:
                deny(actor + " cannot grant points", actor, "show_award", p_code=code,
                     p_run_id=first_run, p_question_key=first_key, p_member_id=member["id"], p_points=10)
            deny("foreign-room award target is rejected", "H", "show_award", p_code=code,
                 p_run_id=first_run, p_question_key=first_key, p_member_id=other_member["id"], p_points=10)
            for points in [9, 16]:
                deny("normal award bound rejected: " + str(points), "H", "show_award", state="22023",
                     p_code=code, p_run_id=first_run, p_question_key=first_key, p_member_id=p1["id"], p_points=points)
            award_args = {"p_code": code, "p_run_id": first_run, "p_question_key": first_key,
                          "p_member_id": p1["id"], "p_points": 10}
            award = rpc("H", "show_award", **award_args)
            record("normal lower-bound award increments only the target score", award["score"] == 10
                   and not award["already_awarded"] and rpc("P2", "show_my_membership", p_code=code)["score"] == 0)
            before = private_rows()
            repeat = rpc("H", "show_award", **award_args)
            record("award replay is idempotent", repeat["already_awarded"] and repeat["score"] == 10
                   and private_rows() == before)
            deny("conflicting award cannot increment again", "H", "show_award", state="23505",
                 **(award_args | {"p_points": 11}))
            revealed = deepcopy(templates["normal"])
            room, _ = publish("reveal", "rapidfire", 0, 0, revealed)
            record("normal correct index appears only in reveal", room["state"]["correct"] == 2)

            room, second_publish = publish("question", "rapidfire", 0, 1, templates["normal"])
            second_key = room["q_id"]
            record("old accepted answer may acknowledge after question advancement",
                   rpc("P1", "show_answer", p_code=code, p_question_key=first_key, p_choice=0) == answer)
            deny("fresh answer cannot target an advanced old question", "P2", "show_answer",
                 p_code=code, p_question_key=first_key, p_choice=1)
            deny("host cannot republish an old question", "H", "show_host_publish", state="22023",
                 p_code=code, p_run_id=first_run, p_patch=first_publish["p_patch"],
                 p_expected_version=room["version"], p_request_id=str(uuid4()))
            for actor in ["P1", "P2"]:
                rpc(actor, "show_answer", p_code=code, p_question_key=second_key, p_choice=1)
            close2 = rpc("H", "show_close_submissions", p_code=code, p_run_id=first_run,
                         p_question_key=second_key, p_expected_version=room["version"], p_request_id=str(uuid4()))
            room = close2["room"]
            record("later close snapshot contains both canonical members", len(close2["answers"]) == 2)
            upper = rpc("H", "show_award", p_code=code, p_run_id=first_run,
                        p_question_key=second_key, p_member_id=p1["id"], p_points=15)
            record("normal upper-bound award is accepted atomically", upper["score"] == 25)
            record("leave acknowledges without deleting historical membership",
                   rpc("P2", "show_leave", p_code=code) == {"left": True}
                   and rpc("P2", "show_my_membership", p_code=code) is None)
            skipped = rpc("H", "show_award", p_code=code, p_run_id=first_run,
                          p_question_key=second_key, p_member_id=p2["id"], p_points=15)
            record("leave-before-grading skips score and ledger without freezing host", skipped.get("skipped_member_left")
                   and skipped["points"] == 0 and skipped["score"] == 0
                   and not any(a["member_id"] == p2["id"] for a in private_rows()["awards"]))
            deny("left membership cannot heartbeat or submit", "P2", "show_heartbeat", p_code=code)
            old_p2 = p2
            p2 = rpc("P2", "show_join", p_code=code, p_name="P2 Rejoined", p_tag="adult")
            record("rejoin creates a new zero-score membership while preserving old events",
                   p2["id"] != old_p2["id"] and p2["score"] == 0
                   and any(a["member_id"] == old_p2["id"] for a in private_rows()["answers"]))
            room = rpc("H", "show_begin_run", p_code=code, p_expected_version=room["version"], p_request_id=str(uuid4()))
            record("new run preserves active identities, scores, and original expiry",
                   room["run_id"] != first_run and room["expires_at"] == expiry
                   and rpc("P1", "show_my_membership", p_code=code)["score"] == 25)
            before = private_rows()
            record("committed old host request replay cannot reset current run",
                   rpc("H", "show_host_publish", **first_publish)["run_id"] == first_run
                   and private_rows() == before)
            deny("fresh host publication cannot replay an old run", "H", "show_host_publish", state="22023",
                 **(first_publish | {"p_expected_version": room["version"], "p_request_id": str(uuid4())}))
            deny("host cannot read prior-run answers through current-run endpoint", "H", "show_host_answers",
                 p_code=code, p_run_id=first_run, p_question_key=first_key)
            deny("rejoined member cannot add a fresh old-run answer", "P2", "show_answer",
                 p_code=code, p_question_key=first_key, p_choice=1)
            record("committed old award replay remains idempotent after new run",
                   rpc("H", "show_award", **award_args)["already_awarded"])

            buzzer = deepcopy(templates["buzzer"])
            room, _ = publish("buzzer", "buzzer", 2, 0, buzzer)
            buzzer_key = room["q_id"]
            deny("armed buzzer does not accept buzzes", "P1", "show_buzz", p_code=code, p_question_key=buzzer_key)
            buzzer["bz"]["phase"] = "open"
            room, _ = publish("buzzer", "buzzer", 2, 0, buzzer)
            record("active buzzer omits correct index and untrusted identities", room["state"]["bz"]["correct"] is None)
            buzz1 = rpc("P1", "show_buzz", p_code=code, p_question_key=buzzer_key)
            before = private_rows()
            record("buzzer derives own identity and identical retry creates no event",
                   buzz1["player_id"] == p1["id"] and buzz1["tag"] == "youth"
                   and rpc("P1", "show_buzz", p_code=code, p_question_key=buzzer_key) == buzz1 and private_rows() == before)
            invalid = deepcopy(buzzer)
            invalid["bz"]["lanes"]["adult"] = {"st": "answering", "bid": p2["id"], "out": []}
            deny("host cannot select a member who has not buzzed", "H", "show_host_publish", state="22023",
                 p_code=code, p_run_id=room["run_id"], p_patch={"state": invalid},
                 p_expected_version=room["version"], p_request_id=str(uuid4()))
            buzz2 = rpc("P2", "show_buzz", p_code=code, p_question_key=buzzer_key)
            record("other team buzz is canonical", buzz2["player_id"] == p2["id"] and buzz2["tag"] == "adult")
            invalid = deepcopy(buzzer)
            invalid["bz"]["lanes"]["youth"] = {"st": "answering", "bid": p2["id"], "out": []}
            deny("host cannot put another team member into a buzzer lane", "H", "show_host_publish", state="22023",
                 p_code=code, p_run_id=room["run_id"], p_patch={"state": invalid},
                 p_expected_version=room["version"], p_request_id=str(uuid4()))
            invalid["bz"]["lanes"]["youth"]["bid"] = other_member["id"]
            deny("host cannot select a foreign-room buzzer member", "H", "show_host_publish", state="22023",
                 p_code=code, p_run_id=room["run_id"], p_patch={"state": invalid},
                 p_expected_version=room["version"], p_request_id=str(uuid4()))
            buzzer["bz"]["lanes"]["youth"] = {"st": "answering", "bid": p1["id"], "out": []}
            room, _ = publish("buzzer", "buzzer", 2, 0, buzzer)
            deny("unselected member cannot answer through another team lane", "P2", "show_answer",
                 p_code=code, p_question_key=buzzer_key, p_choice=1)
            buzz_answer = rpc("P1", "show_answer", p_code=code, p_question_key=buzzer_key, p_choice=2)
            record("selected buzzer member can submit", buzz_answer["player_id"] == p1["id"])
            buzzer["bz"]["lanes"]["adult"] = {"st": "answering", "bid": p2["id"], "out": []}
            room, _ = publish("buzzer", "buzzer", 2, 0, buzzer)
            rpc("P2", "show_answer", p_code=code, p_question_key=buzzer_key, p_choice=1)
            deny("buzzer award cannot exceed fixed ten points", "H", "show_award", state="22023",
                 p_code=code, p_run_id=room["run_id"], p_question_key=buzzer_key, p_member_id=p1["id"], p_points=11)
            record("buzzer ten-point award succeeds", rpc("H", "show_award", p_code=code,
                   p_run_id=room["run_id"], p_question_key=buzzer_key, p_member_id=p1["id"], p_points=10)["score"] == 35)
            # O remains a foreign host but may join A as an ordinary member.
            observer = rpc("O", "show_join", p_code=code, p_name="Late member", p_tag="youth")
            record("midgame join has no host authority and starts at zero", observer["score"] == 0)
            buzzer["bz"]["lanes"]["youth"] = {"st": "open", "bid": None, "out": [p1["id"]]}
            room, _ = publish("buzzer", "buzzer", 2, 0, buzzer)
            rpc("O", "show_buzz", p_code=code, p_question_key=buzzer_key)
            buzzer["bz"]["lanes"]["youth"] = {"st": "answering", "bid": observer["id"], "out": [p1["id"]]}
            room, _ = publish("buzzer", "buzzer", 2, 0, buzzer)
            rpc("O", "show_answer", p_code=code, p_question_key=buzzer_key, p_choice=0)
            deny("second buzzer winner for one team cannot receive points", "H", "show_award", state="23505",
                 p_code=code, p_run_id=room["run_id"], p_question_key=buzzer_key,
                 p_member_id=observer["id"], p_points=10)
            deny("joining still cannot claim host", "O", "show_host_members", p_code=code)

            clues = deepcopy(templates["clues"])
            invalid = deepcopy(clues)
            invalid["fc"]["clues"].append("Unrevealed synthetic clue")
            next_key = room["run_id"] + ":p3q0"
            deny("clue state cannot publish an unrevealed suffix", "H", "show_host_publish", state="22023",
                 p_code=code, p_run_id=room["run_id"], p_patch={"phase": "fiveclues", "round_type": "fiveclues",
                 "round_index": 3, "q_index": 0, "q_id": next_key, "state": invalid},
                 p_expected_version=room["version"], p_request_id=str(uuid4()))
            room, _ = publish("fiveclues", "fiveclues", 3, 0, clues)
            clue_key = room["q_id"]
            record("active clue state derives points and conceals correct answer and unknown fields",
                   room["state"]["fc"]["correct"] is None and room["state"]["fc"]["pointsNow"] == 5
                   and "MUST_NOT_ESCAPE" not in json.dumps(room))
            for actor in ["P1", "P2"]:
                rpc(actor, "show_answer", p_code=code, p_question_key=clue_key, p_choice=2)
            clue_closed = rpc("H", "show_close_submissions", p_code=code, p_run_id=room["run_id"],
                              p_question_key=clue_key, p_expected_version=room["version"], p_request_id=str(uuid4()))
            room = clue_closed["room"]
            record("clue close freezes both answers", len(clue_closed["answers"]) == 2)
            deny("new late clue answer cannot enter the frozen snapshot", "O", "show_answer",
                 p_code=code, p_question_key=clue_key, p_choice=2)
            for points in [0, 6]:
                deny("clue award bound rejected: " + str(points), "H", "show_award", state="22023",
                     p_code=code, p_run_id=room["run_id"], p_question_key=clue_key, p_member_id=p1["id"], p_points=points)
            lower = rpc("H", "show_award", p_code=code, p_run_id=room["run_id"], p_question_key=clue_key,
                        p_member_id=p1["id"], p_points=1)
            upper = rpc("H", "show_award", p_code=code, p_run_id=room["run_id"], p_question_key=clue_key,
                        p_member_id=p2["id"], p_points=5)
            record("clue lower and upper award bounds update separate scores", lower["score"] == 36 and upper["score"] == 5)
            clues["fc"]["phase"] = "reveal"
            room, _ = publish("fiveclues", "fiveclues", 3, 0, clues)
            record("clue correct index is visible in reveal only", rpc("P2", "show_player_state", p_code=code)["state"]["fc"]["correct"] == 2)
            room = rpc("H", "show_host_publish", p_code=code, p_run_id=room["run_id"],
                       p_patch={"phase": "final", "q_id": "", "state": templates["final"]},
                       p_expected_version=room["version"], p_request_id=str(uuid4()))
            record("final totals derive from stored scores instead of proposed summary",
                   room["state"]["fin"]["youth"]["total"] == 36 and room["state"]["fin"]["adult"]["total"] == 5
                   and room["state"]["fin"]["teamWin"] == "youth")
            roster = rpc("H", "show_host_members", p_code=code)
            record("host roster returns canonical public member fields without auth identities",
                   len(roster) == 3 and all(set(m) == {"id", "name", "tag", "score", "joined_at", "last_seen"} for m in roster)
                   and old_p2["id"] not in {m["id"] for m in roster})
            record("heartbeat and all runs preserve the original fixed expiry",
                   rpc("H", "show_host_resume", p_code=code)["expires_at"] == expiry)
            check_legacy("all protocol operations leave every legacy fixture unchanged", legacy)

            # Advance only this synthetic room's expiry, without waiting or
            # invoking any production maintenance/retention function.
            sql("UPDATE show_private.rooms SET expires_at=clock_timestamp()-interval '1 second' WHERE code=" + literal(code) + ";")
            record("expired preview returns null while another room remains available",
                   rpc("O", "show_preview", p_code=code) is None
                   and rpc("O", "show_host_resume", p_code=other_code)["code"] == other_code)
            expiry_calls = [
                ("H", "show_create_room", {"p_request_id": create_request}),
                ("H", "show_host_resume", {"p_code": code}),
                ("H", "show_host_members", {"p_code": code}),
                ("H", "show_host_answers", {"p_code": code, "p_run_id": room["run_id"], "p_question_key": clue_key}),
                ("H", "show_host_buzzes", {"p_code": code, "p_run_id": room["run_id"], "p_question_key": buzzer_key}),
                ("H", "show_begin_run", {"p_code": code, "p_expected_version": room["version"], "p_request_id": str(uuid4())}),
                ("H", "show_host_publish", first_publish | {"p_request_id": str(uuid4())}),
                ("H", "show_close_submissions", {"p_code": code, "p_run_id": room["run_id"],
                  "p_question_key": clue_key, "p_expected_version": room["version"], "p_request_id": str(uuid4())}),
                ("P1", "show_join", {"p_code": code, "p_name": "Expired", "p_tag": "youth"}),
                ("P1", "show_my_membership", {"p_code": code}),
                ("P1", "show_player_state", {"p_code": code}),
                ("P1", "show_heartbeat", {"p_code": code}),
                ("P1", "show_leave", {"p_code": code}),
                ("P1", "show_answer", {"p_code": code, "p_question_key": clue_key, "p_choice": 2}),
                ("P1", "show_buzz", {"p_code": code, "p_question_key": buzzer_key}),
                ("H", "show_award", award_args),
            ]
            for actor, function, arguments in expiry_calls:
                deny("expiry blocks " + actor + " " + function + " including retries", actor, function, **arguments)
            retained = private_rows()
            record("expiry denies access without deleting room or historical data",
                   any(r["code"] == code for r in retained["rooms"]) and len(retained["answers"]) >= 7)
            sql("BEGIN;\n" + ROLLBACK.read_text() + "\nCOMMIT;")
            record("rollback retains every private room, member, event, award, and request", private_rows() == retained)
            disabled = json.loads(sql("""SELECT jsonb_agg(jsonb_build_object('name',p.proname,
              'anon',has_function_privilege('anon',p.oid,'EXECUTE'),
              'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE')) ORDER BY p.proname)
              FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname LIKE 'show\\_%' ESCAPE '\\';"""))
            record("rollback disables all 17 RPCs for both client roles", len(disabled) == 17
                   and all(not f["anon"] and not f["authenticated"] for f in disabled))
            for role in ["anon", "authenticated"]:
                deny("rollback prevents new rooms for " + role, "H", "show_create_room", role=role, p_request_id=str(uuid4()))
                deny("rollback prevents live-room preview for " + role, "O", "show_preview", role=role, p_code=other_code)
                deny_raw("rollback keeps direct private tables denied for " + role, "P1", "SELECT * FROM show_private.rooms", role=role)
            check_legacy("rollback preserves all legacy fixture rows and metadata", legacy)
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
    parser.add_argument("--report", type=Path, default=Path("/tmp/tierbrain-show-access-tests.json"))
    args = parser.parse_args()
    report = run_checks(args.report.resolve())
    print(json.dumps({"passed": report["passed"], "checks": len(report["tests"]),
                      "cleanup_completed": report["cleanup_completed"], "report": str(args.report.resolve())}))
    if not report["passed"]:
        print("Failed case: " + report.get("last_case", "setup"))
        print(report.get("error", report.get("cleanup_error", "Unknown test failure")))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
