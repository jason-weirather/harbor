---
title: A Quiet Cast Into Harbor
summary: Harbor is a portable fishing widget that can sit inside a page without taking the whole site hostage.
authorName: Josh
publishedAt: 2026-05-25
heroTag: Portable widget, durable reading
pond:
  roomUrl: /rooms/pond/
  placement:
    desktop: sidecar
    mobile: card-after-intro
---

Harbor starts from a simple promise: the page should still make sense even when the fishing widget moves somewhere else later.

This hello-world build treats the pond as a portable module, not the center of an entire framework. The page keeps the essay readable, the game state local to the widget, and the artifact URLs durable. That means you can ship a whimsical fishing toy without turning the whole site into a fragile app.

The interactive pond on the right is intentionally small. It already knows how to:

- honor a simple 0/1/2 viewport mask,
- let readers target playable water tiles,
- run a tiny cast, wait, reel loop,
- keep up to six fish in a creel,
- reveal artifact links that open their own canonical pages.

The next good step after this prototype would be stronger host examples: more ways to embed the widget, more generic artifact payloads, and a cleaner handoff between host code and the fishing loop.
