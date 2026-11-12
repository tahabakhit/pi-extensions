# Migrate the bundled statusline

The candidates in this checkout are not published yet. Do not deploy their npm declarations until both releases are available.

1. Back up your Pi settings and any copied `~/.pi/agent/extensions/statusline/` directory outside Pi's extension discovery directories.
2. Remove the copied extension and the old `npm:@tahabakhit/pi-statusline` package declaration before enabling the split packages.
3. After publication, select the packages you want. Use the exact footer-only version to avoid the bundled 0.1.0 release:

```json
	{
		"packages": [
			"npm:@tahabakhit/pi-statusline@0.2.0",
			"npm:@tahabakhit/pi-tui@0.1.0"
		]
	}
```

Merge those entries into your existing package list. Do not replace unrelated packages. Each package is optional. Keep only `pi-statusline` for the footer, or add `pi-tui` for the editor layout and transcript timestamps.

4. Restart Pi and check `pi list`. Confirm that the old bundled or copied statusline is no longer loaded. Pi installs declared missing packages on launch.
5. Confirm that the footer has no output-speed display, the header is Pi's default, and timestamp rows appear once if enabled.

Existing timestamp entries remain readable because `pi-tui` preserves both `statusline-stamp` and legacy `pi-stamp` renderers. Nothing measures generation speed in the split packages.

To roll back, stop loading all split packages before restoring the bundled 0.1.0 declaration or copied backup. Never restore the old bundle alongside the separate timestamp writer.
