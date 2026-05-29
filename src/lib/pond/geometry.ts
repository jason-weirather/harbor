import type { Tile, TileOrigin, TileSize } from "./types";

export interface TilePoint {
  x: number;
  y: number;
}

export interface HexTileMetrics {
  cornerWidth: number;
  halfHeight: number;
  halfWidth: number;
  height: number;
  width: number;
}

const HEX_CAMERA_ROTATION = -Math.PI / 6;
const HEX_CAMERA_Y_SCALE = 0.4;

export function getPlayableTiles(mask: string[]): Tile[] {
  const tiles: Tile[] = [];

  for (let row = 0; row < mask.length; row += 1) {
    for (let col = 0; col < mask[row].length; col += 1) {
      if (mask[row][col] === "1") {
        tiles.push({ row, col });
      }
    }
  }

  return tiles;
}

export function projectTile(tile: Tile, tileSize: TileSize, origin: TileOrigin) {
  const center = getHexPlaneCenter(tile, tileSize);

  return projectHexPlanePoint(center, origin);
}

function getHexPlaneHeight(tileSize: TileSize) {
  return tileSize.width * (2 / Math.sqrt(3));
}

function getHexPlaneCenter(tile: Tile, tileSize: TileSize): TilePoint {
  const height = getHexPlaneHeight(tileSize);

  return {
    x: tile.row * (tileSize.width / 2) - tile.col * tileSize.width,
    y: tile.row * height * 0.75,
  };
}

function projectHexPlanePoint(point: TilePoint, origin: TileOrigin): TilePoint {
  const cos = Math.cos(HEX_CAMERA_ROTATION);
  const sin = Math.sin(HEX_CAMERA_ROTATION);
  const rotatedX = point.x * cos - point.y * sin;
  const rotatedY = point.x * sin + point.y * cos;

  return {
    x: origin.x + rotatedX,
    y: origin.y + rotatedY * HEX_CAMERA_Y_SCALE,
  };
}

export function getHexTileMetrics(tileSize: TileSize): HexTileMetrics {
  const offsets = getHexTilePointOffsets(tileSize);
  const minX = Math.min(...offsets.map((point) => point.x));
  const maxX = Math.max(...offsets.map((point) => point.x));
  const minY = Math.min(...offsets.map((point) => point.y));
  const maxY = Math.max(...offsets.map((point) => point.y));
  const width = maxX - minX;
  const height = maxY - minY;

  return {
    cornerWidth: width * 0.25,
    halfHeight: height / 2,
    halfWidth: width / 2,
    height,
    width,
  };
}

export function getHexTilePointOffsets(tileSize: TileSize): TilePoint[] {
  const width = tileSize.width;
  const height = getHexPlaneHeight(tileSize);

  return [
    { x: 0, y: -height / 2 },
    { x: width / 2, y: -height / 4 },
    { x: width / 2, y: height / 4 },
    { x: 0, y: height / 2 },
    { x: -width / 2, y: height / 4 },
    { x: -width / 2, y: -height / 4 },
  ].map((point) => projectHexPlanePoint(point, { x: 0, y: 0 }));
}

export function getHexTilePoints(tile: Tile, tileSize: TileSize, origin: TileOrigin) {
  const center = projectTile(tile, tileSize, origin);

  return getHexTilePointOffsets(tileSize).map((point) => ({
    x: center.x + point.x,
    y: center.y + point.y,
  }));
}

export function createHexPoints(tile: Tile, tileSize: TileSize, origin: TileOrigin) {
  return getHexTilePoints(tile, tileSize, origin)
    .map((point) => `${point.x},${point.y}`)
    .join(" ");
}

export function createDiamondPoints(tile: Tile, tileSize: TileSize, origin: TileOrigin) {
  return createHexPoints(tile, tileSize, origin);
}

export function getStageBounds(mask: string[], tileSize: TileSize, origin: TileOrigin) {
  const tiles = getPlayableTiles(mask);
  const metrics = getHexTileMetrics(tileSize);

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const tile of tiles) {
    const center = projectTile(tile, tileSize, origin);
    minX = Math.min(minX, center.x - metrics.halfWidth);
    maxX = Math.max(maxX, center.x + metrics.halfWidth);
    minY = Math.min(minY, center.y - metrics.halfHeight);
    maxY = Math.max(maxY, center.y + metrics.halfHeight);
  }

  return {
    width: maxX - minX + metrics.width * 2,
    height: maxY - minY + metrics.height * 2,
    minX,
    minY,
  };
}
