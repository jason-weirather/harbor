import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BITE_DELAY_MS, CAST_RANGE_TILES, REEL_ANIMATION_MS, canCast } from "../lib/pond/game";
import { getPlayableTiles, projectTile } from "../lib/pond/geometry";
import type {
  CatchInstance,
  PondManifest,
  ShoreTile,
  Tile,
  TileOrigin,
  TileSize,
} from "../lib/pond/types";
import type { HarborArtifact } from "./HarborWidget.types";
import type { AmbientFish, HarborGameMode, MovementPath } from "./harborWidget.shared";
import {
  buildNearShoreWaterKeys,
  getMinimumTileDistance,
  getTileKey,
  isTileWithinCastRange,
  tileMatches,
} from "./harborWidget.shared";

interface FishingSceneProps {
  manifest: PondManifest<HarborArtifact>;
  playerTile: ShoreTile;
  selectedWaterTile?: Tile;
  hoveredWaterTile?: Tile;
  gameState: HarborGameMode;
  activeCatchPreview?: CatchInstance;
  ambientFish: AmbientFish[];
  movement?: MovementPath;
  reelingStartedAt?: number;
  reelDuration: number;
  approachStartedAt?: number;
  approachDirection: 1 | -1;
  encounterFishScale: number;
  onMoveToLand: (tile: ShoreTile) => void;
  onChooseWater: (tile: Tile) => void;
  onHoverWater: (tile?: Tile) => void;
}

interface BackdropTile extends Tile {
  terrain: "water" | "water-deep" | "sand" | "grass";
}

interface FisherPose {
  bob: number;
  rodLift: number;
  armLift: number;
  swayX: number;
  torsoLean: number;
  frontLegLift: number;
  backLegLift: number;
  frontStep: number;
  backStep: number;
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

function getDeterministicNoise(a: number, b: number, seed = 0) {
  const value = Math.sin((a + seed * 17.13) * 127.1 + (b - seed * 5.7) * 311.7) * 43758.5453;
  return value - Math.floor(value);
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getFisherPose(mode: HarborGameMode, motion: number): FisherPose {
  if (mode === "walking") {
    const stride = Math.sin(motion * 1.9);

    return {
      bob: Math.abs(stride) * 2.1,
      rodLift: 4 + Math.cos(motion * 1.2) * 1.3,
      armLift: 2 + Math.max(0, stride) * 1.8,
      swayX: stride * 1.7,
      torsoLean: 1.3 + Math.max(0, stride) * 0.7,
      frontLegLift: stride > 0 ? Math.abs(stride) * 3.1 : 0,
      backLegLift: stride < 0 ? Math.abs(stride) * 3.1 : 0,
      frontStep: stride * 2.6,
      backStep: -stride * 2.3,
    };
  }

  const idleWave = Math.sin(motion * 0.72);
  const patientWave = Math.sin(motion * 0.36 + 0.8);

  return {
    bob: mode === "inspecting" ? 0.6 : Math.max(0, idleWave) * 1.35,
    rodLift:
      mode === "inspecting"
        ? 15
        : mode === "hooked"
          ? 8 + idleWave * 0.8
          : mode === "reeling"
            ? 12 + patientWave * 0.8
            : mode === "waiting"
              ? 4 + patientWave * 1.1
              : 3 + patientWave * 0.7,
    armLift:
      mode === "inspecting"
        ? 6
        : mode === "reeling"
          ? 4 + idleWave * 0.6
          : mode === "hooked"
            ? 2.8 + patientWave * 0.5
            : 1 + patientWave * 0.5,
    swayX: mode === "waiting" ? idleWave * 1.2 : patientWave * 0.65,
    torsoLean:
      mode === "reeling" ? 1.8 : mode === "hooked" ? 1.2 : mode === "waiting" ? 0.8 : 0.5,
    frontLegLift: 0,
    backLegLift: 0,
    frontStep: 0,
    backStep: 0,
  };
}

function getRodLocalGeometry(mode: HarborGameMode, motion: number, pull: number) {
  const pose = getFisherPose(mode, motion);
  const handX = 7;
  const handY = 2 - pose.armLift * 0.35;
  const baseTipX = 31.1;
  const baseTipY = -27.05 - pose.rodLift * 0.02;

  if (mode === "idle" || mode === "walking") {
    return {
      pose,
      handX,
      handY,
      bendX: undefined,
      bendY: undefined,
      tipX: baseTipX,
      tipY: baseTipY,
    };
  }

  const clampedPull = clamp(pull, 0, 1.1);
  const shaftX = baseTipX - handX;
  const shaftY = baseTipY - handY;
  const pointAlongShaft = (progress: number) => ({
    x: handX + shaftX * progress,
    y: handY + shaftY * progress,
  });

  let bend = pointAlongShaft(0.88);
  let tipX = baseTipX - 0.1;
  let tipY = baseTipY + 1.2;

  if (mode === "hooked") {
    bend = pointAlongShaft(0.86);
    tipX = baseTipX;
    tipY = baseTipY + 1.65;
  } else if (mode === "reeling") {
    bend = pointAlongShaft(0.76);
    tipX = baseTipX + 0.55 + clampedPull * 0.38;
    tipY = baseTipY + 3.2 + clampedPull * 1.45;
  } else if (mode === "inspecting") {
    bend = pointAlongShaft(0.84);
    tipX = baseTipX + 0.15;
    tipY = baseTipY + 2.1;
  }

  return {
    pose,
    handX,
    handY,
    bendX: bend.x,
    bendY: bend.y,
    tipX,
    tipY,
  };
}

function getRodTipPosition(
  x: number,
  y: number,
  mode: HarborGameMode,
  motion: number,
  scale = 1,
  pull = 0,
) {
  const rod = getRodLocalGeometry(mode, motion, pull);
  const translatedX = x + rod.pose.swayX * scale;
  const translatedY = y - 22 * scale + rod.pose.bob * scale;

  return {
    x: translatedX + rod.tipX * scale,
    y: translatedY + rod.tipY * scale,
  };
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

function drawDiamond(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  halfWidth: number,
  halfHeight: number,
  fill: string,
  stroke: string,
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
  ctx.lineWidth = 1;
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

function drawGroundTileDetails(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  terrain: BackdropTile["terrain"] | ShoreTile["terrain"],
  variant: number,
  detailScale: number,
) {
  const pixel = Math.max(1, Math.round(detailScale * 0.45));
  const bit = (dx: number, dy: number, width: number, height: number, color: string) => {
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
  const wave = (dx: number, dy: number, width: number, height: number, color: string) => {
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
  drawPixelRect(
    ctx,
    x - (15 - shift) * pixel,
    y - 5 * pixel,
    6 * pixel,
    pixel,
    "rgba(233, 251, 255, 0.82)",
  );
  drawPixelRect(
    ctx,
    x - (12 - shift) * pixel,
    y - 2 * pixel,
    7 * pixel,
    pixel,
    "rgba(214, 246, 254, 0.78)",
  );
  drawPixelRect(
    ctx,
    x - (10 - shift) * pixel,
    y + pixel,
    5 * pixel,
    pixel,
    "rgba(135, 205, 223, 0.45)",
  );
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
  orientation: "horizontal" | "vertical-up" = "horizontal",
) {
  const wag = frame % 2;
  const bodyColor = shadowy ? mixHex(accent, "#173f52", 0.54) : accent;
  const finColor = shadowy ? mixHex(accent, "#102e3c", 0.62) : accent;
  const eyeColor = shadowy ? "rgba(203, 244, 255, 0.16)" : "#10243a";
  const tailColor = shadowy ? mixHex(accent, "#123646", 0.7) : "#d3f7ff";
  const highlight = shadowy ? "rgba(201, 243, 255, 0.06)" : "rgba(255,255,255,0.25)";

  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  if (orientation === "vertical-up") {
    ctx.rotate(Math.PI / 2);
    ctx.scale(scale, scale);
  } else {
    ctx.scale(direction * scale, scale);
  }
  drawPixelRect(ctx, -11, 7, 14, 2, "rgba(9, 29, 39, 0.18)");
  drawPixelRect(ctx, -11, -3, 14, 6, bodyColor);
  drawPixelRect(ctx, -7, -6, 8, 3, finColor);
  drawPixelRect(ctx, -6, 3, 7, 3, finColor);
  drawPixelRect(ctx, 3, -4 - wag, 6, 8 + wag * 2, bodyColor);
  drawPixelRect(ctx, -9, -1, 2, 2, eyeColor);
  drawPixelRect(ctx, -13, -1, 3, 2, tailColor);
  drawPixelRect(ctx, -1, -1, 4, 1, highlight);
  ctx.restore();
}

function getFishNoseOffset(
  scale: number,
  direction: 1 | -1,
  orientation: "horizontal" | "vertical-up",
) {
  if (orientation === "vertical-up") {
    return {
      x: 0,
      y: -scale * 8.5,
    };
  }

  return {
    x: direction * scale * 8.5,
    y: 0,
  };
}

function drawPixelBobber(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  mode: HarborGameMode,
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
  mode: HarborGameMode,
  motion: number,
  scale = 1,
  pull = 0,
) {
  const rod = getRodLocalGeometry(mode, motion, pull);
  const pose = rod.pose;
  const coatColor = "#c7664e";
  const coatShadow = "#954735";
  const coatLight = "#da8a63";
  const hatColor = "#efc94e";
  const hatShadow = "#c59e2d";
  const skin = "#f1cfaa";
  const skinShadow = "#d6ab81";
  const legColor = "#29445e";
  const bootColor = "#5e432f";
  const eyeColor = "#5b402c";
  ctx.save();
  ctx.translate(
    Math.round(x + pose.swayX * scale),
    Math.round(y - 22 * scale + pose.bob * scale),
  );
  ctx.scale(scale, scale);
  drawPixelRect(ctx, -13, 20, 28, 5, "rgba(22,50,74,0.22)");
  drawPixelRect(ctx, -7 + pose.backStep, 9 - pose.backLegLift, 4, 11 + pose.backLegLift, legColor);
  drawPixelRect(ctx, 1 + pose.frontStep, 9 - pose.frontLegLift, 5, 11 + pose.frontLegLift, legColor);
  drawPixelRect(ctx, -8 + pose.backStep, 18, 6, 4, bootColor);
  drawPixelRect(ctx, 1 + pose.frontStep, 18, 7, 4, bootColor);
  drawPixelRect(ctx, -10, -1, 19, 13, coatColor);
  drawPixelRect(ctx, 1, -1, 8, 13, coatShadow);
  drawPixelRect(ctx, -7, 2, 8, 8, coatLight);
  drawPixelRect(ctx, -4, 4, 7, 1, "#f7dfc3");
  drawPixelRect(ctx, -4, 7, 7, 1, "#f7dfc3");
  drawPixelRect(ctx, -5, -12, 13, 10, skin);
  drawPixelRect(ctx, 3, -12, 5, 10, skinShadow);
  drawPixelRect(ctx, 4, -8, 2, 2, skinShadow);
  drawPixelRect(ctx, 1, -9, 2, 2, eyeColor);
  drawPixelRect(ctx, -9, -17, 19, 4, hatColor);
  drawPixelRect(ctx, -3, -22, 12, 5, hatColor);
  drawPixelRect(ctx, 4, -22, 5, 5, hatShadow);
  drawPixelRect(ctx, -8, -13, 17, 2, hatShadow);
  drawPixelRect(ctx, 4, 1, 3, 6, skin);
  drawPixelRect(ctx, 5, 5, 2, 3, skinShadow);
  ctx.strokeStyle = "#244a67";
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(Math.round(rod.handX), Math.round(rod.handY));
  if (typeof rod.bendX === "number" && typeof rod.bendY === "number") {
    ctx.lineTo(Math.round(rod.bendX), Math.round(rod.bendY));
  }
  ctx.lineTo(Math.round(rod.tipX), Math.round(rod.tipY));
  ctx.stroke();
  ctx.restore();
}

export default function FishingScene({
  manifest,
  playerTile,
  selectedWaterTile,
  hoveredWaterTile,
  gameState,
  activeCatchPreview,
  ambientFish,
  movement,
  reelingStartedAt,
  reelDuration,
  approachStartedAt,
  approachDirection,
  encounterFishScale,
  onMoveToLand,
  onChooseWater,
  onHoverWater,
}: FishingSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const waterTiles = useMemo(() => getPlayableTiles(manifest.pond.mask), [manifest.pond.mask]);
  const nearShoreWaterKeys = useMemo(
    () => buildNearShoreWaterKeys(waterTiles, manifest.pond.shoreline),
    [manifest.pond.shoreline, waterTiles],
  );
  const nearShoreWaterTiles = useMemo(
    () => waterTiles.filter((tile) => nearShoreWaterKeys.has(getTileKey(tile))),
    [nearShoreWaterKeys, waterTiles],
  );
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
  const [sceneSize, setSceneSize] = useState(manifest.pond.viewBox);

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
    gameState === "waiting" ||
    gameState === "hooked" ||
    gameState === "reeling" ||
    gameState === "inspecting"
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
      const motion = time / 150;
      const detailScale = camera.tileSize.width / manifest.pond.tile.width;
      const fisherScale = Math.max(1.6, Math.min(2.35, detailScale * 0.43));
      const treeScale = Math.max(1.7, Math.min(2.75, detailScale * 0.5));
      const fishScaleBoost = Math.max(1.35, Math.min(2.1, detailScale * 0.32));
      const bushScale = Math.max(1.08, Math.min(1.44, detailScale * 0.24));
      const reedsScale = Math.max(1.72, Math.min(2.45, detailScale * 0.4));
      const rockScale = Math.max(1.15, Math.min(1.65, detailScale * 0.28));
      let visualPlayerCenter = playerCenter;
      let fisherMode = gameState;

      if (movement && movement.tiles.length > 1) {
        const elapsed = Math.max(0, time - movement.startedAt);
        const totalSegments = movement.tiles.length - 1;
        const pathProgress = Math.min(totalSegments, elapsed / movement.segmentDuration);
        const segmentIndex = Math.min(totalSegments - 1, Math.floor(pathProgress));
        const localProgress = easeInOut(Math.min(1, Math.max(0, pathProgress - segmentIndex)));
        const fromCenter = projectSceneTile(movement.tiles[segmentIndex]);
        const toCenter = projectSceneTile(
          movement.tiles[segmentIndex + 1] ?? movement.tiles[segmentIndex],
        );

        visualPlayerCenter = {
          x: lerp(fromCenter.x, toCenter.x, localProgress),
          y: lerp(fromCenter.y, toCenter.y, localProgress),
        };
        fisherMode = "walking";
      }

      const fisherGroundY = visualPlayerCenter.y;
      let rodPull = 0;
      let rodTip = getRodTipPosition(
        visualPlayerCenter.x,
        fisherGroundY,
        fisherMode,
        motion,
        fisherScale,
        rodPull,
      );
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
        if (!fish.active) {
          continue;
        }

        const fromCenter = projectSceneTile(fish.fromTile);
        const toCenter = projectSceneTile(fish.toTile);
        const swimProgress = Math.min(
          1,
          Math.max(0, (time - fish.segmentStartedAt) / Math.max(1, fish.segmentDuration)),
        );
        const center = {
          x: lerp(fromCenter.x, toCenter.x, swimProgress),
          y: lerp(fromCenter.y, toCenter.y, swimProgress),
        };
        const wave = Math.sin(time / 760 + fish.phase) * 6;
        const wiggle = Math.cos(time / 920 + fish.phase * 1.3) * 3;
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
        const reelProgress =
          gameState === "reeling" && reelingStartedAt
            ? Math.min(1, Math.max(0, (time - reelingStartedAt) / reelDuration))
            : 0;
        if (gameState === "reeling") {
          const reelEndX = lerp(targetCenter.x, rodTip.x - 12, easeInOut(reelProgress));
          const distancePull =
            (reelEndX - visualPlayerCenter.x) / Math.max(40, camera.tileSize.width * 1.15);
          const fightPull = (1 - reelProgress) * 0.42;
          rodPull = clamp(distancePull + fightPull, 0, 1.35);
          rodTip = getRodTipPosition(
            visualPlayerCenter.x,
            fisherGroundY,
            fisherMode,
            motion,
            fisherScale,
            rodPull,
          );
        }
        const inspectPoint = {
          x: rodTip.x - 3,
          y: rodTip.y + 19,
        };
        let currentLineEnd =
          gameState === "inspecting"
            ? inspectPoint
            : gameState === "reeling" && reelingStartedAt
              ? {
                  x: lerp(targetCenter.x, rodTip.x - 12, easeInOut(reelProgress)),
                  y: lerp(targetCenter.y - 4, rodTip.y + 8, easeInOut(reelProgress)),
                }
              : { x: targetCenter.x, y: targetCenter.y - 4 };

        let hookedFishCenter: { x: number; y: number } | undefined;
        let fishShadowy = false;
        let orientation: "horizontal" | "vertical-up" = "horizontal";
        let hookDirection: 1 | -1 = rodTip.x < currentLineEnd.x ? 1 : -1;
        let hookedFishScale = encounterFishScale * fishScaleBoost;

        if (activeCatchPreview) {
          const reelAnchor = currentLineEnd;

          if (gameState === "waiting" && approachStartedAt) {
            const approachProgress = Math.min(
              1,
              Math.max(0, (time - approachStartedAt) / BITE_DELAY_MS),
            );
            const approachStart = {
              x: targetCenter.x + approachDirection * 18,
              y: targetCenter.y + 12,
            };
            hookedFishCenter = {
              x: lerp(
                approachStart.x,
                currentLineEnd.x - approachDirection * 3,
                easeInOut(approachProgress),
              ),
              y: lerp(approachStart.y, currentLineEnd.y + 9, easeInOut(approachProgress)),
            };
            fishShadowy = true;
            hookDirection = approachDirection;
          } else if (gameState === "hooked") {
            hookedFishCenter = {
              x: currentLineEnd.x + Math.sin(time / 120) * 5,
              y: currentLineEnd.y + 10 + Math.cos(time / 100) * 3,
            };
            fishShadowy = true;
          } else if (gameState === "reeling") {
            hookDirection = rodTip.x < reelAnchor.x ? 1 : -1;
            const waterEdgeDistance = getMinimumTileDistance(sceneWaterTile, nearShoreWaterTiles);
            const startsAtEdge = nearShoreWaterKeys.has(getTileKey(sceneWaterTile));

            if (startsAtEdge) {
              hookedFishScale *= 1.12;
              hookedFishCenter = {
                x: reelAnchor.x,
                y: reelAnchor.y + 8,
              };
            } else {
              const surfaceThreshold = Math.max(
                0.28,
                Math.min(
                  0.86,
                  waterEdgeDistance <= 1 ? 0.35 : (waterEdgeDistance - 1) / waterEdgeDistance,
                ),
              );
              const hasSurfaced = reelProgress >= surfaceThreshold;

              if (!hasSurfaced) {
                fishShadowy = true;
                hookedFishScale *= 1.05;
                const zigzagAmount = Math.max(3, 10 - reelProgress * 6);
                const zigzagX = Math.sin(time / 92 + reelProgress * 18) * zigzagAmount;
                const swayY = Math.cos(time / 108 + reelProgress * 13) * 2.2;
                hookedFishCenter = {
                  x: reelAnchor.x + zigzagX,
                  y: reelAnchor.y + 11 + swayY,
                };
              } else {
                const surfacedProgress = easeInOut(
                  Math.min(
                    1,
                    Math.max(0, (reelProgress - surfaceThreshold) / Math.max(0.001, 1 - surfaceThreshold)),
                  ),
                );
                hookedFishScale *= lerp(1.08, 1.16, surfacedProgress);
                const lastThrash = (1 - surfacedProgress) * 3.5;
                hookedFishCenter = {
                  x: reelAnchor.x + Math.sin(time / 120 + surfacedProgress * 4) * lastThrash,
                  y: reelAnchor.y + lerp(11, 8, surfacedProgress),
                };
              }
            }
          } else if (gameState === "inspecting") {
            hookedFishScale *= 1.22;
            const verticalNoseOffset = hookedFishScale * 8.5;
            hookedFishCenter = {
              x: inspectPoint.x,
              y: inspectPoint.y + verticalNoseOffset,
            };
            orientation = "vertical-up";
          }

          if (hookedFishCenter && (gameState === "reeling" || gameState === "inspecting")) {
            const noseOffset = getFishNoseOffset(hookedFishScale, hookDirection, orientation);
            currentLineEnd = {
              x: hookedFishCenter.x + noseOffset.x,
              y: hookedFishCenter.y + noseOffset.y,
            };
          }
        }

        ctx.strokeStyle =
          gameState === "hooked" || gameState === "reeling" || gameState === "inspecting"
            ? "#17354d"
            : "#335c72";
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

        if (activeCatchPreview && hookedFishCenter) {
          drawPixelFish(
            ctx,
            hookedFishCenter.x,
            hookedFishCenter.y,
            activeCatchPreview.accent,
            hookDirection,
            hookedFishScale,
            frame,
            fishShadowy,
            orientation,
          );
        }

        if (gameState === "waiting" || gameState === "hooked") {
          drawPixelBobber(ctx, currentLineEnd.x, currentLineEnd.y + 2, gameState, frame);
        }
      }

      drawPixelFisher(
        ctx,
        visualPlayerCenter.x,
        fisherGroundY,
        fisherMode,
        motion,
        fisherScale,
        rodPull,
      );

      rafId = window.requestAnimationFrame(draw);
    };

    rafId = window.requestAnimationFrame(draw);

    return () => window.cancelAnimationFrame(rafId);
  }, [
    activeCatchPreview,
    ambientFish,
    approachDirection,
    approachStartedAt,
    backdropTiles,
    bushCenter,
    camera,
    cattailCenterA,
    cattailCenterB,
    cattailCenterC,
    encounterFishScale,
    edgeTreeCenter,
    foothillTreeCenter,
    gameState,
    hoveredWaterTile,
    lowerBushCenter,
    lowerTreeCenter,
    manifest,
    movement,
    nearShoreWaterKeys,
    nearShoreWaterTiles,
    playerCenter,
    playerTile,
    reelDuration,
    reelingStartedAt,
    ridgeTreeCenter,
    sceneWaterTile,
    selectedWaterTile,
    shoreRockCenter,
    upperTreeCenter,
    waterTiles,
  ]);

  return (
    <div
      className="harbor-widget__scene"
      ref={sceneRef}
      tabIndex={0}
      aria-label={`Click land to move the fisher, then click water within ${CAST_RANGE_TILES} squares to cast and auto-catch fish.`}
    >
      <canvas
        aria-hidden="true"
        className="harbor-widget__canvas"
        height={camera.viewportHeight}
        ref={canvasRef}
        width={camera.viewportWidth}
      />
      <div className="harbor-widget__hotspots" aria-hidden="true">
        {manifest.pond.shoreline.map((tile) => {
          const center = projectSceneTile(tile);
          const isReserved = tileIsReserved(tile, "land");

          return (
            <button
              className="harbor-widget__hotspot harbor-widget__hotspot--land"
              data-testid={`shore-${tile.row}-${tile.col}`}
              key={`shore-${tile.row}-${tile.col}`}
              onClick={() => !isReserved && onMoveToLand(tile)}
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
              className="harbor-widget__hotspot harbor-widget__hotspot--water"
              data-testid={`tile-${tile.row}-${tile.col}`}
              key={`tile-${tile.row}-${tile.col}`}
              onClick={() => !isReserved && onChooseWater(tile)}
              onMouseEnter={() =>
                !isReserved &&
                (gameState === "idle" || gameState === "inventory-full") &&
                onHoverWater(tile)
              }
              onMouseLeave={() => onHoverWater(undefined)}
              onPointerEnter={() =>
                !isReserved &&
                (gameState === "idle" || gameState === "inventory-full") &&
                onHoverWater(tile)
              }
              onPointerLeave={() => onHoverWater(undefined)}
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
  );
}
