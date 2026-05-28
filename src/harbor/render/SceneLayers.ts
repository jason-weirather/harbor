import type { Tile } from "../../lib/pond/types";
import type { HarborSpriteName } from "./SpriteAtlas";

export type BackdropTerrain = "water" | "water-deep" | "sand" | "grass";

export interface BackdropTile extends Tile {
  terrain: BackdropTerrain;
}

export type HarborSceneLayer =
  | "background"
  | "terrain"
  | "shoreOverlay"
  | "waterLife"
  | "props"
  | "characters"
  | "fx"
  | "foreground"
  | "lighting";

export const HARBOR_SCENE_LAYERS: HarborSceneLayer[] = [
  "background",
  "terrain",
  "shoreOverlay",
  "waterLife",
  "props",
  "characters",
  "fx",
  "foreground",
  "lighting",
];

export interface ScenePropPlacement {
  asset: HarborSpriteName;
  id: string;
  layer: HarborSceneLayer;
  offsetX: number;
  offsetY: number;
  order?: number;
  scale: number;
  tile: Tile;
}

export const SCENE_PROP_PLACEMENTS: ScenePropPlacement[] = [
  {
    asset: "prop.tree.pine.0",
    id: "upper-pine",
    layer: "props",
    offsetX: 11,
    offsetY: -42,
    scale: 1.18,
    tile: { row: 3, col: 12 },
  },
  {
    asset: "prop.tree.pine.0",
    id: "ridge-pine",
    layer: "props",
    offsetX: 12,
    offsetY: -34,
    scale: 1.08,
    tile: { row: 5, col: 13 },
  },
  {
    asset: "prop.tree.pine.0",
    id: "lower-pine",
    layer: "props",
    offsetX: 8,
    offsetY: -30,
    scale: 1,
    tile: { row: 6, col: 14 },
  },
  {
    asset: "prop.tree.pine.0",
    id: "edge-pine",
    layer: "props",
    offsetX: 10,
    offsetY: -28,
    scale: 0.94,
    tile: { row: 7, col: 14 },
  },
  {
    asset: "prop.tree.pine.0",
    id: "foothill-pine",
    layer: "props",
    offsetX: 8,
    offsetY: -24,
    scale: 0.9,
    tile: { row: 10, col: 15 },
  },
  {
    asset: "prop.bush.0",
    id: "shore-bush",
    layer: "props",
    offsetX: 8,
    offsetY: -10,
    scale: 1,
    tile: { row: 9, col: 13 },
  },
  {
    asset: "prop.bush.0",
    id: "lower-bush",
    layer: "props",
    offsetX: 4,
    offsetY: -6,
    scale: 0.96,
    tile: { row: 12, col: 13 },
  },
  {
    asset: "prop.rock.0",
    id: "shore-rock",
    layer: "props",
    offsetX: 14,
    offsetY: -3,
    scale: 1,
    tile: { row: 4, col: 12 },
  },
  {
    asset: "prop.reeds.0",
    id: "cattails-a",
    layer: "shoreOverlay",
    offsetX: -8,
    offsetY: 10,
    scale: 0.88,
    tile: { row: 2, col: 7 },
  },
  {
    asset: "prop.reeds.0",
    id: "cattails-b",
    layer: "shoreOverlay",
    offsetX: -6,
    offsetY: 11,
    scale: 0.94,
    tile: { row: 3, col: 8 },
  },
  {
    asset: "prop.reeds.0",
    id: "cattails-c",
    layer: "shoreOverlay",
    offsetX: -4,
    offsetY: 12,
    scale: 1,
    tile: { row: 4, col: 9 },
  },
  {
    asset: "prop.foreground.foliage.0",
    id: "foreground-left",
    layer: "foreground",
    offsetX: -70,
    offsetY: -16,
    order: 8,
    scale: 1.42,
    tile: { row: 13, col: 10 },
  },
  {
    asset: "prop.foreground.foliage.0",
    id: "foreground-bottom",
    layer: "foreground",
    offsetX: -16,
    offsetY: 16,
    order: 9,
    scale: 1.18,
    tile: { row: 14, col: 12 },
  },
];

function getBackdropTerrain(row: number, col: number): BackdropTerrain {
  const shoreline = 12 - row * 0.28;

  if (col >= shoreline + 2.6) {
    return "grass";
  }

  if (col >= shoreline + 1.1) {
    return "sand";
  }

  return (row + col) % 2 === 0 ? "water" : "water-deep";
}

export function buildBackdropTiles(): BackdropTile[] {
  const tiles: BackdropTile[] = [];

  for (let row = -14; row <= 32; row += 1) {
    for (let col = -12; col <= 34; col += 1) {
      tiles.push({
        row,
        col,
        terrain: getBackdropTerrain(row, col),
      });
    }
  }

  return tiles;
}
