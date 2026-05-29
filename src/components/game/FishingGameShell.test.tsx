import { act, fireEvent, render, screen } from "@testing-library/react";
import manifest from "../../generated/pond-manifest.json";
import FishingGameShell from "./FishingGameShell";

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

describe("FishingGameShell", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("moves on land clicks and auto-casts when nearby water is clicked", () => {
    render(<FishingGameShell manifest={manifest} />);

    fireEvent.click(screen.getByTestId("shore-3-10"));
    fireEvent.click(screen.getByTestId("tile-7-4"));

    advanceUntil(() => {
      expect(screen.getByTestId("creel-count")).toHaveTextContent("1/6");
    });

    fireEvent.click(screen.getByRole("button", { name: /Open catch overlay/i }));
    expect(screen.getAllByText(/Lantern Koi|Library Carp|Oracle Eel|Clockwork Betta/).length).toBeGreaterThan(0);
  });

  it("allows the player to move along shoreline tiles", () => {
    render(<FishingGameShell manifest={manifest} />);

    fireEvent.click(screen.getByTestId("shore-2-9"));

    expect(screen.getByText(/Walking to bank tile 2:9/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("tile-7-4"));
    expect(screen.getByText(/Let the fisher finish walking before you cast again/)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1200);
    });

    expect(screen.getByText(/Moved to bank tile 2:9/)).toBeInTheDocument();
  });

  it("refuses water casts that are farther than six tiles away", () => {
    render(<FishingGameShell manifest={manifest} />);

    fireEvent.click(screen.getByTestId("tile-12-0"));

    expect(screen.getByText(/That water is too far away/)).toBeInTheDocument();
    expect(screen.getByTestId("creel-count")).toHaveTextContent("0/6");
  });

  it("keeps fishing the same water tile until the player moves away", () => {
    render(<FishingGameShell manifest={manifest} />);

    fireEvent.click(screen.getByTestId("shore-3-10"));
    fireEvent.click(screen.getByTestId("tile-7-4"));

    advanceUntil(() => {
      expect(screen.getByTestId("creel-count")).toHaveTextContent("1/6");
    });

    advanceUntil(() => {
      expect(screen.getByTestId("creel-count")).toHaveTextContent("2/6");
    }, 40000);

    fireEvent.click(screen.getByTestId("shore-2-9"));

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.getByText(/Moved to bank tile 2:9/)).toBeInTheDocument();
    expect(screen.getByTestId("creel-count")).toHaveTextContent("2/6");
  });

  it("links caught artifacts to the plain reading pages", () => {
    const forcedManifest = {
      ...manifest,
      artifacts: [manifest.artifacts[0]],
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

    render(<FishingGameShell manifest={forcedManifest} />);

    fireEvent.click(screen.getByTestId("shore-3-10"));
    fireEvent.click(screen.getByTestId("tile-7-4"));

    advanceUntil(() => {
      expect(screen.getByTestId("creel-count")).toHaveTextContent("1/6");
    });
    fireEvent.click(screen.getByRole("button", { name: /Open catch overlay/i }));

    advanceUntil(() => {
      expect(screen.getByRole("link", { name: /Read artifact:/ })).toHaveAttribute(
        "href",
        "/plain/artifacts/dock-checklist/",
      );
    });
  });

  it("opens and closes the catch overlay without hiding the game status", () => {
    render(<FishingGameShell manifest={manifest} />);

    expect(screen.getByText(/Move across the left shoreline/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Open catch overlay/i }));
    expect(screen.getByTestId("catch-overlay")).toBeInTheDocument();
    expect(screen.getByText(/Move across the left shoreline/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Close catch overlay/i }));
    expect(screen.queryByTestId("catch-overlay")).not.toBeInTheDocument();
  });
});
