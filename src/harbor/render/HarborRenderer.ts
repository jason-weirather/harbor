import type {
  CatchInstance,
  PondManifest,
  ReservedZone,
  ShoreTile,
  Tile,
  TileOrigin,
  TileSize,
} from "../../lib/pond/types";
import type { HarborArtifact } from "../HarborWidget.types";
import type { AmbientEgret, AmbientFish, HarborGameMode, MovementPath } from "../harborWidget.shared";
import type { BackdropTile } from "./SceneLayers";

export interface ScenePoint {
  x: number;
  y: number;
}

export interface HarborCamera {
  origin: TileOrigin;
  reservedZones: ReservedZone[];
  tileSize: TileSize;
  viewportHeight: number;
  viewportWidth: number;
}

export interface CanvasHarborFrame {
  activeCatchPreview?: CatchInstance;
  ambientEgret?: AmbientEgret;
  ambientFish: AmbientFish[];
  approachDirection: 1 | -1;
  approachStartedAt?: number;
  backdropTiles: BackdropTile[];
  camera: HarborCamera;
  castingStartedAt?: number;
  encounterFishScale: number;
  gameState: HarborGameMode;
  hoveredWaterTile?: Tile;
  manifest: PondManifest<HarborArtifact>;
  movement?: MovementPath;
  nearShoreWaterKeys: Set<string>;
  nearShoreWaterTiles: Tile[];
  playerTile: ShoreTile;
  projectSceneTile: (tile: Tile) => ScenePoint;
  reelDuration: number;
  reelingStartedAt?: number;
  sceneWaterTile?: Tile;
  selectedWaterTile?: Tile;
  time: number;
  waterTiles: Tile[];
}

export interface HarborRenderer {
  drawFrame: (ctx: CanvasRenderingContext2D, frame: CanvasHarborFrame) => void;
}
