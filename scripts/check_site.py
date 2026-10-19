#!/usr/bin/env python3
"""Read-only checks for the static site; no network or third-party packages."""

from __future__ import annotations

import argparse
from collections import Counter
from html.parser import HTMLParser
import json
from pathlib import Path
import shutil
import subprocess
from urllib.parse import unquote, urljoin, urlsplit
import xml.etree.ElementTree as ET


SITE_ORIGIN = "https://tierbrain.co/"
SITE_HOSTS = {"tierbrain.co", "www.tierbrain.co", "tierbrain.github.io"}
SKIP_DIRS = {".git", ".venv", "venv", "node_modules", "dist", "scripts", "tests"}
JS_TYPES = {"", "text/javascript", "application/javascript", "module"}
JSON_TYPES = {"application/ld+json", "application/json"}


def local_target(root: Path, source: Path, value: str) -> Path | None:
    """Resolve deployed local URLs, including Pages' extensionless HTML routes."""
    value = value.strip()
    if not value or value.startswith("#"):
        return None
    parsed = urlsplit(value)
    if parsed.scheme and parsed.scheme not in {"http", "https"}:
        return None
    if parsed.netloc and parsed.hostname not in SITE_HOSTS:
        return None
    base = SITE_ORIGIN + source.relative_to(root).as_posix()
    path = unquote(urlsplit(urljoin(base, value)).path).lstrip("/")
    target = (root / path).resolve()
    if not target.is_relative_to(root):
        raise ValueError(f"URL escapes site directory: {value}")
    candidates = [target]
    if not target.suffix:
        candidates.extend([target.with_suffix(".html"), target / "index.html"])
    elif target.is_dir():
        candidates.append(target / "index.html")
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return target


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.targets: list[tuple[int, str]] = []
        self.scripts: list[tuple[int, str, str]] = []
        self.current_script = None

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        for key in ("href", "src", "poster"):
            if attrs.get(key):
                self.targets.append((self.getpos()[0], attrs[key]))
        if tag == "script":
            self.current_script = [self.getpos()[0], attrs.get("type", "").lower(), []]

    def handle_data(self, data):
        if self.current_script is not None:
            self.current_script[2].append(data)

    def handle_endtag(self, tag):
        if tag == "script" and self.current_script is not None:
            line, kind, chunks = self.current_script
            self.scripts.append((line, kind, "".join(chunks)))
            self.current_script = None


def validate(root: Path) -> dict:
    root = root.resolve()
    errors = []
    counts = Counter()
    node = shutil.which("node")
    if node is None:
        errors.append("Node.js is required for JavaScript syntax validation")

    def fail(source, line, message):
        where = source.relative_to(root).as_posix()
        errors.append(f"{where}:{line}: {message}")

    def check_target(source, line, value):
        try:
            target = local_target(root, source, value)
            if target is not None:
                counts["local_targets"] += 1
                if not target.is_file():
                    fail(source, line, f"missing local target {value!r}")
        except ValueError as error:
            fail(source, line, str(error))

    def check_js(source, line, body, module=False):
        if not body.strip() or node is None:
            return
        counts["javascript"] += 1
        command = [node, "--check"]
        if module:
            command.append("--input-type=module")
        checked = subprocess.run(command, input=body, text=True, capture_output=True)
        if checked.returncode:
            fail(source, line, "invalid JavaScript\n" + checked.stderr.strip())

    paths = [path for path in root.rglob("*")
             if path.is_file() and not any(part in SKIP_DIRS for part in path.relative_to(root).parts)]
    for source in sorted(paths):
        suffix = source.suffix.lower()
        if suffix == ".html":
            counts["html"] += 1
            parser = PageParser()
            parser.feed(source.read_text(encoding="utf-8"))
            for line, target in parser.targets:
                check_target(source, line, target)
            for line, kind, body in parser.scripts:
                if kind in JS_TYPES:
                    check_js(source, line, body, module=kind == "module")
                elif kind in JSON_TYPES:
                    counts["json_scripts"] += 1
                    try:
                        json.loads(body)
                    except ValueError as error:
                        fail(source, line, f"invalid {kind}: {error}")
        elif suffix in {".js", ".mjs"}:
            check_js(source, 1, source.read_text(encoding="utf-8"), module=suffix == ".mjs")
        elif suffix == ".json":
            counts["json_files"] += 1
            try:
                json.loads(source.read_text(encoding="utf-8"))
            except ValueError as error:
                fail(source, 1, f"invalid JSON: {error}")
        elif source.name.startswith("sitemap") and suffix == ".xml":
            counts["sitemaps"] += 1
            try:
                tree = ET.parse(source)
                if tree.getroot().tag.rsplit("}", 1)[-1] not in {"urlset", "sitemapindex"}:
                    fail(source, 1, "expected sitemap urlset or sitemapindex")
                for element in tree.iter():
                    if element.tag.rsplit("}", 1)[-1] == "loc":
                        check_target(source, 1, element.text or "")
            except ET.ParseError as error:
                fail(source, 1, f"invalid sitemap XML: {error}")

    robots = root / "robots.txt"
    if robots.is_file():
        for line, value in enumerate(robots.read_text().splitlines(), 1):
            if value.lower().startswith("sitemap:"):
                check_target(robots, line, value.partition(":")[2].strip())
    return {"counts": dict(sorted(counts.items())), "errors": errors}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    result = validate(args.root)
    print(json.dumps(result, indent=2))
    return bool(result["errors"])


if __name__ == "__main__":
    raise SystemExit(main())
