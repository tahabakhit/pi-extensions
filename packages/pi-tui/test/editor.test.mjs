import assert from 'node:assert/strict';
import test from 'node:test';
import { installEditor } from '../src/editor.js';

test('only the native TUI editor changes, without intercepting keyboard or message events', () => {
  const handlers = new Map();
  class CustomEditor { constructor(...args) { this.args = args; } }
  installEditor({ on: (event, fn) => handlers.set(event, fn) }, { CustomEditor });
  assert.deepEqual([...handlers.keys()], ['session_start']);
  for (const mode of ['rpc', 'json', 'print']) {
    handlers.get('session_start')({}, { mode, ui: new Proxy({}, { get() { throw new Error('No non-TUI UI access'); } }) });
  }
  for (const reason of ['startup', 'reload']) {
    let factory;
    const ui = { setEditorComponent: value => { factory = value; } };
    handlers.get('session_start')({ reason }, { mode: 'tui', ui });
    const editor = factory('tui', 'theme', 'keybindings');
    assert.equal(editor.constructor, CustomEditor);
    assert.deepEqual(editor.args, ['tui', 'theme', 'keybindings', { paddingX: 1, embedWorkingStatus: true }]);
  }
});
