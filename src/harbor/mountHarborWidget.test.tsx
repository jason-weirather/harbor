import { act, fireEvent, within } from "@testing-library/react";
import manifest from "../generated/pond-manifest.json";
import { mountHarborWidget } from "./mountHarborWidget";
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

describe("mountHarborWidget", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("mounts into a plain DOM container and exposes widget controls", () => {
    const forcedManifest: HarborWidgetManifest = {
      ...manifest,
      artifacts: [],
      fish: [
        {
          ...manifest.fish[0],
          artifactChance: 1,
        },
      ],
      spawnTables: [
        {
          id: "default",
          entries: [{ fishId: manifest.fish[0].id, weight: 1 }],
        },
      ],
    };
    const container = document.createElement("div");
    document.body.append(container);
    let controller!: ReturnType<typeof mountHarborWidget>;
    act(() => {
      controller = mountHarborWidget(container, {
        manifest: forcedManifest,
        title: "Mounted Harbor",
        mode: "embedded",
      });
    });
    const hostArtifacts: HarborArtifact[] = [
      {
        id: "mounted-host-artifact",
        title: "Mounted Host Artifact",
        summary: "Mounted widgets can swap in host-provided artifacts after render.",
        displayMode: "panel",
      },
    ];

    act(() => {
      controller.setArtifacts(hostArtifacts);
    });

    const ui = within(container);

    fireEvent.click(ui.getByTestId("shore-3-10"));
    fireEvent.click(ui.getByTestId("tile-7-4"));

    advanceUntil(() => {
      expect(ui.getByTestId("creel-count")).toHaveTextContent("1/6");
    });

    expect(controller.getHeldCatches()).toEqual([
      expect.objectContaining({
        artifact: expect.objectContaining({ id: "mounted-host-artifact" }),
        heldIndex: 0,
      }),
    ]);

    fireEvent.click(ui.getByRole("button", { name: /Open catch overlay/i }));
    fireEvent.click(ui.getByRole("button", { name: /Show artifact: Mounted Host Artifact/i }));

    expect(controller.getState()).toEqual(
      expect.objectContaining({
        title: "Mounted Harbor",
        selectedArtifact: expect.objectContaining({ id: "mounted-host-artifact" }),
      }),
    );

    act(() => {
      controller.clearCreel();
    });

    expect(controller.getState().creel).toHaveLength(0);
    expect(controller.getHeldCatches()).toHaveLength(0);

    act(() => {
      controller.destroy();
    });

    expect(container.innerHTML).toBe("");
  });
});
