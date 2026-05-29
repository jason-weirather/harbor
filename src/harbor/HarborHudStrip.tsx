interface HarborHudStripProps {
  creelCapacity: number;
  creelCount: number;
  gameStateLabel: string;
  isCatchOverlayOpen: boolean;
  score: number;
  statusMessage: string;
  onOpenCatchOverlay: () => void;
}

function getCompactStatus(statusMessage: string) {
  const firstSentence = statusMessage.split(".")[0]?.trim() ?? statusMessage;

  if (firstSentence.length <= 86) {
    return firstSentence;
  }

  return `${firstSentence.slice(0, 83).trim()}...`;
}

function CreelIcon() {
  return (
    <svg aria-hidden="true" className="harbor-widget__hud-icon" viewBox="0 0 24 24">
      <path d="M6 10c1.5-3.5 4.2-5 7-5s5.3 1.6 6.6 5" />
      <path d="M4.5 10h15l-1.5 9h-12z" />
      <path d="M8 14h8" />
      <path d="M9 17h6" />
    </svg>
  );
}

export default function HarborHudStrip({
  creelCapacity,
  creelCount,
  gameStateLabel,
  isCatchOverlayOpen,
  score,
  statusMessage,
  onOpenCatchOverlay,
}: HarborHudStripProps) {
  return (
    <footer className="harbor-widget__hud" aria-label="Harbor status">
      <span className="harbor-widget__hud-state">{gameStateLabel}</span>
      <span className="harbor-widget__hud-message" aria-live="polite">
        {getCompactStatus(statusMessage)}
      </span>
      <span className="harbor-widget__hud-score">Score {score}</span>
      <button
        aria-label={isCatchOverlayOpen ? "Catch overlay open" : "Open catch overlay"}
        aria-pressed={isCatchOverlayOpen}
        className="harbor-widget__catch-button"
        data-testid="open-catch-overlay"
        onClick={onOpenCatchOverlay}
        type="button"
      >
        <CreelIcon />
        <span className="harbor-widget__catch-count" data-testid="creel-count">
          {creelCount}/{creelCapacity}
        </span>
      </button>
    </footer>
  );
}
