# Pi statusline

`@tahabakhit/pi-statusline` replaces Pi's header, editor layout, and footer. It adds local timestamps after user messages and final replies. Tools and messages keep Pi's native rendering.

Version 0.1.0 is prepared locally and has not been published. After publication, install it with:

```sh
	pi install npm:@tahabakhit/pi-statusline
```

For a local session before publication, run this from the repository root:

```sh
	pi -e ./packages/pi-statusline
```

## UI behavior

The header shows the session name. The native `CustomEditor` has the working indicator in its border. Pi still handles completion, paste, selection, IME, and keyboard shortcuts.

The footer shows the directory, Git branch, model, and effort. The next row shows context used and used/window token counts. Context warns at 80% and errors at 90%. Unknown context is `?`, not zero. At narrow widths, the directory abbreviates before the branch and directory disappear. Other extensions' statuses appear on a separate row.

After a measured reply, the footer adds output generation speed for the last reply and the session average. Generation time starts at the first streamed chunk and ends at message completion. The average divides measured output tokens by total measured generation time. Failed, aborted, empty, and sub-250 ms replies do not count. Resumed history has no timing. Narrow layouts drop speed before context.

Timestamps show local 24-hour time. Final replies also show elapsed time since the user message. A date appears on the first stamp and when the day changes. Intermediate tool-call turns get no stamp. Stamps persist as custom session entries and never reach the model. Legacy `pi-stamp` rows still render their timestamps.

The package runs its UI and stamp writes only in TUI mode. It adds no tools, network requests, credentials access, quota display, or external commands. Colors use the active Pi theme's semantic roles. No dotfiles theme is required.

## Compatibility and ownership

The package uses the Pi 1.5.2 extension APIs. Its unit tests inject host classes and do not prove real keyboard, paste, or terminal rendering behavior. Other Pi versions and operating systems need their own runtime checks. Node 22 or newer is required.

Do not load this package alongside another extension that replaces the header, footer, or editor. If you previously deployed `~/.pi/agent/extensions/statusline/` through dotfiles, back it up outside the extension discovery directory and retire that live copy before enabling this package. Removing the dotfiles source alone does not remove the live copy. Do not keep the backup under `~/.pi/agent/extensions/`.

`src/index.js` imports Pi's host classes. `src/ui.js` contains the layout and lifecycle logic. Pi supplies the working animation and Git branch observer. The extension disposes its branch subscription when the footer is replaced or the session shuts down.

To stop loading the npm package, run `pi remove npm:@tahabakhit/pi-statusline` and restart Pi. If dotfiles still declares the package, remove that declaration too or Pi installs it again on a later launch. Existing timestamp entries remain in session history.
