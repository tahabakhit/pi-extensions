// Keep Pi's native editor, keyboard handling, and working animation.
export function installEditor(pi, { CustomEditor }) {
  pi.on('session_start', (_event, ctx) => {
    if (ctx.mode !== 'tui') return;
    ctx.ui.setEditorComponent((tui, theme, keybindings) =>
      new CustomEditor(tui, theme, keybindings, { paddingX: 1, embedWorkingStatus: true }));
  });
}
