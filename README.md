# harbor

Harbor is a static-first clubhouse prototype built with Astro. This first slice
ships a readable article layout, canonical artifact pages, and a small isometric
fishing pond that can surface those artifacts as catches.

## What is here

- Markdown-backed posts and artifact pages
- A generated `/pond/manifest.json` built from content and pond YAML
- A sidecar pond on the article page plus a dedicated pond room
- Unit and component tests for the pond loop and manifest generation

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
- `src/components/pond/PondApp.test.tsx` covers a cast -> bite -> reel -> keep flow.
- `scripts/generate-pond-manifest.test.mjs` covers manifest normalization and validation.
