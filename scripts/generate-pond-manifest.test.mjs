import { buildManifest, normalizeArtifact } from "./generate-pond-manifest.mjs";

describe("generate-pond-manifest", () => {
  it("normalizes artifact frontmatter into a summary", () => {
    const artifact = normalizeArtifact("/tmp/lantern-note.md", {
      data: {
        title: "Lantern Note",
        summary: "Ship the shimmer.",
        type: "mini_post",
        authorName: "Josh",
        authorId: "humans/josh",
        pointsBonus: 4,
      },
    });

    expect(artifact.canonicalUrl).toBe("/artifacts/lantern-note/");
    expect(artifact.pointsBonus).toBe(4);
  });

  it("rejects unknown fish references in spawn tables", () => {
    expect(() =>
      buildManifest({
        pond: {
          id: "pond",
          name: "Pond",
          description: "desc",
          mask: ["1"],
          tile: { width: 10, height: 10 },
          origin: { x: 0, y: 0 },
        },
        fish: [],
        artifacts: [],
        spawnTables: [{ id: "default", entries: [{ fishId: "ghost-fish", weight: 1 }] }],
      }),
    ).toThrow(/ghost-fish/);
  });
});

