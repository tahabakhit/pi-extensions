import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
function run(command, args, cwd) {
  const env = { ...process.env, npm_config_update_notifier: 'false' };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 60000, env });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return result.stdout;
}
for (const [name, modules, suites] of [
  ['pi-statusline', ['footer.js'], ['statusline.test.mjs']],
  ['pi-tui', ['editor.js', 'timestamps.js'], ['editor.test.mjs', 'timestamps.test.mjs']],
]) {
  test(`${name} archive contains only public files and passes tests outside the checkout`, t => {
    const workspace = path.join(root, 'packages', name);
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-pack-`));
    t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
    const [artifact] = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temp], workspace));
    assert.deepEqual(artifact.files.map(file => file.path).sort(), [
      'CHANGELOG.md', 'LICENSE', 'README.md', 'package.json', 'src/index.js', ...modules.map(module => `src/${module}`),
    ].sort());
    const archive = path.join(temp, artifact.filename);
    const digest = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
    t.diagnostic(`${artifact.filename}, ${artifact.size} bytes, sha256 ${digest}`);
    run('tar', ['-xzf', archive, '-C', temp], temp);
    const extracted = path.join(temp, 'package');
    const manifest = JSON.parse(fs.readFileSync(path.join(extracted, 'package.json'), 'utf8'));
    assert.equal(manifest.name, `@tahabakhit/${name}`);
    assert.equal(manifest.publishConfig.access, 'public');
    assert.deepEqual(manifest.pi.extensions, ['./src/index.js']);
    assert.equal(manifest.dependencies, undefined);
    assert.equal(manifest.scripts.preinstall, undefined);
    assert.equal(manifest.scripts.postinstall, undefined);
    for (const file of ['src/index.js', ...modules.map(module => `src/${module}`)]) {
      assert.deepEqual(fs.readFileSync(path.join(extracted, file)), fs.readFileSync(path.join(workspace, file)));
      run(process.execPath, ['--check', path.join(extracted, file)], temp);
    }
    fs.mkdirSync(path.join(extracted, 'test'));
    for (const suite of suites) {
      fs.copyFileSync(path.join(workspace, 'test', suite), path.join(extracted, 'test', suite));
    }
    assert.match(run(process.execPath, ['--test', '--test-reporter=tap', ...suites.map(suite => `test/${suite}`)], extracted), /# fail 0/);
  });
}
