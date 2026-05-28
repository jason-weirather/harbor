import { CAST_RANGE_TILES } from "../lib/pond/game";
import type { CatchInstance, ShoreTile, Tile } from "../lib/pond/types";
import type { HarborArtifact } from "./HarborWidget.types";

type SelectedArtifactAction =
  | {
      kind: "open";
      href: string;
      label: string;
    }
  | {
      kind: "button";
      label: string;
      onClick: () => void;
    };

interface HarborInfoPanelProps {
  title: string;
  statusHeading: string;
  statusMessage: string;
  playerTile: ShoreTile;
  targetTile?: Tile;
  score: number;
  railCount: number;
  gameStateLabel: string;
  isHudCollapsed: boolean;
  lastCatch?: CatchInstance;
  selectedArtifact?: HarborArtifact;
  selectedArtifactAction?: SelectedArtifactAction;
  onToggleHud: () => void;
}

export default function HarborInfoPanel({
  title,
  statusHeading,
  statusMessage,
  playerTile,
  targetTile,
  score,
  railCount,
  gameStateLabel,
  isHudCollapsed,
  lastCatch,
  selectedArtifact,
  selectedArtifactAction,
  onToggleHud,
}: HarborInfoPanelProps) {
  return (
    <div className="harbor-widget__panel-top">
      <div className="harbor-widget__summary" aria-live="polite">
        <p className="harbor-widget__eyebrow">{title}</p>
        <strong>{statusHeading}</strong>
        <span>{statusMessage}</span>
      </div>

      <div className="harbor-widget__meta">
        <span className="fishing-chip">
          Stand {playerTile.row}:{playerTile.col}
        </span>
        <span className="fishing-chip">Range {CAST_RANGE_TILES}</span>
        <span className="fishing-chip">
          Target {targetTile ? `${targetTile.row}:${targetTile.col}` : "none"}
        </span>
        <span className="fishing-chip">Score {score}</span>
        <span className="fishing-chip">Rail {railCount}/6</span>
        {lastCatch && <span className="fishing-chip">Last catch {lastCatch.displayName}</span>}
      </div>

      <div className="harbor-widget__actions">
        <button
          aria-controls="catch-rail"
          aria-expanded={!isHudCollapsed}
          className="pond-button pond-button--compact"
          data-testid="toggle-hud"
          onClick={onToggleHud}
          type="button"
        >
          {isHudCollapsed ? "Expand rail" : "Minimize rail"}
        </button>
        <span className="fishing-status-pill">{gameStateLabel}</span>
      </div>

      <aside className="harbor-widget__artifact-panel" aria-live="polite">
        {selectedArtifact ? (
          <>
            <p className="harbor-widget__artifact-label">Selected artifact</p>
            <strong>{selectedArtifact.title}</strong>
            <span>{selectedArtifact.summary ?? "This artifact does not include a summary yet."}</span>
            {selectedArtifactAction ? (
              selectedArtifactAction.kind === "open" ? (
                <a className="harbor-widget__artifact-action" href={selectedArtifactAction.href}>
                  {selectedArtifactAction.label}
                </a>
              ) : (
                <button
                  className="pond-link-button harbor-widget__artifact-action"
                  onClick={selectedArtifactAction.onClick}
                  type="button"
                >
                  {selectedArtifactAction.label}
                </button>
              )
            ) : null}
          </>
        ) : (
          <>
            <p className="harbor-widget__artifact-label">Info panel</p>
            <strong>Artifacts and status live here</strong>
            <span>
              Click a catch rail artifact that uses panel mode to keep its details visible inside the
              widget.
            </span>
          </>
        )}
      </aside>
    </div>
  );
}
