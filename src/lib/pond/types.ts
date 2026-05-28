export type ArtifactType =
  | "mini_post"
  | "response"
  | "comment"
  | "external_link"
  | "quote"
  | "demo_note";

export type FishRarity = "common" | "uncommon" | "rare" | "oddball";
export type LandTerrain = "grass" | "sand" | "path" | "dock";

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

export interface ViewBox {
  width: number;
  height: number;
}

export interface ShoreTile extends Tile {
  terrain?: LandTerrain;
  dock?: boolean;
  castable?: boolean;
}

export interface ReservedZone {
  id?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
}

export interface PondDefinition {
  id: string;
  name: string;
  description: string;
  mask: string[];
  tile: TileSize;
  viewBox: ViewBox;
  origin: TileOrigin;
  shoreline: ShoreTile[];
  reservedZones: ReservedZone[];
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

export interface PondArtifactRecord {
  id: string;
  title: string;
  summary?: string;
  pointsBonus?: number;
}

export interface ArtifactSummary extends PondArtifactRecord {
  id: string;
  slug: string;
  title: string;
  type: ArtifactType;
  authorId: string;
  authorName: string;
  canonicalUrl: string;
  readingUrl: string;
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

export interface PondManifest<TArtifact extends PondArtifactRecord = ArtifactSummary> {
  pond: PondDefinition;
  fish: FishTemplate[];
  artifacts: TArtifact[];
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
