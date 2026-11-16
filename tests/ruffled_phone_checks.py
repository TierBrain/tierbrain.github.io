#!/usr/bin/env python3
"""End-to-end Ruffled Feathers phone play: one TV page and several phones, in real
browsers, against the real ruffled_private SQL in a throwaway local PostgreSQL.

A small local bridge stands in for Supabase's HTTP layer: it serves the site, swaps
vendor/supabase.js for a stub whose rpc() posts here, and runs each call as the
`authenticated` role with that browser's synthetic guest ID as auth.uid(). Nothing
leaves the machine; real GoTrue/PostgREST remain separate checks.

Usage (as a non-root user): python3 tests/ruffled_phone_checks.py --local-pgbin /usr/lib/postgresql/16/bin
"""
from __future__ import annotations

import argparse
import functools
import http.server
import json
import os
from pathlib import Path
import re
import socketserver
import threading
import time

from check_ruffled_access import Database, FIXTURE, MIGRATION, literal

ROOT = Path(__file__).resolve().parents[1]
STUB = r"""
window.supabase = { createClient(url, key, opts) {
  const k = opts.auth.storageKey;
  const id = () => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
  return {
    auth: {
      async getSession(){ return { data: { session: id() ? { user: { id: id() } } : null }, error: null }; },
      async signInAnonymously(){ localStorage.setItem(k, crypto.randomUUID()); return { data: {}, error: null }; },
      async getUser(){ return { data: { user: { id: id() } }, error: null }; }
    },
    async rpc(name, args){
      const r = await fetch('/rpc/' + name, { method: 'POST', headers: { 'content-type': 'application/json', 'x-actor': id() }, body: JSON.stringify(args) });
      const body = await r.json();
      return r.ok ? { data: body, error: null, status: 200 } : { data: null, error: body, status: r.status };
    }
  };
} };
"""


def serve(db: Database):
    lock = threading.Lock()

    class Handler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            if self.path.split('?')[0] == '/vendor/supabase.js':
                body = STUB.encode()
                self.send_response(200); self.send_header('content-type', 'text/javascript'); self.send_header('content-length', str(len(body))); self.end_headers(); self.wfile.write(body)
                return
            super().do_GET()

        def do_POST(self):
            m = re.fullmatch(r'/rpc/(ruffled_[a-z_]+)', self.path)
            actor = self.headers.get('x-actor', '')
            args = json.loads(self.rfile.read(int(self.headers['content-length'])) or b'{}')
            if not m or not re.fullmatch(r'[0-9a-f-]{36}', actor):
                return self.reply(400, {'message': 'bad request'})
            parts = []
            for k, v in args.items():
                if not re.fullmatch(r'p_[a-z_]+', k):
                    return self.reply(400, {'message': 'bad argument'})
                if v is None:
                    val = 'NULL'
                elif isinstance(v, bool):
                    val = 'true' if v else 'false'
                elif isinstance(v, int):
                    val = str(v)
                elif isinstance(v, (dict, list)):
                    val = literal(json.dumps(v)) + '::jsonb'
                else:
                    val = literal(str(v))
                parts.append('%s => %s' % (k, val))
            sql = ("BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub=" + literal(actor) + ";\n\\set VERBOSITY verbose\n"
                   "SELECT public.%s(%s);\nCOMMIT;" % (m.group(1), ', '.join(parts)))
            result = db.run(sql)
            if result.returncode:
                text = result.stderr
                hit = re.search(r'ERROR:\s+([0-9A-Z]{5}):\s+(.*)', text)
                return self.reply(400, {'code': hit.group(1) if hit else '', 'message': hit.group(2) if hit else text})
            out = result.stdout.strip()
            self.reply(200, json.loads(out) if out else None)

        def reply(self, status, body):
            data = json.dumps(body).encode()
            self.send_response(status); self.send_header('content-type', 'application/json'); self.send_header('content-length', str(len(data))); self.end_headers(); self.wfile.write(data)

    class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
        daemon_threads = True
    server = Server(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def run(pgbin, shots=None):
    from playwright.sync_api import sync_playwright
    results = []

    def ok(label, cond=True, **info):
        if not cond:
            raise AssertionError(label + ' ' + json.dumps(info, default=str))
        results.append(label); print(label + ': passed', flush=True)

    with Database(pgbin) as db:
        db.sql(FIXTURE.read_text()); db.sql(MIGRATION.read_text(), single=True)
        server = serve(db)
        base = 'http://127.0.0.1:%d' % server.server_address[1]
        with sync_playwright() as p:
            browser = p.chromium.launch()
            errors = []

            def page(w, h, mobile=False):
                ctx = browser.new_context(viewport={'width': w, 'height': h}, is_mobile=mobile, has_touch=mobile, reduced_motion='reduce')
                ctx.route('**/*', lambda r: r.continue_() if r.request.url.startswith(base) else r.abort())
                pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
                return pg

            tv = page(1920, 1080)
            tv.goto(base + '/ruffled-feathers.html'); tv.evaluate('window.__noConfirm = true')
            tv.click('#playMode [data-v="phones"]')
            tv.wait_for_function("/^[A-Z2-9]{5}$/.test(document.getElementById('roomCode').textContent.trim())", timeout=15000)
            code = tv.text_content('#roomCode').strip()
            link = tv.get_attribute('#joinUrl', 'href')
            ok('the TV opens a room with a code and join link', bool(re.fullmatch(r'[A-Z2-9]{5}', code)) and link.endswith('/ruffled-play.html?c=' + code))
            ok('the local player list is hidden in phones mode', tv.locator('#localBox').is_hidden() and tv.locator('#lobbyBox').is_visible())
            names = ['Priya', 'Sam', 'Ruth']
            phones = []
            for n in names:
                ph = page(390, 844, mobile=True)
                ph.goto(link)
                ok('the phone page fills in the code from the link (' + n + ')', ph.input_value('#code') == code)
                ph.fill('#name', n); ph.click('#joinBtn')
                ph.wait_for_selector('#vWait:not([hidden])')
                phones.append(ph)
            ok('each phone says it is in', all(('in, ' + n) in ph.text_content('#waitHead') for ph, n in zip(phones, names)))
            dup = page(390, 844, mobile=True); dup.goto(link); dup.fill('#name', 'priya'); dup.click('#joinBtn')
            dup.wait_for_function("document.getElementById('joinErr').textContent.length > 0")
            ok('a name already in the room is refused on the phone', 'taken' in dup.text_content('#joinErr'))
            tv.wait_for_function("document.querySelectorAll('#netList .prow').length === 3", timeout=10000)
            ok('the TV lists the three players with their colours', tv.locator('#netList .prow:not(.watch) svg').count() == 3)
            if shots:
                tv.screenshot(path=shots + '/tv-lobby.jpg', type='jpeg', quality=85); phones[0].screenshot(path=shots + '/phone-joined.jpg', type='jpeg', quality=85)
            tv.click('#beginBtn')
            tv.wait_for_selector('#order:not([hidden]) #boutBtn')
            for ph in phones:
                ph.wait_for_selector('#vTable:not([hidden])', timeout=5000)
            ok('starting the game shows the Pecking Order on every phone')

            by_id = {}
            for ph, n in zip(phones, names):
                by_id[ph.evaluate('__rp.ME.id')] = (ph, n)

            def play_bout(kind):
                tv.click('#boutBtn')
                tv.wait_for_function("window.__rf.B && window.__rf.B.sid", timeout=8000)
                bout = tv.evaluate("({a: __rf.T.players[__rf.B.bt.a].id, b: __rf.T.players[__rf.B.bt.b].id, correct: __rf.B.opts.indexOf(__rf.B.q.correct)})")
                pa, pb = by_id[bout['a']][0], by_id[bout['b']][0]
                watcher = [ph for ph in phones if ph not in (pa, pb)][0]
                for ph in (pa, pb):
                    ph.wait_for_selector('#vBout:not([hidden]) #peck:not([hidden])', timeout=5000)
                watcher.wait_for_selector('#vBout:not([hidden])', timeout=5000)
                ok('both robins in bout get a PECK button; the third phone watches', watcher.locator('#peck').is_hidden())
                pa.wait_for_function("!document.getElementById('peck').disabled", timeout=6000)
                if kind == 'wrong-then-right':
                    pa.dispatch_event('#peck', 'pointerdown')
                    pa.wait_for_selector('#opts.live', timeout=5000)
                    ok('pecking first unlocks the answers on that phone only', pb.locator('#opts.live').count() == 0)
                    wrong = (bout['correct'] + 1) % 4
                    pa.locator('#opts .opt').nth(wrong).click()
                    tv.wait_for_function("window.__rf.B.locked.some(Boolean)", timeout=5000)
                    ok('a wrong answer on the phone locks that robin out on the TV', tv.text_content('#pillL') + tv.text_content('#pillR') != '')
                    pb.wait_for_function("!document.getElementById('peck').disabled", timeout=5000)
                    pb.dispatch_event('#peck', 'pointerdown'); pb.wait_for_selector('#opts.live', timeout=5000)
                    pb.locator('#opts .opt').nth(bout['correct']).click()
                    winner = pb
                elif kind == 'right':
                    pb.wait_for_function("!document.getElementById('peck').disabled", timeout=6000)
                    pb.dispatch_event('#peck', 'pointerdown'); pb.wait_for_selector('#opts.live', timeout=5000)
                    pb.locator('#opts .opt').nth(bout['correct']).click()
                    winner = pb
                else:
                    pa.dispatch_event('#peck', 'pointerdown'); pa.wait_for_selector('#opts.live', timeout=5000)
                    pa.locator('#opts .opt').nth((bout['correct'] + 1) % 4).click()
                    pb.wait_for_function("!document.getElementById('peck').disabled", timeout=5000)
                    pb.dispatch_event('#peck', 'pointerdown'); pb.wait_for_selector('#opts.live', timeout=5000)
                    pb.locator('#opts .opt').nth((bout['correct'] + 2) % 4).click()
                    winner = None
                tv.wait_for_selector('#nextBtn:not([hidden])', timeout=8000)
                if winner:
                    winner.wait_for_function("document.getElementById('status').textContent.includes('Correct')", timeout=5000)
                    ok('the winning phone says Correct, and the TV agrees', 'Two points to' in tv.text_content('#msg'))
                else:
                    ok('both wrong ends 0-0 on the TV', '0–0' in tv.text_content('#msg'))
                watcher.wait_for_function("document.querySelector('#opts .opt.right')", timeout=5000)
                ok('the watching phone sees the correct answer revealed')
                if shots and kind == 'wrong-then-right':
                    tv.screenshot(path=shots + '/tv-bout.jpg', type='jpeg', quality=85); winner.screenshot(path=shots + '/phone-correct.jpg', type='jpeg', quality=85)
                tv.click('#nextBtn')

            play_bout('wrong-then-right')
            if shots:
                time.sleep(1); phones[0].screenshot(path=shots + '/phone-table.jpg', type='jpeg', quality=85)
            play_bout('both-wrong')
            play_bout('right')
            tv.wait_for_selector('#final:not([hidden])', timeout=8000)
            ok('after every pair has met, the TV shows the winner')
            for ph in phones:
                ph.wait_for_function("document.getElementById('tableHead').textContent.startsWith('Top of the tree')", timeout=6000)
            tv_points = tv.evaluate("Object.fromEntries(__rf.T.players.map(p => [p.id, p.pts]))")
            server_points = phones[0].evaluate("__rp.S.run.points")
            ok('the TV and the server agree on every point', tv_points == server_points, tv=tv_points, server=server_points)
            champ = tv.text_content('#champName').strip()
            ok('every phone shows the same winner as the TV', all(champ in ph.text_content('#tableHead') for ph in phones))
            if shots:
                phones[1].screenshot(path=shots + '/phone-final.jpg', type='jpeg', quality=85)
            ok('no page errors', errors == [], errors=errors)
            browser.close()
        server.shutdown()
    print('%d checks passed' % len(results))


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--local-pgbin')
    ap.add_argument('--shots')
    a = ap.parse_args()
    run(a.local_pgbin, a.shots)
