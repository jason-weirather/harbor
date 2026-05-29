import type { ShoreTile, Tile } from "../../lib/pond/types";
import type { ScenePoint } from "./HarborRenderer";
import { clamp, getDeterministicNoise } from "./palette";
import type { HarborSpriteName } from "./SpriteAtlas";

export type BackdropTerrain = "water" | "water-deep" | "sand" | "dirt" | "grass";

export interface BackdropTile extends Tile {
  terrain: BackdropTerrain;
}

export interface ResponsiveTerrainContext {
  viewportHeight: number;
  viewportWidth: number;
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
];

function getWaterEdgeByRow(mask: string[]) {
  return mask.map((row) => {
    const firstLandCol = row.indexOf("0");

    return firstLandCol === -1 ? row.length : firstLandCol;
  });
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const progress = clamp((value - edge0) / Math.max(0.001, edge1 - edge0), 0, 1);

  return progress * progress * (3 - 2 * progress);
}

function getShorelineNoise(tile: Tile) {
  const broad = getDeterministicNoise(Math.floor(tile.row / 2), 4, 41) - 0.5;
  const pocket = getDeterministicNoise(Math.floor(tile.row / 2), Math.floor(tile.col / 3), 47) - 0.5;
  const notch = getDeterministicNoise(Math.floor(tile.row / 2), 13, 53);
  const cape = getDeterministicNoise(Math.floor(tile.row / 5), 29, 59);

  return broad * 0.09 + pocket * 0.045 + (notch > 0.76 ? -0.065 : 0) + (cape > 0.84 ? 0.04 : 0);
}

export function getResponsiveBackdropTerrain(
  tile: Tile,
  center: ScenePoint,
  fallback: BackdropTerrain,
  context: ResponsiveTerrainContext,
): BackdropTerrain {
  const x = center.x / context.viewportWidth;
  const y = center.y / context.viewportHeight;
  const isPortrait = context.viewportHeight > context.viewportWidth * 1.08;
  const edgeNoise = getShorelineNoise(tile);

  if (isPortrait) {
    const leftBank = 0.125 + edgeNoise * 0.65;
    const bottomShore = 0.79 - smoothstep(0.14, 0.92, x) * 0.06 + edgeNoise * 0.38;

    if (x < leftBank - 0.072 || y > bottomShore + 0.115) {
      return "grass";
    }

    if (x < leftBank - 0.038 || y > bottomShore + 0.065) {
      return "dirt";
    }

    if (x < leftBank || y > bottomShore) {
      return "sand";
    }

    if (x < leftBank + 0.035 || y > bottomShore - 0.038) {
      return "water";
    }

    return y < 0.18 || x > 0.72 ? "water-deep" : fallback.startsWith("water") ? fallback : "water";
  }

  const bottomReach = smoothstep(0.74, 0.98, y);
  const shoreX = 0.17 + bottomReach * 0.9 + edgeNoise;

  if (x < shoreX - 0.13) {
    return "grass";
  }

  if (x < shoreX - 0.074) {
    return "dirt";
  }

  if (x < shoreX) {
    return "sand";
  }

  if (x < shoreX + 0.042) {
    return "water";
  }

  return x > 0.66 || y < 0.2 ? "water-deep" : fallback.startsWith("water") ? fallback : "water";
}

export function isLandTerrain(terrain: BackdropTerrain) {
  return terrain === "sand" || terrain === "dirt" || terrain === "grass";
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

  if (col >= waterEdge + 2.55 + grassEdgeNoise) {
    return "grass";
  }

  if (col >= waterEdge + 1.3 + grassEdgeNoise * 0.55) {
    return "dirt";
  }

  if (col >= waterEdge - 0.2) {
    return "sand";
  }

  return col <= waterEdge - 5.5 || (row + col) % 3 === 0 ? "water-deep" : "water";
}

export function buildBackdropTiles(mask: string[], shoreline: ShoreTile[]): BackdropTile[] {
  const tiles: BackdropTile[] = [];
  const waterEdges = getWaterEdgeByRow(mask);
  const rowMin = -44;
  const rowMax = mask.length + 44;
  const colMax = Math.max(...mask.map((row) => row.length), 20) + 44;
  const colMin = -44;

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
    const terrain =
      tile.dock || tile.terrain === "dock" || tile.terrain === "path"
        ? "dirt"
        : (tile.terrain ?? "grass");

    tiles.push({
      row: tile.row,
      col: tile.col,
      terrain,
    });
  }

  return tiles;
}
