import assert from 'node:assert/strict';
import test from 'node:test';
import { contextSegment, directory, installFooter, plain, renderFooter, tokens } from '../src/footer.js';

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
  installFooter(pi, { ...host, ...extraHost });
  const emit = (event, ctx = context({ mode, ui }), payload = {}) => handlers.get(event)?.(payload, ctx);
  return { emit, ui, entries, renderers,
    get editor() { return editor; }, get header() { return header; }, get footer() { return footer; } };
}

test('footer owns no header, editor, timestamps, or speed hooks in any mode', () => {
  for (const mode of ['tui', 'rpc', 'json', 'print']) {
    const r = runtime(mode);
    r.emit('session_start');
    assert.equal(r.editor, undefined);
    assert.equal(r.header, undefined);
    assert.equal(typeof r.footer, mode === 'tui' ? 'function' : 'undefined');
    assert.equal(r.renderers.size, 0);
    assert.deepEqual(r.entries, []);
    r.emit('session_shutdown');
  }
  const events = [];
  installFooter({ on: name => events.push(name) }, host);
  for (const removed of ['message_start', 'message_update', 'turn_end']) assert.ok(!events.includes(removed));
});

test('model changes refresh live context; footer subscriptions dispose exactly once', () => {
  const r = runtime();
  r.emit('session_start');
  let renders = 0, unsubscribes = 0;
  const tui = { requestRender: () => { renders++; } };
  const data = footerData({ onBranchChange: callback => {
    callback();
    return () => { unsubscribes++; };
  } });
  const f = r.footer(tui, theme, data);
  r.emit('model_select', context({ ui: r.ui, model: { id: 'changed' }, thinkingLevel: 'low' }));
  assert.match(f.render(120)[0], /changed low/);
  assert.ok(renders >= 2);
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
