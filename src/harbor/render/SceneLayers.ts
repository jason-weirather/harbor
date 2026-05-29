import type { ShoreTile, Tile } from "../../lib/pond/types";
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

function getWaterEdgeByRow(mask: string[]) {
  return mask.map((row) => {
    const firstLandCol = row.indexOf("0");

    return firstLandCol === -1 ? row.length : firstLandCol;
  });
}

function getExtrapolatedWaterEdge(row: number, waterEdges: number[]) {
  if (waterEdges.length === 0) {
    return 8;
  }

  if (row < 0) {
    const leadSlope = ((waterEdges[3] ?? waterEdges[0]) - waterEdges[0]) / 3;

    return waterEdges[0] + row * Math.max(0.35, leadSlope);
  }

  if (row >= waterEdges.length) {
    const lastIndex = waterEdges.length - 1;
    const tailSlope = (waterEdges[lastIndex] - (waterEdges[lastIndex - 3] ?? waterEdges[lastIndex])) / 3;

    return waterEdges[lastIndex] + (row - lastIndex) * Math.min(-0.35, tailSlope);
  }

  return waterEdges[row];
}

function getBackdropTerrain(row: number, col: number, waterEdges: number[]): BackdropTerrain {
  const waterEdge = getExtrapolatedWaterEdge(row, waterEdges);
  const grassEdgeNoise = ((row * 17 + col * 11) % 5) * 0.08;

  if (col >= waterEdge + 3.15 + grassEdgeNoise) {
    return "grass";
  }

  if (col >= waterEdge - 0.2) {
    return "sand";
  }

  return col <= waterEdge - 5.5 || (row + col) % 3 === 0 ? "water-deep" : "water";
}

export function buildBackdropTiles(mask: string[], shoreline: ShoreTile[]): BackdropTile[] {
  const tiles: BackdropTile[] = [];
  const waterEdges = getWaterEdgeByRow(mask);
  const rowMin = -30;
  const rowMax = mask.length + 26;
  const colMax = Math.max(...mask.map((row) => row.length), 20) + 28;
  const colMin = -28;

  for (let row = rowMin; row <= rowMax; row += 1) {
    for (let col = colMin; col <= colMax; col += 1) {
      tiles.push({
        row,
        col,
        terrain: getBackdropTerrain(row, col, waterEdges),
      });
    }
  }

  for (const tile of shoreline) {
    const terrain = tile.dock ? "sand" : tile.terrain ?? "grass";

    tiles.push({
      row: tile.row,
      col: tile.col,
      terrain: terrain === "dock" || terrain === "path" ? "sand" : terrain,
    });
  }

  return tiles;
}
