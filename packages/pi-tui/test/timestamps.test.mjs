import assert from 'node:assert/strict';
import test from 'node:test';
import { clock, elapsed, installTimestamps, LEGACY_STAMP_TYPE, STAMP_TYPE, stampText } from '../src/timestamps.js';

// Test doubles, not a substitute for the real host's ANSI/Unicode renderer.
const widthOf = text => [...text].reduce((sum, ch) => sum + (/\p{Mark}/u.test(ch) ? 0 : /[界文😀]/u.test(ch) ? 2 : 1), 0);
const host = {
  home: '/home/fixture', visibleWidth: widthOf,
  truncateToWidth(text, width) {
    let result = '';
    for (const ch of text) {
      if (widthOf(result + ch) > width) break;
      result += ch;
    }
    return result;
  },
  CustomEditor: class { constructor(...args) { this.args = args; } },
};
const theme = { fg: (_color, text) => text };
const context = overrides => ({ mode: 'tui', cwd: '/home/fixture/projects/work',
  model: { id: 'gpt-6.1-sol', contextWindow: 1_000_000 }, thinkingLevel: 'high',
  getContextUsage: () => ({ percent: 24, tokens: 240_000, contextWindow: 1_000_000 }),
  sessionManager: { getSessionName: () => '' }, ...overrides });
const footerData = overrides => ({ getGitBranch: () => 'main',
  getExtensionStatuses: () => new Map(), ...overrides });

function runtime(mode = 'tui', extraHost = {}) {
  const handlers = new Map();
  const entries = [], renderers = new Map();
  const pi = { on: (event, fn) => handlers.set(event, fn),
    appendEntry: (customType, data) => entries.push({ type: 'custom', customType, data }),
    registerEntryRenderer: (customType, fn) => renderers.set(customType, fn) };
  let editor, header, footer;
  const ui = {
    setEditorComponent: fn => { editor = fn; },
    setHeader: fn => { header = fn; },
    setFooter: fn => { footer = fn; },
  };
  installTimestamps(pi, { ...host, ...extraHost });
  const emit = (event, ctx = context({ mode, ui }), payload = {}) => handlers.get(event)?.(payload, ctx);
  return { emit, ui, entries, renderers,
    get editor() { return editor; }, get header() { return header; }, get footer() { return footer; } };
}

// Local-time fixtures, so expectations hold in any time zone.
const at = (day, h, m, s) => new Date(2026, 10, day, h, m, s).getTime();

test('stamp text shows local time, the date on a new day, and reply duration', () => {
  assert.equal(clock(at(10, 9, 5, 7), at(10, 8, 0, 0)), '09:05:07');
  assert.equal(clock(at(10, 9, 5, 7)), 'Nov 10 09:05:07', 'first stamp carries the date');
  assert.equal(clock(at(11, 0, 0, 1), at(10, 23, 59, 59)), 'Nov 11 00:00:01');
  assert.equal(clock(NaN), '');
  for (const [ms, text] of [[0, '0.0s'], [4250, '4.2s'], [42_900, '42s'], [65_000, '1m 5s'], [3_725_000, '1h 2m'], [-1, '']]) {
    assert.equal(elapsed(ms), text);
  }
  const previous = at(10, 9, 0, 0);
  assert.equal(stampText({ role: 'user', at: at(10, 9, 0, 3), previous }), '09:00:03');
  assert.equal(stampText({ role: 'assistant', at: at(10, 9, 1, 8), previous, took: 65_000 }), '09:01:08 · 1m 5s');
  assert.equal(stampText({ role: 'assistant', at: at(10, 9, 1, 8), previous }), '09:01:08');
  assert.equal(stampText({ version: 2, role: 'user', timestamp: at(10, 9, 0, 3), previousTimestamp: previous }), '09:00:03',
    'legacy pi-stamp rows keep their time');
  assert.equal(stampText({ toolName: 'bash', startedAt: 1, completedAt: 2 }), '', 'legacy tool rows render nothing');
});

test('a run stamps the user message and the final reply, never tool turns or other modes', () => {
  let clockNow = at(10, 9, 0, 0);
  const r = runtime('tui', { now: () => clockNow });
  const branch = [{ type: 'custom', customType: LEGACY_STAMP_TYPE, data: { version: 2, role: 'user', timestamp: at(10, 8, 0, 0) } }];
  const ctx = context({ ui: r.ui, sessionManager: { getSessionName: () => '', getBranch: () => branch } });
  r.emit('session_start', ctx);
  const send = (event, payload) => r.emit(event, ctx, payload);
  send('message_end', { message: { role: 'user', timestamp: at(10, 9, 0, 0) } });
  assert.equal(r.entries.length, 0, 'user stamp waits until Pi has persisted the message');
  send('message_start', { message: { role: 'assistant' } });
  send('turn_end', { message: { role: 'assistant', stopReason: 'toolUse' } });
  clockNow = at(10, 9, 1, 5);
  assert.equal(send('turn_end', { message: { role: 'assistant', stopReason: 'stop' } }), undefined);
  send('agent_end', {});
  assert.deepEqual(r.entries.map(e => [e.customType, e.data]), [
    [STAMP_TYPE, { version: 1, role: 'user', at: at(10, 9, 0, 0), previous: at(10, 8, 0, 0) }],
    [STAMP_TYPE, { version: 1, role: 'assistant', at: at(10, 9, 1, 5), took: 65_000, previous: at(10, 9, 0, 0) }],
  ]);
  const render = (type, entry) => r.renderers.get(type)(entry, { expanded: false }, theme)?.render(20);
  assert.deepEqual(render(STAMP_TYPE, r.entries[1]), ['      09:01:05 · 1m 5s'.slice(-20)]);
  assert.ok(render(STAMP_TYPE, r.entries[1]).every(line => widthOf(line) <= 20));
  assert.equal(r.renderers.get(STAMP_TYPE)({ data: {} }, {}, theme), undefined);
  assert.deepEqual(render(LEGACY_STAMP_TYPE, branch[0]), ['     Nov 10 08:00:00'], 'no previous stamp, so the date shows');
  for (const mode of ['rpc', 'json', 'print']) {
    const other = runtime(mode, { now: () => clockNow });
    const c = context({ mode, ui: other.ui, sessionManager: { getSessionName: () => '', getBranch: () => [] } });
    other.emit('session_start', c);
    other.emit('message_end', c, { message: { role: 'user', timestamp: at(10, 9, 0, 0) } });
    other.emit('turn_end', c, { message: { role: 'assistant', stopReason: 'stop' } });
    other.emit('session_shutdown', c);
    assert.equal(other.entries.length, 0, `${mode} writes no stamps`);
  }
});

test('timestamps never replace the header, footer, or editor; shutdown flushes once', () => {
  const r = runtime();
  r.emit('session_start');
  assert.equal(r.header, undefined);
  assert.equal(r.footer, undefined);
  assert.equal(r.editor, undefined);
  r.emit('message_end', undefined, { message: { role: 'user', timestamp: at(10, 9, 0, 0) } });
  r.emit('session_shutdown');
  r.emit('session_shutdown');
  assert.equal(r.entries.length, 1);
  r.emit('session_start');
  r.emit('agent_end');
  assert.equal(r.entries.length, 1, 'reload does not replay pending timestamps');
});
