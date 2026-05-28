import { act, fireEvent, render, screen } from "@testing-library/react";
import manifest from "../generated/pond-manifest.json";
import HarborWidget from "./HarborWidget";
import type { HarborArtifact, HarborWidgetManifest } from "./HarborWidget.types";

function advanceUntil(assertion: () => void, totalMs = 30000, stepMs = 500) {
  let lastError: unknown;

  for (let elapsed = 0; elapsed <= totalMs; elapsed += stepMs) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      act(() => {
        vi.advanceTimersByTime(stepMs);
      });
    }
  }

  if (lastError) {
    throw lastError;
  }
}

function createForcedManifest<TArtifact>(artifacts: TArtifact[]): HarborWidgetManifest<TArtifact> {
  return {
    ...manifest,
    artifacts,
    fish: [
      {
        ...manifest.fish[0],
        artifactChance: artifacts.length > 0 ? 1 : 0,
      },
    ],
    spawnTables: [
      {
        id: "default",
        entries: [{ fishId: manifest.fish[0].id, weight: 1 }],
      },
    ],
  };
}

function fishOnce() {
  fireEvent.click(screen.getByTestId("shore-3-10"));
  fireEvent.click(screen.getByTestId("tile-7-4"));

  advanceUntil(() => {
    expect(screen.getByText(/Rail 1\/6/)).toBeInTheDocument();
  });
}

describe("HarborWidget", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs without Astro and emits catch and artifact selection callbacks", () => {
    const hostArtifacts: HarborArtifact[] = [
      {
        id: "host-field-note",
        title: "Host Field Note",
        summary: "This summary comes from the host application instead of Markdown content.",
        displayMode: "panel",
        payload: { source: "test-host" },
      },
    ];
    const onCatch = vi.fn();
    const onArtifactSelected = vi.fn();

    render(
      <HarborWidget
        manifest={createForcedManifest(hostArtifacts)}
        mode="embedded"
        onArtifactSelected={onArtifactSelected}
        onCatch={onCatch}
      />,
    );

    fishOnce();

    expect(onCatch).toHaveBeenCalledWith(
      expect.objectContaining({
        artifact: expect.objectContaining({ id: "host-field-note" }),
        kept: true,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /Show artifact: Host Field Note/i }));

    expect(onArtifactSelected).toHaveBeenCalledWith(
      expect.objectContaining({ id: "host-field-note" }),
    );
    expect(
      screen.getByText(/This summary comes from the host application instead of Markdown content./),
    ).toBeInTheDocument();
  });

  it("supports catches when the manifest has zero artifacts", () => {
    render(<HarborWidget manifest={createForcedManifest([])} mode="embedded" />);

    fishOnce();

    expect(screen.getByText(/No artifact attached./)).toBeInTheDocument();
  });

  it("can delegate artifact opening back to the host", () => {
    const hostArtifacts: HarborArtifact[] = [
      {
        id: "host-open-request",
        title: "Host Open Request",
        summary: "The host wants to intercept this artifact open action.",
        displayMode: "host",
      },
    ];
    const onRequestOpenArtifact = vi.fn();

    render(
      <HarborWidget
        manifest={createForcedManifest(hostArtifacts)}
        mode="embedded"
        onRequestOpenArtifact={onRequestOpenArtifact}
      />,
    );

    fishOnce();

    fireEvent.click(screen.getByRole("button", { name: /Open artifact: Host Open Request/i }));

    expect(onRequestOpenArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ id: "host-open-request" }),
    );
  });

  it("renders in embedded mode without depending on body-level layout classes", () => {
    document.body.className = "custom-host-layout";

    render(<HarborWidget manifest={createForcedManifest([])} mode="embedded" />);

    expect(document.body.className).toBe("custom-host-layout");
    expect(screen.getByLabelText("Pixel fishing prototype")).toHaveClass("harbor-widget--embedded");
  });
});
