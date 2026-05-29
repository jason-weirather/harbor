import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import manifest from "../generated/pond-manifest.json";
import HarborWidget from "./HarborWidget";
import type {
  HarborArtifact,
  HarborWidgetHandle,
  HarborWidgetManifest,
  HarborWidgetState,
} from "./HarborWidget.types";

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

function startFishing() {
  fireEvent.click(screen.getByTestId("shore-3-10"));
  fireEvent.click(screen.getByTestId("tile-7-4"));
}

function fishUntilCount(count: number, capacity = 6, totalMs = 50000) {
  advanceUntil(() => {
    expect(screen.getByTestId("creel-count")).toHaveTextContent(`${count}/${capacity}`);
  }, totalMs);
}

function openCatchOverlay() {
  fireEvent.click(screen.getByRole("button", { name: /Open catch overlay/i }));
}

function getLatestState(onStateChange: ReturnType<typeof vi.fn>) {
  return onStateChange.mock.calls.at(-1)?.[0] as HarborWidgetState | undefined;
}

describe("HarborWidget", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("defaults maxCreelSize to 6", () => {
    const widgetRef = createRef<HarborWidgetHandle>();

    render(<HarborWidget ref={widgetRef} manifest={createForcedManifest([])} mode="embedded" />);

    expect(widgetRef.current?.getState().creelCapacity).toBe(6);
    expect(screen.getByTestId("creel-count")).toHaveTextContent("0/6");
  });

  it("accepts maxCreelSize and displays the configured capacity", () => {
    render(<HarborWidget manifest={createForcedManifest([])} maxCreelSize={2} mode="embedded" />);

    expect(screen.getByTestId("creel-count")).toHaveTextContent("0/2");

    startFishing();
    fishUntilCount(2, 2);
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

    startFishing();
    fishUntilCount(1);
    openCatchOverlay();

    expect(onCatch).toHaveBeenCalledWith(
      expect.objectContaining({
        artifact: expect.objectContaining({ id: "host-field-note" }),
        creelCapacity: 6,
        heldCatches: [expect.objectContaining({ artifact: expect.objectContaining({ id: "host-field-note" }) })],
        kept: true,
        releasePolicy: "newest",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /Show artifact: Host Field Note/i }));

    expect(onArtifactSelected).toHaveBeenCalledWith(
      expect.objectContaining({ id: "host-field-note", payload: { source: "test-host" } }),
    );
  });

  it("supports catches when the manifest has zero artifacts", () => {
    render(<HarborWidget manifest={createForcedManifest([])} mode="embedded" />);

    startFishing();
    fishUntilCount(1);
    openCatchOverlay();

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

    startFishing();
    fishUntilCount(1);
    openCatchOverlay();

    fireEvent.click(screen.getByRole("button", { name: /Open artifact: Host Open Request/i }));

    expect(onRequestOpenArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ id: "host-open-request" }),
    );
  });

  it("opens the catch overlay from the HUD icon", () => {
    render(<HarborWidget manifest={createForcedManifest([])} mode="embedded" />);

    openCatchOverlay();

    expect(screen.getByTestId("catch-overlay")).toBeInTheDocument();
    expect(screen.getByText("No fish held yet.")).toBeInTheDocument();
  });

  it("lists caught fish in the catch overlay", () => {
    render(<HarborWidget manifest={createForcedManifest([])} mode="embedded" />);

    startFishing();
    fishUntilCount(1);
    openCatchOverlay();

    expect(
      screen.getAllByText(/Lantern Koi|Library Carp|Oracle Eel|Clockwork Betta/).length,
    ).toBeGreaterThan(0);
  });

  it("individual release buttons remove the selected fish", () => {
    const widgetRef = createRef<HarborWidgetHandle>();

    render(<HarborWidget ref={widgetRef} manifest={createForcedManifest([])} mode="embedded" />);

    startFishing();
    fishUntilCount(1);
    openCatchOverlay();

    const heldCatch = widgetRef.current?.getHeldCatches()[0];
    expect(heldCatch).toBeDefined();

    fireEvent.click(screen.getByLabelText(`Release ${heldCatch?.catch.displayName}`));

    expect(screen.getByTestId("creel-count")).toHaveTextContent("0/6");
    expect(widgetRef.current?.getHeldCatches()).toHaveLength(0);
  });

  it("releasePolicy oldest removes the oldest held fish for quick release", () => {
    const widgetRef = createRef<HarborWidgetHandle>();

    render(<HarborWidget ref={widgetRef} manifest={createForcedManifest([])} mode="embedded" />);

    startFishing();
    fishUntilCount(2);
    openCatchOverlay();

    const before = widgetRef.current?.getHeldCatches().map((heldCatch) => heldCatch.catch.id) ?? [];
    fireEvent.click(screen.getByRole("button", { name: /Release oldest first/i }));
    fireEvent.click(screen.getByRole("button", { name: /Release one/i }));

    expect(widgetRef.current?.getHeldCatches().map((heldCatch) => heldCatch.catch.id)).toEqual([
      before[1],
    ]);
  });

  it("releasePolicy newest removes the newest held fish for quick release", () => {
    const widgetRef = createRef<HarborWidgetHandle>();

    render(<HarborWidget ref={widgetRef} manifest={createForcedManifest([])} mode="embedded" />);

    startFishing();
    fishUntilCount(2);
    openCatchOverlay();

    const before = widgetRef.current?.getHeldCatches().map((heldCatch) => heldCatch.catch.id) ?? [];
    fireEvent.click(screen.getByRole("button", { name: /Release newest first/i }));
    fireEvent.click(screen.getByRole("button", { name: /Release one/i }));

    expect(widgetRef.current?.getHeldCatches().map((heldCatch) => heldCatch.catch.id)).toEqual([
      before[0],
    ]);
  });

  it("when full, newest preserves old behavior and releases the incoming catch", () => {
    const widgetRef = createRef<HarborWidgetHandle>();
    const onCatch = vi.fn();

    render(
      <HarborWidget
        ref={widgetRef}
        manifest={createForcedManifest([])}
        maxCreelSize={1}
        mode="embedded"
        onCatch={onCatch}
      />,
    );

    startFishing();
    advanceUntil(() => expect(onCatch).toHaveBeenCalledTimes(1), 50000);
    const before = widgetRef.current?.getHeldCatches().map((heldCatch) => heldCatch.catch.id) ?? [];

    advanceUntil(() => expect(onCatch).toHaveBeenCalledTimes(2), 50000);

    const overflowEvent = onCatch.mock.calls[1][0];
    expect(overflowEvent.kept).toBe(false);
    expect(overflowEvent.releasedCatch?.id).toBe(overflowEvent.catch.id);
    expect(widgetRef.current?.getHeldCatches().map((heldCatch) => heldCatch.catch.id)).toEqual(before);
  });

  it("when full, oldest releases the oldest held catch and keeps the incoming catch", () => {
    const widgetRef = createRef<HarborWidgetHandle>();
    const onCatch = vi.fn();

    render(
      <HarborWidget
        ref={widgetRef}
        manifest={createForcedManifest([])}
        maxCreelSize={1}
        mode="embedded"
        onCatch={onCatch}
      />,
    );

    act(() => {
      widgetRef.current?.setReleasePolicy("oldest");
    });
    startFishing();
    advanceUntil(() => expect(onCatch).toHaveBeenCalledTimes(1), 50000);
    const before = widgetRef.current?.getHeldCatches().map((heldCatch) => heldCatch.catch.id) ?? [];

    advanceUntil(() => expect(onCatch).toHaveBeenCalledTimes(2), 50000);

    const overflowEvent = onCatch.mock.calls[1][0];
    expect(overflowEvent.kept).toBe(true);
    expect(overflowEvent.releasedCatch?.id).toBe(before[0]);
    expect(widgetRef.current?.getHeldCatches().map((heldCatch) => heldCatch.catch.id)).toEqual([
      overflowEvent.catch.id,
    ]);
  });

  it("onStateChange includes heldCatches with resolved artifact objects", () => {
    const hostArtifacts: HarborArtifact[] = [
      {
        id: "host-state-artifact",
        title: "Host State Artifact",
        summary: "The state payload should include this artifact.",
        displayMode: "panel",
      },
    ];
    const onStateChange = vi.fn();

    render(
      <HarborWidget
        manifest={createForcedManifest(hostArtifacts)}
        mode="embedded"
        onStateChange={onStateChange}
      />,
    );

    startFishing();
    advanceUntil(() => {
      expect(getLatestState(onStateChange)?.heldCatches).toHaveLength(1);
    });

    expect(getLatestState(onStateChange)).toEqual(
      expect.objectContaining({
        creelCapacity: 6,
        heldCatches: [
          expect.objectContaining({
            artifact: expect.objectContaining({ id: "host-state-artifact" }),
            heldIndex: 0,
            isNewest: true,
            isOldest: true,
          }),
        ],
        isCatchOverlayOpen: false,
        releasePolicy: "newest",
      }),
    );
  });

  it("renders in embedded mode without depending on body-level layout classes", () => {
    document.body.className = "custom-host-layout";

    render(<HarborWidget manifest={createForcedManifest([])} mode="embedded" />);

    expect(document.body.className).toBe("custom-host-layout");
    expect(screen.getByLabelText("Pixel fishing prototype")).toHaveClass("harbor-widget--embedded");
  });
});
