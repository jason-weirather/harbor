import { CAST_RANGE_TILES } from "../lib/pond/game";
import type { FishTemplate, ShoreTile, Tile } from "../lib/pond/types";

export type HarborGameMode =
  | "idle"
  | "walking"
  | "casting"
  | "waiting"
  | "hooked"
  | "reeling"
  | "inspecting"
  | "inventory-full";

export interface AmbientFish {
  id: string;
  fishId: string;
  accent: string;
  fromTile: Tile;
  toTile: Tile;
  previousTile?: Tile;
  segmentStartedAt: number;
  segmentDuration: number;
  direction: 1 | -1;
  size: number;
  phase: number;
  active: boolean;
  respawnAt?: number;
  expiresAt: number;
}

export type AmbientEgretState = "arriving" | "watching" | "striking" | "eating" | "leaving";

export interface AmbientEgret {
  id: string;
  state: AmbientEgretState;
  perchTile: ShoreTile;
  targetWaterTile: Tile;
  direction: 1 | -1;
  startedAt: number;
  stateStartedAt: number;
  hasSpottedFish?: boolean;
  caughtFish?: {
    accent: string;
    direction: 1 | -1;
    fishId: string;
    size: number;
  };
}

export interface EgretPerchCandidate {
  direction: 1 | -1;
  perchTile: ShoreTile;
  targetWaterTile: Tile;
}

export interface MovementPath {
  tiles: ShoreTile[];
  startedAt: number;
  segmentDuration: number;
}

export interface EncounterContext {
  target: Tile;
  castNumber: number;
  fishId: string;
  fishScale: number;
  direction: 1 | -1;
}

export const AMBIENT_LOGIC_TICK_MS = 180;
export const AMBIENT_SWIM_MIN_MS = 2200;
export const AMBIENT_SWIM_MAX_MS = 4600;
export const AMBIENT_RESPAWN_MIN_MS = 1800;
export const AMBIENT_RESPAWN_MAX_MS = 4200;
export const AMBIENT_LIFETIME_MIN_MS = 32000;
export const AMBIENT_LIFETIME_MAX_MS = 56000;
export const EGRET_INITIAL_VISIT_MIN_MS = 1800;
export const EGRET_INITIAL_VISIT_MAX_MS = 5200;
export const EGRET_VISIT_MIN_MS = 14000;
export const EGRET_VISIT_MAX_MS = 26000;
export const EGRET_ARRIVE_MS = 5200;
export const EGRET_FISH_APPROACH_MS = 9000;
export const EGRET_WATCH_MAX_MS = 45000;
export const EGRET_STRIKE_MS = 720;
export const EGRET_EAT_MS = 6500;
export const EGRET_LEAVE_MS = 5200;
export const EGRET_PLAYER_BIAS_RANGE_TILES = 4;
export const EGRET_PLAYER_BIAS_WEIGHT = 0.4;
export const CAST_ANIMATION_MS = 760;
export const WALK_SEGMENT_MS = 190;
export const INITIAL_AMBIENT_BLUEPRINTS = [
  { from: { row: 7, col: 5 }, to: { row: 7, col: 4 }, phase: 0.1, duration: 1200 },
  { from: { row: 8, col: 5 }, to: { row: 7, col: 4 }, phase: 0.7, duration: 2900 },
  { from: { row: 4, col: 7 }, to: { row: 4, col: 8 }, phase: 1.2, duration: 2600 },
  { from: { row: 3, col: 11 }, to: { row: 3, col: 12 }, phase: 1.8, duration: 3400 },
  { from: { row: 6, col: 13 }, to: { row: 6, col: 12 }, phase: 2.4, duration: 3000 },
  { from: { row: 8, col: 13 }, to: { row: 8, col: 14 }, phase: 2.9, duration: 4200 },
  { from: { row: 10, col: 10 }, to: { row: 10, col: 11 }, phase: 3.6, duration: 3600 },
] as const;

export function tileMatches(left?: Tile, right?: Tile) {
  return Boolean(left && right && left.row === right.row && left.col === right.col);
}

export function getTileKey(tile: Tile) {
  return `${tile.row}:${tile.col}`;
}

export function getTileRangeDistance(origin: Tile, target: Tile) {
  return Math.max(
    Math.abs(origin.row - target.row),
    Math.abs(origin.col - target.col),
  );
}

export function isTileWithinCastRange(origin: Tile, target: Tile, range = CAST_RANGE_TILES) {
  return getTileRangeDistance(origin, target) <= range;
}

export function getStatusHeading(
  gameState: HarborGameMode,
  targetTile: Tile | undefined,
  isCreelFull: boolean,
) {
  if (gameState === "walking") {
    return "Changing spots";
  }

  if (gameState === "casting") {
    return "Casting out";
  }

  if (gameState === "hooked") {
    return "Fish on the line";
  }

  if (gameState === "reeling") {
    return "Reeling it in";
  }

  if (gameState === "inspecting") {
    return "Inspecting the catch";
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

export function buildNearShoreWaterKeys(waterTiles: Tile[], shoreline: ShoreTile[]) {
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

export function buildEgretPerchCandidates(
  shoreline: ShoreTile[],
  waterTiles: Tile[],
): EgretPerchCandidate[] {
  const waterByKey = new Map(waterTiles.map((tile) => [getTileKey(tile), tile] as const));
  const preferredShoreline = shoreline.filter((tile) => tile.castable && !tile.dock);
  const shorelineCandidates = preferredShoreline.length > 0 ? preferredShoreline : shoreline;
  const candidates: EgretPerchCandidate[] = [];
  const sideNeighborSteps = [
    { row: -1, col: 0 },
    { row: 1, col: 0 },
    { row: 0, col: -1 },
    { row: 0, col: 1 },
  ];

  for (const perchTile of shorelineCandidates) {
    const adjacentWater: Tile[] = [];

    for (const step of sideNeighborSteps) {
      const waterTile = waterByKey.get(
        getTileKey({
          row: perchTile.row + step.row,
          col: perchTile.col + step.col,
        }),
      );

      if (waterTile) {
        adjacentWater.push(waterTile);
      }
    }

    if (adjacentWater.length === 0) {
      continue;
    }

    const targetWaterTile =
      adjacentWater.find((tile) => tile.col <= perchTile.col) ?? adjacentWater[0];

    candidates.push({
      perchTile,
      targetWaterTile,
      direction: targetWaterTile.col >= perchTile.col ? 1 : -1,
    });
  }

  return candidates;
}

export function getEgretPerchPlayerBiasWeight(
  perchTile: Tile,
  playerTile: Tile,
  biasRange = EGRET_PLAYER_BIAS_RANGE_TILES,
) {
  const distance = getTileRangeDistance(playerTile, perchTile);

  if (distance > biasRange) {
    return 1;
  }

  return 1 + (biasRange + 1 - distance) * EGRET_PLAYER_BIAS_WEIGHT;
}

export function chooseEgretPerchCandidate(
  candidates: EgretPerchCandidate[],
  playerTile: Tile | undefined,
  random: () => number,
) {
  const eligibleCandidates = playerTile
    ? candidates.filter((candidate) => !tileMatches(candidate.perchTile, playerTile))
    : candidates;

  if (eligibleCandidates.length === 0) {
    return undefined;
  }

  const weightedCandidates = eligibleCandidates.map((candidate) => ({
    candidate,
    weight: playerTile ? getEgretPerchPlayerBiasWeight(candidate.perchTile, playerTile) : 1,
  }));
  const totalWeight = weightedCandidates.reduce((total, candidate) => {
    return total + candidate.weight;
  }, 0);
  let threshold = random() * totalWeight;

  for (const weightedCandidate of weightedCandidates) {
    threshold -= weightedCandidate.weight;

    if (threshold <= 0) {
      return weightedCandidate.candidate;
    }
  }

  return weightedCandidates.at(-1)?.candidate;
}

export function getMinimumTileDistance(origin: Tile, targets: Tile[]) {
  if (targets.length === 0) {
    return 0;
  }

  return targets.reduce((minimum, target) => {
    return Math.min(minimum, getTileRangeDistance(origin, target));
  }, Number.POSITIVE_INFINITY);
}

export function randomBetween(random: () => number, min: number, max: number) {
  return min + random() * (max - min);
}

export function getAmbientFishBaseSize(fish: FishTemplate) {
  if (fish.rarity === "oddball") {
    return 1.28;
  }

  if (fish.rarity === "rare") {
    return 1.2;
  }

  if (fish.rarity === "uncommon") {
    return 1.12;
  }

  return 1.04;
}

export function buildWaterNeighborMap(waterTiles: Tile[]) {
  const waterSet = new Set(waterTiles.map(getTileKey));
  const neighbors = new Map<string, Tile[]>();

  for (const tile of waterTiles) {
    const adjacent: Tile[] = [];

    for (let rowStep = -1; rowStep <= 1; rowStep += 1) {
      for (let colStep = -1; colStep <= 1; colStep += 1) {
        if (rowStep === 0 && colStep === 0) {
          continue;
        }

        const nextTile = {
          row: tile.row + rowStep,
          col: tile.col + colStep,
        };

        if (waterSet.has(getTileKey(nextTile))) {
          adjacent.push(nextTile);
        }
      }
    }

    neighbors.set(getTileKey(tile), adjacent);
  }

  return neighbors;
}

export function chooseNextSwimTile(
  current: Tile,
  previous: Tile | undefined,
  neighborMap: Map<string, Tile[]>,
  random: () => number,
  baitTile?: Tile,
) {
  const candidates = neighborMap.get(getTileKey(current)) ?? [];

  if (candidates.length === 0) {
    return current;
  }

  const weighted = candidates.map((candidate) => {
    let weight = 1;

    if (previous && tileMatches(candidate, previous)) {
      weight *= baitTile ? 0.55 : 0.25;
    }

    if (baitTile) {
      const distance = getTileRangeDistance(candidate, baitTile);
      weight += Math.max(0, CAST_RANGE_TILES + 2 - distance) * 0.9;

      if (tileMatches(candidate, baitTile)) {
        weight += 9;
      }
    }

    return {
      tile: candidate,
      weight,
    };
  });

  const total = weighted.reduce((sum, candidate) => sum + candidate.weight, 0);
  let threshold = random() * total;

  for (const candidate of weighted) {
    threshold -= candidate.weight;

    if (threshold <= 0) {
      return candidate.tile;
    }
  }

  return weighted.at(-1)?.tile ?? current;
}

export function buildShoreNeighborMap(shoreline: ShoreTile[]) {
  const shorelineByKey = new Map(shoreline.map((tile) => [getTileKey(tile), tile] as const));
  const neighbors = new Map<string, ShoreTile[]>();

  for (const tile of shoreline) {
    const adjacent: ShoreTile[] = [];

    for (let rowStep = -1; rowStep <= 1; rowStep += 1) {
      for (let colStep = -1; colStep <= 1; colStep += 1) {
        if (rowStep === 0 && colStep === 0) {
          continue;
        }

        const nextTile = shorelineByKey.get(
          getTileKey({
            row: tile.row + rowStep,
            col: tile.col + colStep,
          }),
        );

        if (nextTile) {
          adjacent.push(nextTile);
        }
      }
    }

    neighbors.set(getTileKey(tile), adjacent);
  }

  return neighbors;
}

export function findShorePath(
  start: ShoreTile,
  goal: ShoreTile,
  neighborMap: Map<string, ShoreTile[]>,
) {
  if (tileMatches(start, goal)) {
    return [start];
  }

  const startKey = getTileKey(start);
  const goalKey = getTileKey(goal);
  const queue: ShoreTile[] = [start];
  const visited = new Set<string>([startKey]);
  const parent = new Map<string, string>();
  const shorelineByKey = new Map<string, ShoreTile>([[startKey, start]]);

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current) {
      break;
    }

    const currentKey = getTileKey(current);

    if (currentKey === goalKey) {
      break;
    }

    for (const neighbor of neighborMap.get(currentKey) ?? []) {
      const neighborKey = getTileKey(neighbor);

      if (visited.has(neighborKey)) {
        continue;
      }

      visited.add(neighborKey);
      parent.set(neighborKey, currentKey);
      shorelineByKey.set(neighborKey, neighbor);
      queue.push(neighbor);
    }
  }

  if (!visited.has(goalKey)) {
    return [start, goal];
  }

  const path: ShoreTile[] = [];
  let cursor = goalKey;

  while (cursor) {
    const tile = cursor === startKey ? start : shorelineByKey.get(cursor) ?? goal;
    path.push(tile);

    if (cursor === startKey) {
      break;
    }

    cursor = parent.get(cursor) ?? "";
  }

  return path.reverse();
}

export function getGameStateLabel(gameState: HarborGameMode, isCreelFull: boolean) {
  if (gameState === "walking") {
    return "Walking";
  }

  if (gameState === "casting") {
    return "Casting";
  }

  if (gameState === "hooked") {
    return "Hooked";
  }

  if (gameState === "reeling") {
    return "Reeling";
  }

  if (gameState === "inspecting") {
    return "Inspecting";
  }

  if (gameState === "waiting") {
    return "Waiting";
  }

  if (isCreelFull) {
    return "Rail full";
  }

  return "Roaming";
}
