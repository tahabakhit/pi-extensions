# Pi TUI

`@tahabakhit/pi-tui` configures Pi's native editor layout and adds message timestamps and reply durations to the transcript.

After the 0.1.0 release is available, install it with `pi install npm:@tahabakhit/pi-tui@0.1.0`.

To try the local source from the repository root:

```sh
	pi -e ./packages/pi-tui
```

## Editor behavior

The extension creates Pi's own `CustomEditor` with `paddingX: 1` and `embedWorkingStatus: true`. Pi handles keyboard shortcuts, completion, paste, selection, IME, and working animation. The extension has no custom input handler.

## Transcript behavior

Timestamps show local 24-hour time after user messages and final replies. Final replies also show elapsed time since the user message. A date appears on the first timestamp and when the day changes. Intermediate tool-call turns get no timestamp.

The extension writes custom `statusline-stamp` session entries with the same type and data format as the former bundled statusline. Those entries persist but never enter model context. The extension also renders historical `pi-stamp` entries. Shutdown flushes pending user timestamps. New sessions reset pending state and restore date context from the active branch.

The editor changes and timestamp writes run only in TUI mode. Pi's header stays native. The package has no footer, speed measurement, commands, tools, external processes, or network access.

## Compatibility and ownership

Node 22 or newer is required. The loader diagnostic targets Pi 1.5.2. Unit tests check editor construction with an injected class and timestamp behavior with an injected clock. Real keyboard and terminal behavior need an interactive check.

Do not load this package alongside another editor replacement or timestamp writer. The bundled `pi-statusline@0.1.0` and the copied legacy statusline both overlap with this package. It can run independently or alongside footer-only `pi-statusline@0.2.0`.

`src/index.js` registers both modules. `src/editor.js` owns the editor layout, and `src/timestamps.js` owns timestamp writes and rendering. No separate timestamp package is required.

Removing this package stops new timestamp writes but does not delete historical entries. Restart or reload Pi after removing its declaration to restore the default editor. Re-enabling the package restores its historical timestamp renderers.
