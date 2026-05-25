import manifest from "../../generated/pond-manifest.json";
import {
  canCast,
  createSeededRandom,
  moveTarget,
  pickFish,
  resolveCatch,
} from "./game";

describe("pond game helpers", () => {
  it("only allows casts on playable tiles", () => {
    expect(canCast({ row: 7, col: 4 }, manifest.pond.mask)).toBe(true);
    expect(canCast({ row: 0, col: 0 }, manifest.pond.mask)).toBe(false);
  });

  it("moves the selected tile in the requested direction", () => {
    expect(moveTarget(manifest.pond.mask, { row: 7, col: 2 }, "right")).toEqual({
      row: 7,
      col: 3,
    });
  });

  it("resolves a reproducible catch with a seeded random source", () => {
    const random = createSeededRandom("harbor-demo-seed");
    const catchResult = resolveCatch(manifest, { row: 7, col: 4 }, random, 1);

    expect(catchResult.displayName).toBe("Oracle Eel");
    expect(catchResult.points).toBeGreaterThan(0);
  });

  it("picks a fish from the weighted spawn table", () => {
    const fish = pickFish(manifest.fish, manifest.spawnTables[0].entries, () => 0.01);
    expect(fish.id).toBe("lantern-koi");
  });
});
