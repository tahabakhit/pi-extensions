// Usage: node test/host-smoke.mjs /path/to/pi-coding-agent /path/to/package [...packages]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [hostArg, ...packageArgs] = process.argv.slice(2);
assert.ok(hostArg && packageArgs.length, 'Pass an installed Pi directory and at least one candidate package');
const host = path.resolve(hostArg);
const candidates = packageArgs.map(value => path.resolve(value));
const { loadExtensions } = await import(pathToFileURL(path.join(host, 'dist/core/extensions/loader.js')));
async function check(packages) {
  const manifests = packages.map(dir => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')));
  const names = manifests.map(m => m.name);
  const hasFooter = names.includes('@tahabakhit/pi-statusline');
  const hasEditor = names.includes('@tahabakhit/pi-tui');
  const hasTimestamps = hasEditor;
  const result = await loadExtensions(manifests.flatMap((m, i) => m.pi.extensions.map(entry => path.join(packages[i], entry))), packages[0]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.extensions.length, packages.length);
  const entries = [];
  result.runtime.appendEntry = (customType, data) => entries.push({ customType, data });
  for (const extension of result.extensions) {
    assert.equal(extension.tools.size, 0);
    assert.equal(extension.commands.size, 0);
    assert.ok(!extension.handlers.has('message_update'), 'No speed measurement hook');
  }
  assert.equal(result.extensions.reduce((sum, e) => sum + e.entryRenderers.size, 0), hasTimestamps ? 2 : 0);
  const emit = async (event, payload, ctx) => {
    for (const extension of result.extensions) {
      for (const handler of extension.handlers.get(event) ?? []) await handler(payload, ctx);
    }
  };
  let editor, footer, subscriptions = 0, disposed = 0;
  const ui = {
    setEditorComponent: factory => { editor = factory; },
    setHeader() { throw new Error('The header must remain native'); },
    setFooter: factory => { footer = factory; },
  };
  const ctx = {
    mode: 'tui', cwd: packages[0], ui,
    model: { id: 'fixture-model', contextWindow: 100000 }, thinkingLevel: 'medium',
    getContextUsage: () => ({ percent: 25, tokens: 25000, contextWindow: 100000 }),
    sessionManager: { getBranch: () => [{ type: 'custom', customType: 'statusline-stamp', data: { at: 1000 } }] },
  };
  const theme = { fg: (_color, value) => value };
  const data = {
    getGitBranch: () => 'main', getExtensionStatuses: () => new Map(),
    onBranchChange: () => { subscriptions++; return () => { disposed++; }; },
  };
  for (const reason of ['startup', 'reload']) {
    await emit('session_start', { reason }, ctx);
    assert.equal(typeof editor, hasEditor ? 'function' : 'undefined');
    assert.equal(typeof footer, hasFooter ? 'function' : 'undefined');
    const f = footer?.({ requestRender() {} }, theme, data);
    if (f) {
      assert.match(f.render(120)[0], /fixture-model medium/);
      assert.equal(f.render(120)[1], 'Context 25% used (25k/100k)');
      await emit('model_select', {}, { ...ctx, model: { ...ctx.model, id: 'changed' } });
      assert.match(f.render(120)[0], /changed/);
    }
    const before = entries.length;
    await emit('message_end', { message: { role: 'user', timestamp: Date.now() - 1000 } }, ctx);
    await emit('message_start', { message: { role: 'assistant' } }, ctx);
    await emit('message_end', { message: { role: 'assistant', stopReason: 'stop', usage: { output: 100 } } }, ctx);
    await emit('turn_end', { message: { role: 'assistant', stopReason: 'stop' } }, ctx);
    await emit('agent_end', {}, ctx);
    assert.equal(entries.length - before, hasTimestamps ? 2 : 0, 'Exactly one timestamp writer');
    if (f) assert.doesNotMatch(f.render(120).join('\n'), /t\/s|avg/);
    await emit('session_shutdown', { reason: 'reload' }, ctx);
    f?.dispose();
    if (f) assert.deepEqual(f.render(80), []);
  }
  assert.equal(subscriptions, hasFooter ? 2 : 0);
  assert.equal(disposed, subscriptions);
  for (const mode of ['rpc', 'json', 'print']) {
    const other = { ...ctx, mode, ui: new Proxy({}, { get() { throw new Error(`${mode} must not access UI`); } }) };
    const before = entries.length;
    await emit('session_start', { reason: 'startup' }, other);
    await emit('message_end', { message: { role: 'user', timestamp: Date.now() } }, other);
    await emit('turn_end', { message: { role: 'assistant', stopReason: 'stop' } }, other);
    await emit('session_shutdown', { reason: 'quit' }, other);
    assert.equal(entries.length, before);
  }
  console.log(`Pi loader and lifecycle passed: ${names.join(', ')}`);
}
for (const candidate of candidates) await check([candidate]);
if (candidates.length > 1) {
  await check(candidates);
  await check([...candidates].reverse());
}
