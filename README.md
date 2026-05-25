# harbor

Harbor is a static-first clubhouse prototype built with Astro. This first slice
ships a fishing-first isometric shoreline prototype, world routes that all boot
into the same playable pond, and durable plain reading pages behind the catches.

## What is here

- Markdown-backed posts and artifact pages
- A generated `/pond/manifest.json` built from content and pond YAML
- A full-screen shoreline board with walkable land tiles, fishable water, and ambient swimmers
- A cast-only fishing loop that auto-hooks fish into the bottom catch rail
- A bottom catch rail with score, throw-back controls, and artifact reading links
- A plain article fallback route at `/plain/posts/<slug>/`
- Plain artifact reading routes at `/plain/artifacts/<slug>/`
- Unit and component tests for the pond loop and manifest generation

## Route shape

- `/`, `/rooms/pond/`, `/posts/<slug>/`, and `/artifacts/<slug>/` all use the game-first shell.
- `/plain/posts/<slug>/` and `/plain/artifacts/<slug>/` are the durable reading fallbacks for now.

## Run locally

Harbor is a Node project. It does not need its own Python environment, so your
`mamba` environment only matters if it already exposes `node` and `npm`.

```bash
npm install
npm run dev
```

Then open the local Astro dev server URL that appears in the terminal.

## Useful commands

```bash
npm run pond:build
npm run test
npm run build
npm run preview
```

## Test examples

- `npm run test` runs the whole suite.
- `src/lib/pond/game.test.ts` covers cast rules, weighted fish picks, and seeded catches.
- `src/components/game/FishingGameShell.test.tsx` covers bank movement, the cast -> bite -> reel flow, and artifact reading links.
- `scripts/generate-pond-manifest.test.mjs` covers manifest normalization and validation.
