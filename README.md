# harbor

Harbor is a portable fishing game widget. Astro is now just the demo host around
that widget, not the product boundary itself.

## What is here

- `src/harbor/HarborWidget.tsx` as the reusable widget surface
- `src/harbor/mountHarborWidget.ts` for mounting the widget into any host DOM container
- `src/harbor/WidgetDemoHost.tsx` as a minimal embedded demo host for the widget
- A generated `/pond/manifest.json` built from pond YAML, fish YAML, spawn tables, and demo artifacts
- A shoreline fishing loop with walkable land, fishable water, ambient swimmers, and a catch rail
- Generic widget artifacts that can come from manifest JSON, Markdown, API data, or host-provided JS
- `/rooms/pond/` as the standalone widget demo
- `/widget-demo/` as the minimal embedded widget demo inside a thin Astro host
- Tests for pond mechanics, widget callbacks, host mounting, and manifest generation

## Route shape

- `/` and `/rooms/pond/` host the standalone widget demo.
- `/widget-demo/` hosts the embedded widget demo.
- `/plain/posts/<slug>/` and `/plain/artifacts/<slug>/` remain sample reading targets for demo artifacts.

## Run locally

Harbor is a Node project. It does not need its own Python environment, so your
`mamba` environment only matters if it already exposes `node` and `npm`.

```bash
npm install
npm run dev
```

Then open the local Astro dev server URL that appears in the terminal.

If you only care about the product surface, start with `src/harbor/`. The
widget lives there; Astro is just the demo harness used in this repo.

## Useful commands

```bash
npm run pond:build
npm run scene:capture -- --width 1758 --height 1035 --out tmp/pond-scene.png
npm run test
npm run build
npm run preview
```

`npm run scene:capture` builds the site, starts a temporary local preview
server, and saves a PNG of the visible game board only. This is still the preferred
debug path for visual iteration now that the in-UI export button is gone.

## Widget API

`HarborWidget` accepts:

- `manifest`
- `title`
- `mode: "standalone" | "embedded" | "background"`
- `artifactAdapter`
- `onCatch`
- `onArtifactSelected`
- `onRequestOpenArtifact`
- `onStateChange`

`mountHarborWidget(container, options)` returns a controller with:

- `destroy()`
- `getState()`
- `setArtifacts(artifacts)`
- `clearCreel()`

Use `HarborWidget` directly when you already have a React host. Use
`mountHarborWidget(...)` when you want to mount into a plain DOM container from
host JavaScript.

## Test examples

- `npm run test` runs the whole suite.
- `src/lib/pond/game.test.ts` covers cast rules, weighted fish picks, and seeded catches.
- `src/components/game/FishingGameShell.test.tsx` covers bank movement, the cast -> bite -> reel flow, and artifact reading links through the compatibility wrapper.
- `src/harbor/HarborWidget.test.tsx` covers host callbacks, zero-artifact catches, and embedded mode behavior.
- `src/harbor/mountHarborWidget.test.tsx` covers plain DOM mounting and controller methods.
- `scripts/generate-pond-manifest.test.mjs` covers manifest normalization and validation.
