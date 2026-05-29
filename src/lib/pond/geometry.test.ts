import { createHexPoints, getHexTileMetrics, projectTile } from "./geometry";

describe("pond geometry", () => {
  it("projects tiles onto a tightly packed isometric hex grid", () => {
    const tileSize = { width: 40, height: 20 };
    const origin = { x: 100, y: 50 };
    const first = projectTile({ row: 4, col: 6 }, tileSize, origin);
    const nextColumn = projectTile({ row: 4, col: 7 }, tileSize, origin);
    const nextRow = projectTile({ row: 5, col: 6 }, tileSize, origin);

    expect(nextColumn.x).toBeLessThan(first.x);
    expect(nextColumn.y).toBeGreaterThan(first.y);
    expect(nextRow.x).toBeGreaterThan(first.x);
    expect(nextRow.y).toBeGreaterThan(first.y);
  });

  it("creates six points for a hex tile", () => {
    const metrics = getHexTileMetrics({ width: 40, height: 20 });
    const points = createHexPoints(
      { row: 1, col: 2 },
      { width: 40, height: 20 },
      { x: 0, y: 0 },
    ).split(" ");

    expect(points).toHaveLength(6);
    expect(metrics.width).toBeGreaterThan(metrics.height);
  });
});
