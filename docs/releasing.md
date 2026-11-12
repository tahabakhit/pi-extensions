# Publish an extension

Each workspace has its own version and npm release. Run these commands from the repository root.

1. Update the package's `version` and `CHANGELOG.md`.
2. Run the tests:

```sh
	npm run check
```

3. Pack the selected workspace into a directory outside the checkout:

```sh
	mkdir -p /tmp/pi-extensions-release
	npm pack --workspace @tahabakhit/pi-statusline --ignore-scripts --pack-destination /tmp/pi-extensions-release
	tar -tzf /tmp/pi-extensions-release/tahabakhit-pi-statusline-0.2.0.tgz
	sha256sum /tmp/pi-extensions-release/tahabakhit-pi-statusline-0.2.0.tgz
```

Use the versioned filename that `npm pack` reports. These examples use the footer-only 0.2.0 candidate. Pack the TUI workspace separately. Its archive contains both editor and timestamp modules. Check the archive contents and test the extracted package outside the checkout. `npm run check` also packs a temporary artifact, checks its file list, and runs the behavioral tests against its extracted code.

For an installed Pi distribution, `test/host-smoke.mjs` accepts the Pi package
directory followed by one or more extracted extension package directories.
It uses that distribution's loader without starting an agent or reading your
Pi settings. It checks entrypoint imports, startup, reload, footer rendering,
subscription disposal, non-TUI guards, and coexistence in both package orders. It does not test a real terminal or
instantiate the editor. The loader path is internal to Pi and may change.

4. Confirm that your npm account can publish to `@tahabakhit`. Review the source and archive for secrets. Before committing to the public repository, scan staged changes:

```sh
	gitleaks git --staged
```

5. With publication approval, publish the reviewed tarball, not a rebuilt workspace:

```sh
	npm publish /tmp/pi-extensions-release/tahabakhit-pi-statusline-0.2.0.tgz --access public --ignore-scripts
```

6. Verify the registry version and contents before changing consumers. Update the root package table after publication.

The host supplies Pi imports. Keep those imports in `peerDependencies` with `"*"` ranges, not `dependencies`. Add new extensions as separate workspaces. Do not add a root `pi.extensions` list that loads all packages together.
