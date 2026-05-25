import { act, fireEvent, render, screen } from "@testing-library/react";
import manifest from "../../generated/pond-manifest.json";
import { BITE_DELAY_MS } from "../../lib/pond/game";
import PondApp from "./PondApp";

describe("PondApp", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(globalThis.navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs a cast, bite, reel, and keep flow", () => {
    render(<PondApp manifest={manifest} variant="room" />);

    fireEvent.click(screen.getByTestId("tile-7-4"));
    fireEvent.click(screen.getByRole("button", { name: "Cast" }));

    act(() => {
      vi.advanceTimersByTime(BITE_DELAY_MS + 10);
    });

    fireEvent.click(screen.getByRole("button", { name: "Reel in" }));

    expect(screen.getByText("On the line")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Keep fish" }));

    expect(screen.getByText(/Creel 1\/6/)).toBeInTheDocument();
    expect(
      screen.getAllByText(/Lantern Koi|Library Carp|Oracle Eel|Clockwork Betta/).length,
    ).toBeGreaterThan(0);
  });

  it("can open and share an artifact after a catch", async () => {
    render(<PondApp manifest={manifest} variant="room" />);

    fireEvent.click(screen.getByTestId("tile-7-4"));
    fireEvent.click(screen.getByRole("button", { name: "Cast" }));

    act(() => {
      vi.advanceTimersByTime(BITE_DELAY_MS + 10);
    });

    fireEvent.click(screen.getByRole("button", { name: "Reel in" }));
    fireEvent.click(screen.getByRole("button", { name: "View artifact" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share" }));
    });

    expect(screen.getByText(/Copied \//)).toBeInTheDocument();
  });
});
