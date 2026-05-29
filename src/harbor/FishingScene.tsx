import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CAST_RANGE_TILES } from "../lib/pond/game";
import { getHexTileMetrics, getPlayableTiles, projectTile } from "../lib/pond/geometry";
import type {
  CatchInstance,
  PondManifest,
  ShoreTile,
  Tile,
  TileOrigin,
  TileSize,
} from "../lib/pond/types";
import type { HarborArtifact } from "./HarborWidget.types";
import type {
  AmbientEgret,
  AmbientFish,
  EgretPerchCandidate,
  HarborGameMode,
  MovementPath,
} from "./harborWidget.shared";
import {
  buildEgretPerchCandidates,
  buildShoreNeighborMap,
  buildNearShoreWaterKeys,
  findShorePath,
  getTileKey,
  isTileWithinCastRange,
  tileMatches,
} from "./harborWidget.shared";
import { drawCanvasHarborFrame } from "./render/CanvasHarborRenderer";
import type { HarborCamera } from "./render/HarborRenderer";
import {
  buildBackdropTiles,
  getResponsiveBackdropTerrain,
  isLandTerrain,
  type BackdropTerrain,
} from "./render/SceneLayers";

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
  onEgretPerchCandidatesChange?: (candidates: EgretPerchCandidate[]) => void;
  onHoverWater: (tile?: Tile) => void;
  onMoveToLand: (tile: ShoreTile, path?: ShoreTile[]) => void;
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
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function isProjectedTileVisible(
  center: { x: number; y: number },
  metrics: ReturnType<typeof getHexTileMetrics>,
  viewportWidth: number,
  viewportHeight: number,
  margin: number,
) {
  return (
    center.x + metrics.halfWidth >= -margin &&
    center.x - metrics.halfWidth <= viewportWidth + margin &&
    center.y + metrics.halfHeight >= -margin &&
    center.y - metrics.halfHeight <= viewportHeight + margin
  );
}

function toWalkableTerrain(terrain: BackdropTerrain): ShoreTile["terrain"] {
  if (terrain === "grass" || terrain === "sand") {
    return terrain;
  }

  return "path";
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
  onEgretPerchCandidatesChange,
  onChooseWater,
  onHoverWater,
}: FishingSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const waterTiles = useMemo(() => getPlayableTiles(manifest.pond.mask), [manifest.pond.mask]);
  const focusTile = useMemo<ShoreTile>(
    () =>
      manifest.pond.shoreline.find((tile) => tile.dock) ??
      manifest.pond.shoreline.find((tile) => tile.row === 6 && tile.col === 11) ??
      manifest.pond.shoreline.find((tile) => tile.castable) ??
      manifest.pond.shoreline[0],
    [manifest.pond.shoreline],
  );
  const backdropTiles = useMemo(
    () => buildBackdropTiles(manifest.pond.mask, manifest.pond.shoreline),
    [manifest.pond.mask, manifest.pond.shoreline],
  );
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
    const isPortrait = sceneHeight > sceneWidth * 1.08;
    const baseScale =
      Math.max(
        sceneWidth / manifest.pond.viewBox.width,
        sceneHeight / manifest.pond.viewBox.height,
      ) * (isPortrait ? 0.42 : 0.44);
    const tileSize = {
      width: manifest.pond.tile.width * baseScale,
      height: manifest.pond.tile.height * baseScale,
    };
    const tileMetrics = getHexTileMetrics(tileSize);
    const focusBounds = getProjectedBounds([focusTile], tileSize);
    const desiredFocusX = sceneWidth * (isPortrait ? 0.24 : 0.16);
    const desiredFocusY = Math.min(
      sceneHeight - safeBottom - tileMetrics.height * 2,
      sceneHeight * (isPortrait ? 0.84 : 0.72),
    );
    const origin = {
      x: desiredFocusX - (focusBounds.minX + tileMetrics.halfWidth),
      y: desiredFocusY - (focusBounds.minY + tileMetrics.halfHeight),
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
  const hotspotMetrics = useMemo(() => getHexTileMetrics(camera.tileSize), [camera.tileSize]);
  const visibleLandTiles = useMemo<ShoreTile[]>(() => {
    const landByKey = new Map<string, ShoreTile>();
    const margin = Math.max(24, camera.tileSize.width * 1.25);

    for (const tile of backdropTiles) {
      const center = projectSceneTile(tile);

      if (
        !isProjectedTileVisible(
          center,
          hotspotMetrics,
          camera.viewportWidth,
          camera.viewportHeight,
          margin,
        )
      ) {
        continue;
      }

      const terrain = getResponsiveBackdropTerrain(tile, center, tile.terrain, camera);

      if (!isLandTerrain(terrain)) {
        continue;
      }

      landByKey.set(getTileKey(tile), {
        row: tile.row,
        col: tile.col,
        terrain: toWalkableTerrain(terrain),
        castable: true,
      });
    }

    for (const tile of manifest.pond.shoreline) {
      const center = projectSceneTile(tile);

      if (
        isProjectedTileVisible(
          center,
          hotspotMetrics,
          camera.viewportWidth,
          camera.viewportHeight,
          margin,
        ) ||
        tileMatches(tile, playerTile)
      ) {
        landByKey.set(getTileKey(tile), tile);
      }
    }

    landByKey.set(getTileKey(playerTile), playerTile);

    return [...landByKey.values()];
  }, [
    backdropTiles,
    camera,
    hotspotMetrics,
    manifest.pond.shoreline,
    playerTile,
    projectSceneTile,
  ]);
  const visibleLandNeighborMap = useMemo(
    () => buildShoreNeighborMap(visibleLandTiles),
    [visibleLandTiles],
  );
  const responsiveWaterTileKeys = useMemo(() => {
    const waterKeys = new Set<string>();
    const margin = Math.max(24, camera.tileSize.width);

    for (const tile of waterTiles) {
      const center = projectSceneTile(tile);

      if (
        !isProjectedTileVisible(
          center,
          hotspotMetrics,
          camera.viewportWidth,
          camera.viewportHeight,
          margin,
        )
      ) {
        continue;
      }

      const terrain = getResponsiveBackdropTerrain(tile, center, "water", camera);

      if (terrain === "water" || terrain === "water-deep") {
        waterKeys.add(getTileKey(tile));
      }
    }

    return waterKeys;
  }, [camera, hotspotMetrics, projectSceneTile, waterTiles]);
  const responsiveWaterTiles = useMemo(
    () => waterTiles.filter((tile) => responsiveWaterTileKeys.has(getTileKey(tile))),
    [responsiveWaterTileKeys, waterTiles],
  );
  const visibleEgretPerchCandidates = useMemo(
    () => buildEgretPerchCandidates(visibleLandTiles, responsiveWaterTiles),
    [responsiveWaterTiles, visibleLandTiles],
  );
  const nearShoreWaterKeys = useMemo(
    () => buildNearShoreWaterKeys(waterTiles, visibleLandTiles),
    [visibleLandTiles, waterTiles],
  );
  const nearShoreWaterTiles = useMemo(
    () => waterTiles.filter((tile) => nearShoreWaterKeys.has(getTileKey(tile))),
    [nearShoreWaterKeys, waterTiles],
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
    onEgretPerchCandidatesChange?.(visibleEgretPerchCandidates);
  }, [onEgretPerchCandidatesChange, visibleEgretPerchCandidates]);

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

    const shouldAnimate =
      typeof window.navigator.userAgent !== "string" ||
      !window.navigator.userAgent.toLowerCase().includes("jsdom");

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

      if (shouldAnimate) {
        rafId = window.requestAnimationFrame(draw);
      }
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
        {visibleLandTiles.map((tile) => {
          const center = projectSceneTile(tile);
          const isReserved = tileIsReserved(tile, "land");

          return (
            <button
              className="harbor-widget__hotspot harbor-widget__hotspot--land"
              data-testid={`shore-${tile.row}-${tile.col}`}
              key={`shore-${tile.row}-${tile.col}`}
              onClick={() =>
                !isReserved &&
                onMoveToLand(tile, findShorePath(playerTile, tile, visibleLandNeighborMap))
              }
              style={
                {
                  "--hotspot-left": `${center.x}px`,
                  "--hotspot-top": `${center.y}px`,
                  "--hotspot-width": `${hotspotMetrics.width}px`,
                  "--hotspot-height": `${hotspotMetrics.height}px`,
                } as CSSProperties
              }
              tabIndex={-1}
              type="button"
            />
          );
        })}
        {waterTiles.map((tile) => {
          if (!responsiveWaterTileKeys.has(getTileKey(tile))) {
            return null;
          }

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
                  "--hotspot-width": `${hotspotMetrics.width}px`,
                  "--hotspot-height": `${hotspotMetrics.height}px`,
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
