import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CAST_RANGE_TILES } from "../lib/pond/game";
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
import type { AmbientEgret, AmbientFish, HarborGameMode, MovementPath } from "./harborWidget.shared";
import {
  buildNearShoreWaterKeys,
  getTileKey,
  isTileWithinCastRange,
  tileMatches,
} from "./harborWidget.shared";
import { drawCanvasHarborFrame } from "./render/CanvasHarborRenderer";
import type { HarborCamera } from "./render/HarborRenderer";
import { buildBackdropTiles } from "./render/SceneLayers";

interface FishingSceneProps {
  activeCatchPreview?: CatchInstance;
  ambientEgret?: AmbientEgret;
  ambientFish: AmbientFish[];
  approachDirection: 1 | -1;
  approachStartedAt?: number;
  castingStartedAt?: number;
  encounterFishScale: number;
  gameState: HarborGameMode;
  hoveredWaterTile?: Tile;
  manifest: PondManifest<HarborArtifact>;
  movement?: MovementPath;
  onChooseWater: (tile: Tile) => void;
  onHoverWater: (tile?: Tile) => void;
  onMoveToLand: (tile: ShoreTile) => void;
  playerTile: ShoreTile;
  reelDuration: number;
  reelingStartedAt?: number;
  selectedWaterTile?: Tile;
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

export default function FishingScene({
  manifest,
  playerTile,
  selectedWaterTile,
  hoveredWaterTile,
  gameState,
  activeCatchPreview,
  ambientEgret,
  ambientFish,
  movement,
  castingStartedAt,
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
  const camera = useMemo<HarborCamera>(() => {
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
  const projectSceneTile = useMemo(
    () => (tile: Tile) => projectTile(tile, camera.tileSize, camera.origin),
    [camera.origin, camera.tileSize],
  );
  const tileIsReserved = (tile: Tile, kind: "land" | "water") =>
    isTileInsideReservedZone(tile, kind, camera.tileSize, camera.origin, camera.reservedZones);
  const activeWaterTile = hoveredWaterTile ?? selectedWaterTile;
  const activeWaterInRange =
    activeWaterTile && isTileWithinCastRange(playerTile, activeWaterTile)
      ? activeWaterTile
      : undefined;
  const sceneWaterTile =
    gameState === "waiting" ||
    gameState === "casting" ||
    gameState === "hooked" ||
    gameState === "reeling" ||
    gameState === "inspecting"
      ? selectedWaterTile
      : activeWaterInRange;

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

    const draw = (time: number) => {
      drawCanvasHarborFrame(ctx, {
        activeCatchPreview,
        ambientEgret,
        ambientFish,
        approachDirection,
        approachStartedAt,
        backdropTiles,
        camera,
        castingStartedAt,
        encounterFishScale,
        gameState,
        hoveredWaterTile,
        manifest,
        movement,
        nearShoreWaterKeys,
        nearShoreWaterTiles,
        playerTile,
        projectSceneTile,
        reelDuration,
        reelingStartedAt,
        sceneWaterTile,
        selectedWaterTile,
        time,
        waterTiles,
      });

      rafId = window.requestAnimationFrame(draw);
    };

    rafId = window.requestAnimationFrame(draw);

    return () => window.cancelAnimationFrame(rafId);
  }, [
    activeCatchPreview,
    ambientEgret,
    ambientFish,
    approachDirection,
    approachStartedAt,
    backdropTiles,
    camera,
    castingStartedAt,
    encounterFishScale,
    gameState,
    hoveredWaterTile,
    manifest,
    movement,
    nearShoreWaterKeys,
    nearShoreWaterTiles,
    playerTile,
    projectSceneTile,
    reelDuration,
    reelingStartedAt,
    sceneWaterTile,
    selectedWaterTile,
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
