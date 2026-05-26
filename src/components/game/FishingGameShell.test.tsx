import { act, fireEvent, render, screen } from "@testing-library/react";
import manifest from "../../generated/pond-manifest.json";
import { AUTO_CATCH_MS, BITE_DELAY_MS, REEL_ANIMATION_MS } from "../../lib/pond/game";
import FishingGameShell from "./FishingGameShell";

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

    act(() => {
      vi.advanceTimersByTime(BITE_DELAY_MS + AUTO_CATCH_MS + REEL_ANIMATION_MS + 10);
    });

    expect(screen.getByText(/Rail 1\/6/)).toBeInTheDocument();
    expect(
      screen.getAllByText(/Lantern Koi|Library Carp|Oracle Eel|Clockwork Betta/).length,
    ).toBeGreaterThan(0);
  });

  it("allows the player to move along shoreline tiles", () => {
    render(<FishingGameShell manifest={manifest} />);

    fireEvent.click(screen.getByTestId("shore-3-10"));

    expect(screen.getByText(/Stand 3:10/)).toBeInTheDocument();
  });

  it("refuses water casts that are farther than six tiles away", () => {
    render(<FishingGameShell manifest={manifest} />);

    fireEvent.click(screen.getByTestId("tile-12-0"));

    act(() => {
      vi.advanceTimersByTime(BITE_DELAY_MS + AUTO_CATCH_MS + REEL_ANIMATION_MS + 10);
    });

    expect(
      screen.getByText(/That water is too far away. Move closer and cast within 6 squares./),
    ).toBeInTheDocument();
    expect(screen.getByText(/Rail 0\/6/)).toBeInTheDocument();
  });

  it("keeps fishing the same water tile until the player moves away", () => {
    render(<FishingGameShell manifest={manifest} />);

    fireEvent.click(screen.getByTestId("shore-3-10"));
    fireEvent.click(screen.getByTestId("tile-7-4"));

    act(() => {
      vi.advanceTimersByTime(BITE_DELAY_MS + AUTO_CATCH_MS + REEL_ANIMATION_MS + 10);
    });

    expect(screen.getByText(/Rail 1\/6/)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(BITE_DELAY_MS + AUTO_CATCH_MS + REEL_ANIMATION_MS + 10);
    });

    expect(screen.getByText(/Rail 2\/6/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("shore-2-9"));

    act(() => {
      vi.advanceTimersByTime(BITE_DELAY_MS + AUTO_CATCH_MS + REEL_ANIMATION_MS + 10);
    });

    expect(screen.getByText(/Stand 2:9/)).toBeInTheDocument();
    expect(screen.getByText(/Target none/)).toBeInTheDocument();
    expect(screen.getByText(/Rail 2\/6/)).toBeInTheDocument();
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

    act(() => {
      vi.advanceTimersByTime(BITE_DELAY_MS + AUTO_CATCH_MS + REEL_ANIMATION_MS + 10);
    });

    expect(screen.getByRole("link", { name: /Read artifact:/ })).toHaveAttribute(
      "href",
      "/plain/artifacts/dock-checklist/",
    );
  });

  it("can minimize and expand the catch rail without hiding the game status", () => {
    render(<FishingGameShell manifest={manifest} />);

    const rail = document.getElementById("catch-rail");

    expect(rail).not.toHaveAttribute("hidden");
    expect(screen.getByText(/Stand 3:10/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("toggle-hud"));

    expect(rail).toHaveAttribute("hidden");
    expect(screen.getByRole("button", { name: /Expand rail/i })).toBeInTheDocument();
    expect(screen.getByText(/Stand 3:10/)).toBeInTheDocument();
  });

  it("exports the visible scene canvas as a png", () => {
    const toDataUrlSpy = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL");
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    render(<FishingGameShell manifest={manifest} />);

    fireEvent.click(screen.getByTestId("export-scene"));

    expect(toDataUrlSpy).toHaveBeenCalledWith("image/png");
    expect(clickSpy).toHaveBeenCalled();
  });
});
