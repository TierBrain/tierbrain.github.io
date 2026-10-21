#!/usr/bin/env python3
"""Offline preparation only: writes disposable secrets and copies current Show SQL."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument("--migration", type=Path, required=True)
parser.add_argument("--driver-image", default="node@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392",
                    help="Inspected official Node 22 image, pinned as name@sha256:digest")
args = parser.parse_args()
if not re.fullmatch(r"[A-Za-z0-9._/:\-]+@sha256:[a-f0-9]{64}", args.driver_image):
    parser.error("--driver-image must be a digest-pinned image reference")
env_path = ROOT / ".env"
if env_path.exists():
    parser.error(".env already exists; remove it only after disposing the old stack")
payload = args.migration.read_bytes()
data = {
    "DB_PASSWORD": secrets.token_hex(24),
    "AUTH_DB_PASSWORD": secrets.token_hex(24),
    "REST_DB_PASSWORD": secrets.token_hex(24),
    "JWT_SECRET": secrets.token_hex(48),
    "TEST_DRIVER_IMAGE": args.driver_image,
}
fd = os.open(env_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w") as stream:
    stream.write("".join(f"{key}={value}\n" for key, value in data.items()))
(ROOT / "show-migration.sql").write_bytes(payload)
(ROOT / "prepared-input.json").write_text(json.dumps({
    "migration_source": str(args.migration.resolve()),
    "migration_sha256": hashlib.sha256(payload).hexdigest(),
    "driver_image": args.driver_image,
    "postgres_image": "postgres:17.11@sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826",
    "gotrue_image": "supabase/gotrue:v2.187.0@sha256:8b0b3f68d9a8667e183b481ff74f5d72eedc1e8b70f6bde2aab1e5d79d16df62",
    "postgrest_image": "postgrest/postgrest:v14.5@sha256:b574528fe109c8343c1247155734d03df8c34b462f342dca0ccc20244fc36ef9",
}, indent=2) + "\n")
print("Prepared disposable local inputs; secret values were not printed.")
