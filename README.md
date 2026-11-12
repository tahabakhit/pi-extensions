# Pi extensions

Independently installable extensions for [Pi](https://pi.dev), published under the `@tahabakhit` npm scope.

| Package | Purpose | Release |
| --- | --- | --- |
| [@tahabakhit/pi-statusline](packages/pi-statusline/README.md) | Header, native editor, context footer, token speed, and message timestamps | 0.1.0, prepared locally, not published |

Each extension lives in `packages/<name>` with its own manifest, source, tests, changelog, and license. The root is a private npm workspace, not an installable Pi bundle. Installing one package does not load the others. This layout follows [narumiruna/pi-extensions](https://github.com/narumiruna/pi-extensions). No code from that repository is included.

For local development, no dependency installation or build step is required:

```sh
	npm run check
	pi -e ./packages/pi-statusline
```

The Pi command starts an interactive session with the local package. Do not also load an installed copy or another extension that replaces the same UI components. See [package behavior](packages/pi-statusline/README.md) and [release steps](docs/releasing.md).
