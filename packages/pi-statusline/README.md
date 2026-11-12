# Pi statusline

`@tahabakhit/pi-statusline` replaces only Pi's footer. It shows the directory, Git branch, model, effort, and context usage.

After the 0.2.0 release is available, install it with `pi install npm:@tahabakhit/pi-statusline@0.2.0`.

To try the local source from the repository root:

```sh
	pi -e ./packages/pi-statusline
```

Do not load the published bundled 0.1.0 version at the same time.

## Footer behavior

The first row shows directory, branch, model, and effort. The next row shows context used and used/window token counts. Unknown usage is `?`, not zero. The color changes at 80% and 90% used. Narrow layouts abbreviate the directory, then drop the branch and directory to keep the model visible. Other extensions' statuses appear on a separate row.

The package uses the active Pi theme's semantic colors. It needs no dotfiles theme. It disposes its Git branch subscription on footer replacement and session shutdown.

There is no speed measurement, header replacement, editor replacement, or timestamp writer. The package adds no tools, commands, network requests, external processes, or session entries. It changes the UI only in TUI mode.

## Compatibility

The loader diagnostic targets Pi 1.5.2. Unit tests inject host helpers and do not prove real terminal behavior. Node 22 or newer is required. Other Pi versions and operating systems need separate runtime checks.

Do not load another footer replacement alongside this package. It can run independently or alongside `@tahabakhit/pi-tui`, which owns editor layout and transcript timestamps. See [migration from 0.1.0](https://github.com/tahabakhit/pi-extensions/blob/main/docs/migrate-0.2.md) in the source repository.
