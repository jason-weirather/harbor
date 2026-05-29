import type { CSSProperties } from "react";
import type {
  HarborArtifact,
  HarborHeldCatch,
  HarborReleasePolicy,
} from "./HarborWidget.types";

type ArtifactAction =
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

interface CatchOverlayProps {
  creelCapacity: number;
  heldCatches: HarborHeldCatch[];
  releasePolicy: HarborReleasePolicy;
  selectedArtifact?: HarborArtifact;
  getArtifactAction: (artifact: HarborArtifact) => ArtifactAction;
  onClose: () => void;
  onReleaseCatch: (catchId: string) => void;
  onReleaseNext: () => void;
  onReleasePolicyChange: (policy: HarborReleasePolicy) => void;
}

function ReleaseIcon() {
  return (
    <svg aria-hidden="true" className="harbor-widget__release-icon" viewBox="0 0 24 24">
      <path d="M5 12h12" />
      <path d="m13 8 4 4-4 4" />
      <path d="M5 7v10" />
    </svg>
  );
}

export default function CatchOverlay({
  creelCapacity,
  heldCatches,
  releasePolicy,
  selectedArtifact,
  getArtifactAction,
  onClose,
  onReleaseCatch,
  onReleaseNext,
  onReleasePolicyChange,
}: CatchOverlayProps) {
  return (
    <aside
      aria-label="Catch inventory"
      className="harbor-widget__catch-overlay"
      data-testid="catch-overlay"
    >
      <header className="harbor-widget__catch-overlay-header">
        <div>
          <strong>Catch</strong>
          <span>{heldCatches.length}/{creelCapacity} held</span>
        </div>
        <button
          aria-label="Close catch overlay"
          className="harbor-widget__icon-button"
          onClick={onClose}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="m6 6 12 12" />
            <path d="m18 6-12 12" />
          </svg>
        </button>
      </header>

      <div className="harbor-widget__release-policy" aria-label="Release policy">
        <button
          aria-pressed={releasePolicy === "oldest"}
          className="harbor-widget__policy-button"
          onClick={() => onReleasePolicyChange("oldest")}
          type="button"
        >
          Release oldest first
        </button>
        <button
          aria-pressed={releasePolicy === "newest"}
          className="harbor-widget__policy-button"
          onClick={() => onReleasePolicyChange("newest")}
          type="button"
        >
          Release newest first
        </button>
      </div>

      <button
        className="pond-button pond-button--compact harbor-widget__release-next"
        disabled={heldCatches.length === 0}
        onClick={onReleaseNext}
        type="button"
      >
        Release one
      </button>

      <div className="harbor-widget__catch-list">
        {heldCatches.length === 0 ? (
          <p className="harbor-widget__catch-empty">No fish held yet.</p>
        ) : (
          heldCatches.map((heldCatch) => {
            const catchItem = heldCatch.catch;
            const artifact = heldCatch.artifact;
            const artifactAction = artifact ? getArtifactAction(artifact) : undefined;
            const isSelected = artifact && selectedArtifact?.id === artifact.id;

            return (
              <article
                className={`harbor-widget__catch-card${isSelected ? " is-selected" : ""}`}
                key={catchItem.id}
              >
                <div
                  className="harbor-widget__catch-swatch"
                  style={{ "--fish-accent": catchItem.accent } as CSSProperties}
                />
                <div className="harbor-widget__catch-copy">
                  <strong>{catchItem.displayName}</strong>
                  <span>{catchItem.points} points</span>
                  {artifact ? (
                    <span className="harbor-widget__artifact-title">{artifact.title}</span>
                  ) : (
                    <span>No artifact attached.</span>
                  )}
                  {artifact && artifactAction ? (
                    artifactAction.kind === "open" ? (
                      <a href={artifactAction.href}>{artifactAction.label}</a>
                    ) : (
                      <button
                        className="pond-link-button"
                        onClick={artifactAction.onClick}
                        type="button"
                      >
                        {artifactAction.label}
                      </button>
                    )
                  ) : null}
                </div>
                <button
                  aria-label={`Release ${catchItem.displayName}`}
                  className="harbor-widget__icon-button harbor-widget__release-catch"
                  onClick={() => onReleaseCatch(catchItem.id)}
                  type="button"
                >
                  <ReleaseIcon />
                </button>
              </article>
            );
          })
        )}
      </div>
    </aside>
  );
}
