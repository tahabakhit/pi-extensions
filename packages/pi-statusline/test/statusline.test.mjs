import assert from 'node:assert/strict';
import test from 'node:test';
import { clock, contextSegment, createSpeedTracker, directory, elapsed, installUI, LEGACY_STAMP_TYPE, plain, renderFooter, speed, speedSegment, STAMP_TYPE, stampText, tokens } from '../src/ui.js';

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

test('metadata is terminal-safe, paths respect home boundaries, unknown usage is honest', () => {
  assert.equal(plain('\x1b[31mbad\x1b[0m\nname'), 'bad name');
  assert.equal(plain('\x1b]0;injected\x07safe'), 'safe');
  assert.equal(directory('/home/fixture/x', host.home), '~/x');
  assert.equal(directory('/home/fixture-other/x', host.home), '/home/fixture-other/x');
  assert.equal(tokens(1_000_000), '1M');
  assert.equal(tokens(NaN), '?');
  for (const percent of [null, undefined, NaN, -1]) {
    assert.deepEqual(contextSegment({ percent }), { text: 'Context ? used', color: 'muted' });
  }
  assert.equal(contextSegment({ percent: 0 }).text, 'Context 0% used');
  for (const [percent, color] of [[79, 'success'], [80, 'warning'], [90, 'error'], [150, 'error']]) {
    assert.equal(contextSegment({ percent }).color, color);
  }
});

test('footer shows identity and used context; widths, Unicode and absent metrics fit', () => {
  const ctx = context();
  assert.deepEqual(renderFooter(ctx, footerData(), theme, 120, host), [
    '~/projects/work · main · gpt-6.1-sol high', 'Context 24% used (240k/1M)',
  ]);
  for (const width of [0, 1, 2, 20, 40, 80, 120]) {
    for (const cwd of [ctx.cwd, '/home/fixture/文界/é/😀-work', '/deep/'.repeat(25)]) {
      const lines = renderFooter(context({ cwd }), footerData({
        getExtensionStatuses: () => new Map([['test', 'Search ready']]),
      }), theme, width, host);
      assert.ok(lines.every(line => widthOf(line) <= width));
    }
  }
  const lines = renderFooter(context({ model: undefined, thinkingLevel: 'off', getContextUsage: () => undefined }),
    footerData({ getGitBranch: () => undefined }), theme, 120, host);
  assert.ok(lines[0].includes('no model'));
  assert.equal(lines[1], 'Context ? used');
  assert.doesNotMatch(lines.join('\n'), /5h|Weekly|\$/);
});

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
  installUI(pi, { ...host, ...extraHost });
  const emit = (event, ctx = context({ mode, ui }), payload = {}) => handlers.get(event)?.(payload, ctx);
  return { emit, ui, entries, renderers,
    get editor() { return editor; }, get header() { return header; }, get footer() { return footer; } };
}

test('UI only owns TUI surfaces; editor delegates keyboard/paste and native animation', () => {
  for (const mode of ['rpc', 'json', 'print']) {
    const r = runtime(mode);
    r.emit('session_start');
    assert.equal(r.editor, undefined);
    assert.equal(r.footer, undefined);
    r.emit('agent_start');
    r.emit('session_shutdown');
  }
  const r = runtime();
  r.emit('session_start');
  const editor = r.editor('tui', 'theme', 'bindings');
  assert.deepEqual(editor.args, ['tui', 'theme', 'bindings', { paddingX: 1, embedWorkingStatus: true }]);
});

test('model/session changes refresh live context; footer subscriptions dispose exactly once', () => {
  const r = runtime();
  r.emit('session_start');
  let renders = 0, unsubscribes = 0;
  const tui = { requestRender: () => { renders++; } };
  const data = footerData({ onBranchChange: callback => {
    callback();
    return () => { unsubscribes++; };
  } });
  const f = r.footer(tui, theme, data);
  const h = r.header(tui, theme);
  r.emit('model_select', context({ ui: r.ui, model: { id: 'changed' }, thinkingLevel: 'low' }));
  assert.match(f.render(120)[0], /changed low/);
  r.emit('session_info_changed', context({ ui: r.ui, sessionManager: { getSessionName: () => 'new name' } }));
  assert.equal(h.render(120)[0], 'Pi · new name');
  assert.ok(renders >= 3);
  const replacement = r.footer(tui, theme, data);
  assert.equal(unsubscribes, 1);
  f.dispose();
  assert.equal(unsubscribes, 1, 'old component cleanup is idempotent');
  r.emit('session_shutdown');
  replacement.dispose();
  assert.equal(unsubscribes, 2);
  assert.deepEqual(replacement.render(120), []);
  r.emit('session_start');
  const resumed = r.footer(tui, theme, data);
  assert.match(resumed.render(120)[0], /gpt-6.1-sol/);
  r.emit('session_shutdown');
  assert.equal(unsubscribes, 3);
});

const reply = (output, stopReason = 'stop') => ({ role: 'assistant', stopReason, usage: { output } });

test('speed tracker measures generation time per reply and skips unmeasurable replies', () => {
  let clock = 0;
  const t = createSpeedTracker(() => clock);
  assert.equal(t.stats(), null);
  t.finish(reply(100));
  assert.equal(t.stats(), null, 'end without start is ignored');
  t.start(); clock = 500; t.chunk(); clock = 1000; t.chunk(); clock = 2500; t.finish(reply(100));
  assert.deepEqual(t.stats(), { last: 50, average: 50 }, 'timed from first chunk, not request start');
  t.start(); clock = 3000; t.chunk(); clock = 3500; t.finish(reply(100));
  assert.deepEqual(t.stats(), { last: 200, average: 80 }, 'average is total tokens over total time');
  for (const [message, ms] of [[reply(100, 'aborted'), 1000], [reply(100, 'error'), 1000],
    [reply(0), 1000], [reply(undefined), 1000], [{ role: 'assistant' }, 1000], [reply(5), 100]]) {
    t.start(); t.chunk(); clock += ms; t.finish(message);
    assert.deepEqual(t.stats(), { last: 200, average: 80 });
  }
  t.start(); clock += 1000; t.finish(reply(100));
  assert.deepEqual(t.stats(), { last: 200, average: 80 }, 'no streamed chunk, no measurement');
  t.reset();
  assert.equal(t.stats(), null);
  assert.equal(speed(52.14), '52.1 t/s');
  assert.equal(speed(1234), '1.2k t/s');
  assert.equal(speed(NaN), '?');
  assert.equal(speedSegment(null), null);
  assert.deepEqual(speedSegment({ last: 52.14, average: 41 }), { text: 'Out 52.1 t/s · avg 41.0 t/s', color: 'muted' });
});

test('footer adds speed after a measured reply and drops it before context at narrow widths', () => {
  const stats = { last: 52.14, average: 41 };
  assert.deepEqual(renderFooter(context(), footerData(), theme, 120, host, stats)[1],
    'Context 24% used (240k/1M) · Out 52.1 t/s · avg 41.0 t/s');
  assert.equal(renderFooter(context(), footerData(), theme, 40, host, stats)[1], 'Context 24% used (240k/1M)');
  assert.equal(renderFooter(context(), footerData(), theme, 120, host, null)[1], 'Context 24% used (240k/1M)');
  for (const width of [0, 1, 20, 40, 57, 58, 80]) {
    assert.ok(renderFooter(context(), footerData(), theme, width, host, stats).every(line => widthOf(line) <= width));
  }
});

test('assistant messages drive the footer speed; other roles, chunks and modes do not', () => {
  let clock = 0;
  const r = runtime('tui', { now: () => clock });
  r.emit('session_start');
  let renders = 0;
  const f = r.footer({ requestRender: () => { renders++; } }, theme, footerData({ onBranchChange: () => () => {} }));
  const ctx = context({ ui: r.ui });
  const send = (event, payload, c = ctx) => r.emit(event, c, payload);
  send('message_start', { message: { role: 'user' } });
  send('message_update', {});
  clock = 1000;
  send('message_end', { message: { role: 'user' } });
  assert.doesNotMatch(f.render(120)[1], /t\/s/, 'user messages are not timed');
  send('message_start', { message: { role: 'assistant' } });
  clock = 1500; send('message_update', {});
  const before = renders;
  clock = 2000; send('message_update', {});
  assert.equal(renders, before, 'chunks never redraw');
  clock = 3500;
  assert.equal(send('message_end', { message: reply(100) }), undefined, 'message_end never replaces the message');
  assert.ok(renders > before);
  assert.match(f.render(120)[1], /Out 50\.0 t\/s · avg 50\.0 t\/s$/);
  send('message_start', { message: { role: 'toolResult' } });
  send('message_end', { message: { role: 'toolResult', usage: { output: 9 } } });
  assert.match(f.render(120)[1], /Out 50\.0 t\/s/);
  r.emit('session_start');
  const resumed = r.footer({ requestRender() {} }, theme, footerData({ onBranchChange: () => () => {} }));
  assert.doesNotMatch(resumed.render(120)[1], /t\/s/, 'a new session starts unmeasured');
  r.emit('session_shutdown');
  const rpc = runtime('rpc', { now: () => clock });
  const rpcCtx = context({ mode: 'rpc', ui: rpc.ui });
  for (const [event, payload] of [['message_start', { message: { role: 'assistant' } }], ['message_update', {}],
    ['message_end', { message: reply(100) }]]) assert.equal(rpc.emit(event, rpcCtx, payload), undefined);
});

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
