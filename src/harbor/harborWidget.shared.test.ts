import { describe, expect, it } from "vitest";
import {
  buildEgretPerchCandidates,
  chooseEgretPerchCandidate,
  getEgretPerchPlayerBiasWeight,
} from "./harborWidget.shared";
import type { ShoreTile, Tile } from "../lib/pond/types";

describe("harbor widget shared helpers", () => {
  it("only gives egrets shoreline perches that share a side with water", () => {
    const shoreline: ShoreTile[] = [
      { row: 2, col: 2, terrain: "sand", castable: true },
      { row: 4, col: 4, terrain: "sand", castable: true },
    ];
    const waterTiles: Tile[] = [
      { row: 3, col: 3 },
      { row: 4, col: 5 },
    ];

    expect(buildEgretPerchCandidates(shoreline, waterTiles)).toEqual([
      {
        perchTile: shoreline[1],
        targetWaterTile: waterTiles[1],
        direction: 1,
      },
    ]);
  });

  it("never chooses the player's tile as an egret perch", () => {
    const playerTile: ShoreTile = { row: 4, col: 4, terrain: "grass", castable: true };
    const neighboringPerch: ShoreTile = { row: 4, col: 5, terrain: "grass", castable: true };
    const candidates = [
      {
        perchTile: playerTile,
        targetWaterTile: { row: 4, col: 3 },
        direction: -1 as const,
      },
      {
        perchTile: neighboringPerch,
        targetWaterTile: { row: 4, col: 6 },
        direction: 1 as const,
      },
    ];

    expect(chooseEgretPerchCandidate([candidates[0]], playerTile, () => 0)).toBeUndefined();
    expect(chooseEgretPerchCandidate(candidates, playerTile, () => 0)).toBe(candidates[1]);
  });

  it("weights egret perches near the player above distant perches", () => {
    const playerTile: ShoreTile = { row: 6, col: 6, terrain: "grass", castable: true };
    const nearbyPerch: ShoreTile = { row: 7, col: 8, terrain: "grass", castable: true };
    const distantPerch: ShoreTile = { row: 12, col: 13, terrain: "grass", castable: true };

    expect(getEgretPerchPlayerBiasWeight(nearbyPerch, playerTile)).toBeGreaterThan(
      getEgretPerchPlayerBiasWeight(distantPerch, playerTile),
    );
    expect(getEgretPerchPlayerBiasWeight(distantPerch, playerTile)).toBe(1);
  });
});
