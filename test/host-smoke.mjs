// Optional diagnostic against an explicitly selected installed Pi distribution.
// Usage: node test/host-smoke.mjs /path/to/pi-coding-agent /path/to/extracted/package
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [host, candidate] = process.argv.slice(2).map(value => path.resolve(value));
assert.ok(host && candidate, 'Pass the installed Pi package and extracted extension package paths');
const manifest = JSON.parse(fs.readFileSync(path.join(candidate, 'package.json'), 'utf8'));
const { loadExtensions } = await import(pathToFileURL(path.join(host, 'dist/core/extensions/loader.js')));
const result = await loadExtensions(manifest.pi.extensions.map(entry => path.join(candidate, entry)), candidate);
assert.deepEqual(result.errors, []);
assert.equal(result.extensions.length, 1);
const extension = result.extensions[0];
assert.equal(extension.tools.size, 0);
assert.equal(extension.commands.size, 0);
assert.equal(extension.entryRenderers.size, 2);
const emit = async (event, payload, ctx) => {
	for (const handler of extension.handlers.get(event) ?? []) await handler(payload, ctx);
};
let editor, header, footer, subscriptions = 0, disposed = 0;
const ui = {
	setEditorComponent: factory => { editor = factory; },
	setHeader: factory => { header = factory; },
	setFooter: factory => { footer = factory; },
};
const ctx = {
	mode: 'tui', cwd: candidate, ui,
	model: { id: 'fixture-model', contextWindow: 100000 }, thinkingLevel: 'medium',
	getContextUsage: () => ({ percent: 25, tokens: 25000, contextWindow: 100000 }),
	sessionManager: { getSessionName: () => 'artifact smoke', getBranch: () => [] },
};
const theme = { fg: (_color, value) => value };
const data = {
	getGitBranch: () => 'main', getExtensionStatuses: () => new Map(),
	onBranchChange: () => { subscriptions++; return () => { disposed++; }; },
};
for (const reason of ['startup', 'reload']) {
	await emit('session_start', { reason }, ctx);
	assert.equal(typeof editor, 'function');
	const h = header({}, theme);
	const f = footer({ requestRender() {} }, theme, data);
	assert.deepEqual(h.render(80), ['Pi · artifact smoke']);
	assert.match(f.render(120)[0], /fixture-model medium/);
	assert.equal(f.render(120)[1], 'Context 25% used (25k/100k)');
	await emit('model_select', {}, { ...ctx, model: { ...ctx.model, id: 'changed' } });
	assert.match(f.render(120)[0], /changed/);
	await emit('session_shutdown', { reason: 'reload' }, ctx);
	f.dispose();
	assert.deepEqual(f.render(80), []);
}
assert.equal(subscriptions, 2);
assert.equal(disposed, 2);
for (const mode of ['rpc', 'json', 'print']) {
	await emit('session_start', { reason: 'startup' }, { ...ctx, mode, ui: new Proxy({}, {
		get() { throw new Error(`${mode} must not call UI factories`); },
	}) });
	await emit('session_shutdown', { reason: 'quit' }, { ...ctx, mode });
}
console.log('Pi loader import, TUI startup/reload/footer/disposal, and non-TUI guards passed.');
