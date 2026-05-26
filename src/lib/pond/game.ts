import type {
  ArtifactSummary,
  CatchInstance,
  FishTemplate,
  PondManifest,
  SpawnEntry,
  Tile,
} from "./types";
import { getPlayableTiles } from "./geometry";

export const MAX_CREEL_SIZE = 6;
export const BITE_DELAY_MS = 900;
export const BITE_WINDOW_MS = 1800;
export const AUTO_CATCH_MS = 650;
export const REEL_ANIMATION_MS = 1700;
export const INSPECTION_MS = 1000;
export const CAST_RANGE_TILES = 6;

const RARITY_MULTIPLIER = {
  common: 1,
  uncommon: 1.45,
  rare: 1.9,
  oddball: 2.4,
} as const;

export function canCast(target: Tile | undefined, mask: string[]) {
  if (!target) {
    return false;
  }

  return Boolean(mask[target.row]?.[target.col] === "1");
}

export function hashSeed(seed: string) {
  let hash = 1779033703 ^ seed.length;

  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }

  return hash >>> 0;
}

export function createSeededRandom(seed: string) {
  let state = hashSeed(seed);

  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickWeightedEntry(entries: SpawnEntry[], random: () => number) {
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let threshold = random() * totalWeight;

  for (const entry of entries) {
    threshold -= entry.weight;
    if (threshold <= 0) {
      return entry;
    }
  }

  return entries.at(-1);
}

export function pickFish(
  fish: FishTemplate[],
  spawnEntries: SpawnEntry[],
  random: () => number,
) {
  const picked = pickWeightedEntry(spawnEntries, random);

  if (!picked) {
    throw new Error("Cannot pick a fish without spawn entries.");
  }

  const match = fish.find((candidate) => candidate.id === picked.fishId);

  if (!match) {
    throw new Error(`Spawn entry ${picked.fishId} has no matching fish template.`);
  }

  return match;
}

export function pickArtifact(
  artifacts: ArtifactSummary[],
  fish: FishTemplate,
  random: () => number,
) {
  if (artifacts.length === 0 || random() > fish.artifactChance) {
    return undefined;
  }

  const index = Math.floor(random() * artifacts.length);
  return artifacts[index];
}

export function resolveCatch(
  manifest: PondManifest,
  target: Tile,
  random: () => number,
  castNumber: number,
  forcedFishId?: string,
): CatchInstance {
  const spawnTable = manifest.spawnTables[0];
  const fish =
    forcedFishId
      ? manifest.fish.find((candidate) => candidate.id === forcedFishId) ??
        pickFish(manifest.fish, spawnTable.entries, random)
      : pickFish(manifest.fish, spawnTable.entries, random);
  const artifact = pickArtifact(manifest.artifacts, fish, random);
  const points =
    Math.round(fish.basePoints * RARITY_MULTIPLIER[fish.rarity]) +
    (artifact?.pointsBonus ?? 0);

  return {
    id: `${fish.id}-${castNumber}-${target.row}-${target.col}`,
    fishId: fish.id,
    displayName: fish.name,
    points,
    rarity: fish.rarity,
    caughtAt: new Date().toISOString(),
    target,
    artifactId: artifact?.id,
    accent: fish.accent,
    blurb: fish.blurb,
    state: "kept",
  };
}

export function moveTarget(
  mask: string[],
  current: Tile | undefined,
  direction: "up" | "down" | "left" | "right",
) {
  const tiles = getPlayableTiles(mask);

  if (!current) {
    return tiles[0];
  }

  const candidates = tiles
    .filter((tile) => {
      if (direction === "up") return tile.row < current.row;
      if (direction === "down") return tile.row > current.row;
      if (direction === "left") return tile.col < current.col;
      return tile.col > current.col;
    })
    .sort((left, right) => {
      const leftPrimary =
        direction === "up" || direction === "down"
          ? Math.abs(left.row - current.row)
          : Math.abs(left.col - current.col);
      const rightPrimary =
        direction === "up" || direction === "down"
          ? Math.abs(right.row - current.row)
          : Math.abs(right.col - current.col);

      if (leftPrimary !== rightPrimary) {
        return leftPrimary - rightPrimary;
      }

      const leftSecondary =
        direction === "up" || direction === "down"
          ? Math.abs(left.col - current.col)
          : Math.abs(left.row - current.row);
      const rightSecondary =
        direction === "up" || direction === "down"
          ? Math.abs(right.col - current.col)
          : Math.abs(right.row - current.row);

      return leftSecondary - rightSecondary;
    });

  return candidates[0] ?? current;
}
