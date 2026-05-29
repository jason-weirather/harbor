import type {
  CatchInstance,
  PondArtifactRecord,
  PondManifest,
  ShoreTile,
  Tile,
} from "../lib/pond/types";

export type HarborWidgetMode = "standalone" | "embedded" | "background";
export type HarborArtifactDisplayMode = "auto" | "panel" | "open" | "host";
export type HarborReleasePolicy = "oldest" | "newest";

export interface HarborArtifact extends PondArtifactRecord {
  id: string;
  title: string;
  summary?: string;
  url?: string;
  payload?: unknown;
  pointsBonus?: number;
  displayMode?: HarborArtifactDisplayMode;
}

export type HarborWidgetManifest<TArtifact = HarborArtifact> = Omit<
  PondManifest<PondArtifactRecord>,
  "artifacts"
> & {
  artifacts: TArtifact[];
};

export type HarborArtifactAdapter<TArtifact = unknown> = (artifact: TArtifact) => HarborArtifact;

export interface HarborHeldCatch {
  catch: CatchInstance;
  artifact?: HarborArtifact;
  heldIndex: number;
  isOldest: boolean;
  isNewest: boolean;
}

export interface HarborCatchEvent {
  catch: CatchInstance;
  artifact?: HarborArtifact;
  kept: boolean;
  score: number;
  creel: CatchInstance[];
  creelCapacity: number;
  heldCatches: HarborHeldCatch[];
  releasedCatch?: CatchInstance;
  releasePolicy: HarborReleasePolicy;
}

export interface HarborWidgetState {
  title: string;
  mode: HarborWidgetMode;
  gameState:
    | "idle"
    | "walking"
    | "casting"
    | "waiting"
    | "hooked"
    | "reeling"
    | "inspecting"
    | "inventory-full";
  statusHeading: string;
  statusMessage: string;
  playerTile: ShoreTile;
  selectedWaterTile?: Tile;
  score: number;
  creel: CatchInstance[];
  creelCapacity: number;
  heldCatches: HarborHeldCatch[];
  lastCatch?: CatchInstance;
  selectedArtifact?: HarborArtifact;
  availableArtifacts: HarborArtifact[];
  isCatchOverlayOpen: boolean;
  releasePolicy: HarborReleasePolicy;
}

export interface HarborWidgetOptions<TArtifact = unknown> {
  manifest: HarborWidgetManifest<TArtifact>;
  title?: string;
  mode?: HarborWidgetMode;
  maxCreelSize?: number;
  artifactAdapter?: HarborArtifactAdapter<TArtifact>;
  onCatch?: (event: HarborCatchEvent) => void;
  onArtifactSelected?: (artifact: HarborArtifact | undefined) => void;
  onRequestOpenArtifact?: (artifact: HarborArtifact) => void;
  onStateChange?: (state: HarborWidgetState) => void;
}

export interface HarborWidgetHandle {
  getState: () => HarborWidgetState;
  getHeldCatches: () => HarborHeldCatch[];
  setArtifacts: (artifacts: HarborArtifact[]) => void;
  clearCreel: () => void;
  releaseCatch: (catchId: string) => void;
  releaseNextCatch: () => CatchInstance | undefined;
  setCatchOverlayOpen: (open: boolean) => void;
  setReleasePolicy: (policy: HarborReleasePolicy) => void;
}

export interface HarborWidgetController extends HarborWidgetHandle {
  destroy: () => void;
}
