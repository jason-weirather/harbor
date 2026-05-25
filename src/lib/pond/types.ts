export type ArtifactType =
  | "mini_post"
  | "response"
  | "comment"
  | "external_link"
  | "quote"
  | "demo_note";

export type FishRarity = "common" | "uncommon" | "rare" | "oddball";

export type GameState =
  | "idle"
  | "waiting"
  | "bite-window"
  | "catch-review"
  | "inventory-full";

export interface Tile {
  row: number;
  col: number;
}

export interface TileSize {
  width: number;
  height: number;
}

export interface TileOrigin {
  x: number;
  y: number;
}

export interface PondDefinition {
  id: string;
  name: string;
  description: string;
  mask: string[];
  tile: TileSize;
  origin: TileOrigin;
}

export interface FishTemplate {
  id: string;
  name: string;
  rarity: FishRarity;
  basePoints: number;
  accent: string;
  blurb: string;
  artifactChance: number;
}

export interface ArtifactSummary {
  id: string;
  slug: string;
  title: string;
  type: ArtifactType;
  authorId: string;
  authorName: string;
  canonicalUrl: string;
  summary: string;
  pointsBonus: number;
  disclosure?: string;
  external: boolean;
}

export interface SpawnEntry {
  fishId: string;
  weight: number;
}

export interface SpawnTable {
  id: string;
  entries: SpawnEntry[];
}

export interface PondManifest {
  pond: PondDefinition;
  fish: FishTemplate[];
  artifacts: ArtifactSummary[];
  spawnTables: SpawnTable[];
  generatedAt: string;
}

export interface CatchInstance {
  id: string;
  fishId: string;
  displayName: string;
  points: number;
  rarity: FishRarity;
  caughtAt: string;
  target: Tile;
  artifactId?: string;
  accent: string;
  blurb: string;
  state: "kept" | "released";
}

