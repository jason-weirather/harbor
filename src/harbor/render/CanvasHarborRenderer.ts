import { BITE_DELAY_MS } from "../../lib/pond/game";
import { getHexTileMetrics, getHexTilePointOffsets } from "../../lib/pond/geometry";
import type { ShoreTile, Tile } from "../../lib/pond/types";
import {
  CAST_ANIMATION_MS,
  EGRET_ARRIVE_MS,
  EGRET_EAT_MS,
  EGRET_LEAVE_MS,
  EGRET_STRIKE_MS,
  getMinimumTileDistance,
  getTileKey,
  isTileWithinCastRange,
  tileMatches,
  type AmbientEgret,
  type AmbientEgretState,
  type HarborGameMode,
} from "../harborWidget.shared";
import type { CanvasHarborFrame, ScenePoint } from "./HarborRenderer";
import {
  getResponsiveBackdropTerrain,
  SCENE_PROP_PLACEMENTS,
  type BackdropTerrain,
  type ScenePropPlacement,
} from "./SceneLayers";
import { getSpriteFrame, type HarborSpriteName } from "./SpriteAtlas";
import { sortSceneDrawables, type SceneDrawable } from "./depthSort";
import {
  HARBOR_PALETTE,
  clamp,
  easeInOut,
  getDeterministicNoise,
  lerp,
  mixHex,
} from "./palette";

interface FisherPose {
  armLift: number;
  backLegLift: number;
  backStep: number;
  bob: number;
  frontLegLift: number;
  frontStep: number;
  rodLift: number;
  swayX: number;
  torsoLean: number;
}

interface NamedSpriteOptions {
  accent?: string;
  direction?: 1 | -1;
  frame: number;
  mode?: HarborGameMode;
  scale: number;
}

interface EgretRenderPose {
  direction: 1 | -1;
  mode: AmbientEgretState;
  progress: number;
  x: number;
  y: number;
}

function getTileFill(terrain: BackdropTerrain | ShoreTile["terrain"], dock?: boolean) {
  if (terrain === "water") {
    return HARBOR_PALETTE.waterMid;
  }

  if (terrain === "water-deep") {
    return HARBOR_PALETTE.waterDeep;
  }

  if (terrain === "sand") {
    return HARBOR_PALETTE.sand;
  }

  if (terrain === "dirt") {
    return mixHex(HARBOR_PALETTE.path, HARBOR_PALETTE.wetSand, 0.24);
  }

  if (terrain === "dirt" || terrain === "path") {
    return HARBOR_PALETTE.path;
  }

  if (terrain === "dock" || dock) {
    return HARBOR_PALETTE.dock;
  }

  return HARBOR_PALETTE.grass;
}

type TerrainKind = BackdropTerrain | ShoreTile["terrain"];

const HEX_EDGE_NEIGHBOR_OFFSETS = [
  { row: -1, col: -1 },
  { row: 0, col: -1 },
  { row: 1, col: 0 },
  { row: 1, col: 1 },
  { row: 0, col: 1 },
  { row: -1, col: 0 },
] as const;

function getTerrainLift(
  terrain: TerrainKind | undefined,
  detailScale: number,
  dock?: boolean,
) {
  if (terrain === "water" || terrain === "water-deep") {
    return 0;
  }

  const elevationScale = clamp(detailScale / 1.2, 0.9, 1.15);

  if (terrain === "sand") {
    return 5 * elevationScale;
  }

  if (terrain === "dirt" || terrain === "path" || terrain === "dock" || dock) {
    return 7 * elevationScale;
  }

  return 9 * elevationScale;
}

function getTerrainSideFill(terrain: TerrainKind | undefined, dock?: boolean) {
  if (terrain === "sand") {
    return "#bf995e";
  }

  if (terrain === "dirt" || terrain === "path" || terrain === "dock" || dock) {
    return "#9b7045";
  }

  return "#4f8444";
}

function normalizeShoreTerrain(tile: ShoreTile): TerrainKind {
  if (tile.dock) {
    return "dirt";
  }

  return tile.terrain === "dock" || tile.terrain === "path" ? "dirt" : (tile.terrain ?? "grass");
}

function buildTerrainMap(frame: CanvasHarborFrame) {
  const terrainMap = new Map<string, TerrainKind>();

  for (const tile of frame.backdropTiles) {
    terrainMap.set(
      getTileKey(tile),
      getResponsiveBackdropTerrain(tile, frame.projectSceneTile(tile), tile.terrain, frame.camera),
    );
  }

  for (const tile of frame.manifest.pond.shoreline) {
    terrainMap.set(getTileKey(tile), normalizeShoreTerrain(tile));
  }

  return terrainMap;
}

let cachedTerrainMap:
  | {
      key: string;
      terrainMap: Map<string, TerrainKind>;
    }
  | undefined;

function getTerrainMapCacheKey(frame: CanvasHarborFrame) {
  return [
    frame.manifest.pond.id,
    frame.camera.viewportWidth,
    frame.camera.viewportHeight,
    frame.camera.origin.x.toFixed(2),
    frame.camera.origin.y.toFixed(2),
    frame.camera.tileSize.width.toFixed(2),
    frame.camera.tileSize.height.toFixed(2),
    frame.backdropTiles.length,
    frame.waterTiles.length,
    frame.manifest.pond.shoreline.length,
  ].join("|");
}

function getCachedTerrainMap(frame: CanvasHarborFrame) {
  const key = getTerrainMapCacheKey(frame);

  if (cachedTerrainMap?.key === key) {
    return cachedTerrainMap.terrainMap;
  }

  const terrainMap = buildTerrainMap(frame);
  cachedTerrainMap = {
    key,
    terrainMap,
  };

  return terrainMap;
}

function getTerrainSideDrops(
  tile: Tile,
  lift: number,
  terrainMap: Map<string, TerrainKind>,
  detailScale: number,
) {
  return HEX_EDGE_NEIGHBOR_OFFSETS.map((offset) => {
    const neighborKey = getTileKey({
      row: tile.row + offset.row,
      col: tile.col + offset.col,
    });
    const neighborTerrain = terrainMap.get(neighborKey);

    if (!neighborTerrain) {
      return 0;
    }

    return Math.max(0, lift - getTerrainLift(neighborTerrain, detailScale));
  });
}

function getShoreTileLift(tile: ShoreTile, detailScale: number) {
  return getTerrainLift(normalizeShoreTerrain(tile), detailScale, tile.dock);
}

function isShoreTile(tile: Tile | ShoreTile): tile is ShoreTile {
  return "terrain" in tile || "dock" in tile || "castable" in tile;
}

function getSceneTileLift(frame: CanvasHarborFrame, tile: Tile | ShoreTile, detailScale: number) {
  if (isShoreTile(tile)) {
    return getShoreTileLift(tile, detailScale);
  }

  const shoreTile = frame.manifest.pond.shoreline.find((candidate) => tileMatches(candidate, tile));

  return shoreTile ? getShoreTileLift(shoreTile, detailScale) : 0;
}

function projectRaisedLandTile(frame: CanvasHarborFrame, tile: Tile | ShoreTile, detailScale: number) {
  const center = frame.projectSceneTile(tile);

  return {
    x: center.x,
    y: center.y - getSceneTileLift(frame, tile, detailScale),
  };
}

function getHexPoints(
  centerX: number,
  centerY: number,
  pointOffsets: readonly { x: number; y: number }[],
) {
  return pointOffsets.map((point) => ({
    x: centerX + point.x,
    y: centerY + point.y,
  }));
}

function drawPolygon(ctx: CanvasRenderingContext2D, points: { x: number; y: number }[], fill: string) {
  ctx.beginPath();
  ctx.moveTo(Math.round(points[0].x), Math.round(points[0].y));

  for (const point of points.slice(1)) {
    ctx.lineTo(Math.round(point.x), Math.round(point.y));
  }

  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function drawHexTile(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  pointOffsets: readonly { x: number; y: number }[],
  fill: string | CanvasGradient,
  stroke: string,
  lineWidth = 1,
) {
  const points = getHexPoints(centerX, centerY, pointOffsets);

  ctx.beginPath();
  ctx.moveTo(Math.round(points[0].x), Math.round(points[0].y));

  for (const point of points.slice(1)) {
    ctx.lineTo(Math.round(point.x), Math.round(point.y));
  }

  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();

  if (lineWidth > 0) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function drawRaisedHexTile(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  pointOffsets: readonly { x: number; y: number }[],
  fill: string | CanvasGradient,
  stroke: string,
  lineWidth: number,
  lift: number,
  sideFill: string,
  sideDrops: readonly number[],
) {
  if (lift > 0.5) {
    const top = getHexPoints(centerX, centerY - lift, pointOffsets);

    sideDrops.forEach((drop, edgeIndex) => {
      if (drop <= 0.5) {
        return;
      }

      const nextIndex = (edgeIndex + 1) % top.length;
      const bottomA = {
        x: top[edgeIndex].x,
        y: top[edgeIndex].y + drop,
      };
      const bottomB = {
        x: top[nextIndex].x,
        y: top[nextIndex].y + drop,
      };
      const shadedSideFill =
        edgeIndex >= 2 && edgeIndex <= 3
          ? mixHex(sideFill, "#203f45", 0.22)
          : edgeIndex === 4
            ? mixHex(sideFill, "#fff6d8", 0.08)
            : sideFill;

      drawPolygon(ctx, [top[edgeIndex], top[nextIndex], bottomB, bottomA], shadedSideFill);
      ctx.save();
      ctx.strokeStyle =
        edgeIndex >= 2 && edgeIndex <= 3
          ? "rgba(32, 54, 42, 0.2)"
          : "rgba(255, 247, 210, 0.1)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(bottomA.x), Math.round(bottomA.y));
      ctx.lineTo(Math.round(bottomB.x), Math.round(bottomB.y));
      ctx.stroke();
      ctx.restore();
    });
  }

  drawHexTile(ctx, centerX, centerY - lift, pointOffsets, fill, stroke, lineWidth);

  if (lift > 0.5) {
    const top = getHexPoints(centerX, centerY - lift, pointOffsets);

    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255, 250, 218, 0.18)";
    ctx.beginPath();
    ctx.moveTo(Math.round(top[4].x), Math.round(top[4].y));
    ctx.lineTo(Math.round(top[5].x), Math.round(top[5].y));
    ctx.lineTo(Math.round(top[0].x), Math.round(top[0].y));
    ctx.stroke();

    ctx.strokeStyle = "rgba(38, 55, 44, 0.14)";
    ctx.beginPath();
    ctx.moveTo(Math.round(top[1].x), Math.round(top[1].y));
    ctx.lineTo(Math.round(top[2].x), Math.round(top[2].y));
    ctx.lineTo(Math.round(top[3].x), Math.round(top[3].y));
    ctx.stroke();
    ctx.restore();
  }
}

function isHexInViewport(
  frame: CanvasHarborFrame,
  centerX: number,
  centerY: number,
  halfWidth: number,
  halfHeight: number,
  margin = 0,
) {
  return (
    centerX + halfWidth >= -margin &&
    centerX - halfWidth <= frame.camera.viewportWidth + margin &&
    centerY + halfHeight >= -margin &&
    centerY - halfHeight <= frame.camera.viewportHeight + margin
  );
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

function drawEllipsePath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
) {
  if (typeof ctx.ellipse === "function") {
    ctx.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2);
    return;
  }

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, radiusY / Math.max(1, radiusX));
  ctx.arc(0, 0, radiusX, 0, Math.PI * 2);
  ctx.restore();
}

function drawSoftOvalShadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  alpha = 0.18,
) {
  if (typeof ctx.createRadialGradient !== "function") {
    ctx.save();
    ctx.fillStyle = `rgba(11, 26, 40, ${alpha * 0.58})`;
    ctx.beginPath();
    drawEllipsePath(ctx, x, y, width * 0.5, height * 0.5);
    ctx.fill();
    ctx.restore();
    return;
  }

  const gradient = ctx.createRadialGradient(x, y, 1, x, y, Math.max(width, height) * 0.5);
  gradient.addColorStop(0, `rgba(11, 26, 40, ${alpha})`);
  gradient.addColorStop(0.68, `rgba(11, 26, 40, ${alpha * 0.46})`);
  gradient.addColorStop(1, "rgba(11, 26, 40, 0)");

  ctx.save();
  ctx.scale(1, height / width);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y * (width / height), width * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawGroundTileDetails(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  terrain: BackdropTerrain | ShoreTile["terrain"],
  variant: number,
  detailScale: number,
) {
  const pixel = Math.max(1, Math.round(detailScale * 0.45));
  const bit = (dx: number, dy: number, width: number, height: number, color: string) => {
    drawPixelRect(ctx, x + dx * pixel, y + dy * pixel, width * pixel, height * pixel, color);
  };

  if (terrain === "sand") {
    const shadow = variant % 2 === 0 ? "rgba(147, 111, 58, 0.18)" : "rgba(191, 147, 83, 0.2)";
    const pebble = "rgba(95, 83, 63, 0.18)";
    const glint = "rgba(255, 244, 194, 0.34)";
    bit(-10, -2, 2, 1, shadow);
    bit(-4, 4, 2, 1, shadow);
    bit(6, -1, 2, 1, shadow);
    bit(1, 6, 1, 1, pebble);
    bit(-7, 3, 1, 1, pebble);
    bit(-5, -6, 1, 1, glint);
    bit(8, 4, 1, 1, glint);
    return;
  }

  if (terrain === "path") {
    bit(-10, -4, 3, 1, "rgba(132, 82, 45, 0.2)");
    bit(5, -1, 2, 1, "rgba(132, 82, 45, 0.18)");
    bit(-3, 5, 3, 1, "rgba(242, 219, 161, 0.28)");
    bit(1, 7, 2, 1, "rgba(110, 72, 40, 0.18)");
    return;
  }

  if (terrain === "grass") {
    bit(-8, 2, 2, 3, "rgba(47, 96, 53, 0.3)");
    bit(-1, -4, 1, 3, "rgba(138, 207, 93, 0.34)");
    bit(4, 2, 2, 2, "rgba(45, 89, 50, 0.24)");
    bit(8, -2, 1, 3, "rgba(160, 221, 116, 0.32)");
    bit(-4, 6, 1, 2, "rgba(45, 89, 50, 0.24)");
    bit(5, -6, 1, 2, "rgba(188, 231, 132, 0.24)");
  }
}

function drawWaterRippleSprite(
  ctx: CanvasRenderingContext2D,
  asset: Extract<HarborSpriteName, "fx.ripple.0">,
  x: number,
  y: number,
  time: number,
  variant: number,
  scale: number,
  alpha = 1,
) {
  getSpriteFrame(asset);
  const pixel = Math.max(1, Math.round(scale * 0.64));
  const drift = Math.sin(time / 260 + variant * 0.73) * pixel * 2.2;
  const bob = Math.cos(time / 310 + variant * 0.37) * pixel * 0.8;
  const pulse = 0.66 + Math.sin(time / 300 + variant) * 0.3;
  const colors = [
    `rgba(229, 255, 252, ${0.46 * alpha * pulse})`,
    `rgba(89, 211, 222, ${0.34 * alpha})`,
    `rgba(8, 75, 111, ${0.2 * alpha})`,
  ];

  ctx.save();
  ctx.translate(Math.round(x + drift), Math.round(y + bob));
  ctx.lineCap = "square";
  ctx.lineWidth = Math.max(1, pixel);
  ctx.strokeStyle = colors[0];
  ctx.beginPath();
  ctx.moveTo(-9 * pixel, -2 * pixel);
  ctx.lineTo(-4 * pixel, -3 * pixel);
  ctx.moveTo(1 * pixel, -1 * pixel);
  ctx.lineTo(8 * pixel, -2 * pixel);
  ctx.stroke();

  ctx.strokeStyle = colors[1];
  ctx.beginPath();
  ctx.moveTo(-7 * pixel, 3 * pixel);
  ctx.lineTo(-1 * pixel, 2 * pixel);
  ctx.moveTo(4 * pixel, 3 * pixel);
  ctx.lineTo(10 * pixel, 2 * pixel);
  ctx.stroke();

  if (variant % 3 === 0) {
    ctx.strokeStyle = colors[2];
    ctx.beginPath();
    ctx.moveTo(-3 * pixel, 7 * pixel);
    ctx.lineTo(5 * pixel, 6 * pixel);
    ctx.stroke();
  }

  ctx.restore();
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
  const density = deep ? 0.42 : 0.64;
  const first = getDeterministicNoise(variant, 2, 9);
  const second = getDeterministicNoise(variant, 7, 12);
  const pixel = Math.max(1, Math.round(detailScale * 0.52));
  const currentPhase = ((time / 34 + variant * 3.7) % 38) - 19;

  if (deep && first < 0.26) {
    return;
  }

  drawWaterRippleSprite(
    ctx,
    "fx.ripple.0",
    x - 10 * detailScale * 0.38 + first * 12,
    y - 4 * detailScale * 0.28,
    time,
    variant,
    detailScale,
    density,
  );

  if (second > 0.62) {
    drawWaterRippleSprite(
      ctx,
      "fx.ripple.0",
      x + 7 * detailScale * 0.34,
      y + 5 * detailScale * 0.22,
      time + 190,
      variant + 5,
      detailScale * 0.78,
      density * 0.66,
    );
  }

  if (first > 0.5) {
    const alpha = (deep ? 0.12 : 0.24) + Math.max(0, Math.sin(time / 320 + variant)) * 0.14;
    const brightCurrent = `rgba(222, 255, 248, ${alpha})`;
    const tealCurrent = `rgba(78, 195, 207, ${alpha * 0.72})`;

    ctx.save();
    ctx.translate(Math.round(x + currentPhase * pixel * 0.22), Math.round(y));
    drawPixelRect(ctx, -13 * pixel, -7 * pixel, 7 * pixel, pixel, brightCurrent);
    drawPixelRect(ctx, 3 * pixel, 8 * pixel, 8 * pixel, pixel, tealCurrent);
    ctx.restore();
  }
}

function drawShoreWash(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  detailScale: number,
  variant: number,
) {
  getSpriteFrame("overlay.shore.foam.0");
  const pixel = Math.max(1, Math.round(detailScale * 0.58));
  const shift = variant % 2 === 0 ? 0 : 1;
  drawPixelRect(
    ctx,
    x - (16 - shift) * pixel,
    y - 5 * pixel,
    6 * pixel,
    pixel,
    HARBOR_PALETTE.foam,
  );
  drawPixelRect(
    ctx,
    x - (12 - shift) * pixel,
    y - 2 * pixel,
    7 * pixel,
    pixel,
    "rgba(198, 245, 248, 0.68)",
  );
  drawPixelRect(
    ctx,
    x - (10 - shift) * pixel,
    y + pixel,
    5 * pixel,
    pixel,
    "rgba(74, 169, 179, 0.32)",
  );
  drawPixelRect(
    ctx,
    x + (4 + shift) * pixel,
    y + 3 * pixel,
    3 * pixel,
    pixel,
    "rgba(255, 255, 239, 0.5)",
  );
}

function drawBrokenGrassEdge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  detailScale: number,
  variant: number,
) {
  const pixel = Math.max(1, Math.round(detailScale * 0.48));
  const tufts = [
    [-14, -1, 2, 3],
    [-7, 2, 1, 3],
    [3, -1, 2, 4],
    [11, 2, 1, 3],
  ];

  for (const [dx, dy, width, height] of tufts) {
    const lift = variant % 2;
    drawPixelRect(
      ctx,
      x + dx * pixel,
      y + (dy - lift) * pixel,
      width * pixel,
      height * pixel,
      "rgba(52, 112, 58, 0.42)",
    );
  }
}

function drawPixelTree(ctx: CanvasRenderingContext2D, x: number, y: number, scale = 1) {
  getSpriteFrame("prop.tree.pine.0");
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(scale, scale);
  drawSoftOvalShadow(ctx, 0, 33, 44, 13, 0.26);
  drawPixelRect(ctx, -6, 8, 12, 25, "#5c3824");
  drawPixelRect(ctx, -2, 10, 4, 21, "#936744");
  drawPixelRect(ctx, -26, 21, 51, 7, "#17392e");
  drawPixelRect(ctx, -22, 15, 48, 8, "#23503e");
  drawPixelRect(ctx, -21, 9, 39, 7, "#2f654b");
  drawPixelRect(ctx, -16, 3, 37, 7, "#397356");
  drawPixelRect(ctx, -18, -3, 29, 7, "#43825e");
  drawPixelRect(ctx, -12, -9, 24, 7, "#58976b");
  drawPixelRect(ctx, -9, -15, 17, 6, "#76b985");
  drawPixelRect(ctx, -5, -20, 10, 5, "#a3d5a2");
  drawPixelRect(ctx, -20, 17, 5, 3, "#62b06d");
  drawPixelRect(ctx, -10, 7, 4, 3, "#86cb7d");
  drawPixelRect(ctx, 5, 1, 4, 3, "#9dd794");
  drawPixelRect(ctx, 9, 13, 5, 3, "#1c4438");
  drawPixelRect(ctx, -15, 11, 4, 2, "#1f4a3b");
  ctx.restore();
}

function drawPixelBush(ctx: CanvasRenderingContext2D, x: number, y: number, scale = 1) {
  getSpriteFrame("prop.bush.0");
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(scale, scale);
  drawSoftOvalShadow(ctx, 0, 8, 26, 8, 0.18);
  drawPixelRect(ctx, -12, 2, 24, 8, "#477f4a");
  drawPixelRect(ctx, -9, -5, 21, 8, "#61a65c");
  drawPixelRect(ctx, -4, -10, 12, 7, "#7dc56d");
  drawPixelRect(ctx, -9, -1, 3, 3, "#9ae28a");
  drawPixelRect(ctx, 4, -2, 3, 2, "#b5ef9a");
  ctx.restore();
}

function drawPixelRock(ctx: CanvasRenderingContext2D, x: number, y: number, scale = 1) {
  getSpriteFrame("prop.rock.0");
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(scale, scale);
  drawSoftOvalShadow(ctx, 0, 13, 48, 10, 0.18);
  drawPixelRect(ctx, -20, 7, 36, 10, "#6f8792");
  drawPixelRect(ctx, -14, 2, 28, 10, "#92a9b2");
  drawPixelRect(ctx, -8, -2, 17, 7, "#dbe7eb");
  drawPixelRect(ctx, -15, 9, 5, 2, "#516a74");
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
  getSpriteFrame("prop.reeds.0");
  const sway = frame % 4;
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(scale, scale);
  drawSoftOvalShadow(ctx, 0, 6, 32, 7, 0.13);
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

function drawForegroundFoliage(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  frame: number,
  scale = 1,
) {
  getSpriteFrame("prop.foreground.foliage.0");
  const sway = Math.sin(frame * 0.34) * 1.5;
  ctx.save();
  ctx.translate(Math.round(x + sway), Math.round(y));
  ctx.scale(scale, scale);
  ctx.globalAlpha = 0.84;
  drawPixelRect(ctx, -38, -8, 30, 13, "rgba(19, 61, 48, 0.88)");
  drawPixelRect(ctx, -30, -19, 28, 15, "rgba(27, 84, 58, 0.86)");
  drawPixelRect(ctx, -17, -30, 25, 16, "rgba(43, 112, 69, 0.82)");
  drawPixelRect(ctx, 1, -16, 30, 13, "rgba(32, 89, 59, 0.84)");
  drawPixelRect(ctx, 12, -27, 20, 13, "rgba(87, 145, 82, 0.7)");
  drawPixelRect(ctx, -20, -12, 5, 4, "rgba(135, 198, 101, 0.58)");
  drawPixelRect(ctx, 4, -22, 4, 3, "rgba(153, 211, 117, 0.52)");
  ctx.restore();
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
  getSpriteFrame("fish.lanternKoi.swim.0");
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
  drawSoftOvalShadow(ctx, -2, 8, 24, 7, shadowy ? 0.13 : 0.2);
  drawPixelRect(ctx, -11, -3, 14, 6, bodyColor);
  drawPixelRect(ctx, -7, -6, 8, 3, finColor);
  drawPixelRect(ctx, -6, 3, 7, 3, finColor);
  drawPixelRect(ctx, 3, -4 - wag, 6, 8 + wag * 2, bodyColor);
  drawPixelRect(ctx, -9, -1, 2, 2, eyeColor);
  drawPixelRect(ctx, -13, -1, 3, 2, tailColor);
  drawPixelRect(ctx, -1, -1, 4, 1, highlight);
  ctx.restore();
}

function drawFishInBeak(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  accent: string,
  scale = 1,
) {
  drawPixelRect(ctx, x, y, 7 * scale, 3 * scale, mixHex(accent, "#173f52", 0.18));
  drawPixelRect(ctx, x + 5 * scale, y - scale, 3 * scale, 5 * scale, mixHex(accent, "#123646", 0.28));
  drawPixelRect(ctx, x + scale, y + scale, 3 * scale, scale, "rgba(255,255,255,0.34)");
}

function drawPixelEgret(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  direction: 1 | -1,
  state: AmbientEgretState,
  progress: number,
  frame: number,
  scale = 1,
  caughtFish?: AmbientEgret["caughtFish"],
) {
  const flying = state === "arriving" || state === "leaving";
  const striking = state === "striking";
  const eating = state === "eating";
  const wingsUp = Math.floor(frame / 3) % 2 === 0;
  const white = "#fffdf1";
  const shade = "#d9e7e3";
  const warmShade = "#f2ead2";
  const bill = "#d8aa3a";
  const leg = "#27333f";
  const swallow = eating ? Math.min(1, progress / 0.62) : 0;

  getSpriteFrame(
    flying
      ? "wildlife.egret.fly.0"
      : striking
        ? "wildlife.egret.strike.0"
        : eating
          ? "wildlife.egret.eat.0"
          : "wildlife.egret.stand.0",
  );

  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(direction * scale, scale);
  drawSoftOvalShadow(ctx, 0, 21, flying ? 34 : 24, flying ? 8 : 7, flying ? 0.08 : 0.18);

  if (flying) {
    const upperWingY = wingsUp ? -39 : -15;
    const farWingY = wingsUp ? -12 : 12;
    const farWingHeight = wingsUp ? 8 : 10;
    drawPixelRect(ctx, -17, -9, 27, 10, white);
    drawPixelRect(ctx, -12, -5, 20, 8, shade);
    drawPixelRect(ctx, -4, upperWingY, 46, 10, white);
    drawPixelRect(ctx, 18, upperWingY + (wingsUp ? 8 : 5), 24, 6, shade);
    drawPixelRect(ctx, -40, farWingY, 36, farWingHeight, warmShade);
    drawPixelRect(ctx, -34, farWingY + (wingsUp ? 6 : 8), 22, 6, shade);
    drawPixelRect(ctx, 7, -13, 12, 5, white);
    drawPixelRect(ctx, 16, -11, 15, 2, bill);
    drawPixelRect(ctx, -23, 2, 16, 2, leg);
    drawPixelRect(ctx, -21, 6, 14, 2, leg);
    ctx.restore();
    return;
  }

  drawPixelRect(ctx, -4, 4, 2, 22, leg);
  drawPixelRect(ctx, 5, 4, 2, 22, leg);
  drawPixelRect(ctx, -8, 24, 8, 2, leg);
  drawPixelRect(ctx, 2, 24, 8, 2, leg);
  drawPixelRect(ctx, -14, -9, 26, 14, white);
  drawPixelRect(ctx, -8, -5, 18, 9, shade);
  drawPixelRect(ctx, -17, -3, 9, 7, warmShade);

  if (striking) {
    const neckReach = 18 + progress * 12;
    drawPixelRect(ctx, 7, -8, neckReach, 4, white);
    drawPixelRect(ctx, 22 + progress * 12, -5 + progress * 8, 5, 14, white);
    drawPixelRect(ctx, 25 + progress * 12, 7 + progress * 7, 9, 5, white);
    drawPixelRect(ctx, 33 + progress * 12, 9 + progress * 7, 13, 3, bill);
    if (caughtFish) {
      drawFishInBeak(ctx, 44 + progress * 10, 9 + progress * 7, caughtFish.accent, 1);
    }
    ctx.restore();
    return;
  }

  drawPixelRect(ctx, 6, -21, 5, 18, white);
  drawPixelRect(ctx, 8, -28, 9, 6, white);
  drawPixelRect(ctx, 15, -27, 12, 3, bill);
  drawPixelRect(ctx, 14, -26, 2, 2, "#142333");

  if (caughtFish && eating && swallow < 1) {
    drawFishInBeak(ctx, 27 - swallow * 9, -26 + swallow * 12, caughtFish.accent, 1);
  }

  if (eating && progress > 0.58) {
    drawPixelRect(ctx, 8, -18, 4, 3, "rgba(210, 230, 226, 0.72)");
  }

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
  if (mode === "casting") {
    return;
  }

  drawTargetRipples(ctx, x, y, frame, mode === "hooked" ? "bite" : "selected");
}

function getFisherPose(mode: HarborGameMode, motion: number, castingProgress = 1): FisherPose {
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
  const cast = easeInOut(clamp(castingProgress, 0, 1));
  const castSnap = Math.sin(cast * Math.PI);

  return {
    bob:
      mode === "casting"
        ? castSnap * 1.5
        : mode === "inspecting"
          ? 0.6
          : Math.max(0, idleWave) * 1.35,
    rodLift:
      mode === "casting"
        ? 16 - cast * 8 + castSnap * 3
        : mode === "inspecting"
        ? 15
        : mode === "hooked"
          ? 8 + idleWave * 0.8
          : mode === "reeling"
            ? 12 + patientWave * 0.8
            : mode === "waiting"
              ? 4 + patientWave * 1.1
              : 3 + patientWave * 0.7,
    armLift:
      mode === "casting"
        ? 6.8 - cast * 2.4 + castSnap * 1.5
        : mode === "inspecting"
        ? 6
        : mode === "reeling"
          ? 4 + idleWave * 0.6
          : mode === "hooked"
            ? 2.8 + patientWave * 0.5
            : 1 + patientWave * 0.5,
    swayX:
      mode === "casting"
        ? lerp(-1.3, 1.15, cast) + castSnap * 0.55
        : mode === "waiting"
          ? idleWave * 1.2
          : patientWave * 0.65,
    torsoLean:
      mode === "casting"
        ? lerp(-1.25, 1.35, cast)
        : mode === "reeling"
          ? 1.8
          : mode === "hooked"
            ? 1.2
            : mode === "waiting"
              ? 0.8
              : 0.5,
    frontLegLift: 0,
    backLegLift: 0,
    frontStep: 0,
    backStep: 0,
  };
}

function getRodLocalGeometry(
  mode: HarborGameMode,
  motion: number,
  pull: number,
  castingProgress = 1,
) {
  const pose = getFisherPose(mode, motion, castingProgress);
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

  if (mode === "casting") {
    const cast = easeInOut(clamp(castingProgress, 0, 1));
    const castArc = Math.sin(cast * Math.PI);
    const tipX = lerp(-13, baseTipX + 4.5, cast);
    const tipY = lerp(-18, baseTipY + 0.8, cast) - castArc * 27;
    const bendX = lerp(-3, baseTipX - 6, cast);
    const bendY = lerp(-7, baseTipY - 2, cast) - castArc * 12;

    return {
      pose,
      handX,
      handY,
      bendX,
      bendY,
      tipX,
      tipY,
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
  castingProgress = 1,
) {
  const rod = getRodLocalGeometry(mode, motion, pull, castingProgress);
  const translatedX = x + rod.pose.swayX * scale;
  const translatedY = y - 22 * scale + rod.pose.bob * scale;

  return {
    x: translatedX + rod.tipX * scale,
    y: translatedY + rod.tipY * scale,
  };
}

function drawPixelFisher(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  mode: HarborGameMode,
  motion: number,
  scale = 1,
  pull = 0,
  castingProgress = 1,
) {
  getSpriteFrame(
    mode === "reeling" || mode === "hooked"
      ? "fisher.reel.right.0"
      : mode === "waiting" || mode === "casting"
        ? "fisher.cast.right.0"
        : "fisher.idle.right.0",
  );
  const rod = getRodLocalGeometry(mode, motion, pull, castingProgress);
  const pose = rod.pose;
  const coatColor = "#c7664e";
  const coatShadow = "#954735";
  const coatLight = "#df9369";
  const hatColor = "#efc94e";
  const hatShadow = "#b98d26";
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
  drawSoftOvalShadow(ctx, 0, 22, 32, 10, 0.24);
  drawPixelRect(ctx, -7 + pose.backStep, 9 - pose.backLegLift, 4, 11 + pose.backLegLift, legColor);
  drawPixelRect(ctx, 1 + pose.frontStep, 9 - pose.frontLegLift, 5, 11 + pose.frontLegLift, legColor);
  drawPixelRect(ctx, -8 + pose.backStep, 18, 6, 4, bootColor);
  drawPixelRect(ctx, 1 + pose.frontStep, 18, 7, 4, bootColor);
  drawPixelRect(ctx, -10, -1 + pose.torsoLean * 0.2, 19, 13, coatColor);
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

function drawTargetRipples(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  frame: number,
  intent: "hover" | "selected" | "blocked" | "bite",
) {
  const color =
    intent === "blocked"
      ? "rgba(239, 68, 68, 0.58)"
      : intent === "bite"
        ? "rgba(255, 205, 109, 0.78)"
        : intent === "hover"
          ? "rgba(236, 255, 214, 0.68)"
          : "rgba(201, 248, 255, 0.74)";
  const pulse = (frame % 18) / 18;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.82 - pulse * 0.38;
  ctx.beginPath();
  drawEllipsePath(ctx, x, y + 2, 13 + pulse * 12, 6 + pulse * 6);
  ctx.stroke();
  ctx.globalAlpha = 0.46 - pulse * 0.22;
  ctx.beginPath();
  drawEllipsePath(ctx, x, y + 2, 23 + pulse * 14, 10 + pulse * 7);
  ctx.stroke();
  ctx.restore();
}

function drawSplashFx(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  frame: number,
  scale: number,
  intensity = 1,
) {
  getSpriteFrame("fx.splash.0");
  const pixel = Math.max(1, Math.round(scale * 0.42));
  const burst = (frame % 5) - 2;
  const color = `rgba(231, 255, 255, ${0.68 * intensity})`;
  drawPixelRect(ctx, x - 7 * pixel - burst, y - 3 * pixel, 3 * pixel, pixel, color);
  drawPixelRect(ctx, x + 4 * pixel + burst, y - 5 * pixel, 2 * pixel, pixel, color);
  drawPixelRect(ctx, x - 2 * pixel, y - 8 * pixel - Math.abs(burst), pixel, 3 * pixel, color);
  drawPixelRect(ctx, x + 8 * pixel, y + 2 * pixel, 3 * pixel, pixel, "rgba(118, 210, 225, 0.4)");
}

function drawSparkleFx(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  frame: number,
  scale: number,
  color = "rgba(255, 238, 143, 0.88)",
) {
  getSpriteFrame("fx.sparkle.0");
  const pixel = Math.max(1, Math.round(scale * 0.42));
  const flicker = frame % 2;
  drawPixelRect(ctx, x - pixel, y - 4 * pixel, 2 * pixel, 8 * pixel, color);
  drawPixelRect(ctx, x - 4 * pixel, y - pixel, 8 * pixel, 2 * pixel, color);
  if (flicker === 0) {
    drawPixelRect(ctx, x + 7 * pixel, y + 2 * pixel, pixel, pixel, "rgba(255,255,255,0.72)");
    drawPixelRect(ctx, x - 8 * pixel, y - 3 * pixel, pixel, pixel, "rgba(255,255,255,0.62)");
  }
}

function drawNamedSprite(
  ctx: CanvasRenderingContext2D,
  asset: HarborSpriteName,
  x: number,
  y: number,
  options: NamedSpriteOptions,
) {
  if (asset === "prop.tree.pine.0") {
    drawPixelTree(ctx, x, y, options.scale);
    return;
  }

  if (asset === "prop.reeds.0") {
    drawPixelCattails(ctx, x, y, options.frame, options.scale);
    return;
  }

  if (asset === "prop.rock.0") {
    drawPixelRock(ctx, x, y, options.scale);
    return;
  }

  if (asset === "prop.bush.0") {
    drawPixelBush(ctx, x, y, options.scale);
    return;
  }

  if (asset === "prop.foreground.foliage.0") {
    drawForegroundFoliage(ctx, x, y, options.frame, options.scale);
    return;
  }

  if (asset === "fish.lanternKoi.swim.0") {
    drawPixelFish(
      ctx,
      x,
      y,
      options.accent ?? "#d3f7ff",
      options.direction ?? 1,
      options.scale,
      options.frame,
      true,
    );
  }
}

function getWaterFill(tile: Tile, isNearShore: boolean, variant: number) {
  const offshoreDepth = clamp((9.4 - tile.col + tile.row * 0.035) / 15.5, 0, 1);
  const broadPatch = getDeterministicNoise(Math.floor(tile.row / 7), Math.floor(tile.col / 7), 8);
  const shelfPatch = getDeterministicNoise(Math.floor(tile.row / 5), Math.floor(tile.col / 6), 24);
  const currentPatch = getDeterministicNoise(variant, 17, 31);
  const deepened = clamp(
    offshoreDepth * 0.68 +
      broadPatch * 0.18 +
      shelfPatch * 0.08 +
      currentPatch * 0.035 -
      (isNearShore ? 0.36 : 0.03),
    0,
    1,
  );
  const base = mixHex(HARBOR_PALETTE.waterShallow, HARBOR_PALETTE.waterDeep, deepened);
  const surface = mixHex(base, HARBOR_PALETTE.waterNight, deepened * 0.12 + (broadPatch > 0.76 ? 0.05 : 0));

  if (isNearShore) {
    return mixHex(surface, "#63d2cc", 0.26 + (variant % 3) * 0.018);
  }

  return surface;
}

function drawBackground(ctx: CanvasRenderingContext2D, frame: CanvasHarborFrame) {
  const gradient = ctx.createLinearGradient(0, 0, frame.camera.viewportWidth, frame.camera.viewportHeight);
  gradient.addColorStop(0, mixHex(HARBOR_PALETTE.waterMid, HARBOR_PALETTE.waterShallow, 0.12));
  gradient.addColorStop(0.52, HARBOR_PALETTE.waterMid);
  gradient.addColorStop(1, mixHex(HARBOR_PALETTE.waterDeep, HARBOR_PALETTE.waterNight, 0.32));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, frame.camera.viewportWidth, frame.camera.viewportHeight);
}

function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  frame: CanvasHarborFrame,
  detailScale: number,
  terrainMap: Map<string, TerrainKind>,
) {
  const tileMetrics = getHexTileMetrics(frame.camera.tileSize);
  const tilePointOffsets = getHexTilePointOffsets(frame.camera.tileSize);
  const halfWidth = tileMetrics.halfWidth;
  const halfHeight = tileMetrics.halfHeight;

  for (const tile of frame.backdropTiles) {
    const center = frame.projectSceneTile(tile);
    const terrain = terrainMap.get(getTileKey(tile)) ?? tile.terrain;
    const isWater = terrain.startsWith("water");
    const variant = tile.row + tile.col;

    if (!isHexInViewport(frame, center.x, center.y, halfWidth, halfHeight, frame.camera.tileSize.width * 2)) {
      continue;
    }

    if (isWater) {
      const isNearShore = frame.nearShoreWaterKeys.has(getTileKey(tile));

      ctx.save();
      ctx.globalAlpha = 0.72;
      drawHexTile(
        ctx,
        center.x,
        center.y,
        tilePointOffsets,
        getWaterFill(tile, isNearShore, variant),
        "rgba(64, 163, 181, 0)",
        0,
      );
      ctx.restore();
    } else {
      const lift = getTerrainLift(terrain, detailScale);
      const sideDrops = getTerrainSideDrops(tile, lift, terrainMap, detailScale);

      drawRaisedHexTile(
        ctx,
        center.x,
        center.y,
        tilePointOffsets,
        getTileFill(terrain),
        "rgba(62, 98, 59, 0.18)",
        0.8,
        lift,
        getTerrainSideFill(terrain),
        sideDrops,
      );
    }

    if (isWater) {
      if ((variant + Math.round(tile.row * 0.5)) % 4 === 0) {
        drawWaterTileDetails(
          ctx,
          center.x,
          center.y,
          frame.time * 0.9,
          variant,
          detailScale * 0.82,
          terrain === "water-deep",
        );
      }
    } else {
      const lift = getTerrainLift(terrain, detailScale);

      drawGroundTileDetails(ctx, center.x, center.y - lift, terrain, variant, detailScale);
    }
  }
}

function drawWater(
  ctx: CanvasRenderingContext2D,
  frame: CanvasHarborFrame,
  detailScale: number,
  terrainMap: Map<string, TerrainKind>,
) {
  const tileMetrics = getHexTileMetrics(frame.camera.tileSize);
  const tilePointOffsets = getHexTilePointOffsets(frame.camera.tileSize);
  const halfWidth = tileMetrics.halfWidth;
  const halfHeight = tileMetrics.halfHeight;

  for (const tile of frame.waterTiles) {
    const center = frame.projectSceneTile(tile);
    const terrain = terrainMap.get(getTileKey(tile));

    if (!terrain?.startsWith("water")) {
      continue;
    }

    const isHovered = tileMatches(tile, frame.hoveredWaterTile);
    const isSelected = tileMatches(tile, frame.selectedWaterTile);
    const isInRange = isTileWithinCastRange(frame.playerTile, tile);
    const isNearShore = frame.nearShoreWaterKeys.has(getTileKey(tile));
    const variant = tile.row * 7 + tile.col * 11;
    const fill = getWaterFill(tile, isNearShore, variant);
    const normalStroke = "rgba(54, 139, 164, 0)";
    const stroke =
      isHovered || isSelected
        ? isInRange
          ? "rgba(222, 255, 218, 0.46)"
          : "rgba(239, 68, 68, 0.42)"
        : normalStroke;

    if (!isHexInViewport(frame, center.x, center.y, halfWidth, halfHeight, frame.camera.tileSize.width)) {
      continue;
    }

    ctx.save();
    ctx.globalAlpha = isHovered || isSelected ? 0.98 : 0.93;
    drawHexTile(
      ctx,
      center.x,
      center.y,
      tilePointOffsets,
      fill,
      stroke,
      isHovered || isSelected ? 1.4 : 0,
    );
    ctx.restore();
    drawWaterTileDetails(ctx, center.x, center.y, frame.time, variant, detailScale, !isNearShore);

    if (isNearShore) {
      drawShoreWash(ctx, center.x, center.y, detailScale, variant);
    }

    if (isHovered || isSelected) {
      drawTargetRipples(
        ctx,
        center.x,
        center.y,
        Math.floor(frame.time / 120),
        isInRange ? (isSelected ? "selected" : "hover") : "blocked",
      );
    }
  }
}

function drawShore(
  ctx: CanvasRenderingContext2D,
  frame: CanvasHarborFrame,
  detailScale: number,
  terrainMap: Map<string, TerrainKind>,
) {
  const tileMetrics = getHexTileMetrics(frame.camera.tileSize);
  const tilePointOffsets = getHexTilePointOffsets(frame.camera.tileSize);
  const halfWidth = tileMetrics.halfWidth;
  const halfHeight = tileMetrics.halfHeight;

  for (const tile of frame.manifest.pond.shoreline) {
    const center = frame.projectSceneTile(tile);
    const isPlayer = tileMatches(tile, frame.playerTile);
    const shoreTerrain = normalizeShoreTerrain(tile);
    const tileFill = getTileFill(shoreTerrain, tile.dock);
    const lift = getShoreTileLift(tile, detailScale);
    const tileTopY = center.y - lift;
    const sideDrops = getTerrainSideDrops(tile, lift, terrainMap, detailScale);

    if (!isHexInViewport(frame, center.x, center.y, halfWidth, halfHeight, frame.camera.tileSize.width)) {
      continue;
    }

    drawRaisedHexTile(
      ctx,
      center.x,
      center.y,
      tilePointOffsets,
      tileFill,
      isPlayer ? "rgba(23, 50, 74, 0.58)" : "rgba(74, 101, 65, 0.22)",
      isPlayer ? 1.2 : 0.65,
      lift,
      getTerrainSideFill(shoreTerrain, tile.dock),
      sideDrops,
    );
    drawGroundTileDetails(ctx, center.x, tileTopY, shoreTerrain, tile.row + tile.col, detailScale);

    if (shoreTerrain === "grass") {
      drawBrokenGrassEdge(ctx, center.x, tileTopY + halfHeight * 0.18, detailScale, tile.row + tile.col);
    }
  }
}

function getScaledPropScale(prop: ScenePropPlacement, detailScale: number) {
  if (prop.asset === "prop.tree.pine.0") {
    return Math.max(1.7, Math.min(2.75, detailScale * 0.5)) * prop.scale;
  }

  if (prop.asset === "prop.reeds.0") {
    return Math.max(1.72, Math.min(2.45, detailScale * 0.4)) * prop.scale;
  }

  if (prop.asset === "prop.rock.0") {
    return Math.max(1.15, Math.min(1.65, detailScale * 0.28)) * prop.scale;
  }

  if (prop.asset === "prop.bush.0") {
    return Math.max(1.08, Math.min(1.44, detailScale * 0.24)) * prop.scale;
  }

  return Math.max(1.24, Math.min(1.9, detailScale * 0.34)) * prop.scale;
}

function getAnimatedPlayerCenter(frame: CanvasHarborFrame, time: number, detailScale: number): {
  center: ScenePoint;
  mode: HarborGameMode;
} {
  let center = projectRaisedLandTile(frame, frame.playerTile, detailScale);
  let mode = frame.gameState;

  if (frame.movement && frame.movement.tiles.length > 1) {
    const elapsed = Math.max(0, time - frame.movement.startedAt);
    const totalSegments = frame.movement.tiles.length - 1;
    const pathProgress = Math.min(totalSegments, elapsed / frame.movement.segmentDuration);
    const segmentIndex = Math.min(totalSegments - 1, Math.floor(pathProgress));
    const localProgress = easeInOut(Math.min(1, Math.max(0, pathProgress - segmentIndex)));
    const fromCenter = projectRaisedLandTile(frame, frame.movement.tiles[segmentIndex], detailScale);
    const toCenter = projectRaisedLandTile(
      frame,
      frame.movement.tiles[segmentIndex + 1] ?? frame.movement.tiles[segmentIndex],
      detailScale,
    );

    center = {
      x: lerp(fromCenter.x, toCenter.x, localProgress),
      y: lerp(fromCenter.y, toCenter.y, localProgress),
    };
    mode = "walking";
  }

  return { center, mode };
}

function getEgretPose(
  egret: AmbientEgret,
  frame: CanvasHarborFrame,
  detailScale: number,
  egretScale: number,
): EgretRenderPose {
  const perchCenter = projectRaisedLandTile(frame, egret.perchTile, detailScale);
  const targetCenter = frame.projectSceneTile(egret.targetWaterTile);
  const waterDirection = targetCenter.x >= perchCenter.x ? 1 : -1;
  const standingFootOffset = 22 * egretScale;
  const perchPoint = {
    x: perchCenter.x,
    y: perchCenter.y - standingFootOffset,
  };
  const elapsed = Math.max(0, frame.time - egret.stateStartedAt);

  if (egret.state === "arriving") {
    const progress = easeInOut(clamp(elapsed / EGRET_ARRIVE_MS, 0, 1));
    const startX = waterDirection === 1 ? -96 : frame.camera.viewportWidth + 96;
    const startY = perchPoint.y - 145;

    return {
      direction: waterDirection,
      mode: egret.state,
      progress,
      x: lerp(startX, perchPoint.x - waterDirection * 8, progress),
      y: lerp(startY, perchPoint.y, progress) + Math.sin(progress * Math.PI) * -18,
    };
  }

  if (egret.state === "striking") {
    const progress = easeInOut(clamp(elapsed / EGRET_STRIKE_MS, 0, 1));

    return {
      direction: waterDirection,
      mode: egret.state,
      progress,
      x: lerp(perchPoint.x, targetCenter.x - waterDirection * 18, progress * 0.34),
      y: lerp(perchPoint.y, targetCenter.y - frame.camera.tileSize.height * 0.18, progress * 0.34),
    };
  }

  if (egret.state === "eating") {
    return {
      direction: waterDirection,
      mode: egret.state,
      progress: clamp(elapsed / EGRET_EAT_MS, 0, 1),
      x: perchPoint.x,
      y: perchPoint.y + Math.sin(frame.time / 180) * 0.8,
    };
  }

  if (egret.state === "leaving") {
    const progress = easeInOut(clamp(elapsed / EGRET_LEAVE_MS, 0, 1));
    const endX = waterDirection === 1 ? frame.camera.viewportWidth + 96 : -96;
    const endY = perchPoint.y - 150;

    return {
      direction: waterDirection,
      mode: egret.state,
      progress,
      x: lerp(perchPoint.x - waterDirection * 8, endX, progress),
      y: lerp(perchPoint.y, endY, progress) + Math.sin(progress * Math.PI) * -20,
    };
  }

  return {
    direction: waterDirection,
    mode: egret.state,
    progress: 0,
    x: perchPoint.x,
    y: perchPoint.y + Math.sin(frame.time / 650) * 0.7,
  };
}

function drawLineAndEncounter(
  ctx: CanvasRenderingContext2D,
  frame: CanvasHarborFrame,
  motion: number,
  playerCenter: ScenePoint,
  fisherMode: HarborGameMode,
  fisherScale: number,
  fishScaleBoost: number,
  detailScale: number,
) {
  if (!frame.sceneWaterTile) {
    return 0;
  }

  const targetCenter = frame.projectSceneTile(frame.sceneWaterTile);
  const reelProgress =
    frame.gameState === "reeling" && frame.reelingStartedAt
      ? Math.min(1, Math.max(0, (frame.time - frame.reelingStartedAt) / frame.reelDuration))
      : 0;
  const castingProgress =
    frame.gameState === "casting" && frame.castingStartedAt
      ? clamp((frame.time - frame.castingStartedAt) / CAST_ANIMATION_MS, 0, 1)
      : frame.gameState === "casting"
        ? 1
        : 0;
  let rodPull = 0;
  let rodTip = getRodTipPosition(
    playerCenter.x,
    playerCenter.y,
    fisherMode,
    motion,
    fisherScale,
    rodPull,
    castingProgress,
  );

  if (frame.gameState === "reeling") {
    const reelEndX = lerp(targetCenter.x, rodTip.x - 12, easeInOut(reelProgress));
    const distancePull = (reelEndX - playerCenter.x) / Math.max(40, frame.camera.tileSize.width * 1.15);
    const fightPull = (1 - reelProgress) * 0.42;
    rodPull = clamp(distancePull + fightPull, 0, 1.35);
    rodTip = getRodTipPosition(
      playerCenter.x,
      playerCenter.y,
      fisherMode,
      motion,
      fisherScale,
      rodPull,
      castingProgress,
    );
  }

  const inspectPoint = {
    x: rodTip.x - 3,
    y: rodTip.y + 19,
  };
  let currentLineEnd =
    frame.gameState === "inspecting"
      ? inspectPoint
      : frame.gameState === "casting"
        ? {
            x: lerp(rodTip.x - 4, targetCenter.x, easeInOut(castingProgress)),
            y:
              lerp(rodTip.y + 10, targetCenter.y - 4, easeInOut(castingProgress)) -
              Math.sin(castingProgress * Math.PI) * Math.max(34, frame.camera.tileSize.height * 0.9),
          }
      : frame.gameState === "reeling" && frame.reelingStartedAt
        ? {
            x: lerp(targetCenter.x, rodTip.x - 12, easeInOut(reelProgress)),
            y: lerp(targetCenter.y - 4, rodTip.y + 8, easeInOut(reelProgress)),
          }
        : { x: targetCenter.x, y: targetCenter.y - 4 };

  let hookedFishCenter: ScenePoint | undefined;
  let fishShadowy = false;
  let orientation: "horizontal" | "vertical-up" = "horizontal";
  let hookDirection: 1 | -1 = rodTip.x < currentLineEnd.x ? 1 : -1;
  let hookedFishScale = frame.encounterFishScale * fishScaleBoost;

  if (frame.activeCatchPreview) {
    const reelAnchor = currentLineEnd;

    if (frame.gameState === "waiting" && frame.approachStartedAt) {
      const approachProgress = Math.min(1, Math.max(0, (frame.time - frame.approachStartedAt) / BITE_DELAY_MS));
      const approachStart = {
        x: targetCenter.x + frame.approachDirection * 18,
        y: targetCenter.y + 12,
      };
      hookedFishCenter = {
        x: lerp(approachStart.x, currentLineEnd.x - frame.approachDirection * 3, easeInOut(approachProgress)),
        y: lerp(approachStart.y, currentLineEnd.y + 9, easeInOut(approachProgress)),
      };
      fishShadowy = true;
      hookDirection = frame.approachDirection;
    } else if (frame.gameState === "hooked") {
      hookedFishCenter = {
        x: currentLineEnd.x + Math.sin(frame.time / 120) * 5,
        y: currentLineEnd.y + 10 + Math.cos(frame.time / 100) * 3,
      };
      fishShadowy = true;
    } else if (frame.gameState === "reeling") {
      hookDirection = rodTip.x < reelAnchor.x ? 1 : -1;
      const waterEdgeDistance = getMinimumTileDistance(frame.sceneWaterTile, frame.nearShoreWaterTiles);
      const startsAtEdge = frame.nearShoreWaterKeys.has(getTileKey(frame.sceneWaterTile));

      if (startsAtEdge) {
        hookedFishScale *= 1.12;
        hookedFishCenter = {
          x: reelAnchor.x,
          y: reelAnchor.y + 8,
        };
      } else {
        const surfaceThreshold = Math.max(
          0.28,
          Math.min(0.86, waterEdgeDistance <= 1 ? 0.35 : (waterEdgeDistance - 1) / waterEdgeDistance),
        );
        const hasSurfaced = reelProgress >= surfaceThreshold;

        if (!hasSurfaced) {
          fishShadowy = true;
          hookedFishScale *= 1.05;
          const zigzagAmount = Math.max(3, 10 - reelProgress * 6);
          const zigzagX = Math.sin(frame.time / 92 + reelProgress * 18) * zigzagAmount;
          const swayY = Math.cos(frame.time / 108 + reelProgress * 13) * 2.2;
          hookedFishCenter = {
            x: reelAnchor.x + zigzagX,
            y: reelAnchor.y + 11 + swayY,
          };
        } else {
          const surfacedProgress = easeInOut(
            Math.min(1, Math.max(0, (reelProgress - surfaceThreshold) / Math.max(0.001, 1 - surfaceThreshold))),
          );
          hookedFishScale *= lerp(1.08, 1.16, surfacedProgress);
          const lastThrash = (1 - surfacedProgress) * 3.5;
          hookedFishCenter = {
            x: reelAnchor.x + Math.sin(frame.time / 120 + surfacedProgress * 4) * lastThrash,
            y: reelAnchor.y + lerp(11, 8, surfacedProgress),
          };
        }
      }
    } else if (frame.gameState === "inspecting") {
      hookedFishScale *= 1.22;
      const verticalNoseOffset = hookedFishScale * 8.5;
      hookedFishCenter = {
        x: inspectPoint.x,
        y: inspectPoint.y + verticalNoseOffset,
      };
      orientation = "vertical-up";
    }

    if (hookedFishCenter && (frame.gameState === "reeling" || frame.gameState === "inspecting")) {
      const noseOffset = getFishNoseOffset(hookedFishScale, hookDirection, orientation);
      currentLineEnd = {
        x: hookedFishCenter.x + noseOffset.x,
        y: hookedFishCenter.y + noseOffset.y,
      };
    }
  }

  ctx.strokeStyle =
    frame.gameState === "hooked" || frame.gameState === "reeling" || frame.gameState === "inspecting"
      ? "#17354d"
      : "#335c72";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(Math.round(rodTip.x), Math.round(rodTip.y));
  if (frame.gameState === "casting") {
    const castEase = easeInOut(castingProgress);
    const loop = Math.sin(castEase * Math.PI);
    const firstControl = {
      x: lerp(rodTip.x, currentLineEnd.x, 0.28),
      y: Math.min(rodTip.y, currentLineEnd.y) - 14 - loop * Math.max(34, frame.camera.tileSize.height * 0.7),
    };
    const secondControl = {
      x: lerp(rodTip.x, currentLineEnd.x, 0.68),
      y: Math.min(rodTip.y, currentLineEnd.y) - 6 - loop * Math.max(48, frame.camera.tileSize.height * 0.86),
    };

    if (typeof ctx.bezierCurveTo === "function") {
      ctx.bezierCurveTo(
        Math.round(firstControl.x),
        Math.round(firstControl.y),
        Math.round(secondControl.x),
        Math.round(secondControl.y),
        Math.round(currentLineEnd.x),
        Math.round(currentLineEnd.y),
      );
    } else {
      ctx.quadraticCurveTo(
        Math.round(secondControl.x),
        Math.round(secondControl.y),
        Math.round(currentLineEnd.x),
        Math.round(currentLineEnd.y),
      );
    }
  } else if (frame.gameState === "waiting") {
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

  if (frame.activeCatchPreview && hookedFishCenter) {
    drawPixelFish(
      ctx,
      hookedFishCenter.x,
      hookedFishCenter.y,
      frame.activeCatchPreview.accent,
      hookDirection,
      hookedFishScale,
      Math.floor(frame.time / 180),
      fishShadowy,
      orientation,
    );

    if (frame.gameState === "hooked" || frame.gameState === "reeling") {
      drawSplashFx(ctx, hookedFishCenter.x, hookedFishCenter.y + 5, Math.floor(frame.time / 120), detailScale, 0.9);
    }

    if (frame.gameState === "inspecting") {
      drawSparkleFx(ctx, hookedFishCenter.x + 12, hookedFishCenter.y - 8, Math.floor(frame.time / 120), detailScale);
    }
  }

  if (frame.gameState === "casting") {
    if (castingProgress > 0.06) {
      drawPixelBobber(ctx, currentLineEnd.x, currentLineEnd.y + 2, frame.gameState, Math.floor(frame.time / 180));
    }

    if (castingProgress > 0.76) {
      drawSplashFx(
        ctx,
        targetCenter.x,
        targetCenter.y + 5,
        Math.floor(frame.time / 120),
        detailScale,
        clamp((castingProgress - 0.76) / 0.24, 0, 1) * 0.7,
      );
    }
  } else if (frame.gameState === "waiting" || frame.gameState === "hooked") {
    drawPixelBobber(ctx, currentLineEnd.x, currentLineEnd.y + 2, frame.gameState, Math.floor(frame.time / 180));
  }

  return rodPull;
}

function drawLighting(ctx: CanvasRenderingContext2D, frame: CanvasHarborFrame) {
  ctx.save();
  if (typeof ctx.createRadialGradient === "function") {
    const warm = ctx.createRadialGradient(
      frame.camera.viewportWidth * 0.08,
      frame.camera.viewportHeight * 0.06,
      0,
      frame.camera.viewportWidth * 0.08,
      frame.camera.viewportHeight * 0.06,
      frame.camera.viewportWidth * 0.92,
    );
    warm.addColorStop(0, "rgba(255, 211, 123, 0.2)");
    warm.addColorStop(0.45, "rgba(255, 188, 93, 0.08)");
    warm.addColorStop(1, "rgba(255, 188, 93, 0)");
    ctx.fillStyle = warm;
    ctx.fillRect(0, 0, frame.camera.viewportWidth, frame.camera.viewportHeight);
  } else {
    ctx.fillStyle = "rgba(255, 188, 93, 0.08)";
    ctx.fillRect(0, 0, frame.camera.viewportWidth, frame.camera.viewportHeight);
  }

  const cool = ctx.createLinearGradient(0, 0, frame.camera.viewportWidth, frame.camera.viewportHeight);
  cool.addColorStop(0, "rgba(255, 255, 255, 0)");
  cool.addColorStop(1, "rgba(9, 41, 67, 0.22)");
  ctx.fillStyle = cool;
  ctx.fillRect(0, 0, frame.camera.viewportWidth, frame.camera.viewportHeight);

  if (typeof ctx.createRadialGradient === "function") {
    const vignette = ctx.createRadialGradient(
      frame.camera.viewportWidth * 0.44,
      frame.camera.viewportHeight * 0.48,
      frame.camera.viewportWidth * 0.16,
      frame.camera.viewportWidth * 0.5,
      frame.camera.viewportHeight * 0.5,
      frame.camera.viewportWidth * 0.72,
    );
    vignette.addColorStop(0, "rgba(9, 41, 67, 0)");
    vignette.addColorStop(0.76, "rgba(9, 41, 67, 0.05)");
    vignette.addColorStop(1, "rgba(7, 28, 48, 0.22)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, frame.camera.viewportWidth, frame.camera.viewportHeight);
  }
  ctx.restore();
}

export function drawCanvasHarborFrame(ctx: CanvasRenderingContext2D, frame: CanvasHarborFrame) {
  const detailScale = frame.camera.tileSize.width / frame.manifest.pond.tile.width;
  const fisherScale = Math.max(1.6, Math.min(2.35, detailScale * 0.43));
  const fishScaleBoost = Math.max(1.35, Math.min(2.1, detailScale * 0.32));
  const frameIndex = Math.floor(frame.time / 180);
  const motion = frame.time / 150;
  const castingProgress =
    frame.gameState === "casting" && frame.castingStartedAt
      ? clamp((frame.time - frame.castingStartedAt) / CAST_ANIMATION_MS, 0, 1)
      : frame.gameState === "casting"
        ? 1
        : 0;
  const terrainMap = getCachedTerrainMap(frame);
  const player = getAnimatedPlayerCenter(frame, frame.time, detailScale);
  const drawables: SceneDrawable[] = [];

  ctx.clearRect(0, 0, frame.camera.viewportWidth, frame.camera.viewportHeight);
  ctx.imageSmoothingEnabled = false;
  drawBackground(ctx, frame);
  drawBackdrop(ctx, frame, detailScale, terrainMap);
  drawWater(ctx, frame, detailScale, terrainMap);
  drawShore(ctx, frame, detailScale, terrainMap);

  for (const prop of SCENE_PROP_PLACEMENTS) {
    const baseCenter = frame.projectSceneTile(prop.tile);
    const lift = prop.asset === "prop.reeds.0" ? 0 : getSceneTileLift(frame, prop.tile, detailScale);
    const center = {
      x: baseCenter.x,
      y: baseCenter.y - lift,
    };
    drawables.push({
      id: prop.id,
      layer: prop.layer,
      order: prop.order,
      y: center.y + prop.offsetY,
      draw: () => {
        drawNamedSprite(ctx, prop.asset, center.x + prop.offsetX, center.y + prop.offsetY, {
          frame: frameIndex + prop.id.length,
          scale: getScaledPropScale(prop, detailScale),
        });
      },
    });
  }

  for (const fish of frame.ambientFish) {
    if (!fish.active) {
      continue;
    }

    const fromCenter = frame.projectSceneTile(fish.fromTile);
    const toCenter = frame.projectSceneTile(fish.toTile);
    const swimProgress = Math.min(
      1,
      Math.max(0, (frame.time - fish.segmentStartedAt) / Math.max(1, fish.segmentDuration)),
    );
    const center = {
      x: lerp(fromCenter.x, toCenter.x, swimProgress),
      y: lerp(fromCenter.y, toCenter.y, swimProgress),
    };
    const wave = Math.sin(frame.time / 760 + fish.phase) * 6;
    const wiggle = Math.cos(frame.time / 920 + fish.phase * 1.3) * 3;

    drawables.push({
      id: fish.id,
      layer: "waterLife",
      y: center.y,
      draw: () => {
        drawNamedSprite(ctx, "fish.lanternKoi.swim.0", center.x + wave, center.y + 4 + wiggle, {
          accent: fish.accent,
          direction: fish.direction,
          frame: frameIndex,
          scale: fish.size * fishScaleBoost,
        });
      },
    });
  }

  if (frame.ambientEgret) {
    const egretScale = Math.max(1.28, Math.min(1.95, detailScale * 0.31));
    const pose = getEgretPose(frame.ambientEgret, frame, detailScale, egretScale);
    drawables.push({
      id: frame.ambientEgret.id,
      layer: "characters",
      y: pose.y + (pose.mode === "striking" ? frame.camera.tileSize.height * 0.45 : 0),
      draw: () => {
        drawPixelEgret(
          ctx,
          pose.x,
          pose.y,
          pose.direction,
          pose.mode,
          pose.progress,
          frameIndex,
          egretScale,
          frame.ambientEgret?.caughtFish,
        );
      },
    });
  }

  let rodPull = 0;
  drawables.push({
    id: "line-and-encounter",
    layer: "characters",
    order: -4,
    y: player.center.y - 1,
    draw: () => {
      rodPull = drawLineAndEncounter(
        ctx,
        frame,
        motion,
        player.center,
        player.mode,
        fisherScale,
        fishScaleBoost,
        detailScale,
      );
    },
  });

  drawables.push({
    id: "fisher",
    layer: "characters",
    y: player.center.y,
    draw: () => {
      drawPixelFisher(
        ctx,
        player.center.x,
        player.center.y,
        player.mode,
        motion,
        fisherScale,
        rodPull,
        castingProgress,
      );
    },
  });

  for (const drawable of sortSceneDrawables(drawables)) {
    drawable.draw();
  }

  drawLighting(ctx, frame);
}
