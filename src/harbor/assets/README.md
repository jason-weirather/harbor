# Harbor Asset Pipeline

Harbor is a portable fishing widget. Astro hosts demos, but the widget renderer should be able to load the same asset names in any host.

The current canvas renderer uses procedural placeholders that are keyed to final atlas names. Keep those names stable as bitmap art arrives so the renderer can switch from placeholder drawing to atlas drawing without touching game mechanics.

## Expected Structure

```txt
src/harbor/assets/
  atlases/
    harbor-tiles.png
    harbor-tiles.json
    harbor-characters.png
    harbor-characters.json
    harbor-fish.png
    harbor-fish.json
    harbor-fx.png
    harbor-fx.json
  maps/
    pond-v2.tiled.json
  palettes/
    dawn.json
    dusk.json
```

## Placeholder Frame Names

```txt
tile.water.shallow.0
tile.water.deep.0
tile.sand.0
tile.grass.0
overlay.shore.foam.0
prop.tree.pine.0
prop.reeds.0
fisher.idle.right.0
fisher.cast.right.0
fisher.reel.right.0
fish.lanternKoi.swim.0
fx.ripple.0
fx.splash.0
fx.sparkle.0
```

## Art Direction

Aim for an original cozy HD-2D fishing diorama: crisp pixel sprites, soft dawn lighting, cool water depth, visible shoreline transitions, foreground occlusion, and tiny expressive animation. Do not copy existing game assets or exact designs.
