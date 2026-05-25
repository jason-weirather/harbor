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
  manifest: PondManifest,
  tile: Tile,
  kind: "land" | "water",
) {
  const center = projectTile(tile, manifest.pond.tile, manifest.pond.origin);
  const padding = kind === "water" ? 4 : 6;

  return manifest.pond.reservedZones.some((zone) => {
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

function getTileFill(terrain: BackdropTile["terrain"] | ShoreTile["terrain"], dock?: boolean) {
  if (terrain === "water") {
    return "#57b8d4";
  }

  if (terrain === "water-deep") {
    return "#3d97b8";
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

function getFisherPose(mode: GameMode, frame: number): FisherPose {
  return {
    bob: mode === "idle" ? frame % 2 : 0,
    rodLift: mode === "hooked" ? 7 : mode === "reeling" ? 11 : mode === "waiting" ? 4 : 2,
    armLift: mode === "reeling" ? 4 : mode === "hooked" ? 2 : 0,
  };
}

function getRodTipPosition(x: number, y: number, mode: GameMode, frame: number) {
  const pose = getFisherPose(mode, frame);

  return {
    x: x + 21,
    y: y - 18 - pose.rodLift + pose.bob,
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

function drawPixelTree(ctx: CanvasRenderingContext2D, x: number, y: number) {
  drawPixelRect(ctx, x - 2, y + 6, 4, 12, "#6d4a31");
  drawPixelRect(ctx, x - 8, y + 1, 16, 7, "#366b4d");
  drawPixelRect(ctx, x - 6, y - 5, 12, 6, "#4a885f");
  drawPixelRect(ctx, x - 3, y - 11, 6, 6, "#5ba46d");
}

function drawPixelBush(ctx: CanvasRenderingContext2D, x: number, y: number) {
  drawPixelRect(ctx, x - 8, y + 1, 16, 6, "#4f934f");
  drawPixelRect(ctx, x - 5, y - 3, 12, 6, "#63ad5c");
  drawPixelRect(ctx, x - 2, y - 6, 7, 4, "#78bf6a");
}

function drawPixelRock(ctx: CanvasRenderingContext2D, x: number, y: number) {
  drawPixelRect(ctx, x - 8, y + 3, 16, 6, "#8eaab3");
  drawPixelRect(ctx, x - 5, y, 11, 5, "#c6d7dd");
}

function drawPixelReeds(ctx: CanvasRenderingContext2D, x: number, y: number, frame: number) {
  const sway = frame % 3;
  drawPixelRect(ctx, x - 4, y - 8, 1, 10, "#6ba04d");
  drawPixelRect(ctx, x, y - 11 + sway, 1, 13, "#7db65c");
  drawPixelRect(ctx, x + 4, y - 9, 1, 11, "#83bf62");
}

function drawPixelDock(ctx: CanvasRenderingContext2D, x: number, y: number) {
  drawPixelRect(ctx, x - 16, y - 2, 28, 6, "#8a5634");
  drawPixelRect(ctx, x - 10, y - 8, 22, 4, "#b57b4c");
  drawPixelRect(ctx, x - 14, y - 8, 3, 16, "#6d4a31");
  drawPixelRect(ctx, x + 8, y - 4, 3, 16, "#6d4a31");
}

function drawWaterTileDetails(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  frame: number,
  variant: number,
  deep = false,
) {
  const shimmer = (frame + variant) % 6;
  const foam = deep ? "rgba(185, 235, 248, 0.56)" : "rgba(225, 252, 255, 0.82)";
  const shadow = deep ? "rgba(22, 87, 117, 0.42)" : "rgba(41, 113, 141, 0.28)";
  const glow = deep ? "#6fd1ec" : "#a9eff8";

  drawPixelRect(ctx, x - 9, y - 3, 3, 1, glow);
  drawPixelRect(ctx, x - 4, y - 5, 4, 1, foam);
  drawPixelRect(ctx, x + 3, y - 2, 5, 1, foam);
  drawPixelRect(ctx, x - 6 + shimmer, y + 1, 4, 1, foam);
  drawPixelRect(ctx, x + 1 - shimmer, y + 3, 3, 1, shadow);
  drawPixelRect(ctx, x - 1, y + 5, 5, 1, shadow);

  if (variant % 2 === 0) {
    drawPixelRect(ctx, x - 11, y + 1, 2, 1, foam);
    drawPixelRect(ctx, x + 6, y + 1, 2, 1, glow);
  } else {
    drawPixelRect(ctx, x - 8, y - 1, 2, 1, shadow);
    drawPixelRect(ctx, x + 8, y - 4, 2, 1, foam);
  }
}

function drawPixelFish(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  accent: string,
  direction: 1 | -1,
  scale: number,
  frame: number,
) {
  const wag = frame % 2;

  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(direction * scale, scale);
  drawPixelRect(ctx, -7, -2, 9, 4, accent);
  drawPixelRect(ctx, -3, -5, 5, 2, accent);
  drawPixelRect(ctx, -2, 2, 5, 2, accent);
  drawPixelRect(ctx, 2, -3 - wag, 4, 6 + wag * 2, accent);
  drawPixelRect(ctx, -6, -1, 1, 1, "#10243a");
  drawPixelRect(ctx, -9, -1, 2, 1, "#d3f7ff");
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
) {
  const pose = getFisherPose(mode, frame);
  const bodyColor = "#cb5d43";
  const hatColor = "#efc94e";

  drawPixelRect(ctx, x - 9, y + 13, 18, 4, "rgba(22,50,74,0.22)");
  drawPixelRect(ctx, x - 3, y + 5 + pose.bob, 2, 7, "#2b4158");
  drawPixelRect(ctx, x + 1, y + 5 + pose.bob, 2, 7, "#2b4158");
  drawPixelRect(ctx, x - 5, y - 1 + pose.bob, 10, 8, bodyColor);
  drawPixelRect(ctx, x - 3, y - 8 + pose.bob, 6, 6, "#f5d3a4");
  drawPixelRect(ctx, x - 7, y - 12 + pose.bob, 14, 4, hatColor);
  drawPixelRect(ctx, x - 3, y - 15 + pose.bob, 6, 3, hatColor);
  drawPixelRect(ctx, x - 7, y + 11 + pose.bob, 4, 3, "#5a3d2b");
  drawPixelRect(ctx, x + 3, y + 11 + pose.bob, 4, 3, "#5a3d2b");

  ctx.strokeStyle = "#244a67";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(Math.round(x + 4), Math.round(y + 2 - pose.armLift + pose.bob));
  ctx.lineTo(Math.round(x + 11), Math.round(y - 4 - pose.armLift + pose.bob));
  ctx.lineTo(Math.round(x + 21), Math.round(y - 18 - pose.rodLift + pose.bob));
  ctx.stroke();
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
  const timerRef = useRef<number[]>([]);
  const creelRef = useRef<CatchInstance[]>([]);
  const selectedWaterRef = useRef<Tile>();
  const reelingStartedAtRef = useRef<number>();
  const waterTiles = useMemo(() => getPlayableTiles(manifest.pond.mask), [manifest.pond.mask]);
  const backdropTiles = useMemo(() => buildBackdropTiles(), []);
  const ambientFish = useMemo<AmbientFish[]>(
    () => [
      {
        tile: { row: 2, col: 1 },
        accent: "#f59e0b",
        delay: 0,
        duration: 9800,
        direction: 1,
        size: 1,
      },
      {
        tile: { row: 5, col: 3 },
        accent: "#fb7185",
        delay: 700,
        duration: 11400,
        direction: -1,
        size: 0.9,
      },
      {
        tile: { row: 8, col: 2 },
        accent: "#60a5fa",
        delay: 1400,
        duration: 12600,
        direction: 1,
        size: 1.1,
      },
      {
        tile: { row: 10, col: 4 },
        accent: "#34d399",
        delay: 2400,
        duration: 10200,
        direction: -1,
        size: 0.85,
      },
      {
        tile: { row: 4, col: 6 },
        accent: "#facc15",
        delay: 3300,
        duration: 13200,
        direction: -1,
        size: 0.95,
      },
      {
        tile: { row: 9, col: 5 },
        accent: "#c084fc",
        delay: 4100,
        duration: 14100,
        direction: 1,
        size: 0.8,
      },
      {
        tile: { row: 6, col: 1 },
        accent: "#2dd4bf",
        delay: 5200,
        duration: 11800,
        direction: 1,
        size: 0.88,
      },
    ],
    [],
  );

  const [playerTile, setPlayerTile] = useState<ShoreTile>(manifest.pond.shoreline[0]);
  const [selectedWaterTile, setSelectedWaterTile] = useState<Tile>();
  const [hoveredWaterTile, setHoveredWaterTile] = useState<Tile>();
  const [gameState, setGameState] = useState<GameMode>("idle");
  const [creel, setCreel] = useState<CatchInstance[]>([]);
  const [castNumber, setCastNumber] = useState(0);
  const [lastCatch, setLastCatch] = useState<CatchInstance>();
  const [activeCatchPreview, setActiveCatchPreview] = useState<CatchInstance>();
  const [statusMessage, setStatusMessage] = useState(
    "Move across the left shoreline, hover the water to line up a cast, and let the fisher handle the fight.",
  );

  const isCreelFull = creel.length >= MAX_CREEL_SIZE;
  const score = creel.reduce((sum, item) => sum + item.points, 0);
  const activeWaterTile = hoveredWaterTile ?? selectedWaterTile;
  const activeWaterInRange =
    activeWaterTile && isTileWithinCastRange(playerTile, activeWaterTile)
      ? activeWaterTile
      : undefined;
  const sceneWaterTile =
    gameState === "waiting" || gameState === "hooked" || gameState === "reeling"
      ? selectedWaterTile
      : activeWaterInRange;
  const playerCenter = projectTile(playerTile, manifest.pond.tile, manifest.pond.origin);
  const dockCenter = projectTile({ row: 3, col: 10 }, manifest.pond.tile, manifest.pond.origin);
  const northTreeCenter = projectTile({ row: 0, col: 12 }, manifest.pond.tile, manifest.pond.origin);
  const ridgeTreeCenter = projectTile({ row: 5, col: 13 }, manifest.pond.tile, manifest.pond.origin);
  const southTreeCenter = projectTile({ row: 12, col: 10 }, manifest.pond.tile, manifest.pond.origin);
  const bushCenter = projectTile({ row: 9, col: 13 }, manifest.pond.tile, manifest.pond.origin);
  const lowerBushCenter = projectTile({ row: 12, col: 13 }, manifest.pond.tile, manifest.pond.origin);
  const shoreRockCenter = projectTile({ row: 4, col: 12 }, manifest.pond.tile, manifest.pond.origin);
  const statusHeading = getStatusHeading(gameState, sceneWaterTile, isCreelFull);

  useEffect(() => {
    creelRef.current = creel;
  }, [creel]);

  useEffect(() => {
    selectedWaterRef.current = selectedWaterTile;
  }, [selectedWaterTile]);

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

    const halfWidth = manifest.pond.tile.width / 2;
    const halfHeight = manifest.pond.tile.height / 2;

    const draw = (time: number) => {
      const frame = Math.floor(time / 180);
      const fisherY = playerCenter.y - 5;
      const rodTip = getRodTipPosition(playerCenter.x, fisherY, gameState, frame);
      ctx.clearRect(0, 0, manifest.pond.viewBox.width, manifest.pond.viewBox.height);
      ctx.imageSmoothingEnabled = false;

      ctx.fillStyle = "#cdeff5";
      ctx.fillRect(0, 0, manifest.pond.viewBox.width, manifest.pond.viewBox.height);

      for (const tile of backdropTiles) {
        const center = projectTile(tile, manifest.pond.tile, manifest.pond.origin);
        drawDiamond(
          ctx,
          center.x,
          center.y,
          halfWidth,
          halfHeight,
          getTileFill(tile.terrain),
          tile.terrain.startsWith("water") ? "#2c7e9d" : "#6d8a50",
        );
      }

      for (const tile of waterTiles) {
        const center = projectTile(tile, manifest.pond.tile, manifest.pond.origin);
        const isHovered = tileMatches(tile, hoveredWaterTile);
        const isSelected = tileMatches(tile, selectedWaterTile);
        const isInRange = isTileWithinCastRange(playerTile, tile);
        const isDeep = tile.row + tile.col > 10;
        drawDiamond(
          ctx,
          center.x,
          center.y + 2,
          halfWidth,
          halfHeight,
          isDeep ? "#2a7c9b" : "#2f88a8",
          "#256980",
          true,
        );
        drawDiamond(
          ctx,
          center.x,
          center.y,
          halfWidth,
          halfHeight,
          tile.row % 2 === 0 ? "#56bad7" : "#469fbe",
          isSelected
            ? "#ff8b34"
            : isHovered
              ? isInRange
                ? "#f6f0a2"
                : "#ef4444"
              : "#2b7c95",
        );
        drawWaterTileDetails(ctx, center.x, center.y, frame, tile.row + tile.col, isDeep);
      }

      for (const tile of manifest.pond.shoreline) {
        const center = projectTile(tile, manifest.pond.tile, manifest.pond.origin);
        const isPlayer = tileMatches(tile, playerTile);

        drawDiamond(
          ctx,
          center.x,
          center.y + 2,
          halfWidth,
          halfHeight,
          tile.dock ? "#6f442a" : "#668848",
          tile.dock ? "#53321f" : "#54723b",
          true,
        );
        drawDiamond(
          ctx,
          center.x,
          center.y,
          halfWidth,
          halfHeight,
          getTileFill(tile.terrain, tile.dock),
          isPlayer ? "#17324a" : "#6e8252",
        );
      }

      drawPixelDock(ctx, dockCenter.x + 8, dockCenter.y + 3);
      drawPixelTree(ctx, northTreeCenter.x + 12, northTreeCenter.y - 26);
      drawPixelTree(ctx, ridgeTreeCenter.x + 8, ridgeTreeCenter.y - 22);
      drawPixelTree(ctx, southTreeCenter.x + 6, southTreeCenter.y - 18);
      drawPixelBush(ctx, bushCenter.x + 6, bushCenter.y - 8);
      drawPixelBush(ctx, lowerBushCenter.x + 2, lowerBushCenter.y - 4);
      drawPixelRock(ctx, shoreRockCenter.x + 14, shoreRockCenter.y - 2);
      drawPixelReeds(ctx, dockCenter.x - 28, dockCenter.y + 24, frame);
      drawPixelReeds(ctx, dockCenter.x - 18, dockCenter.y + 34, frame + 1);
      drawPixelReeds(ctx, dockCenter.x - 7, dockCenter.y + 40, frame + 2);

      for (const fish of ambientFish) {
        const center = projectTile(fish.tile, manifest.pond.tile, manifest.pond.origin);
        const wave = Math.sin((time + fish.delay) / fish.duration) * 16;
        const wiggle = Math.cos((time + fish.delay) / (fish.duration / 2)) * 6;
        drawPixelFish(
          ctx,
          center.x + wave,
          center.y + 4 + wiggle,
          fish.accent,
          fish.direction,
          fish.size,
          frame,
        );
      }

      if (sceneWaterTile) {
        const targetCenter = projectTile(sceneWaterTile, manifest.pond.tile, manifest.pond.origin);
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
            0.95,
            frame,
          );
        }

        if (gameState === "waiting" || gameState === "hooked" || gameState === "reeling") {
          drawPixelBobber(ctx, currentLineEnd.x, currentLineEnd.y + 2, gameState, frame);
        }
      }

      drawPixelFisher(ctx, playerCenter.x, fisherY, gameState, frame);

      rafId = window.requestAnimationFrame(draw);
    };

    rafId = window.requestAnimationFrame(draw);

    return () => window.cancelAnimationFrame(rafId);
  }, [
    ambientFish,
    backdropTiles,
    dockCenter,
    gameState,
    hoveredWaterTile,
    manifest,
    playerCenter,
    playerTile,
    ridgeTreeCenter,
    sceneWaterTile,
    activeCatchPreview,
    selectedWaterTile,
    shoreRockCenter,
    southTreeCenter,
    bushCenter,
    lowerBushCenter,
    northTreeCenter,
    waterTiles,
  ]);

  function buildCatchResult(target: Tile, activeCastNumber: number) {
    const random = createSeededRandom(
      `${manifest.pond.id}:${activeCastNumber}:${target.row}:${target.col}`,
    );

    return resolveCatch(manifest, target, random, activeCastNumber);
  }

  function handleMoveToLand(tile: ShoreTile) {

    if (isTileInsideReservedZone(manifest, tile, "land")) {
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

    if (!canCast(tile, manifest.pond.mask) || isTileInsideReservedZone(manifest, tile, "water")) {
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
    <section className="fishing-game" aria-label="Pixel fishing prototype">
      <div
        className="fishing-game__scene"
        tabIndex={0}
        aria-label={`Click land to move the fisher, then click water within ${CAST_RANGE_TILES} squares to cast and auto-catch fish.`}
      >
        <canvas
          aria-hidden="true"
          className="fishing-game__canvas"
          height={manifest.pond.viewBox.height}
          ref={canvasRef}
          width={manifest.pond.viewBox.width}
        />
        <div className="fishing-game__hotspots" aria-hidden="true">
          {manifest.pond.shoreline.map((tile) => {
            const center = projectTile(tile, manifest.pond.tile, manifest.pond.origin);
            const isReserved = isTileInsideReservedZone(manifest, tile, "land");

            return (
              <button
                className="fishing-game__hotspot fishing-game__hotspot--land"
                data-testid={`shore-${tile.row}-${tile.col}`}
                key={`shore-${tile.row}-${tile.col}`}
                onClick={() => !isReserved && handleMoveToLand(tile)}
                style={
                  {
                    "--hotspot-left": `${(center.x / manifest.pond.viewBox.width) * 100}%`,
                    "--hotspot-top": `${(center.y / manifest.pond.viewBox.height) * 100}%`,
                    "--hotspot-width": `${(manifest.pond.tile.width / manifest.pond.viewBox.width) * 100}%`,
                    "--hotspot-height": `${(manifest.pond.tile.height / manifest.pond.viewBox.height) * 100}%`,
                  } as CSSProperties
                }
                tabIndex={-1}
                type="button"
              />
            );
          })}
          {waterTiles.map((tile) => {
            const center = projectTile(tile, manifest.pond.tile, manifest.pond.origin);
            const isReserved = isTileInsideReservedZone(manifest, tile, "water");

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
                    "--hotspot-left": `${(center.x / manifest.pond.viewBox.width) * 100}%`,
                    "--hotspot-top": `${(center.y / manifest.pond.viewBox.height) * 100}%`,
                    "--hotspot-width": `${(manifest.pond.tile.width / manifest.pond.viewBox.width) * 100}%`,
                    "--hotspot-height": `${(manifest.pond.tile.height / manifest.pond.viewBox.height) * 100}%`,
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
        <section className="fishing-game__rail" aria-label="Caught fish">
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
