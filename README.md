# Pi extensions

Independently installable extensions for [Pi](https://pi.dev), published under the `@tahabakhit` npm scope.

| Package | Purpose | Candidate |
| --- | --- | --- |
| [pi-statusline](packages/pi-statusline/README.md) | Footer with directory, branch, model, and context usage | 0.2.0, not published |
| [pi-tui](packages/pi-tui/README.md) | Native editor layout, message timestamps, and reply durations | 0.1.0, not published |

The published `pi-statusline@0.1.0` bundles all these behaviors, speed measurement, and a custom header. The source candidates split those responsibilities and remove speed measurement and the custom header entirely. Follow [the migration guide](docs/migrate-0.2.md) when the candidates are published.

Each extension has its own manifest, source, tests, changelog, and license under `packages/<name>`. The root is a private npm workspace, not a Pi bundle. The packages do not depend on one another. This layout follows [narumiruna/pi-extensions](https://github.com/narumiruna/pi-extensions). No code from that repository is included.

No dependency installation or build step is required for source tests:

```sh
	npm run check
```

To try one candidate in Pi, pass its package directory with `-e`. Do not also load the published bundled version or a copied legacy extension. See [release steps](docs/releasing.md).
