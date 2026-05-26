import type { CSSProperties, MutableRefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AUTO_CATCH_MS,
  BITE_DELAY_MS,
  CAST_RANGE_TILES,
  MAX_CREEL_SIZE,
  REEL_ANIMATION_MS,
  canCast,
  createSeededRandom,
  resolveCatch,
} from "../../lib/pond/game";
import { getPlayableTiles, projectTile } from "../../lib/pond/geometry";
import type {
  ArtifactSummary,
  CatchInstance,
  PondManifest,
  ShoreTile,
  Tile,
  TileOrigin,
  TileSize,
} from "../../lib/pond/types";

interface FishingGameShellProps {
  manifest: PondManifest;
  title?: string;
}

type GameMode = "idle" | "waiting" | "hooked" | "reeling" | "inventory-full";

interface AmbientFish {
  tile: Tile;
  accent: string;
  delay: number;
  duration: number;
  direction: 1 | -1;
  size: number;
}

interface BackdropTile extends Tile {
  terrain: "water" | "water-deep" | "sand" | "grass";
}

interface FisherPose {
  bob: number;
  rodLift: number;
  armLift: number;
}

function getArtifact(manifest: PondManifest, artifactId?: string) {
  if (!artifactId) {
    return undefined;
  }

  return manifest.artifacts.find((artifact) => artifact.id === artifactId);
}

function getArtifactHref(artifact: ArtifactSummary) {
  return artifact.readingUrl ?? artifact.canonicalUrl;
}

function isTileInsideReservedZone(
  tile: Tile,
  kind: "land" | "water",
  tileSize: TileSize,
  origin: TileOrigin,
  reservedZones: PondManifest["pond"]["reservedZones"],
) {
  const center = projectTile(tile, tileSize, origin);
  const padding = kind === "water" ? 4 : 6;

  return reservedZones.some((zone) => {
    return (
      center.x >= zone.x - padding &&
      center.x <= zone.x + zone.width + padding &&
      center.y >= zone.y - padding &&
      center.y <= zone.y + zone.height + padding
    );
  });
}

function getTileRangeDistance(origin: Tile, target: Tile) {
  return Math.max(
    Math.abs(origin.row - target.row),
    Math.abs(origin.col - target.col),
  );
}

function isTileWithinCastRange(origin: Tile, target: Tile, range = CAST_RANGE_TILES) {
  return getTileRangeDistance(origin, target) <= range;
}

function getTileKey(tile: Tile) {
  return `${tile.row}:${tile.col}`;
}

function getDeterministicNoise(a: number, b: number, seed = 0) {
  const value = Math.sin((a + seed * 17.13) * 127.1 + (b - seed * 5.7) * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function getStatusHeading(
  gameState: GameMode,
  targetTile: Tile | undefined,
  isCreelFull: boolean,
) {
  if (gameState === "hooked") {
    return "Fish on the line";
  }

  if (gameState === "reeling") {
    return "Reeling it in";
  }

  if (gameState === "waiting") {
    return "Line in the water";
  }

  if (isCreelFull || gameState === "inventory-full") {
    return "Catch rail full";
  }

  if (targetTile) {
    return "Ready to cast";
  }

  return "Roam the bank";
}

function getBackdropTerrain(row: number, col: number) {
  const shoreline = 12 - row * 0.28;

  if (col >= shoreline + 2.6) {
    return "grass";
  }

  if (col >= shoreline + 1.1) {
    return "sand";
  }

  return (row + col) % 2 === 0 ? "water" : "water-deep";
}

function buildBackdropTiles(): BackdropTile[] {
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

function buildNearShoreWaterKeys(waterTiles: Tile[], shoreline: ShoreTile[]) {
  const keys = new Set<string>();

  for (const waterTile of waterTiles) {
    for (const shoreTile of shoreline) {
      if (
        Math.abs(waterTile.row - shoreTile.row) <= 1 &&
        Math.abs(waterTile.col - shoreTile.col) <= 1
      ) {
        keys.add(getTileKey(waterTile));
        break;
      }
    }
  }

  return keys;
}

function getTileFill(terrain: BackdropTile["terrain"] | ShoreTile["terrain"], dock?: boolean) {
  if (terrain === "water") {
    return "#4598b3";
  }

  if (terrain === "water-deep") {
    return "#327791";
  }

  if (terrain === "sand") {
    return "#e9d48e";
  }

  if (terrain === "path") {
    return "#d5b171";
  }

  if (terrain === "dock" || dock) {
    return "#8f5b37";
  }

  return "#99d15f";
}

function mixHex(base: string, tint: string, amount: number) {
  const normalize = (value: string) => value.replace("#", "");
  const source = normalize(base);
  const target = normalize(tint);
  const toRgb = (value: string) => ({
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  });
  const from = toRgb(source);
  const to = toRgb(target);
  const blend = (start: number, end: number) =>
    Math.round(start + (end - start) * Math.min(1, Math.max(0, amount)));

  return `rgb(${blend(from.r, to.r)}, ${blend(from.g, to.g)}, ${blend(from.b, to.b)})`;
}

function getFisherPose(mode: GameMode, frame: number): FisherPose {
  return {
    bob: mode === "idle" ? frame % 2 : 0,
    rodLift: mode === "hooked" ? 7 : mode === "reeling" ? 11 : mode === "waiting" ? 4 : 2,
    armLift: mode === "reeling" ? 4 : mode === "hooked" ? 2 : 0,
  };
}

function getRodTipPosition(x: number, y: number, mode: GameMode, frame: number, scale = 1) {
  const pose = getFisherPose(mode, frame);

  return {
    x: x + 30 * scale,
    y: y - (26 + pose.rodLift) * scale + pose.bob * scale,
  };
}

function lerp(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

function easeInOut(progress: number) {
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

function getProjectedBounds(
  tiles: Tile[],
  tileSize: TileSize,
  origin: TileOrigin = { x: 0, y: 0 },
) {
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
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function drawDiamond(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  halfWidth: number,
  halfHeight: number,
  fill: string,
  stroke: string,
  shadow = false,
) {
  ctx.beginPath();
  ctx.moveTo(Math.round(centerX), Math.round(centerY - halfHeight));
  ctx.lineTo(Math.round(centerX + halfWidth), Math.round(centerY));
  ctx.lineTo(Math.round(centerX), Math.round(centerY + halfHeight));
  ctx.lineTo(Math.round(centerX - halfWidth), Math.round(centerY));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = shadow ? 1 : 1;
  ctx.stroke();
}

function drawPixelRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height));
}

function drawPixelTree(ctx: CanvasRenderingContext2D, x: number, y: number, scale = 1) {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(scale, scale);
  drawPixelRect(ctx, -16, 32, 32, 4, "rgba(22,50,74,0.16)");
  drawPixelRect(ctx, -6, 9, 12, 24, "#5c3824");
  drawPixelRect(ctx, -2, 11, 4, 20, "#8c6142");
  drawPixelRect(ctx, -22, 20, 44, 6, "#1f4636");
  drawPixelRect(ctx, -18, 14, 40, 7, "#285442");
  drawPixelRect(ctx, -20, 9, 34, 6, "#2f624a");
  drawPixelRect(ctx, -14, 3, 32, 6, "#397255");
  drawPixelRect(ctx, -16, -2, 24, 6, "#3d7e5d");
  drawPixelRect(ctx, -11, -7, 20, 6, "#4f926a");
  drawPixelRect(ctx, -8, -12, 14, 5, "#63a97a");
  drawPixelRect(ctx, -4, -17, 8, 4, "#8fc89b");
  drawPixelRect(ctx, -18, 16, 5, 3, "#5ca86c");
  drawPixelRect(ctx, -10, 7, 4, 3, "#73bc80");
  drawPixelRect(ctx, 5, 1, 4, 3, "#84c990");
  drawPixelRect(ctx, 9, 13, 5, 3, "#20493a");
  drawPixelRect(ctx, -15, 11, 4, 2, "#244d3d");
  ctx.restore();
}

function drawPixelBush(ctx: CanvasRenderingContext2D, x: number, y: number, scale = 1) {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(scale, scale);
  drawPixelRect(ctx, -11, 6, 22, 3, "rgba(22,50,74,0.14)");
  drawPixelRect(ctx, -11, 2, 22, 7, "#4f934f");
  drawPixelRect(ctx, -8, -4, 18, 7, "#63ad5c");
  drawPixelRect(ctx, -3, -9, 10, 6, "#78bf6a");
  drawPixelRect(ctx, -8, -1, 3, 3, "#8bd97d");
  drawPixelRect(ctx, 4, -2, 3, 2, "#9be28b");
  ctx.restore();
}

function drawPixelRock(ctx: CanvasRenderingContext2D, x: number, y: number, scale = 1) {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(scale, scale);
  drawPixelRect(ctx, -22, 11, 44, 4, "rgba(22,50,74,0.14)");
  drawPixelRect(ctx, -20, 7, 36, 10, "#6f8792");
  drawPixelRect(ctx, -14, 2, 28, 10, "#92a9b2");
  drawPixelRect(ctx, -8, -2, 17, 7, "#dbe7eb");
  drawPixelRect(ctx, -15, 9, 5, 2, "#5c7179");
  drawPixelRect(ctx, 6, 5, 4, 2, "#f4fbfd");
  drawPixelRect(ctx, -2, 4, 6, 2, "#c7d4d9");
  ctx.restore();
}

function drawPixelReeds(ctx: CanvasRenderingContext2D, x: number, y: number, frame: number, scale = 1) {
  const sway = frame % 3;
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(scale, scale);
  drawPixelRect(ctx, -11, 2, 22, 3, "rgba(22,50,74,0.1)");
  drawPixelRect(ctx, -9, -15, 2, 17, "#5f9347");
  drawPixelRect(ctx, -5, -20 + sway, 2, 22, "#6fac54");
  drawPixelRect(ctx, -1, -22, 2, 24, "#84c164");
  drawPixelRect(ctx, 3, -19 + sway, 2, 21, "#95cf72");
  drawPixelRect(ctx, 7, -15, 2, 17, "#6ba04d");
  drawPixelRect(ctx, -12, -10 + sway, 2, 13, "#4d7f3d");
  drawPixelRect(ctx, 10, -13, 2, 16, "#4d7f3d");
  drawPixelRect(ctx, -8, -8, 1, 3, "#b8dc95");
  drawPixelRect(ctx, 2, -11, 1, 4, "#b8dc95");
  drawPixelRect(ctx, -5, -18, 2, 2, "#9e7a42");
  drawPixelRect(ctx, 3, -17 + sway, 2, 2, "#9e7a42");
  ctx.restore();
}

function drawPixelCattails(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  frame: number,
  scale = 1,
) {
  const sway = frame % 4;
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(scale, scale);
  drawPixelRect(ctx, -15, 5, 30, 4, "rgba(22,50,74,0.12)");
  drawPixelRect(ctx, -11, -22, 2, 28, "#507d3e");
  drawPixelRect(ctx, -5, -30 + sway, 2, 36, "#699b52");
  drawPixelRect(ctx, 0, -34, 2, 40, "#79ad5b");
  drawPixelRect(ctx, 5, -28 + sway, 2, 34, "#8fbe68");
  drawPixelRect(ctx, 10, -20, 2, 26, "#5a8a43");
  drawPixelRect(ctx, -13, -11, 4, 13, "#7e542e");
  drawPixelRect(ctx, 3, -18 + sway, 4, 14, "#8c6036");
  drawPixelRect(ctx, -9, -28, 2, 8, "#a8d785");
  drawPixelRect(ctx, 6, -26, 2, 7, "#b9e396");
  ctx.restore();
}

function drawPixelDock(ctx: CanvasRenderingContext2D, x: number, y: number, scale = 1) {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(scale, scale);
  drawPixelRect(ctx, -32, 11, 64, 5, "rgba(22,50,74,0.16)");
  drawPixelRect(ctx, -30, -3, 56, 9, "#7e4f31");
  drawPixelRect(ctx, -21, -14, 41, 7, "#b78052");
  drawPixelRect(ctx, -30, -14, 5, 31, "#6c472d");
  drawPixelRect(ctx, 21, -10, 5, 27, "#6c472d");
  drawPixelRect(ctx, -11, -13, 3, 16, "#d9a173");
  drawPixelRect(ctx, 3, -13, 3, 16, "#d9a173");
  drawPixelRect(ctx, -9, -14, 29, 3, "#e7b184");
  drawPixelRect(ctx, -8, -7, 31, 4, "#6f482d");
  drawPixelRect(ctx, 13, -7, 4, 16, "#5d3925");
  drawPixelRect(ctx, -22, 0, 10, 3, "#945f3b");
  drawPixelRect(ctx, -18, -8, 2, 12, "#d09b6d");
  ctx.restore();
}

function drawGroundTileDetails(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  terrain: BackdropTile["terrain"] | ShoreTile["terrain"],
  variant: number,
  detailScale: number,
) {
  const pixel = Math.max(1, Math.round(detailScale * 0.45));
  const bit = (
    dx: number,
    dy: number,
    width: number,
    height: number,
    color: string,
  ) => {
    drawPixelRect(ctx, x + dx * pixel, y + dy * pixel, width * pixel, height * pixel, color);
  };

  if (terrain === "sand") {
    const shadow = variant % 2 === 0 ? "rgba(176, 143, 84, 0.24)" : "rgba(196, 168, 109, 0.22)";
    const sparkle = "rgba(250, 239, 184, 0.34)";
    bit(-9, -2, 2, 1, shadow);
    bit(-2, 4, 2, 1, shadow);
    bit(6, -1, 2, 1, shadow);
    bit(2, 6, 1, 1, shadow);
    bit(-5, -6, 1, 1, sparkle);
    bit(8, 4, 1, 1, sparkle);
    return;
  }

  if (terrain === "path") {
    bit(-10, -4, 3, 1, "rgba(177, 123, 66, 0.24)");
    bit(5, -1, 2, 1, "rgba(177, 123, 66, 0.22)");
    bit(-3, 5, 3, 1, "rgba(214, 191, 139, 0.3)");
    bit(1, 7, 2, 1, "rgba(145, 103, 56, 0.2)");
    return;
  }

  if (terrain === "grass") {
    bit(-8, 2, 2, 3, "rgba(85, 137, 64, 0.32)");
    bit(-1, -4, 1, 3, "rgba(123, 194, 98, 0.35)");
    bit(4, 2, 2, 2, "rgba(72, 118, 58, 0.26)");
    bit(8, -2, 1, 3, "rgba(134, 208, 110, 0.34)");
    bit(-4, 6, 1, 2, "rgba(72, 118, 58, 0.24)");
    bit(5, -6, 1, 2, "rgba(152, 220, 120, 0.28)");
  }
}

function drawWaterTileDetails(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  time: number,
  variant: number,
  detailScale: number,
  deep = false,
) {
  const motion = time / 260;
  const driftA = Math.sin(motion + variant * 0.45) * 2.2;
  const driftB = Math.cos(motion * 0.84 + variant * 0.31) * 1.9;
  const driftC = Math.sin(motion * 1.18 + variant * 0.28) * 1.6;
  const whiteCap = deep ? "rgba(223, 242, 247, 0.22)" : "rgba(233, 246, 250, 0.24)";
  const foam = deep ? "rgba(112, 187, 205, 0.24)" : "rgba(126, 197, 214, 0.28)";
  const shadow = deep ? "rgba(14, 68, 96, 0.3)" : "rgba(22, 82, 112, 0.28)";
  const glow = deep ? "#67acc0" : "#70b4c7";
  const pixel = Math.max(1, Math.round(detailScale * 0.74));
  const wave = (
    dx: number,
    dy: number,
    width: number,
    height: number,
    color: string,
  ) => {
    drawPixelRect(ctx, x + dx * pixel, y + dy * pixel, width * pixel, height * pixel, color);
  };

  wave(-14 + driftA, -7, 6, 1, glow);
  wave(-8 + driftB, -8, 8, 1, whiteCap);
  wave(3 + driftC, -6, 8, 1, foam);
  wave(-13 + driftA, -1, 7, 1, foam);
  wave(-3 + driftB, 1, 8, 1, glow);
  wave(6 - driftC, 0, 6, 1, foam);
  wave(-12 + driftB, 4, 8, 1, shadow);
  wave(-1 - driftA, 6, 6, 1, shadow);
  wave(7 + driftC, 3, 4, 1, glow);
  wave(-6 + driftA, 8, 9, 1, shadow);
  wave(-7 + driftC, -2, 3, 1, foam);
  wave(2 - driftB, 4, 3, 1, foam);
  wave(-12 + driftC, 2, 4, 1, foam);
  wave(8 - driftA, 2, 4, 1, glow);
  wave(-3 + driftB, -3, 3, 1, whiteCap);
  wave(4 - driftC, -9, 4, 1, glow);
  wave(-10 + driftB, -2, 4, 1, shadow);
  wave(8 - driftC, -4, 4, 1, whiteCap);
  wave(2 + driftA, 6, 3, 1, shadow);
  wave(-6 - driftB, 6, 4, 1, glow);
}

function drawShoreWash(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  detailScale: number,
  variant: number,
) {
  const pixel = Math.max(1, Math.round(detailScale * 0.58));
  const shift = variant % 2 === 0 ? 0 : 1;
  drawPixelRect(ctx, x - (15 - shift) * pixel, y - 5 * pixel, 6 * pixel, pixel, "rgba(233, 251, 255, 0.82)");
  drawPixelRect(ctx, x - (12 - shift) * pixel, y - 2 * pixel, 7 * pixel, pixel, "rgba(214, 246, 254, 0.78)");
  drawPixelRect(ctx, x - (10 - shift) * pixel, y + pixel, 5 * pixel, pixel, "rgba(135, 205, 223, 0.45)");
}

function drawPixelFish(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  accent: string,
  direction: 1 | -1,
  scale: number,
  frame: number,
  shadowy = false,
) {
  const wag = frame % 2;
  const bodyColor = shadowy ? mixHex(accent, "#15485c", 0.72) : accent;
  const finColor = shadowy ? mixHex(accent, "#0d2f3f", 0.78) : accent;
  const eyeColor = shadowy ? "rgba(203, 244, 255, 0.18)" : "#10243a";
  const tailColor = shadowy ? mixHex(accent, "#103949", 0.84) : "#d3f7ff";
  const highlight = shadowy ? "rgba(201, 243, 255, 0.08)" : "rgba(255,255,255,0.25)";
  const shadow = shadowy ? "rgba(9, 29, 39, 0.18)" : "rgba(9, 29, 39, 0)";

  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(direction * scale, scale);
  drawPixelRect(ctx, -11, 7, 14, 2, shadow);
  drawPixelRect(ctx, -11, -3, 14, 6, bodyColor);
  drawPixelRect(ctx, -7, -6, 8, 3, finColor);
  drawPixelRect(ctx, -6, 3, 7, 3, finColor);
  drawPixelRect(ctx, 3, -4 - wag, 6, 8 + wag * 2, bodyColor);
  drawPixelRect(ctx, -9, -1, 2, 2, eyeColor);
  drawPixelRect(ctx, -13, -1, 3, 2, tailColor);
  drawPixelRect(ctx, -1, -1, 4, 1, highlight);
  ctx.restore();
}

function drawPixelBobber(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  mode: GameMode,
  frame: number,
) {
  const bob = mode === "hooked" || mode === "reeling" ? frame % 2 : 0;
  drawPixelRect(ctx, x - 2, y - 4 - bob, 4, 4, mode === "hooked" ? "#ff7b2c" : "#fff1bc");
  drawPixelRect(ctx, x - 1, y - 7 - bob, 2, 3, "#0f172a");
  if (mode === "waiting" || mode === "hooked" || mode === "reeling") {
    ctx.strokeStyle = "rgba(217,248,255,0.8)";
    ctx.strokeRect(Math.round(x - 5), Math.round(y - 4), 10, 6);
    ctx.strokeRect(Math.round(x - 8), Math.round(y - 6), 16, 10);
  }
}

function drawPixelFisher(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  mode: GameMode,
  frame: number,
  scale = 1,
) {
  const pose = getFisherPose(mode, frame);
  const coatColor = "#c65c43";
  const coatShadow = "#8f4332";
  const hatColor = "#efc94e";
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(scale, scale);
  drawPixelRect(ctx, -13, 20 + pose.bob, 26, 5, "rgba(22,50,74,0.22)");
  drawPixelRect(ctx, -6, 7 + pose.bob, 4, 11, "#2b4158");
  drawPixelRect(ctx, 2, 7 + pose.bob, 4, 11, "#2b4158");
  drawPixelRect(ctx, -9, -1 + pose.bob, 18, 13, coatColor);
  drawPixelRect(ctx, 3, -1 + pose.bob, 4, 13, coatShadow);
  drawPixelRect(ctx, -7, -12 + pose.bob, 14, 10, "#f3d2ac");
  drawPixelRect(ctx, -10, -16 + pose.bob, 20, 4, hatColor);
  drawPixelRect(ctx, -5, -21 + pose.bob, 11, 5, hatColor);
  drawPixelRect(ctx, -10, 16 + pose.bob, 6, 4, "#5a3d2b");
  drawPixelRect(ctx, 4, 16 + pose.bob, 6, 4, "#5a3d2b");
  drawPixelRect(ctx, -2, 3 + pose.bob, 4, 2, "#f0b88e");
  drawPixelRect(ctx, 5, 3 + pose.bob, 2, 2, "#f0b88e");
  drawPixelRect(ctx, -4, -8 + pose.bob, 2, 2, "#805433");
  drawPixelRect(ctx, 1, -8 + pose.bob, 2, 2, "#805433");
  drawPixelRect(ctx, -2, -4 + pose.bob, 4, 1, "#d68b6e");
  drawPixelRect(ctx, -2, 1 + pose.bob, 4, 1, "#f6e2be");
  ctx.strokeStyle = "#244a67";
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(Math.round(6), Math.round(2 - pose.armLift + pose.bob));
  ctx.lineTo(Math.round(16), Math.round(-7 - pose.armLift + pose.bob));
  ctx.lineTo(Math.round(30), Math.round(-26 - pose.rodLift + pose.bob));
  ctx.stroke();
  ctx.restore();
}

function clearTimers(timerRef: MutableRefObject<number[]>) {
  timerRef.current.forEach((timer) => window.clearTimeout(timer));
  timerRef.current = [];
}

export default function FishingGameShell({
  manifest,
  title = "Harbor Fishing Prototype",
}: FishingGameShellProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number[]>([]);
  const creelRef = useRef<CatchInstance[]>([]);
  const selectedWaterRef = useRef<Tile>();
  const reelingStartedAtRef = useRef<number>();
  const waterTiles = useMemo(() => getPlayableTiles(manifest.pond.mask), [manifest.pond.mask]);
  const defaultPlayerTile = useMemo<ShoreTile>(
    () =>
      manifest.pond.shoreline.find((tile) => tile.dock) ??
      manifest.pond.shoreline.find((tile) => tile.castable) ??
      manifest.pond.shoreline[0],
    [manifest.pond.shoreline],
  );
  const focusTile = useMemo<Tile>(
    () =>
      manifest.pond.shoreline.find((tile) => tile.row === 6 && tile.col === 11) ??
      defaultPlayerTile,
    [defaultPlayerTile, manifest.pond.shoreline],
  );
  const backdropTiles = useMemo(() => buildBackdropTiles(), []);
  const nearShoreWaterKeys = useMemo(
    () => buildNearShoreWaterKeys(waterTiles, manifest.pond.shoreline),
    [manifest.pond.shoreline, waterTiles],
  );
  const ambientFish = useMemo<AmbientFish[]>(
    () => [
      {
        tile: { row: 2, col: 1 },
        accent: "#f59e0b",
        delay: 0,
        duration: 9800,
        direction: 1,
        size: 1.3,
      },
      {
        tile: { row: 5, col: 3 },
        accent: "#fb7185",
        delay: 700,
        duration: 11400,
        direction: -1,
        size: 1.15,
      },
      {
        tile: { row: 8, col: 2 },
        accent: "#60a5fa",
        delay: 1400,
        duration: 12600,
        direction: 1,
        size: 1.35,
      },
      {
        tile: { row: 10, col: 4 },
        accent: "#34d399",
        delay: 2400,
        duration: 10200,
        direction: -1,
        size: 1.05,
      },
      {
        tile: { row: 4, col: 6 },
        accent: "#facc15",
        delay: 3300,
        duration: 13200,
        direction: -1,
        size: 1.2,
      },
      {
        tile: { row: 9, col: 5 },
        accent: "#c084fc",
        delay: 4100,
        duration: 14100,
        direction: 1,
        size: 1.05,
      },
      {
        tile: { row: 6, col: 1 },
        accent: "#2dd4bf",
        delay: 5200,
        duration: 11800,
        direction: 1,
        size: 1.12,
      },
    ],
    [],
  );

  const [playerTile, setPlayerTile] = useState<ShoreTile>(defaultPlayerTile);
  const [selectedWaterTile, setSelectedWaterTile] = useState<Tile>();
  const [hoveredWaterTile, setHoveredWaterTile] = useState<Tile>();
  const [gameState, setGameState] = useState<GameMode>("idle");
  const [creel, setCreel] = useState<CatchInstance[]>([]);
  const [castNumber, setCastNumber] = useState(0);
  const [lastCatch, setLastCatch] = useState<CatchInstance>();
  const [activeCatchPreview, setActiveCatchPreview] = useState<CatchInstance>();
  const [isHudCollapsed, setIsHudCollapsed] = useState(false);
  const [sceneSize, setSceneSize] = useState(manifest.pond.viewBox);
  const [statusMessage, setStatusMessage] = useState(
    "Move across the left shoreline, hover the water to line up a cast, and let the fisher handle the fight.",
  );

  const isCreelFull = creel.length >= MAX_CREEL_SIZE;
  const score = creel.reduce((sum, item) => sum + item.points, 0);
  const sceneWidth = sceneSize.width > 0 ? sceneSize.width : manifest.pond.viewBox.width;
  const sceneHeight = sceneSize.height > 0 ? sceneSize.height : manifest.pond.viewBox.height;
  const camera = useMemo(() => {
    const safeBottom = Math.max(18, sceneHeight * 0.035);
    const baseScale =
      Math.max(
        sceneWidth / manifest.pond.viewBox.width,
        sceneHeight / manifest.pond.viewBox.height,
      ) * 1.42;
    const tileSize = {
      width: manifest.pond.tile.width * baseScale,
      height: manifest.pond.tile.height * baseScale,
    };
    const focusBounds = getProjectedBounds([focusTile], tileSize);
    const desiredPlayerX = sceneWidth * 0.24;
    const desiredPlayerY = sceneHeight - safeBottom - tileSize.height * 2;
    const origin = {
      x: desiredPlayerX - (focusBounds.minX + tileSize.width / 2),
      y: desiredPlayerY - (focusBounds.minY + tileSize.height / 2),
    };
    const reservedZones = manifest.pond.reservedZones.map((zone) => ({
      ...zone,
      x: (zone.x / manifest.pond.viewBox.width) * sceneWidth,
      y: (zone.y / manifest.pond.viewBox.height) * sceneHeight,
      width: (zone.width / manifest.pond.viewBox.width) * sceneWidth,
      height: (zone.height / manifest.pond.viewBox.height) * sceneHeight,
    }));

    return {
      origin,
      reservedZones,
      tileSize,
      viewportHeight: Math.max(1, Math.round(sceneHeight)),
      viewportWidth: Math.max(1, Math.round(sceneWidth)),
    };
  }, [
    focusTile,
    manifest.pond.reservedZones,
    manifest.pond.tile,
    manifest.pond.viewBox.height,
    manifest.pond.viewBox.width,
    sceneHeight,
    sceneWidth,
  ]);
  const projectSceneTile = (tile: Tile) => projectTile(tile, camera.tileSize, camera.origin);
  const tileIsReserved = (tile: Tile, kind: "land" | "water") =>
    isTileInsideReservedZone(tile, kind, camera.tileSize, camera.origin, camera.reservedZones);
  const activeWaterTile = hoveredWaterTile ?? selectedWaterTile;
  const activeWaterInRange =
    activeWaterTile && isTileWithinCastRange(playerTile, activeWaterTile)
      ? activeWaterTile
      : undefined;
  const sceneWaterTile =
    gameState === "waiting" || gameState === "hooked" || gameState === "reeling"
      ? selectedWaterTile
      : activeWaterInRange;
  const playerCenter = projectSceneTile(playerTile);
  const upperTreeCenter = projectSceneTile({ row: 3, col: 12 });
  const ridgeTreeCenter = projectSceneTile({ row: 5, col: 13 });
  const lowerTreeCenter = projectSceneTile({ row: 6, col: 14 });
  const edgeTreeCenter = projectSceneTile({ row: 7, col: 14 });
  const foothillTreeCenter = projectSceneTile({ row: 10, col: 15 });
  const cattailCenterA = projectSceneTile({ row: 2, col: 7 });
  const cattailCenterB = projectSceneTile({ row: 3, col: 8 });
  const cattailCenterC = projectSceneTile({ row: 4, col: 9 });
  const bushCenter = projectSceneTile({ row: 9, col: 13 });
  const lowerBushCenter = projectSceneTile({ row: 12, col: 13 });
  const shoreRockCenter = projectSceneTile({ row: 4, col: 12 });
  const statusHeading = getStatusHeading(gameState, sceneWaterTile, isCreelFull);

  useEffect(() => {
    creelRef.current = creel;
  }, [creel]);

  useEffect(() => {
    selectedWaterRef.current = selectedWaterTile;
  }, [selectedWaterTile]);

  useEffect(() => {
    const updateLayout = () => {
      const nextSceneBox = sceneRef.current?.getBoundingClientRect();

      if (nextSceneBox && nextSceneBox.width > 0 && nextSceneBox.height > 0) {
        setSceneSize((current) =>
          current.width === nextSceneBox.width && current.height === nextSceneBox.height
            ? current
            : {
                width: nextSceneBox.width,
                height: nextSceneBox.height,
              },
        );
      }
    };

    updateLayout();

    if (typeof ResizeObserver !== "undefined") {
      const resizeObserver = new ResizeObserver(() => {
        updateLayout();
      });

      if (sceneRef.current) {
        resizeObserver.observe(sceneRef.current);
      }

      return () => resizeObserver.disconnect();
    }

    window.addEventListener("resize", updateLayout);

    return () => window.removeEventListener("resize", updateLayout);
  }, []);

  useEffect(() => {
    if (isCreelFull && gameState === "idle") {
      setGameState("inventory-full");
      setStatusMessage("The catch rail is full. Throw one back before casting again.");
    }

    if (!isCreelFull && gameState === "inventory-full") {
      if (selectedWaterRef.current && canCast(selectedWaterRef.current, manifest.pond.mask)) {
        const nextCastNumber = castNumber + 1;

        setCastNumber(nextCastNumber);
        setGameState("waiting");
        setActiveCatchPreview(buildCatchResult(selectedWaterRef.current, nextCastNumber));
        setStatusMessage("A slot opened in the catch rail. The fisher casts right back out.");
        scheduleCatchSequence(selectedWaterRef.current, nextCastNumber);
        return;
      }

      setGameState("idle");
      setStatusMessage("A slot opened in the catch rail. Pick a tile and cast again.");
    }
  }, [castNumber, gameState, isCreelFull, manifest.pond.mask]);

  useEffect(() => {
    return () => clearTimers(timerRef);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return undefined;
    }

    let rafId = 0;
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      return undefined;
    }

    const halfWidth = camera.tileSize.width / 2;
    const halfHeight = camera.tileSize.height / 2;

    const draw = (time: number) => {
      const frame = Math.floor(time / 180);
      const detailScale = camera.tileSize.width / manifest.pond.tile.width;
      const fisherScale = Math.max(1.6, Math.min(2.35, detailScale * 0.43));
      const treeScale = Math.max(1.7, Math.min(2.75, detailScale * 0.5));
      const fishScaleBoost = Math.max(1.35, Math.min(2.1, detailScale * 0.32));
      const bushScale = Math.max(1.08, Math.min(1.44, detailScale * 0.24));
      const reedsScale = Math.max(1.72, Math.min(2.45, detailScale * 0.4));
      const rockScale = Math.max(1.15, Math.min(1.65, detailScale * 0.28));
      const fisherY = playerCenter.y - 8;
      const rodTip = getRodTipPosition(playerCenter.x, fisherY, gameState, frame, fisherScale);
      ctx.clearRect(0, 0, camera.viewportWidth, camera.viewportHeight);
      ctx.imageSmoothingEnabled = false;

      ctx.fillStyle = "#cdeff5";
      ctx.fillRect(0, 0, camera.viewportWidth, camera.viewportHeight);

      for (const tile of backdropTiles) {
        const center = projectSceneTile(tile);
        drawDiamond(
          ctx,
          center.x,
          center.y,
          halfWidth,
          halfHeight,
          getTileFill(tile.terrain),
          tile.terrain.startsWith("water") ? "#2c7e9d" : "#6d8a50",
        );
        if (!tile.terrain.startsWith("water")) {
          drawGroundTileDetails(ctx, center.x, center.y, tile.terrain, tile.row + tile.col, detailScale);
        }
      }

      for (const tile of waterTiles) {
        const center = projectSceneTile(tile);
        const isHovered = tileMatches(tile, hoveredWaterTile);
        const isSelected = tileMatches(tile, selectedWaterTile);
        const isInRange = isTileWithinCastRange(playerTile, tile);
        const isDeep = tile.row + tile.col > 10;
        const isNearShore = nearShoreWaterKeys.has(getTileKey(tile));
        const macroPatchA = getDeterministicNoise(
          Math.floor((tile.row + 2) / 4),
          Math.floor((tile.col - 1) / 5),
          1,
        );
        const macroPatchB = getDeterministicNoise(
          Math.floor((tile.row - 3) / 6),
          Math.floor((tile.col + 4) / 4),
          2,
        );
        const speckle = getDeterministicNoise(tile.row, tile.col, 3);
        const tileCluster = getDeterministicNoise(
          Math.floor(tile.row / 2),
          Math.floor(tile.col / 2),
          7,
        );
        const patchBlend = macroPatchA * 0.62 + macroPatchB * 0.38;
        const darkPool =
          patchBlend > 0.58
            ? 0.28
            : patchBlend > 0.5
              ? 0.18
              : patchBlend > 0.42
                ? 0.09
                : 0.03;
        const clusterShadow = tileCluster > 0.68 ? 0.12 : tileCluster > 0.52 ? 0.06 : 0;
        const darkPocket = speckle > 0.76 ? 0.028 : speckle > 0.58 ? 0.012 : 0;
        const nearShoreLift = isNearShore ? 0.004 : 0;
        let underFill = "#236983";
        let surfaceFill = "#3f8ea8";
        underFill = mixHex(underFill, "#194f63", 0.16);
        surfaceFill = mixHex(surfaceFill, "#275f75", 0.15);
        underFill = mixHex(underFill, "#143a49", darkPool + clusterShadow + darkPocket * 0.9);
        surfaceFill = mixHex(surfaceFill, "#1a4759", darkPool + clusterShadow + darkPocket);
        underFill = mixHex(underFill, "#4ea7bc", nearShoreLift * 0.15);
        surfaceFill = mixHex(surfaceFill, "#58b0c5", nearShoreLift * 0.12);
        drawDiamond(
          ctx,
          center.x,
          center.y + 2,
          halfWidth,
          halfHeight,
          underFill,
          "rgba(37,105,128,0.38)",
          true,
        );
        drawDiamond(
          ctx,
          center.x,
          center.y,
          halfWidth,
          halfHeight,
          surfaceFill,
          isSelected
            ? "#ff8b34"
            : isHovered
              ? isInRange
                ? "#f6f0a2"
                : "#ef4444"
              : "rgba(43,124,149,0.34)",
        );
        drawWaterTileDetails(
          ctx,
          center.x,
          center.y,
          time,
          tile.row + tile.col,
          detailScale,
          isDeep,
        );
        if (isNearShore) {
          drawShoreWash(ctx, center.x, center.y, detailScale, tile.row + tile.col);
        }
      }

      for (const tile of manifest.pond.shoreline) {
        const center = projectSceneTile(tile);
        const isPlayer = tileMatches(tile, playerTile);
        const shoreTerrain = tile.dock ? "path" : tile.terrain;

        drawDiamond(
          ctx,
          center.x,
          center.y + 2,
          halfWidth,
          halfHeight,
          shoreTerrain === "path" ? "#bfa36e" : "#668848",
          shoreTerrain === "path" ? "#90784d" : "#54723b",
          true,
        );
        drawDiamond(
          ctx,
          center.x,
          center.y,
          halfWidth,
          halfHeight,
          getTileFill(shoreTerrain),
          isPlayer ? "#17324a" : "#6e8252",
        );
        drawGroundTileDetails(ctx, center.x, center.y, shoreTerrain, tile.row + tile.col, detailScale);
      }

      drawPixelTree(ctx, upperTreeCenter.x + 11, upperTreeCenter.y - 42, treeScale * 1.18);
      drawPixelTree(ctx, ridgeTreeCenter.x + 12, ridgeTreeCenter.y - 34, treeScale * 1.08);
      drawPixelTree(ctx, lowerTreeCenter.x + 8, lowerTreeCenter.y - 30, treeScale);
      drawPixelTree(ctx, edgeTreeCenter.x + 10, edgeTreeCenter.y - 28, treeScale * 0.94);
      drawPixelTree(ctx, foothillTreeCenter.x + 8, foothillTreeCenter.y - 24, treeScale * 0.9);
      drawPixelBush(ctx, bushCenter.x + 8, bushCenter.y - 10, bushScale);
      drawPixelBush(ctx, lowerBushCenter.x + 4, lowerBushCenter.y - 6, bushScale * 0.96);
      drawPixelRock(ctx, shoreRockCenter.x + 14, shoreRockCenter.y - 3, rockScale);
      drawPixelCattails(ctx, cattailCenterA.x - 8, cattailCenterA.y + 10, frame, reedsScale * 0.88);
      drawPixelCattails(ctx, cattailCenterB.x - 6, cattailCenterB.y + 11, frame + 1, reedsScale * 0.94);
      drawPixelCattails(ctx, cattailCenterC.x - 4, cattailCenterC.y + 12, frame + 2, reedsScale);

      for (const fish of ambientFish) {
        const center = projectSceneTile(fish.tile);
        const wave = Math.sin((time + fish.delay) / fish.duration) * 16;
        const wiggle = Math.cos((time + fish.delay) / (fish.duration / 2)) * 6;
        drawPixelFish(
          ctx,
          center.x + wave,
          center.y + 4 + wiggle,
          fish.accent,
          fish.direction,
          fish.size * fishScaleBoost,
          frame,
          true,
        );
      }

      if (sceneWaterTile) {
        const targetCenter = projectSceneTile(sceneWaterTile);
        const currentLineEnd =
          gameState === "reeling" && reelingStartedAtRef.current
            ? {
                x: lerp(
                  targetCenter.x,
                  rodTip.x - 12,
                  easeInOut(
                    Math.min(1, Math.max(0, (time - reelingStartedAtRef.current) / REEL_ANIMATION_MS)),
                  ),
                ),
                y: lerp(
                  targetCenter.y - 4,
                  rodTip.y + 8,
                  easeInOut(
                    Math.min(1, Math.max(0, (time - reelingStartedAtRef.current) / REEL_ANIMATION_MS)),
                  ),
                ),
              }
            : { x: targetCenter.x, y: targetCenter.y - 4 };

        ctx.strokeStyle =
          gameState === "hooked" || gameState === "reeling" ? "#17354d" : "#335c72";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(Math.round(rodTip.x), Math.round(rodTip.y));
        if (gameState === "waiting") {
          const controlX = (rodTip.x + currentLineEnd.x) / 2 + 4;
          const controlY = Math.max(rodTip.y, currentLineEnd.y) + 12;
          ctx.quadraticCurveTo(
            Math.round(controlX),
            Math.round(controlY),
            Math.round(currentLineEnd.x),
            Math.round(currentLineEnd.y),
          );
        } else {
          ctx.lineTo(Math.round(currentLineEnd.x), Math.round(currentLineEnd.y));
        }
        ctx.stroke();

        if (activeCatchPreview && (gameState === "hooked" || gameState === "reeling")) {
          const hookedFishCenter =
            gameState === "hooked"
              ? {
                  x: currentLineEnd.x + Math.sin(time / 120) * 5,
                  y: currentLineEnd.y + 10 + Math.cos(time / 100) * 3,
                }
              : {
                  x: currentLineEnd.x - 7,
                  y: currentLineEnd.y + 8,
                };
          drawPixelFish(
            ctx,
            hookedFishCenter.x,
            hookedFishCenter.y,
            activeCatchPreview.accent,
            rodTip.x > hookedFishCenter.x ? 1 : -1,
            fishScaleBoost * 1.05,
            frame,
          );
        }

        if (gameState === "waiting" || gameState === "hooked" || gameState === "reeling") {
          drawPixelBobber(ctx, currentLineEnd.x, currentLineEnd.y + 2, gameState, frame);
        }
      }

      drawPixelFisher(ctx, playerCenter.x, fisherY, gameState, frame, fisherScale);

      rafId = window.requestAnimationFrame(draw);
    };

    rafId = window.requestAnimationFrame(draw);

    return () => window.cancelAnimationFrame(rafId);
  }, [
    ambientFish,
    backdropTiles,
    camera,
    gameState,
    hoveredWaterTile,
    manifest,
    cattailCenterA,
    cattailCenterB,
    cattailCenterC,
    nearShoreWaterKeys,
    lowerTreeCenter,
    foothillTreeCenter,
    playerCenter,
    playerTile,
    ridgeTreeCenter,
    sceneWaterTile,
    activeCatchPreview,
    selectedWaterTile,
    shoreRockCenter,
    bushCenter,
    lowerBushCenter,
    upperTreeCenter,
    edgeTreeCenter,
    waterTiles,
  ]);

  function buildCatchResult(target: Tile, activeCastNumber: number) {
    const random = createSeededRandom(
      `${manifest.pond.id}:${activeCastNumber}:${target.row}:${target.col}`,
    );

    return resolveCatch(manifest, target, random, activeCastNumber);
  }

  function handleMoveToLand(tile: ShoreTile) {

    if (tileIsReserved(tile, "land")) {
      return;
    }

    clearTimers(timerRef);
    reelingStartedAtRef.current = undefined;
    setPlayerTile(tile);
    setSelectedWaterTile(undefined);
    setHoveredWaterTile(undefined);
    setActiveCatchPreview(undefined);
    setGameState("idle");
    setStatusMessage(
      `Moved to bank tile ${tile.row}:${tile.col}. Click nearby water to cast within ${CAST_RANGE_TILES} squares.`,
    );
  }

  function handleChooseWater(tile: Tile) {
    if (gameState !== "idle" && gameState !== "inventory-full") {
      return;
    }

    if (!canCast(tile, manifest.pond.mask) || tileIsReserved(tile, "water")) {
      return;
    }

    if (!isTileWithinCastRange(playerTile, tile)) {
      setHoveredWaterTile(tile);
      setStatusMessage(
        `That water is too far away. Move closer and cast within ${CAST_RANGE_TILES} squares.`,
      );
      return;
    }

    if (isCreelFull) {
      setGameState("inventory-full");
      setStatusMessage("The catch rail is full. Throw one back before casting again.");
      return;
    }

    const nextCastNumber = castNumber + 1;

    setSelectedWaterTile(tile);
    setHoveredWaterTile(tile);
    setCastNumber(nextCastNumber);
    setGameState("waiting");
    setActiveCatchPreview(buildCatchResult(tile, nextCastNumber));
    reelingStartedAtRef.current = undefined;
    setStatusMessage(
      `Cast to water tile ${tile.row}:${tile.col}. The line settles while the fisher waits.`,
    );
    scheduleCatchSequence(tile, nextCastNumber);
  }

  function finalizeCatch(target: Tile, activeCastNumber: number) {
    const catchResult = buildCatchResult(target, activeCastNumber);
    const artifact = getArtifact(manifest, catchResult.artifactId);
    const nextLength = Math.min(creelRef.current.length + 1, MAX_CREEL_SIZE);

    setCreel((current) =>
      current.length >= MAX_CREEL_SIZE ? current : [...current, catchResult],
    );
    setLastCatch(catchResult);
    reelingStartedAtRef.current = undefined;

    if (
      nextLength < MAX_CREEL_SIZE &&
      selectedWaterRef.current &&
      tileMatches(selectedWaterRef.current, target)
    ) {
      const nextCastNumber = activeCastNumber + 1;

      setCastNumber(nextCastNumber);
      setGameState("waiting");
      setActiveCatchPreview(buildCatchResult(target, nextCastNumber));
      setStatusMessage(
        artifact
          ? `Caught ${catchResult.displayName}. Its artifact is in the rail, and the fisher casts right back out.`
          : `Caught ${catchResult.displayName} for ${catchResult.points} points. The line drops back into the pond.`,
      );
      scheduleCatchSequence(target, nextCastNumber);
      return;
    }

    setActiveCatchPreview(undefined);
    setGameState(nextLength >= MAX_CREEL_SIZE ? "inventory-full" : "idle");
    setStatusMessage(
      artifact
        ? `Caught ${catchResult.displayName}. Its artifact is waiting in the catch rail.`
        : `Caught ${catchResult.displayName} for ${catchResult.points} points.`,
    );
  }

  function scheduleCatchSequence(target: Tile, activeCastNumber: number) {
    clearTimers(timerRef);

    timerRef.current.push(
      window.setTimeout(() => {
        setGameState("hooked");
        setStatusMessage("Fish on the line. The fisher braces against the pull.");
      }, BITE_DELAY_MS),
    );

    timerRef.current.push(
      window.setTimeout(() => {
        reelingStartedAtRef.current = performance.now();
        setGameState("reeling");
        setStatusMessage("Reeling the fish toward shore.");
      }, BITE_DELAY_MS + AUTO_CATCH_MS),
    );

    timerRef.current.push(
      window.setTimeout(() => {
        finalizeCatch(target, activeCastNumber);
      }, BITE_DELAY_MS + AUTO_CATCH_MS + REEL_ANIMATION_MS),
    );
  }

  function handleThrowBack(catchId: string) {
    const released = creel.find((item) => item.id === catchId);
    const nextCreel = creel.filter((item) => item.id !== catchId);

    setCreel(nextCreel);
    setGameState("idle");
    setStatusMessage(
      released
        ? `Threw back ${released.displayName}. There is room in the rail again.`
        : "Opened a slot in the catch rail.",
    );
  }

  return (
    <section
      className={`fishing-game${isHudCollapsed ? " is-hud-collapsed" : ""}`}
      aria-label="Pixel fishing prototype"
    >
      <div
        className="fishing-game__scene"
        ref={sceneRef}
        tabIndex={0}
        aria-label={`Click land to move the fisher, then click water within ${CAST_RANGE_TILES} squares to cast and auto-catch fish.`}
      >
        <canvas
          aria-hidden="true"
          className="fishing-game__canvas"
          height={camera.viewportHeight}
          ref={canvasRef}
          width={camera.viewportWidth}
        />
        <div className="fishing-game__hotspots" aria-hidden="true">
          {manifest.pond.shoreline.map((tile) => {
            const center = projectSceneTile(tile);
            const isReserved = tileIsReserved(tile, "land");

            return (
              <button
                className="fishing-game__hotspot fishing-game__hotspot--land"
                data-testid={`shore-${tile.row}-${tile.col}`}
                key={`shore-${tile.row}-${tile.col}`}
                onClick={() => !isReserved && handleMoveToLand(tile)}
                style={
                  {
                    "--hotspot-left": `${center.x}px`,
                    "--hotspot-top": `${center.y}px`,
                    "--hotspot-width": `${camera.tileSize.width}px`,
                    "--hotspot-height": `${camera.tileSize.height}px`,
                  } as CSSProperties
                }
                tabIndex={-1}
                type="button"
              />
            );
          })}
          {waterTiles.map((tile) => {
            const center = projectSceneTile(tile);
            const isReserved = tileIsReserved(tile, "water");

            return (
              <button
                className="fishing-game__hotspot fishing-game__hotspot--water"
                data-testid={`tile-${tile.row}-${tile.col}`}
                key={`tile-${tile.row}-${tile.col}`}
                onClick={() => !isReserved && handleChooseWater(tile)}
                onMouseEnter={() =>
                  !isReserved &&
                  (gameState === "idle" || gameState === "inventory-full") &&
                  setHoveredWaterTile(tile)
                }
                onMouseLeave={() => setHoveredWaterTile(undefined)}
                onPointerEnter={() =>
                  !isReserved &&
                  (gameState === "idle" || gameState === "inventory-full") &&
                  setHoveredWaterTile(tile)
                }
                onPointerLeave={() => setHoveredWaterTile(undefined)}
                style={
                  {
                    "--hotspot-left": `${center.x}px`,
                    "--hotspot-top": `${center.y}px`,
                    "--hotspot-width": `${camera.tileSize.width}px`,
                    "--hotspot-height": `${camera.tileSize.height}px`,
                  } as CSSProperties
                }
                tabIndex={-1}
                type="button"
              />
            );
          })}
        </div>
      </div>

      <footer className="fishing-game__hud" aria-label="Catch rail">
        <div className="fishing-game__hud-top">
          <div className="fishing-game__summary" aria-live="polite">
            <p className="fishing-game__eyebrow">{title}</p>
            <strong>{statusHeading}</strong>
            <span>{statusMessage}</span>
          </div>
          <div className="fishing-game__meta">
            <span className="fishing-chip">
              Stand {playerTile.row}:{playerTile.col}
            </span>
            <span className="fishing-chip">
              Range {CAST_RANGE_TILES}
            </span>
            <span className="fishing-chip">
              Target {sceneWaterTile ? `${sceneWaterTile.row}:${sceneWaterTile.col}` : "none"}
            </span>
            <span className="fishing-chip">Score {score}</span>
            <span className="fishing-chip">Rail {creel.length}/{MAX_CREEL_SIZE}</span>
            {lastCatch && <span className="fishing-chip">Last catch {lastCatch.displayName}</span>}
          </div>
          <div className="fishing-game__actions">
            <button
              aria-controls="catch-rail"
              aria-expanded={!isHudCollapsed}
              className="pond-button pond-button--compact"
              data-testid="toggle-hud"
              onClick={() => setIsHudCollapsed((current) => !current)}
              type="button"
            >
              {isHudCollapsed ? "Expand rail" : "Minimize rail"}
            </button>
            <span className="fishing-status-pill">
              {gameState === "hooked"
                ? "Hooked"
                : gameState === "reeling"
                  ? "Reeling"
                  : gameState === "waiting"
                    ? "Waiting"
                    : isCreelFull
                      ? "Rail full"
              : "Roaming"}
            </span>
          </div>
        </div>
        <section
          className="fishing-game__rail"
          aria-label="Caught fish"
          hidden={isHudCollapsed}
          id="catch-rail"
        >
          {Array.from({ length: MAX_CREEL_SIZE }, (_, index) => {
            const catchItem = creel[index];

            if (!catchItem) {
              return (
                <article className="fish-rail-card fish-rail-card--empty" key={`empty-${index}`}>
                  <strong>Slot {index + 1}</strong>
                  <span>Nothing hooked yet.</span>
                </article>
              );
            }

            const artifact = getArtifact(manifest, catchItem.artifactId);

            return (
              <article className="fish-rail-card" key={catchItem.id}>
                <div
                  className="fish-rail-card__swatch"
                  style={{ "--fish-accent": catchItem.accent } as CSSProperties}
                />
                <div className="fish-rail-card__copy">
                  <strong>{catchItem.displayName}</strong>
                  <span>{catchItem.points} points</span>
                  {artifact ? (
                    <a href={getArtifactHref(artifact)}>Read artifact: {artifact.title}</a>
                  ) : (
                    <span>No artifact attached.</span>
                  )}
                </div>
                <button className="pond-link-button" onClick={() => handleThrowBack(catchItem.id)}>
                  Throw back
                </button>
              </article>
            );
          })}
        </section>
      </footer>
    </section>
  );
}

function tileMatches(left?: Tile, right?: Tile) {
  return Boolean(left && right && left.row === right.row && left.col === right.col);
}
