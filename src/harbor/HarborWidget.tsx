import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  AUTO_CATCH_MS,
  BITE_DELAY_MS,
  CAST_RANGE_TILES,
  INSPECTION_MS,
  MAX_CREEL_SIZE,
  REEL_ANIMATION_MS,
  canCast,
  createSeededRandom,
  resolveCatch,
} from "../lib/pond/game";
import { getPlayableTiles } from "../lib/pond/geometry";
import type { CatchInstance, PondManifest, ShoreTile, Tile } from "../lib/pond/types";
import CatchRail from "./CatchRail";
import FishingScene from "./FishingScene";
import HarborInfoPanel from "./HarborInfoPanel";
import type {
  HarborArtifact,
  HarborArtifactAdapter,
  HarborWidgetHandle,
  HarborWidgetOptions,
  HarborWidgetState,
} from "./HarborWidget.types";
import {
  AMBIENT_LIFETIME_MAX_MS,
  AMBIENT_LIFETIME_MIN_MS,
  AMBIENT_LOGIC_TICK_MS,
  AMBIENT_RESPAWN_MAX_MS,
  AMBIENT_RESPAWN_MIN_MS,
  AMBIENT_SWIM_MAX_MS,
  AMBIENT_SWIM_MIN_MS,
  CAST_ANIMATION_MS,
  EGRET_ARRIVE_MS,
  EGRET_EAT_MS,
  EGRET_FISH_APPROACH_MS,
  EGRET_INITIAL_VISIT_MAX_MS,
  EGRET_INITIAL_VISIT_MIN_MS,
  EGRET_LEAVE_MS,
  EGRET_STRIKE_MS,
  EGRET_VISIT_MAX_MS,
  EGRET_VISIT_MIN_MS,
  EGRET_WATCH_MAX_MS,
  INITIAL_AMBIENT_BLUEPRINTS,
  WALK_SEGMENT_MS,
  buildEgretPerchCandidates,
  buildNearShoreWaterKeys,
  buildShoreNeighborMap,
  buildWaterNeighborMap,
  chooseEgretPerchCandidate,
  chooseNextSwimTile,
  findShorePath,
  getAmbientFishBaseSize,
  getGameStateLabel,
  getMinimumTileDistance,
  getStatusHeading,
  getTileKey,
  isTileWithinCastRange,
  randomBetween,
  tileMatches,
  type AmbientEgret,
  type AmbientFish,
  type EncounterContext,
  type EgretPerchCandidate,
  type HarborGameMode,
  type MovementPath,
} from "./harborWidget.shared";
import "./harbor-widget.css";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function withArtifactDefaults(artifact: HarborArtifact, source: unknown): HarborArtifact {
  return {
    ...artifact,
    payload: artifact.payload ?? source,
    displayMode: artifact.displayMode ?? (artifact.url ? "open" : "panel"),
  };
}

function normalizeArtifact<TArtifact>(
  source: TArtifact,
  artifactAdapter?: HarborArtifactAdapter<TArtifact>,
): HarborArtifact {
  if (artifactAdapter) {
    return withArtifactDefaults(artifactAdapter(source), source);
  }

  if (!isRecord(source)) {
    throw new Error("HarborWidget artifacts must be objects with at least id and title fields.");
  }

  if (typeof source.id !== "string" || typeof source.title !== "string") {
    throw new Error("HarborWidget artifacts must include string id and title fields.");
  }

  const url =
    typeof source.url === "string"
      ? source.url
      : typeof source.readingUrl === "string"
        ? source.readingUrl
        : typeof source.canonicalUrl === "string"
          ? source.canonicalUrl
          : undefined;
  const summary = typeof source.summary === "string" ? source.summary : undefined;
  const pointsBonus = typeof source.pointsBonus === "number" ? source.pointsBonus : undefined;
  const displayMode =
    source.displayMode === "auto" ||
    source.displayMode === "panel" ||
    source.displayMode === "open" ||
    source.displayMode === "host"
      ? source.displayMode
      : undefined;

  return withArtifactDefaults(
    {
      id: source.id,
      title: source.title,
      summary,
      url,
      payload: "payload" in source ? source.payload : source,
      pointsBonus,
      displayMode,
    },
    source,
  );
}

function clearTimers(timerRef: MutableRefObject<number[]>) {
  timerRef.current.forEach((timer) => window.clearTimeout(timer));
  timerRef.current = [];
}

function getArtifactActionKind(
  artifact: HarborArtifact,
  hasRequestOpenArtifact: boolean,
): "panel" | "open" | "host" {
  const mode = artifact.displayMode ?? "auto";

  if (mode === "panel") {
    return "panel";
  }

  if (mode === "host") {
    return hasRequestOpenArtifact ? "host" : artifact.url ? "open" : "panel";
  }

  if (mode === "open") {
    return artifact.url ? "open" : hasRequestOpenArtifact ? "host" : "panel";
  }

  return artifact.url ? "open" : "panel";
}

const HarborWidget = forwardRef<HarborWidgetHandle, HarborWidgetOptions>(function HarborWidget(
  {
    manifest,
    title = "Harbor Fishing Widget",
    mode = "standalone",
    artifactAdapter,
    onCatch,
    onArtifactSelected,
    onRequestOpenArtifact,
    onStateChange,
  },
  ref,
) {
  const timerRef = useRef<number[]>([]);
  const creelRef = useRef<CatchInstance[]>([]);
  const scoreRef = useRef(0);
  const ambientFishRef = useRef<AmbientFish[]>([]);
  const ambientRandomRef = useRef(createSeededRandom(`${manifest.pond.id}:ambient-school`));
  const egretRandomRef = useRef(createSeededRandom(`${manifest.pond.id}:egret`));
  const ambientEgretRef = useRef<AmbientEgret>();
  const nextEgretVisitAtRef = useRef<number>();
  const egretVisitNumberRef = useRef(0);
  const movementRef = useRef<MovementPath>();
  const selectedWaterRef = useRef<Tile>();
  const castNumberRef = useRef(0);
  const gameStateRef = useRef<HarborGameMode>("idle");
  const playerTileRef = useRef<ShoreTile>();
  const castingStartedAtRef = useRef<number>();
  const reelingStartedAtRef = useRef<number>();
  const reelDurationRef = useRef(REEL_ANIMATION_MS);
  const approachStartedAtRef = useRef<number>();
  const approachDirectionRef = useRef<1 | -1>(1);
  const inspectionStartedAtRef = useRef<number>();
  const encounterRef = useRef<EncounterContext>();
  const widgetStateRef = useRef<HarborWidgetState>();
  const normalizedManifestArtifacts = useMemo(
    () => manifest.artifacts.map((artifact) => normalizeArtifact(artifact, artifactAdapter)),
    [artifactAdapter, manifest.artifacts],
  );
  const [hostArtifacts, setHostArtifacts] = useState<HarborArtifact[]>();
  const availableArtifacts = hostArtifacts ?? normalizedManifestArtifacts;
  const normalizedManifest = useMemo<PondManifest<HarborArtifact>>(
    () => ({
      ...manifest,
      artifacts: availableArtifacts,
    }),
    [availableArtifacts, manifest],
  );
  const normalizedManifestRef = useRef(normalizedManifest);
  const artifactMap = useMemo(
    () => new Map(availableArtifacts.map((artifact) => [artifact.id, artifact] as const)),
    [availableArtifacts],
  );
  const artifactMapRef = useRef(artifactMap);
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
  const shoreNeighborMap = useMemo(
    () => buildShoreNeighborMap(manifest.pond.shoreline),
    [manifest.pond.shoreline],
  );
  const waterNeighborMap = useMemo(() => buildWaterNeighborMap(waterTiles), [waterTiles]);
  const egretPerchCandidates = useMemo(
    () => buildEgretPerchCandidates(manifest.pond.shoreline, waterTiles),
    [manifest.pond.shoreline, waterTiles],
  );
  const ambientFishTemplates = useMemo(
    () =>
      manifest.fish.map((fish) => ({
        fishId: fish.id,
        accent: fish.accent,
        size: getAmbientFishBaseSize(fish),
      })),
    [manifest.fish],
  );

  const [playerTile, setPlayerTile] = useState<ShoreTile>(defaultPlayerTile);
  const [selectedWaterTile, setSelectedWaterTile] = useState<Tile>();
  const [hoveredWaterTile, setHoveredWaterTile] = useState<Tile>();
  const [gameState, setGameState] = useState<HarborGameMode>("idle");
  const [creel, setCreel] = useState<CatchInstance[]>([]);
  const [score, setScore] = useState(0);
  const [castNumber, setCastNumber] = useState(0);
  const [lastCatch, setLastCatch] = useState<CatchInstance>();
  const [activeCatchPreview, setActiveCatchPreview] = useState<CatchInstance>();
  const [isHudCollapsed, setIsHudCollapsed] = useState(false);
  const [selectedArtifact, setSelectedArtifact] = useState<HarborArtifact>();
  const [ambientFish, setAmbientFish] = useState<AmbientFish[]>([]);
  const [ambientEgret, setAmbientEgret] = useState<AmbientEgret>();
  const [statusMessage, setStatusMessage] = useState(
    "Move across the left shoreline, hover the water to line up a cast, and let the fisher handle the fight.",
  );

  const isCreelFull = creel.length >= MAX_CREEL_SIZE;
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
  const statusHeading = getStatusHeading(gameState, sceneWaterTile, isCreelFull);
  const gameStateLabel = getGameStateLabel(gameState, isCreelFull);
  const encounterFishScale =
    encounterRef.current?.fishScale ?? ambientFishTemplates[0]?.size ?? 1.1;

  function getArtifact(artifactId?: string) {
    if (!artifactId) {
      return undefined;
    }

    return artifactMap.get(artifactId);
  }

  function selectArtifact(nextArtifact?: HarborArtifact) {
    setSelectedArtifact(nextArtifact);
    onArtifactSelected?.(nextArtifact);
  }

  function createAmbientFishState(
    id: string,
    fishId: string,
    fromTile: Tile,
    toTile: Tile,
    accent: string,
    size: number,
    phase: number,
    now: number,
    segmentDuration?: number,
  ): AmbientFish {
    return {
      id,
      fishId,
      accent,
      fromTile,
      toTile,
      previousTile: undefined,
      segmentStartedAt: now,
      segmentDuration:
        segmentDuration ??
        randomBetween(ambientRandomRef.current, AMBIENT_SWIM_MIN_MS, AMBIENT_SWIM_MAX_MS),
      direction: toTile.col >= fromTile.col ? 1 : -1,
      size,
      phase,
      active: true,
      expiresAt:
        now + randomBetween(ambientRandomRef.current, AMBIENT_LIFETIME_MIN_MS, AMBIENT_LIFETIME_MAX_MS),
    };
  }

  function createRespawnedAmbientFish(id: string, now: number) {
    const random = ambientRandomRef.current;
    const fromTile = waterTiles[Math.floor(random() * waterTiles.length)] ?? waterTiles[0];
    const toTile = chooseNextSwimTile(fromTile, undefined, waterNeighborMap, random);
    const template =
      ambientFishTemplates[Math.floor(random() * ambientFishTemplates.length)] ??
      ambientFishTemplates[0];

    return createAmbientFishState(
      id,
      template?.fishId ?? manifest.fish[0]?.id ?? "lantern-koi",
      fromTile,
      toTile,
      template?.accent ?? "#345d7d",
      template?.size ?? randomBetween(random, 1.02, 1.32),
      randomBetween(random, 0, Math.PI * 2),
      now,
    );
  }

  function scheduleNextEgretVisit(now: number, initial = false) {
    nextEgretVisitAtRef.current =
      now +
      randomBetween(
        egretRandomRef.current,
        initial ? EGRET_INITIAL_VISIT_MIN_MS : EGRET_VISIT_MIN_MS,
        initial ? EGRET_INITIAL_VISIT_MAX_MS : EGRET_VISIT_MAX_MS,
      );
  }

  function createAmbientEgretState(now: number, candidates: EgretPerchCandidate[]) {
    const random = egretRandomRef.current;
    const currentPlayerTile = playerTileRef.current ?? playerTile;
    const candidate = chooseEgretPerchCandidate(candidates, currentPlayerTile, random);

    if (!candidate) {
      scheduleNextEgretVisit(now);
      return undefined;
    }

    egretVisitNumberRef.current += 1;

    return {
      id: `egret-${egretVisitNumberRef.current}`,
      state: "arriving" as const,
      perchTile: candidate.perchTile,
      targetWaterTile: candidate.targetWaterTile,
      direction: candidate.direction,
      startedAt: now,
      stateStartedAt: now,
    };
  }

  function makeLeavingEgret(egret: AmbientEgret, now: number): AmbientEgret {
    return {
      ...egret,
      state: "leaving",
      stateStartedAt: now,
      caughtFish: undefined,
    };
  }

  function sendEgretAway(now: number, egret = ambientEgretRef.current) {
    if (!egret || egret.state === "leaving") {
      return undefined;
    }

    const leavingEgret = makeLeavingEgret(egret, now);

    ambientEgretRef.current = leavingEgret;
    setAmbientEgret(leavingEgret);

    return leavingEgret;
  }

  function advanceAmbientEgretState(egret: AmbientEgret | undefined, now: number) {
    if (!egret) {
      return undefined;
    }

    const elapsed = now - egret.stateStartedAt;

    if (egret.state === "arriving" && elapsed >= EGRET_ARRIVE_MS) {
      return {
        ...egret,
        state: "watching" as const,
        stateStartedAt: now,
      };
    }

    if (egret.state === "watching" && elapsed >= EGRET_WATCH_MAX_MS) {
      return {
        ...egret,
        state: "leaving" as const,
        stateStartedAt: now,
        caughtFish: undefined,
      };
    }

    if (egret.state === "striking" && elapsed >= EGRET_STRIKE_MS) {
      return {
        ...egret,
        state: "eating" as const,
        stateStartedAt: now,
      };
    }

    if (egret.state === "eating" && elapsed >= EGRET_EAT_MS) {
      return {
        ...egret,
        state: "leaving" as const,
        stateStartedAt: now,
        caughtFish: undefined,
      };
    }

    if (egret.state === "leaving" && elapsed >= EGRET_LEAVE_MS) {
      scheduleNextEgretVisit(now);
      return undefined;
    }

    return egret;
  }

  function buildCatchResult(target: Tile, activeCastNumber: number, fishId?: string) {
    const random = createSeededRandom(
      `${manifest.pond.id}:${activeCastNumber}:${target.row}:${target.col}:${fishId ?? "spawn"}`,
    );

    return resolveCatch(normalizedManifestRef.current, target, random, activeCastNumber, fishId);
  }

  function getReelDurationForTarget(target: Tile) {
    if (nearShoreWaterKeys.has(getTileKey(target))) {
      return REEL_ANIMATION_MS;
    }

    const waterEdgeDistance = getMinimumTileDistance(target, nearShoreWaterTiles);
    return REEL_ANIMATION_MS + Math.min(1800, Math.max(700, waterEdgeDistance * 420));
  }

  function startCastingAtTile(
    target: Tile,
    activeCastNumber: number,
    castingMessage: string,
    settledMessage: string,
  ) {
    clearTimers(timerRef);
    const now = performance.now();

    castNumberRef.current = activeCastNumber;
    castingStartedAtRef.current = now;
    gameStateRef.current = "casting";
    selectedWaterRef.current = target;
    encounterRef.current = undefined;
    approachStartedAtRef.current = undefined;
    reelingStartedAtRef.current = undefined;
    reelDurationRef.current = REEL_ANIMATION_MS;
    inspectionStartedAtRef.current = undefined;
    setSelectedWaterTile(target);
    setHoveredWaterTile(target);
    setCastNumber(activeCastNumber);
    setGameState("casting");
    setActiveCatchPreview(undefined);
    setStatusMessage(castingMessage);

    timerRef.current.push(
      window.setTimeout(() => {
        startWaitingAtTile(target, activeCastNumber, settledMessage);
      }, CAST_ANIMATION_MS),
    );
  }

  function startWaitingAtTile(target: Tile, activeCastNumber: number, message: string) {
    clearTimers(timerRef);
    castNumberRef.current = activeCastNumber;
    castingStartedAtRef.current = undefined;
    gameStateRef.current = "waiting";
    selectedWaterRef.current = target;
    encounterRef.current = undefined;
    approachStartedAtRef.current = undefined;
    reelingStartedAtRef.current = undefined;
    reelDurationRef.current = REEL_ANIMATION_MS;
    inspectionStartedAtRef.current = undefined;
    setSelectedWaterTile(target);
    setHoveredWaterTile(target);
    setCastNumber(activeCastNumber);
    setGameState("waiting");
    setActiveCatchPreview(undefined);
    setStatusMessage(message);
  }

  function startEncounterSequence(encounter: EncounterContext) {
    if (
      !tileMatches(selectedWaterRef.current, encounter.target) ||
      gameStateRef.current !== "waiting"
    ) {
      encounterRef.current = undefined;
      return;
    }

    const catchResult = buildCatchResult(encounter.target, encounter.castNumber, encounter.fishId);
    const reelDuration = getReelDurationForTarget(encounter.target);
    reelDurationRef.current = reelDuration;
    setActiveCatchPreview(catchResult);
    setStatusMessage("A shadow drifts over the bait and noses in toward the bobber.");

    timerRef.current.push(
      window.setTimeout(() => {
        approachStartedAtRef.current = undefined;
        gameStateRef.current = "hooked";
        setGameState("hooked");
        setStatusMessage("Fish on the line. The fisher braces against the pull.");
      }, BITE_DELAY_MS),
    );

    timerRef.current.push(
      window.setTimeout(() => {
        reelingStartedAtRef.current = performance.now();
        gameStateRef.current = "reeling";
        setGameState("reeling");
        setStatusMessage("Reeling the fish in slowly.");
      }, BITE_DELAY_MS + AUTO_CATCH_MS),
    );

    timerRef.current.push(
      window.setTimeout(() => {
        inspectionStartedAtRef.current = performance.now();
        gameStateRef.current = "inspecting";
        setGameState("inspecting");
        setStatusMessage("The fisher lifts the catch to inspect it for a second.");
      }, BITE_DELAY_MS + AUTO_CATCH_MS + reelDuration),
    );

    timerRef.current.push(
      window.setTimeout(() => {
        finalizeCatch(encounter.target, encounter.castNumber, catchResult);
      }, BITE_DELAY_MS + AUTO_CATCH_MS + reelDuration + INSPECTION_MS),
    );
  }

  function finalizeCatch(target: Tile, activeCastNumber: number, catchResult: CatchInstance) {
    const artifact = catchResult.artifactId
      ? artifactMapRef.current.get(catchResult.artifactId)
      : undefined;
    const kept = creelRef.current.length < MAX_CREEL_SIZE;
    const nextCreel = kept ? [...creelRef.current, catchResult] : creelRef.current;
    const nextScore = scoreRef.current + catchResult.points;

    creelRef.current = nextCreel;
    scoreRef.current = nextScore;

    if (kept) {
      setCreel(nextCreel);
    }

    setScore(nextScore);
    setLastCatch(catchResult);
    encounterRef.current = undefined;
    approachStartedAtRef.current = undefined;
    castingStartedAtRef.current = undefined;
    reelingStartedAtRef.current = undefined;
    reelDurationRef.current = REEL_ANIMATION_MS;
    inspectionStartedAtRef.current = undefined;

    onCatch?.({
      catch: catchResult,
      artifact,
      kept,
      score: nextScore,
      creel: nextCreel,
    });

    if (selectedWaterRef.current && tileMatches(selectedWaterRef.current, target)) {
      const nextCastNumber = activeCastNumber + 1;

      startCastingAtTile(
        target,
        nextCastNumber,
        kept
          ? artifact
            ? `Caught ${catchResult.displayName}. Its artifact is in the rail, and the fisher casts right back out.`
            : `Caught ${catchResult.displayName} for ${catchResult.points} points. The fisher casts right back out.`
          : `Caught ${catchResult.displayName} for ${catchResult.points} points, but the rail was full, so it was released after inspection.`,
        `The line lands back on water tile ${target.row}:${target.col}, and the fisher waits for the next passing shadow.`,
      );
      return;
    }

    setActiveCatchPreview(undefined);
    gameStateRef.current = "idle";
    setGameState("idle");
    setStatusMessage(
      kept
        ? artifact
          ? `Caught ${catchResult.displayName}. Its artifact is waiting in the catch rail.`
          : `Caught ${catchResult.displayName} for ${catchResult.points} points.`
        : `Caught ${catchResult.displayName} for ${catchResult.points} points, but released it because the rail was full.`,
    );
  }

  function handleMoveToLand(tile: ShoreTile) {
    if (movementRef.current) {
      setStatusMessage("Let the fisher finish walking to the next bank tile first.");
      return;
    }

    const currentTile = playerTileRef.current ?? playerTile;

    if (tileMatches(currentTile, tile)) {
      return;
    }

    const path = findShorePath(currentTile, tile, shoreNeighborMap);
    const now = performance.now();
    const currentEgret = ambientEgretRef.current;
    const pathTouchesEgret =
      currentEgret &&
      currentEgret.state !== "leaving" &&
      (tileMatches(tile, currentEgret.perchTile) ||
        path.some((pathTile) => tileMatches(pathTile, currentEgret.perchTile)));

    if (pathTouchesEgret) {
      sendEgretAway(now, currentEgret);
    }

    clearTimers(timerRef);
    encounterRef.current = undefined;
    approachStartedAtRef.current = undefined;
    castingStartedAtRef.current = undefined;
    reelingStartedAtRef.current = undefined;
    reelDurationRef.current = REEL_ANIMATION_MS;
    inspectionStartedAtRef.current = undefined;
    gameStateRef.current = "walking";
    selectedWaterRef.current = undefined;
    playerTileRef.current = tile;
    movementRef.current = {
      tiles: path,
      startedAt: now,
      segmentDuration: WALK_SEGMENT_MS,
    };
    setPlayerTile(tile);
    setSelectedWaterTile(undefined);
    setHoveredWaterTile(undefined);
    setActiveCatchPreview(undefined);
    setGameState("walking");
    timerRef.current.push(
      window.setTimeout(() => {
        movementRef.current = undefined;
        gameStateRef.current = "idle";
        setGameState("idle");
        setStatusMessage(
          `Moved to bank tile ${tile.row}:${tile.col}. Click nearby water to cast within ${CAST_RANGE_TILES} squares.`,
        );
      }, Math.max(120, (path.length - 1) * WALK_SEGMENT_MS)),
    );
    setStatusMessage(
      `Walking to bank tile ${tile.row}:${tile.col}. The fisher stays on the shoreline as he changes spots.`,
    );
  }

  function handleChooseWater(tile: Tile) {
    if (gameState === "walking") {
      setStatusMessage("Let the fisher finish walking before you cast again.");
      return;
    }

    if (gameState !== "idle" && gameState !== "inventory-full") {
      return;
    }

    if (!canCast(tile, manifest.pond.mask)) {
      return;
    }

    if (!isTileWithinCastRange(playerTile, tile)) {
      setHoveredWaterTile(tile);
      setStatusMessage(
        `That water is too far away. Move closer and cast within ${CAST_RANGE_TILES} squares.`,
      );
      return;
    }

    const nextCastNumber = castNumber + 1;

    startCastingAtTile(
      tile,
      nextCastNumber,
      isCreelFull
        ? `Casting to water tile ${tile.row}:${tile.col}. The rail is full, so anything landed will be released after inspection.`
        : `Casting to water tile ${tile.row}:${tile.col}.`,
      isCreelFull
        ? `The line settles on water tile ${tile.row}:${tile.col}. The rail is full, so anything landed will be released after inspection.`
        : `The line settles on water tile ${tile.row}:${tile.col} while the fisher waits for a passing shadow.`,
    );
  }

  function handleThrowBack(catchId: string) {
    const released = creel.find((item) => item.id === catchId);
    const nextCreel = creel.filter((item) => item.id !== catchId);

    creelRef.current = nextCreel;
    setCreel(nextCreel);
    if (released?.artifactId && selectedArtifact?.id === released.artifactId) {
      selectArtifact(undefined);
    }
    if (
      gameStateRef.current !== "casting" &&
      gameStateRef.current !== "waiting" &&
      gameStateRef.current !== "hooked" &&
      gameStateRef.current !== "reeling" &&
      gameStateRef.current !== "inspecting"
    ) {
      gameStateRef.current = "idle";
      setGameState("idle");
    }
    setStatusMessage(
      released
        ? `Threw back ${released.displayName}. There is room in the rail again.`
        : "Opened a slot in the catch rail.",
    );
  }

  function handleArtifactPanelSelection(artifact: HarborArtifact) {
    selectArtifact(artifact);
    setStatusMessage(`Keeping ${artifact.title} in the info panel while the pond keeps running.`);
  }

  function clearCreelState() {
    creelRef.current = [];
    setCreel([]);
    selectArtifact(undefined);
    if (gameStateRef.current === "inventory-full") {
      gameStateRef.current = "idle";
      setGameState("idle");
    }
    setStatusMessage("Cleared the catch rail. The shoreline is ready for another run.");
  }

  function getArtifactAction(artifact: HarborArtifact) {
    const actionKind = getArtifactActionKind(artifact, Boolean(onRequestOpenArtifact));

    if (actionKind === "host") {
      return {
        kind: "button" as const,
        label: `Open artifact: ${artifact.title}`,
        onClick: () => {
          onRequestOpenArtifact?.(artifact);
        },
      };
    }

    if (actionKind === "panel") {
      return {
        kind: "button" as const,
        label: `Show artifact: ${artifact.title}`,
        onClick: () => {
          handleArtifactPanelSelection(artifact);
        },
      };
    }

    return {
      kind: "open" as const,
      href: artifact.url ?? "#",
      label: `Read artifact: ${artifact.title}`,
    };
  }

  useEffect(() => {
    creelRef.current = creel;
  }, [creel]);

  useEffect(() => {
    normalizedManifestRef.current = normalizedManifest;
  }, [normalizedManifest]);

  useEffect(() => {
    artifactMapRef.current = artifactMap;
  }, [artifactMap]);

  useEffect(() => {
    scoreRef.current = score;
  }, [score]);

  useEffect(() => {
    selectedWaterRef.current = selectedWaterTile;
  }, [selectedWaterTile]);

  useEffect(() => {
    castNumberRef.current = castNumber;
  }, [castNumber]);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    playerTileRef.current = playerTile;
  }, [playerTile]);

  useEffect(() => {
    if (selectedArtifact && !artifactMap.has(selectedArtifact.id)) {
      selectArtifact(undefined);
    }
  }, [artifactMap, selectedArtifact]);

  useEffect(() => {
    const now = performance.now();
    const seededFish = INITIAL_AMBIENT_BLUEPRINTS.filter((fish) => {
      return canCast(fish.from, manifest.pond.mask) && canCast(fish.to, manifest.pond.mask);
    }).map((fish, index) => {
      const template =
        ambientFishTemplates[index % Math.max(1, ambientFishTemplates.length)] ??
        ambientFishTemplates[0];

      return createAmbientFishState(
        `ambient-${index + 1}`,
        template?.fishId ?? manifest.fish[0]?.id ?? "lantern-koi",
        fish.from,
        fish.to,
        template?.accent ?? "#345d7d",
        template?.size ?? 1.08,
        fish.phase,
        now + index * 16,
        fish.duration,
      );
    });

    const nextAmbientFish =
      seededFish.length > 0
        ? seededFish
        : waterTiles
            .slice(0, 6)
            .map((tile, index) => createRespawnedAmbientFish(`ambient-${index + 1}`, now));

    ambientFishRef.current = nextAmbientFish;
    ambientEgretRef.current = undefined;
    scheduleNextEgretVisit(now, true);
    setAmbientFish(nextAmbientFish);
    setAmbientEgret(undefined);
  }, [ambientFishTemplates, manifest.fish, manifest.pond.mask, waterTiles, waterNeighborMap]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const now = performance.now();
      const random = ambientRandomRef.current;
      const baitTile =
        gameStateRef.current === "waiting" && !approachStartedAtRef.current
          ? selectedWaterRef.current
          : undefined;
      let nextEgret = advanceAmbientEgretState(ambientEgretRef.current, now);

      if (
        !nextEgret &&
        typeof nextEgretVisitAtRef.current === "number" &&
        now >= nextEgretVisitAtRef.current &&
        egretPerchCandidates.length > 0
      ) {
        nextEgret = createAmbientEgretState(now, egretPerchCandidates);
      }

      const currentPlayerTile = playerTileRef.current;
      if (
        nextEgret &&
        currentPlayerTile &&
        nextEgret.state !== "leaving" &&
        tileMatches(nextEgret.perchTile, currentPlayerTile)
      ) {
        nextEgret = makeLeavingEgret(nextEgret, now);
      }

      const egretWatchTile = nextEgret?.state === "watching" ? nextEgret.targetWaterTile : undefined;
      let egretNeedsFish =
        Boolean(
          nextEgret?.state === "watching" &&
            !nextEgret.hasSpottedFish &&
            !baitTile &&
            now - nextEgret.stateStartedAt >= EGRET_FISH_APPROACH_MS,
        );

      const nextAmbientFish = ambientFishRef.current.map((fish) => {
        if (!fish.active) {
          if (fish.respawnAt && now >= fish.respawnAt) {
            return createRespawnedAmbientFish(fish.id, now);
          }

          return fish;
        }

        if (now >= fish.expiresAt) {
          return {
            ...fish,
            active: false,
            respawnAt: now + randomBetween(random, AMBIENT_RESPAWN_MIN_MS, AMBIENT_RESPAWN_MAX_MS),
          };
        }

        if (now - fish.segmentStartedAt < fish.segmentDuration) {
          return fish;
        }

        const arrivedTile = fish.toTile;

        if (nextEgret?.state === "watching" && egretNeedsFish) {
          const approachCandidates =
            waterNeighborMap
              .get(getTileKey(nextEgret.targetWaterTile))
              ?.filter((tile) => !tileMatches(tile, nextEgret?.targetWaterTile)) ?? [];
          const approachTile =
            approachCandidates[Math.floor(random() * approachCandidates.length)] ??
            fish.toTile;
          const targetWaterTile = nextEgret.targetWaterTile;

          nextEgret = {
            ...nextEgret,
            hasSpottedFish: true,
          };
          egretNeedsFish = false;

          return {
            ...fish,
            fromTile: approachTile,
            toTile: targetWaterTile,
            previousTile: fish.fromTile,
            segmentStartedAt: now,
            segmentDuration: randomBetween(random, 900, 1400),
            direction: targetWaterTile.col >= approachTile.col ? 1 : -1,
            expiresAt: Math.max(fish.expiresAt, now + EGRET_WATCH_MAX_MS),
          };
        }

        if (baitTile && tileMatches(arrivedTile, baitTile) && !encounterRef.current) {
          const castContext = {
            target: baitTile,
            castNumber: castNumberRef.current,
            fishId: fish.fishId,
            fishScale: fish.size,
            direction: fish.direction,
          };

          encounterRef.current = castContext;
          approachStartedAtRef.current = now;
          approachDirectionRef.current = fish.direction;
          startEncounterSequence(castContext);

          return {
            ...fish,
            active: false,
            respawnAt: now + randomBetween(random, AMBIENT_RESPAWN_MIN_MS, AMBIENT_RESPAWN_MAX_MS),
          };
        }

        if (nextEgret?.state === "watching" && tileMatches(arrivedTile, nextEgret.targetWaterTile)) {
          nextEgret = {
            ...nextEgret,
            state: "striking",
            stateStartedAt: now,
            caughtFish: {
              accent: fish.accent,
              direction: fish.direction,
              fishId: fish.fishId,
              size: fish.size,
            },
          };

          if (gameStateRef.current === "idle" || gameStateRef.current === "inventory-full") {
            setStatusMessage("An egret snaps a small fish from the shallows and settles in to eat.");
          }

          return {
            ...fish,
            active: false,
            respawnAt: now + randomBetween(random, AMBIENT_RESPAWN_MIN_MS, AMBIENT_RESPAWN_MAX_MS),
          };
        }

        const nextTile = chooseNextSwimTile(
          arrivedTile,
          fish.fromTile,
          waterNeighborMap,
          random,
          baitTile ?? egretWatchTile,
        );

        return {
          ...fish,
          fromTile: arrivedTile,
          toTile: nextTile,
          previousTile: fish.fromTile,
          segmentStartedAt: now,
          segmentDuration: randomBetween(random, AMBIENT_SWIM_MIN_MS, AMBIENT_SWIM_MAX_MS),
          direction: nextTile.col >= arrivedTile.col ? 1 : -1,
        };
      });

      ambientFishRef.current = nextAmbientFish;
      ambientEgretRef.current = nextEgret;
      setAmbientFish(nextAmbientFish);
      setAmbientEgret(nextEgret);
    }, AMBIENT_LOGIC_TICK_MS);

    return () => window.clearInterval(interval);
  }, [egretPerchCandidates, waterNeighborMap]);

  useEffect(() => {
    return () => clearTimers(timerRef);
  }, []);

  const widgetState: HarborWidgetState = {
    title,
    mode,
    gameState,
    statusHeading,
    statusMessage,
    playerTile,
    selectedWaterTile: sceneWaterTile,
    score,
    creel,
    lastCatch,
    selectedArtifact,
    availableArtifacts,
    isHudCollapsed,
  };
  widgetStateRef.current = widgetState;

  useEffect(() => {
    onStateChange?.(widgetState);
  }, [onStateChange, widgetState]);

  useImperativeHandle(
    ref,
    () => ({
      getState: () => widgetStateRef.current ?? widgetState,
      setArtifacts: (artifacts) => {
        setHostArtifacts(artifacts);
      },
      clearCreel: () => {
        clearCreelState();
      },
    }),
    [widgetState],
  );

  return (
    <section
      className={`harbor-widget harbor-widget--${mode}${isHudCollapsed ? " is-hud-collapsed" : ""}`}
      aria-label="Pixel fishing prototype"
    >
      <FishingScene
        manifest={normalizedManifest}
        playerTile={playerTile}
        selectedWaterTile={selectedWaterTile}
        hoveredWaterTile={hoveredWaterTile}
        gameState={gameState}
        activeCatchPreview={activeCatchPreview}
        ambientFish={ambientFish}
        ambientEgret={ambientEgret}
        movement={movementRef.current}
        castingStartedAt={castingStartedAtRef.current}
        reelingStartedAt={reelingStartedAtRef.current}
        reelDuration={reelDurationRef.current}
        approachStartedAt={approachStartedAtRef.current}
        approachDirection={approachDirectionRef.current}
        encounterFishScale={encounterFishScale}
        onMoveToLand={handleMoveToLand}
        onChooseWater={handleChooseWater}
        onHoverWater={setHoveredWaterTile}
      />

      <footer className="harbor-widget__panel" aria-label="Catch rail">
        <HarborInfoPanel
          title={title}
          statusHeading={statusHeading}
          statusMessage={statusMessage}
          playerTile={playerTile}
          targetTile={sceneWaterTile}
          score={score}
          railCount={creel.length}
          gameStateLabel={gameStateLabel}
          isHudCollapsed={isHudCollapsed}
          lastCatch={lastCatch}
          selectedArtifact={selectedArtifact}
          selectedArtifactAction={
            selectedArtifact ? getArtifactAction(selectedArtifact) : undefined
          }
          onToggleHud={() => setIsHudCollapsed((current) => !current)}
        />
        <CatchRail
          creel={creel}
          hidden={isHudCollapsed}
          selectedArtifact={selectedArtifact}
          getArtifact={getArtifact}
          getArtifactAction={getArtifactAction}
          onThrowBack={handleThrowBack}
        />
      </footer>
    </section>
  );
});

export default HarborWidget;
