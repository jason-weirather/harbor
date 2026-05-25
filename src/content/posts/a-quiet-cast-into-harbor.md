---
title: A Quiet Cast Into Harbor
summary: Harbor is a static-first clubhouse where essays and playful rooms can live side by side.
authorName: Josh
publishedAt: 2026-05-25
heroTag: Static-first stories, playful rooms
pond:
  roomUrl: /rooms/pond/
  placement:
    desktop: sidecar
    mobile: card-after-intro
---

Harbor starts from a simple promise: the writing should still make sense after the toy is gone.

This hello-world build treats the pond as a companion room for the article, not a replacement for it. The page keeps the essay readable, the game state local, and the artifact URLs durable. That means you can ship a whimsical fishing toy without turning the whole site into a fragile app.

The interactive pond on the right is intentionally small. It already knows how to:

- honor a simple 0/1/2 viewport mask,
- let readers target playable water tiles,
- run a tiny cast, wait, reel loop,
- keep up to six fish in a creel,
- reveal artifact links that open their own canonical pages.

The next good step after this prototype would be richer content pipelines: more posts, more artifacts, more rooms, and a build pass that can validate editorial metadata before it ships.

