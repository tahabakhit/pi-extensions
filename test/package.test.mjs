import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const workspace = path.join(root, 'packages/pi-statusline');
function run(command, args, cwd) {
	const env = { ...process.env, npm_config_update_notifier: 'false' };
	delete env.NODE_TEST_CONTEXT;
	const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 60000, env });
	assert.ifError(result.error);
	assert.equal(result.status, 0, result.stderr + result.stdout);
	return result.stdout;
}

test('the published artifact contains only public files and passes the behavioral suite outside the checkout', t => {
	const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-statusline-pack-'));
	t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
	const [artifact] = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temp], workspace));
	assert.deepEqual(artifact.files.map(file => file.path).sort(), [
		'CHANGELOG.md', 'LICENSE', 'README.md', 'package.json', 'src/index.js', 'src/ui.js',
	]);
	const archive = path.join(temp, artifact.filename);
	const digest = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
	t.diagnostic(`${artifact.filename}, ${artifact.size} bytes, sha256 ${digest}`);
	run('tar', ['-xzf', archive, '-C', temp], temp);
	const extracted = path.join(temp, 'package');
	const manifest = JSON.parse(fs.readFileSync(path.join(extracted, 'package.json'), 'utf8'));
	assert.equal(manifest.name, '@tahabakhit/pi-statusline');
	assert.equal(manifest.publishConfig.access, 'public');
	assert.deepEqual(manifest.pi.extensions, ['./src/index.js']);
	assert.equal(manifest.dependencies, undefined);
	assert.equal(manifest.scripts.preinstall, undefined);
	assert.equal(manifest.scripts.postinstall, undefined);
	for (const entry of manifest.pi.extensions) assert.ok(fs.existsSync(path.join(extracted, entry)));
	for (const file of ['src/index.js', 'src/ui.js']) {
		assert.deepEqual(fs.readFileSync(path.join(extracted, file)), fs.readFileSync(path.join(workspace, file)));
		run(process.execPath, ['--check', path.join(extracted, file)], temp);
	}
	fs.mkdirSync(path.join(extracted, 'test'));
	fs.copyFileSync(path.join(workspace, 'test/statusline.test.mjs'), path.join(extracted, 'test/statusline.test.mjs'));
	const result = run(process.execPath, ['--test', '--test-reporter=tap', 'test/statusline.test.mjs'], extracted);
	assert.match(result, /# fail 0/);
});
