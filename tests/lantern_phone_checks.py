#!/usr/bin/env python3
"""End-to-end Ten Lanterns phone play: one TV page and three phones, in real browsers,
against the real lantern_private SQL in a throwaway local PostgreSQL.

A small local bridge stands in for Supabase's HTTP layer: it serves the site, swaps
vendor/supabase.js for a stub whose rpc() posts here, and runs each call as the
`authenticated` role with that browser's synthetic guest ID as auth.uid(). Nothing
leaves the machine; real GoTrue/PostgREST remain separate checks.

Usage (as a non-root user): python3 tests/lantern_phone_checks.py --local-pgbin /usr/lib/postgresql/16/bin
"""
from __future__ import annotations

import argparse
import functools
import http.server
import json
from pathlib import Path
import re
import socketserver
import threading

from check_ruffled_access import Database, literal
from check_lantern_access import FIXTURE, MIGRATION
from ruffled_phone_checks import STUB

ROOT = Path(__file__).resolve().parents[1]


def serve(db: Database):
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
            m = re.fullmatch(r'/rpc/(lantern_[a-z_]+)', self.path)
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
                hit = re.search(r'ERROR:\s+([0-9A-Z]{5}):\s+(.*)', result.stderr)
                return self.reply(400, {'code': hit.group(1) if hit else '', 'message': hit.group(2) if hit else result.stderr})
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

            tv = page(1600, 900)
            tv.goto(base + '/ten-lanterns.html'); tv.evaluate('window.__noConfirm = true')
            tv.click('#mode [data-v="versus"]'); tv.click('#auto [data-v="tap"]'); tv.click('#timed [data-v="relaxed"]'); tv.click('#style [data-v="worlds"]')
            tv.click('#playOn [data-v="phones"]')
            tv.wait_for_function("/^[A-Z2-9]{5}$/.test(document.getElementById('roomCode').textContent.trim())", timeout=15000)
            code = tv.text_content('#roomCode').strip()
            link = tv.get_attribute('#joinUrl', 'href')
            ok('the TV opens a room with a code and join link', bool(re.fullmatch(r'[A-Z2-9]{5}', code)) and link.endswith('/ten-lanterns-play.html?c=' + code))
            ok('the typed player list gives way to the lobby', tv.locator('#plist').is_hidden() and tv.locator('#lobbyBox').is_visible())
            names = ['Grandad', 'Amelia', 'Tom']
            phones = []
            for n in names:
                ph = page(390, 844, mobile=True)
                ph.goto(link)
                ok('the phone page fills in the code from the link (' + n + ')', ph.input_value('#code') == code)
                ph.fill('#name', n); ph.click('#joinBtn')
                ph.wait_for_selector('#vWait:not([hidden])')
                phones.append(ph)
            ok('each phone says it is in', all(('in, ' + n) in ph.text_content('#waitHead') for ph, n in zip(phones, names)))
            dup = page(390, 844, mobile=True); dup.goto(link); dup.fill('#name', 'amelia'); dup.click('#joinBtn')
            dup.wait_for_function("document.getElementById('joinErr').textContent.length > 0")
            ok('a name already in the room is refused on the phone', 'taken' in dup.text_content('#joinErr'))
            tv.wait_for_function("document.querySelectorAll('#netList span:not(.away)').length === 3", timeout=10000)
            ok('the TV lists the three players with their symbols', tv.locator('#netList span svg').count() == 3)
            if shots:
                tv.screenshot(path=shots + '/tv-lobby.jpg', type='jpeg', quality=85); phones[0].screenshot(path=shots + '/phone-joined.jpg', type='jpeg', quality=85)
            tv.click('#beginBtn')
            tv.wait_for_selector('#play:not([hidden]) #spinBtn:not([disabled])', timeout=8000)
            ok('the game starts with the phones as its players', tv.evaluate('__tl.S.players.map(p => p.name)') == names and tv.evaluate('__tl.S.phones'))
            for ph in phones:
                ph.wait_for_function("document.getElementById('waitHead').textContent === 'Get ready'", timeout=6000)
            ok('every phone gets ready')
            by_mid = {}
            for ph, n in zip(phones, names):
                by_mid[ph.evaluate('__lp.ME.id')] = ph

            seen = {'answer': 0, 'buzz': 0, 'choose': 0, 'claim': 0}
            checked = set()

            def tvR(expr):
                return tv.evaluate('(() => { const R = __tl.R, S = __tl.S; return ' + expr + '; })()')

            def step(policy):
                """Act once for whoever the TV is waiting on. Returns False when the round is over."""
                if tv.locator('#roundEnd').is_visible():
                    return False
                ph_ = tvR('R && R.phase')
                if ph_ == 'intro':
                    tv.click('#round'); return True
                if ph_ == 'next':
                    tv.click('#nextBtn'); return True
                pid = tvR('R && R.pid')
                if not pid:
                    tv.wait_for_timeout(120); return True
                prompt = None
                for ph in phones:
                    try:
                        ph.wait_for_function("__lp.S && __lp.S.prompt && __lp.S.prompt.id === %s" % json.dumps(pid), timeout=5000)
                    except Exception:
                        pass
                prompt = phones[0].evaluate('__lp.S.prompt')
                kind = prompt['kind']; seen[kind] += 1
                eligible = [by_mid[m] for m in prompt['eligible']]
                watchers = [ph for ph in phones if ph not in eligible]
                if kind == 'answer':
                    correct = tvR('R.q.opts.indexOf(R.q.correct)')
                    ph = eligible[0]
                    ph.wait_for_selector('#opts.live .opt:not([disabled])', timeout=5000)
                    if 'answer' not in checked and watchers:
                        checked.add('answer')
                        ok('the named phone can answer; the others watch', all(w.locator('#opts.live').count() == 0 for w in watchers)
                           and all('to answer' in w.text_content('#who') for w in watchers))
                        ok('no phone is told the answer before it closes', all(w.evaluate('__lp.S.prompt.correct') is None for w in phones))
                        if shots:
                            ph.screenshot(path=shots + '/phone-question.jpg', type='jpeg', quality=85); tv.screenshot(path=shots + '/tv-question.jpg', type='jpeg', quality=85)
                    right = policy(kind)
                    ph.locator('#opts .opt').nth(correct if right else (correct + 1) % 4).click()
                    if not right and 'wrongclaim' not in checked:
                        tv.wait_for_function("__tl.R.pkind === 'claim' && __tl.R.pid", timeout=6000)
                        checked.add('wrongclaim')
                        ok('a wrong answer on a phone offers the steal to the other phones', tv.evaluate('__tl.R.phase') == 'stealpick')
                elif kind == 'claim':
                    ph = eligible[-1]
                    ph.wait_for_selector('#press:not([hidden]):not([disabled])', timeout=5000)
                    if 'claim' not in checked and len(eligible) > 1:
                        checked.add('claim')
                        ph.dispatch_event('#press', 'pointerdown')
                        other = eligible[0]
                        other.wait_for_function("__lp.S.prompt && __lp.S.prompt.closed", timeout=5000)
                        ok('the first to press Me! takes the steal; the next is too late', other.locator('#press').is_hidden() and 'got there first' in other.text_content('#status'))
                    else:
                        ph.dispatch_event('#press', 'pointerdown')
                elif kind == 'buzz':
                    correct = tvR('R.q.opts.indexOf(R.q.correct)')
                    pa = eligible[0]
                    pa.wait_for_function("!document.getElementById('press').disabled && !document.getElementById('press').hidden", timeout=6000)
                    if 'buzz' not in checked and len(eligible) > 1:
                        checked.add('buzz')
                        pb = eligible[1]
                        if shots:
                            pa.screenshot(path=shots + '/phone-buzz.jpg', type='jpeg', quality=85)
                        pa.dispatch_event('#press', 'pointerdown')
                        pa.wait_for_selector('#opts.live', timeout=5000)
                        ok('pressing first unlocks the answers on that phone only', pb.locator('#opts.live').count() == 0)
                        pb.wait_for_function("document.getElementById('who').textContent.includes('pressed first')", timeout=5000)
                        ok('the other phones are told who pressed first', True)
                        pa.locator('#opts .opt').nth((correct + 1) % 4).click()
                        tv.wait_for_function("__tl.R.tried.length >= 1", timeout=5000)
                        pb.wait_for_function("!document.getElementById('press').disabled && !document.getElementById('press').hidden", timeout=6000)
                        ok('a wrong answer locks that phone out and reopens the question', 'Locked out' in pa.text_content('#who'))
                        pb.dispatch_event('#press', 'pointerdown'); pb.wait_for_selector('#opts.live', timeout=5000)
                        pb.locator('#opts .opt').nth(correct).click()
                        pb.wait_for_function("document.getElementById('status').textContent.includes('Correct')", timeout=5000)
                        tv.wait_for_function("__tl.R.phase === 'next' || __tl.R.phase === 'reveal' || __tl.R.phase === 'choose'", timeout=5000)
                        ok('the phone that answered right is told so, and the TV agrees', 'Correct' in tv.text_content('#rmsg'))
                    else:
                        pa.dispatch_event('#press', 'pointerdown'); pa.wait_for_selector('#opts.live', timeout=5000)
                        pa.locator('#opts .opt').nth(correct if policy(kind) else (correct + 1) % 4).click()
                elif kind == 'choose':
                    ph = eligible[0]
                    ph.wait_for_selector('#opts.live .opt:not([disabled])', timeout=5000)
                    if 'choose' not in checked:
                        checked.add('choose')
                        ok('a choice appears on the chooser\'s phone with the TV\'s options',
                           [t.strip() for t in ph.locator('#opts .opt span').all_text_contents()] == tvR('[...document.querySelectorAll("#opts .opt span")].map(s => s.textContent)'))
                        if shots:
                            ph.screenshot(path=shots + '/phone-choice.jpg', type='jpeg', quality=85)
                    ph.locator('#opts .opt:not([disabled])').first.click()
                tv.wait_for_function("!__tl.R || __tl.R.pid !== %s" % json.dumps(pid), timeout=8000)
                return True

            def play(world, policy, until_end=False):
                tv.evaluate('__tl.force(%d)' % world)
                tv.click('#spinBtn'); tv.wait_for_selector('#landBox:not([hidden])'); tv.click('#goBtn')
                for _ in range(200):
                    if not step(policy):
                        break
                head = tv.text_content('#reHead')
                tv.click('#backBtn')
                return head

            alt = {'n': 0}

            def mixed(kind):
                alt['n'] += 1
                return alt['n'] % 2 == 0

            h1 = play(3, mixed)             # the railway: answers, steals, a choice and a claim
            ok('a whole railway round runs on the phones', bool(h1), head=h1)
            if shots:
                tv.wait_for_timeout(300)
            h2 = play(5, lambda k: True)    # the cave: open questions, first to press
            ok('a whole cave round runs on the phones', bool(h2), head=h2)
            tv.evaluate('__tl.S.spin = __tl.S.spins - 1')
            h3 = play(0, lambda k: True)    # Rome: choose a rival, then a two-player duel
            ok('a whole chariot duel runs on the phones', bool(h3), head=h3)
            ok('every kind of moment was used: answer, open question, choice and claim', all(seen[k] > 0 for k in seen), seen=seen)
            tv.wait_for_selector('#end:not([hidden])', timeout=8000)
            for ph in phones:
                ph.wait_for_function("document.getElementById('waitHead').textContent === 'Game over'", timeout=8000)
            ok('when the game ends every phone says so')
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
