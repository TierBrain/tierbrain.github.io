/* Authenticated transport for actor-owned race rooms. Public scores are never
   used for room messages. A failed acknowledgement retries the same receipt. */
(function (global) {
  'use strict';
  const FAMILIES = ['finish', 'tug', 'firstfinger', 'castle', 'core', 'labyrinth'];
  function copy(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
  function uuid() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') return global.crypto.randomUUID();
    const bytes = new Uint8Array(16); global.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const h = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function problem(error, status) {
    const next = new Error(error && error.message ? error.message : 'The connection was interrupted.');
    next.code = error && error.code ? String(error.code) : '';
    next.status = Number(status || (error && error.status) || 0);
    return next;
  }
  function message(error) {
    if (error && error.code === 'PT409') return 'This race changed. Refresh the room before continuing.';
    if (error && error.status === 429) return 'Too many connection attempts. Wait a while, then retry.';
    if (error && (/anonymous|signup.*disabled|signups.*disabled/i.test(error.message) || error.code === 'anonymous_provider_disabled')) return 'Guest access is unavailable. Ask the host to check the game setup.';
    if (error && (error.status === 401 || /jwt|refresh.token|token.*expired|verified guest session/i.test(error.message))) return 'Your guest session needs attention. Reload this page and rejoin if asked.';
    if (error && /nickname.*already/i.test(error.message)) return 'That nickname is already in this room. Choose another.';
    if (error && /only the host/i.test(error.message)) return 'Only the room host can do that.';
    if (error && /window.*closed|run has closed|race already started/i.test(error.message)) return 'That race action has closed. Refresh the room to see the current race.';
    if (error && (error.code === '42501' || error.status === 403)) return 'This browser cannot access that race action. Check the room or rejoin.';
    if (error && error.code === '22023') return error.message;
    if (error && error.code === '54000') return 'This room has reached its activity limit. Wait, then retry or open a new room.';
    return 'Could not reach the race. Check your connection and retry.';
  }
  function retryable(error) {
    return !error.code || error.status === 429 || error.status >= 500 || /fetch|network|abort|timeout|response_lost/i.test(error.code + ' ' + error.message);
  }
  function boundedFetch(input, options) {
    const controller = new AbortController(), given = options && options.signal;
    const abort = () => controller.abort();
    if (given) { if (given.aborted) abort(); else given.addEventListener('abort', abort, { once: true }); }
    const timer = global.setTimeout(abort, 15000);
    return global.fetch(input, Object.assign({}, options || {}, { signal: controller.signal })).finally(() => {
      global.clearTimeout(timer); if (given) given.removeEventListener('abort', abort);
    });
  }
  function create(url, key, options) {
    options = options || {};
    const family = options.family, edition = options.edition || 'general';
    if (!FAMILIES.includes(family) || !['general', 'bible'].includes(edition) || (edition === 'bible' && family !== 'firstfinger')) throw new Error('Unknown race edition.');
    let client = null, readyPromise = null, packet = null, activeRun = '', tail = Promise.resolve();
    let busyCount = 0, waiting = null, lastIssue = null, issueHandler = options.onIssue || null, stateHandler = options.onState || null;
    let offset = 0, bestRtt = Infinity, membershipEpoch = 0;
    function sdk() {
      if (!client) {
        if (!global.supabase || typeof global.supabase.createClient !== 'function') throw new Error('The race connection did not load. Reload this page.');
        client = global.supabase.createClient(url, key, {
          auth: { storageKey: 'tb_race_' + family + '_' + edition + '_auth_v1', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
          global: { fetch: boundedFetch }
        });
      }
      return client;
    }
    async function ready() {
      if (!readyPromise) {
        readyPromise = (async () => {
          const api = sdk(), restored = await api.auth.getSession();
          if (restored.error) throw problem(restored.error);
          if (!restored.data || !restored.data.session) {
            const signed = await api.auth.signInAnonymously();
            if (signed.error) throw problem(signed.error);
          }
          const verified = await api.auth.getUser();
          if (verified.error) throw problem(verified.error);
          if (!verified.data || !verified.data.user || !verified.data.user.id) throw new Error('Your guest session could not be verified. Reload this page.');
          return verified.data.user;
        })();
      }
      try { return await readyPromise; } catch (error) { readyPromise = null; throw error; }
    }
    async function rpc(name, args) {
      await ready();
      const began = Date.now();
      const result = await sdk().rpc('race_' + name, Object.assign({ p_family: family, p_edition: edition }, args || {}));
      if (result.error) throw problem(result.error, result.status);
      const received = Date.now(), server = result.data && Date.parse(result.data.server_time);
      if (Number.isFinite(server) && received - began < bestRtt) { bestRtt = received - began; offset = server - (began + received) / 2; }
      return result.data;
    }
    function notify(detail) { lastIssue = detail && detail.error ? detail : null; if (issueHandler) issueHandler(detail); }
    function latestEvent(rows) { return (rows || []).reduce((latest, row) => Math.max(latest, Number(row.id) || 0), 0); }
    function compareTime(first, second) {
      const a = Date.parse(first), b = Date.parse(second);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
      if (a !== b) return a - b;
      const fraction = value => Number(((String(value).match(/\.(\d+)/) || [,'0'])[1] + '000000000').slice(0, 9));
      return fraction(first) - fraction(second);
    }
    function adopt(next, entering) {
      if (!next || !next.room) return;
      if (next.room.family !== family || next.room.edition !== edition) throw new Error('This room belongs to another race edition.');
      if (!entering && !packet) return;
      if (!entering && packet && next.room.id !== packet.room.id) return;
      if (!entering && packet && (Number(next.room.version) < Number(packet.room.version) ||
          (Number(next.room.version) === Number(packet.room.version) && compareTime(next.server_time, packet.server_time) < 0))) return;
      // A state query can finish before a mutation yet arrive after its receipt.
      // Canonical event IDs preserve the accepted write independently of the
      // response order and the timestamps carried by partial receipts.
      if (!entering && packet && next.rows && next.room.run_id === packet.room.run_id &&
          Number(next.room.version) === Number(packet.room.version) && latestEvent(next.rows) < latestEvent(packet.rows)) return;
      const changed = !packet || packet.room.id !== next.room.id || packet.room.run_id !== next.room.run_id;
      const merged = copy(next);
      if (!changed) {
        merged.room = Object.assign({}, packet.room, merged.room);
        if (merged.member && packet.member && merged.member.id === packet.member.id) merged.member = Object.assign({}, packet.member, merged.member);
      }
      packet = Object.assign({}, changed ? {} : packet, merged);
      if (changed && !next.rows) packet.rows = [];
      if (entering) { activeRun = ''; membershipEpoch++; }
      if (stateHandler) stateHandler(copy(packet));
    }
    function scope() {
      if (!packet || !packet.room) throw new Error('Join a room before continuing.');
      return { p_code: packet.room.code };
    }
    function versioned() {
      return Object.assign(scope(), { p_run_id: packet.room.run_id, p_expected_version: packet.room.version });
    }
    function rememberEvent(row) {
      if (!row || !packet || row.run_id !== packet.room.run_id) return;
      if (row.kind === 'progress') {
        const latest = latestEvent((packet.rows || []).filter(event => event.kind === 'progress' && event.member_id === row.member_id));
        if (Number(row.id) < latest || (packet.member && row.member_id === packet.member.id && compareTime(row.created_at, packet.member.progress_at) < 0)) return;
      }
      packet.rows = [copy(row)].concat((packet.rows || []).filter(existing => existing.id !== row.id));
      if (compareTime(row.created_at, packet.server_time) > 0) packet.server_time = row.created_at;
      if (row.kind === 'progress' && packet.member && row.member_id === packet.member.id) {
        packet.member = Object.assign({}, packet.member, { last_correct: row.correct, last_level: row.level, last_time: row.time_left, progress_at: row.created_at });
        if (row.wrong !== undefined) packet.member.last_wrong = row.wrong;
        if (row.mishaps !== undefined) packet.member.last_mishaps = row.mishaps;
      }
      if (stateHandler) stateHandler(copy(packet));
    }
    function mutate(name, args, adoptResult) {
      const request = Object.assign({}, copy(args), { p_request_id: uuid() });
      busyCount++;
      let task;
      task = tail.then(async () => {
        while (true) {
          try {
            const result = await rpc(name, request);
            if (adoptResult) adoptResult(result);
            waiting = null; notify({ state: 'confirmed', recovered: true, operation: name, request_id: request.p_request_id });
            return copy(result);
          } catch (error) {
            const canRetry = retryable(error), issue = { state: 'failed', error, message: message(error), canRetry, operation: name, request_id: request.p_request_id };
            if (!canRetry || !issueHandler) { notify(issue); throw error; }
            await new Promise((resolve, reject) => { waiting = { issue, request, resume: resolve, cancel: reject, promise: task }; notify(issue); });
          }
        }
      });
      tail = task.catch(() => {});
      return task.finally(() => { busyCount--; });
    }
    return Object.freeze({
      ready, uuid, message,
      current() { return copy(packet); }, room() { return packet ? copy(packet.room) : null; }, member() { return packet ? copy(packet.member) : null; },
      isHost() { return !!(packet && packet.host); }, busy() { return busyCount > 0; }, pending() { return waiting ? copy(waiting.issue) : null; },
      serverNow() { return Date.now() + offset; },
      onIssue(fn) { issueHandler = fn; }, onState(fn) { stateHandler = fn; },
      resetError() { if (waiting) return false; lastIssue = null; return true; },
      error() { return lastIssue; },
      retry() { if (!waiting) return Promise.resolve(); const pending = waiting; waiting = null; pending.resume(); return pending.promise; },
      useRun(run) {
        if (!packet || typeof run !== 'string' || run !== packet.room.run_id) throw new Error('Refresh the room before using this race run.');
        activeRun = run; return run;
      },
      enter(code, name) {
        if (busyCount) return Promise.reject(new Error('Wait for the current race update before joining another room.'));
        return mutate('enter', { p_code: String(code || '').trim().toUpperCase(), p_name: String(name || '').trim() }, result => adopt(result, true));
      },
      async state() {
        const args = scope(), epoch = membershipEpoch, roomId = packet.room.id;
        const result = await rpc('state', Object.assign(args, { p_after_id: 0 }));
        if (epoch !== membershipEpoch || !packet || packet.room.id !== roomId) throw problem({ code: 'PT409', message: 'This room changed while loading.' }, 409);
        adopt(result, false); return copy(packet);
      },
      async read() { const result = await this.state(); return result.rows || []; },
      start(options) { return mutate('start', Object.assign(versioned(), { p_options: copy(options || {}) }), result => adopt(result, false)); },
      submit(kind, payload) {
        if (!activeRun) return Promise.reject(new Error('Wait for the host to start this race.'));
        return mutate('submit', Object.assign(scope(), { p_run_id: activeRun, p_kind: kind, p_payload: copy(payload || {}) }), rememberEvent);
      },
      heartbeat(payload) { return mutate('heartbeat', Object.assign(scope(), { p_payload: copy(payload || {}) }), result => adopt(result, false)); },
      leave() {
        // Once a response has failed, retry is a user decision. Leaving may
        // abandon that local wait, then revoke membership with a separate real
        // receipt. An interrupted enter still has its original canonical code.
        const args = waiting && waiting.issue.operation === 'enter' ? { p_code: waiting.request.p_code } : scope();
        if (waiting) {
          const pending = waiting; waiting = null;
          pending.cancel(problem({ code: 'race_left', message: 'This pending action was cancelled because you left the room.' }));
        }
        return mutate('leave', args, () => { packet = null; activeRun = ''; membershipEpoch++; });
      },
      reset() { return mutate('reset', versioned(), result => adopt(result, false)); }
    });
  }
  global.RaceAccess = Object.freeze({ create });
})(window);
