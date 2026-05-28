import type { CSSProperties } from "react";
import { MAX_CREEL_SIZE } from "../lib/pond/game";
import type { CatchInstance } from "../lib/pond/types";
import type { HarborArtifact } from "./HarborWidget.types";

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

interface CatchRailProps {
  creel: CatchInstance[];
  hidden?: boolean;
  selectedArtifact?: HarborArtifact;
  getArtifact: (artifactId?: string) => HarborArtifact | undefined;
  getArtifactAction: (artifact: HarborArtifact) => ArtifactAction;
  onThrowBack: (catchId: string) => void;
}

export default function CatchRail({
  creel,
  hidden = false,
  selectedArtifact,
  getArtifact,
  getArtifactAction,
  onThrowBack,
}: CatchRailProps) {
  return (
    <section
      className="harbor-widget__rail"
      aria-label="Caught fish"
      hidden={hidden}
      id="catch-rail"
    >
      {Array.from({ length: MAX_CREEL_SIZE }, (_, index) => {
        const catchItem = creel[index];

        if (!catchItem) {
          return (
            <article className="harbor-widget__rail-card harbor-widget__rail-card--empty" key={`empty-${index}`}>
              <strong>Slot {index + 1}</strong>
              <span>Nothing hooked yet.</span>
            </article>
          );
        }

        const artifact = getArtifact(catchItem.artifactId);
        const artifactAction = artifact ? getArtifactAction(artifact) : undefined;
        const isSelected = artifact && selectedArtifact?.id === artifact.id;

        return (
          <article
            className={`harbor-widget__rail-card${isSelected ? " is-selected" : ""}`}
            key={catchItem.id}
          >
            <div
              className="harbor-widget__rail-swatch"
              style={{ "--fish-accent": catchItem.accent } as CSSProperties}
            />
            <div className="harbor-widget__rail-copy">
              <strong>{catchItem.displayName}</strong>
              <span>{catchItem.points} points</span>
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
              ) : (
                <span>No artifact attached.</span>
              )}
            </div>
            <button
              className="pond-link-button"
              onClick={() => onThrowBack(catchItem.id)}
              type="button"
            >
              Throw back
            </button>
          </article>
        );
      })}
    </section>
  );
}
