import type { Tile, TileOrigin, TileSize } from "./types";

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
  return {
    x: origin.x + (tile.row - tile.col) * (tileSize.width / 2),
    y: origin.y + (tile.col + tile.row) * (tileSize.height / 2),
  };
}

export function createDiamondPoints(tile: Tile, tileSize: TileSize, origin: TileOrigin) {
  const center = projectTile(tile, tileSize, origin);
  const halfWidth = tileSize.width / 2;
  const halfHeight = tileSize.height / 2;

  return [
    `${center.x},${center.y - halfHeight}`,
    `${center.x + halfWidth},${center.y}`,
    `${center.x},${center.y + halfHeight}`,
    `${center.x - halfWidth},${center.y}`,
  ].join(" ");
}

export function getStageBounds(mask: string[], tileSize: TileSize, origin: TileOrigin) {
  const tiles = getPlayableTiles(mask);
  const halfWidth = tileSize.width / 2;
  const halfHeight = tileSize.height / 2;

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const tile of tiles) {
    const center = projectTile(tile, tileSize, origin);
    minX = Math.min(minX, center.x - halfWidth);
    maxX = Math.max(maxX, center.x + halfWidth);
    minY = Math.min(minY, center.y - halfHeight);
    maxY = Math.max(maxY, center.y + halfHeight);
  }

  return {
    width: maxX - minX + tileSize.width * 2,
    height: maxY - minY + tileSize.height * 3,
    minX,
    minY,
  };
}
