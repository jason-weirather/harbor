import type { CSSProperties, KeyboardEvent } from "react";
import { useEffect, useState } from "react";
import {
  BITE_DELAY_MS,
  BITE_WINDOW_MS,
  MAX_CREEL_SIZE,
  canCast,
  createSeededRandom,
  moveTarget,
  resolveCatch,
} from "../../lib/pond/game";
import {
  createDiamondPoints,
  getPlayableTiles,
  projectTile,
} from "../../lib/pond/geometry";
import type {
  ArtifactSummary,
  CatchInstance,
  GameState,
  PondManifest,
  Tile,
} from "../../lib/pond/types";

interface PondAppProps {
  manifest: PondManifest;
  variant?: "sidecar" | "room";
}

function getArtifact(manifest: PondManifest, artifactId?: string) {
  if (!artifactId) {
    return undefined;
  }

  return manifest.artifacts.find((artifact) => artifact.id === artifactId);
}

function getStatusTitle(gameState: GameState, isCreelFull: boolean) {
  if (isCreelFull || gameState === "inventory-full") {
    return "Creel full";
  }

  if (gameState === "waiting") {
    return "Line out";
  }

  if (gameState === "bite-window") {
    return "Reel now";
  }

  if (gameState === "catch-review") {
    return "Catch review";
  }

  return "Ready to cast";
}

export default function PondApp({ manifest, variant = "sidecar" }: PondAppProps) {
  const playableTiles = getPlayableTiles(manifest.pond.mask);
  const firstTile = playableTiles[0];
  const allStageTiles = manifest.pond.mask.flatMap((row, rowIndex) =>
    [...row].flatMap((cell, colIndex) =>
      cell === "2"
        ? []
        : [
            {
              row: rowIndex,
              col: colIndex,
              value: cell,
            },
          ],
    ),
  );

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const halfWidth = manifest.pond.tile.width / 2;
  const halfHeight = manifest.pond.tile.height / 2;

  for (const tile of allStageTiles) {
    const center = projectTile(tile, manifest.pond.tile, manifest.pond.origin);
    minX = Math.min(minX, center.x - halfWidth);
    maxX = Math.max(maxX, center.x + halfWidth);
    minY = Math.min(minY, center.y - halfHeight);
    maxY = Math.max(maxY, center.y + halfHeight);
  }

  const stageOrigin = {
    x: manifest.pond.origin.x - minX + manifest.pond.tile.width,
    y: manifest.pond.origin.y - minY + manifest.pond.tile.height,
  };
  const stageWidth = maxX - minX + manifest.pond.tile.width * 2;
  const stageHeight = maxY - minY + manifest.pond.tile.height * 4;

  const [selectedTarget, setSelectedTarget] = useState<Tile | undefined>(firstTile);
  const [gameState, setGameState] = useState<GameState>("idle");
  const [creel, setCreel] = useState<CatchInstance[]>([]);
  const [activeCatch, setActiveCatch] = useState<CatchInstance>();
  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactSummary>();
  const [savedArtifacts, setSavedArtifacts] = useState<string[]>([]);
  const [castNumber, setCastNumber] = useState(0);
  const [statusMessage, setStatusMessage] = useState(
    "Pick a playable water tile and press Cast.",
  );
  const [shareMessage, setShareMessage] = useState("");

  const totalPoints = creel.reduce((sum, item) => sum + item.points, 0);
  const isCreelFull = creel.length >= MAX_CREEL_SIZE;
  const selectedCenter = selectedTarget
    ? projectTile(selectedTarget, manifest.pond.tile, stageOrigin)
    : undefined;
  const dockStart = { x: stageOrigin.x - 16, y: stageOrigin.y + 68 };

  useEffect(() => {
    if (isCreelFull && gameState === "idle") {
      setGameState("inventory-full");
      setStatusMessage("Creel full. Throw one back before you cast again.");
    }

    if (!isCreelFull && gameState === "inventory-full") {
      setGameState("idle");
      setStatusMessage("Space opened up in the creel. Cast again whenever you like.");
    }
  }, [gameState, isCreelFull]);

  useEffect(() => {
    if (gameState !== "waiting") {
      return undefined;
    }

    const biteTimer = window.setTimeout(() => {
      setGameState("bite-window");
      setStatusMessage("A ripple tugs the line. Reel it in.");
    }, BITE_DELAY_MS);

    return () => window.clearTimeout(biteTimer);
  }, [gameState]);

  useEffect(() => {
    if (gameState !== "bite-window") {
      return undefined;
    }

    const missTimer = window.setTimeout(() => {
      setGameState(isCreelFull ? "inventory-full" : "idle");
      setStatusMessage("The wake faded. Pick a tile and cast again.");
    }, BITE_WINDOW_MS);

    return () => window.clearTimeout(missTimer);
  }, [gameState, isCreelFull]);

  function handleSelectTile(tile: Tile) {
    if (!canCast(tile, manifest.pond.mask)) {
      return;
    }

    setSelectedTarget(tile);
    setStatusMessage(`Target set to row ${tile.row}, column ${tile.col}.`);
  }

  function handleStageKeys(event: KeyboardEvent<HTMLDivElement>) {
    const directionMap = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
    } as const;

    if (event.key in directionMap) {
      event.preventDefault();
      const next = moveTarget(
        manifest.pond.mask,
        selectedTarget,
        directionMap[event.key as keyof typeof directionMap],
      );
      handleSelectTile(next);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (selectedTarget) {
        handleSelectTile(selectedTarget);
      }
    }
  }

  function handleCast() {
    if (!canCast(selectedTarget, manifest.pond.mask)) {
      setStatusMessage("Choose a playable tile before casting.");
      return;
    }

    if (isCreelFull) {
      setGameState("inventory-full");
      setStatusMessage("Creel full. Throw one back before you cast again.");
      return;
    }

    setActiveCatch(undefined);
    setShareMessage("");
    setSelectedArtifact(undefined);
    setCastNumber((current) => current + 1);
    setGameState("waiting");
    setStatusMessage("Line out. Keep an eye on the bobber.");
  }

  function handleReel() {
    if (!selectedTarget) {
      return;
    }

    const seed = `${manifest.pond.id}:${castNumber}:${selectedTarget.row}:${selectedTarget.col}`;
    const random = createSeededRandom(seed);
    const catchResult = resolveCatch(manifest, selectedTarget, random, castNumber);
    const artifact = getArtifact(manifest, catchResult.artifactId);

    setActiveCatch(catchResult);
    setSelectedArtifact(artifact);
    setGameState("catch-review");
    setStatusMessage(
      artifact
        ? `${catchResult.displayName} surfaced with "${artifact.title}".`
        : `${catchResult.displayName} surfaced clean and bright.`,
    );
  }

  function handleKeep() {
    if (!activeCatch) {
      return;
    }

    const nextCreel = [...creel, activeCatch];
    setCreel(nextCreel);
    setActiveCatch(undefined);
    setGameState(nextCreel.length >= MAX_CREEL_SIZE ? "inventory-full" : "idle");
    setStatusMessage(`${activeCatch.displayName} slipped into slot ${nextCreel.length}.`);
  }

  function handleReleaseCurrentCatch() {
    setActiveCatch(undefined);
    setSelectedArtifact(undefined);
    setGameState(isCreelFull ? "inventory-full" : "idle");
    setStatusMessage("Released with a small ripple.");
  }

  function handleThrowBack(catchId: string) {
    const nextCreel = creel.filter((item) => item.id !== catchId);
    setCreel(nextCreel);

    if (selectedArtifact && creel.find((item) => item.id === catchId)?.artifactId === selectedArtifact.id) {
      setSelectedArtifact(undefined);
    }

    setGameState("idle");
    setStatusMessage("A slot opened up in the creel.");
  }

  function handleSaveLink(artifact: ArtifactSummary) {
    if (savedArtifacts.includes(artifact.id)) {
      setStatusMessage(`"${artifact.title}" is already in your saved links.`);
      return;
    }

    setSavedArtifacts([...savedArtifacts, artifact.id]);
    setStatusMessage(`Saved a local reminder for "${artifact.title}".`);
  }

  async function handleShareArtifact(artifact: ArtifactSummary) {
    const shareUrl = artifact.canonicalUrl;

    if (typeof navigator !== "undefined" && navigator.share) {
      await navigator.share({ title: artifact.title, url: shareUrl });
      setShareMessage(`Shared ${artifact.title}.`);
      return;
    }

    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(shareUrl);
      setShareMessage(`Copied ${shareUrl}`);
      return;
    }

    setShareMessage(`Open ${shareUrl} from the artifact page.`);
  }

  const statusTitle = getStatusTitle(gameState, isCreelFull);
  const canCastNow = canCast(selectedTarget, manifest.pond.mask) && !isCreelFull;
  const currentArtifact = getArtifact(manifest, activeCatch?.artifactId);

  return (
    <div className={`pond-ui pond-ui--${variant}`}>
      <div className="pond-ui__topline">
        <div>
          <p className="pond-ui__eyebrow">Hello-world pond loop</p>
          <h3>{statusTitle}</h3>
        </div>
        <p className="pond-ui__status">{statusMessage}</p>
      </div>

      <div
        className="pond-stage-frame"
        onKeyDown={handleStageKeys}
        tabIndex={0}
        aria-label="Isometric fishing pond. Use arrow keys to move across water tiles."
      >
        <svg
          className="pond-stage"
          viewBox={`0 0 ${stageWidth} ${stageHeight}`}
          role="img"
          aria-labelledby="pond-stage-title pond-stage-description"
        >
          <title id="pond-stage-title">Clubhouse Pond</title>
          <desc id="pond-stage-description">
            A tiny isometric fishing stage with playable water tiles and a docked fisher.
          </desc>
          <defs>
            <linearGradient id="pond-sky" x1="0%" x2="100%" y1="0%" y2="100%">
              <stop offset="0%" stopColor="#fff3db" />
              <stop offset="55%" stopColor="#d6eef6" />
              <stop offset="100%" stopColor="#93cde0" />
            </linearGradient>
            <linearGradient id="pond-water" x1="0%" x2="100%" y1="0%" y2="100%">
              <stop offset="0%" stopColor="#b9f5fb" />
              <stop offset="100%" stopColor="#2d9db2" />
            </linearGradient>
          </defs>
          <rect height={stageHeight} rx="26" width={stageWidth} fill="url(#pond-sky)" />
          <path
            d={`M 0 ${stageHeight - 92} C ${stageWidth * 0.25} ${stageHeight - 144}, ${
              stageWidth * 0.58
            } ${stageHeight - 28}, ${stageWidth} ${stageHeight - 116} L ${stageWidth} ${stageHeight} L 0 ${stageHeight} Z`}
            fill="#8ecb8a"
            opacity="0.72"
          />
          <ellipse
            cx={dockStart.x - 18}
            cy={dockStart.y - 16}
            fill="#f6e1ba"
            opacity="0.9"
            rx="46"
            ry="24"
          />
          <g aria-hidden="true">
            <polygon
              fill="#9c6c3f"
              points={`${dockStart.x - 56},${dockStart.y - 8} ${dockStart.x - 6},${dockStart.y - 36} ${dockStart.x + 76},${dockStart.y + 10} ${dockStart.x + 28},${dockStart.y + 38}`}
            />
            <ellipse cx={dockStart.x - 6} cy={dockStart.y - 48} fill="#20364a" rx="14" ry="14" />
            <path
              d={`M ${dockStart.x - 10} ${dockStart.y - 34} Q ${dockStart.x + 6} ${
                dockStart.y + 4
              } ${dockStart.x + 18} ${dockStart.y + 24}`}
              fill="none"
              stroke="#20364a"
              strokeWidth="10"
              strokeLinecap="round"
            />
          </g>

          {allStageTiles.map((tile) => {
            const isPlayable = tile.value === "1";
            const isSelected =
              selectedTarget?.row === tile.row && selectedTarget?.col === tile.col;

            return (
              <polygon
                key={`${tile.row}-${tile.col}`}
                data-testid={`tile-${tile.row}-${tile.col}`}
                points={createDiamondPoints(tile, manifest.pond.tile, stageOrigin)}
                fill={isPlayable ? "url(#pond-water)" : "#dbe7e6"}
                opacity={isPlayable ? 1 : 0.44}
                stroke={isSelected ? "#f97316" : isPlayable ? "#11697c" : "#c9d8d6"}
                strokeWidth={isSelected ? 4 : 1.5}
                style={{ cursor: isPlayable ? "pointer" : "default" }}
                onClick={() => isPlayable && handleSelectTile(tile)}
                onMouseEnter={() => isPlayable && setStatusMessage(`Playable tile at row ${tile.row}, column ${tile.col}.`)}
              />
            );
          })}

          {selectedCenter && (
            <g aria-hidden="true">
              <line
                stroke="#20364a"
                strokeDasharray="10 7"
                strokeLinecap="round"
                strokeWidth="3"
                x1={dockStart.x + 10}
                x2={selectedCenter.x}
                y1={dockStart.y - 18}
                y2={selectedCenter.y - 8}
              />
              <circle
                className={gameState === "waiting" || gameState === "bite-window" ? "pond-stage__bobber" : ""}
                cx={selectedCenter.x}
                cy={selectedCenter.y - 8}
                fill={gameState === "bite-window" ? "#f97316" : "#fef3c7"}
                r={10}
                stroke="#0f172a"
                strokeWidth="3"
              />
            </g>
          )}
        </svg>
      </div>

      <div className="pond-controls">
        <button className="pond-button pond-button--primary" disabled={!canCastNow} onClick={handleCast}>
          Cast
        </button>
        <button
          className="pond-button"
          disabled={gameState !== "bite-window"}
          onClick={handleReel}
        >
          Reel in
        </button>
        <span className="pond-meta">
          Target {selectedTarget ? `row ${selectedTarget.row}, col ${selectedTarget.col}` : "none"} ·
          Score {totalPoints} · Creel {creel.length}/{MAX_CREEL_SIZE}
        </span>
      </div>

      {activeCatch && (
        <section className="pond-review" aria-label="Current catch review">
          <div
            className="pond-fish-chip"
            style={{ "--fish-accent": activeCatch.accent } as CSSProperties}
          />
          <div className="pond-review__copy">
            <p className="pond-ui__eyebrow">On the line</p>
            <h4>{activeCatch.displayName}</h4>
            <p>
              {activeCatch.blurb} Worth <strong>{activeCatch.points}</strong> points.
            </p>
            {currentArtifact && (
              <p className="pond-review__artifact">
                Carries <strong>{currentArtifact.title}</strong>.
              </p>
            )}
          </div>
          <div className="pond-review__actions">
            <button className="pond-button pond-button--primary" onClick={handleKeep}>
              Keep fish
            </button>
            <button className="pond-button" onClick={handleReleaseCurrentCatch}>
              Throw back
            </button>
            {currentArtifact && (
              <button className="pond-button" onClick={() => setSelectedArtifact(currentArtifact)}>
                View artifact
              </button>
            )}
          </div>
        </section>
      )}

      <section className="pond-creel" aria-label="Creel">
        {Array.from({ length: MAX_CREEL_SIZE }, (_, index) => {
          const catchItem = creel[index];

          if (!catchItem) {
            return (
              <article className="pond-slot pond-slot--empty" key={`empty-${index}`}>
                <span>Slot {index + 1}</span>
                <small>Open water</small>
              </article>
            );
          }

          const artifact = getArtifact(manifest, catchItem.artifactId);

          return (
            <article className="pond-slot" key={catchItem.id}>
              <div
                className="pond-fish-chip pond-fish-chip--small"
                style={{ "--fish-accent": catchItem.accent } as CSSProperties}
              />
              <div className="pond-slot__copy">
                <strong>{catchItem.displayName}</strong>
                <span>{catchItem.points} pts</span>
              </div>
              <div className="pond-slot__actions">
                {artifact && (
                  <button className="pond-link-button" onClick={() => setSelectedArtifact(artifact)}>
                    View
                  </button>
                )}
                <button className="pond-link-button" onClick={() => handleThrowBack(catchItem.id)}>
                  Throw back
                </button>
              </div>
            </article>
          );
        })}
      </section>

      {selectedArtifact && (
        <aside className="artifact-viewer" aria-label="Artifact viewer">
          <div className="artifact-viewer__topline">
            <div>
              <p className="pond-ui__eyebrow">Artifact</p>
              <h4>{selectedArtifact.title}</h4>
            </div>
            <button className="pond-link-button" onClick={() => setSelectedArtifact(undefined)}>
              Close
            </button>
          </div>
          <p>{selectedArtifact.summary}</p>
          <dl className="artifact-viewer__facts">
            <div>
              <dt>Author</dt>
              <dd>{selectedArtifact.authorName}</dd>
            </div>
            <div>
              <dt>Type</dt>
              <dd>{selectedArtifact.type.replace("_", " ")}</dd>
            </div>
            <div>
              <dt>URL</dt>
              <dd>
                <a href={selectedArtifact.canonicalUrl}>{selectedArtifact.canonicalUrl}</a>
              </dd>
            </div>
          </dl>
          {selectedArtifact.disclosure && (
            <p className="artifact-viewer__disclosure">{selectedArtifact.disclosure}</p>
          )}
          <div className="artifact-viewer__actions">
            <a className="pond-button pond-button--primary" href={selectedArtifact.canonicalUrl}>
              Open page
            </a>
            <button className="pond-button" onClick={() => handleSaveLink(selectedArtifact)}>
              {savedArtifacts.includes(selectedArtifact.id) ? "Saved link" : "Save link"}
            </button>
            <button className="pond-button" onClick={() => void handleShareArtifact(selectedArtifact)}>
              Share
            </button>
          </div>
          {shareMessage && <p className="artifact-viewer__share">{shareMessage}</p>}
        </aside>
      )}
    </div>
  );
}

