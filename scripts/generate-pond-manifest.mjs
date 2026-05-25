import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import YAML from "yaml";

const ARTIFACT_TYPES = new Set([
  "mini_post",
  "response",
  "comment",
  "external_link",
  "quote",
  "demo_note",
]);

async function readYaml(filePath) {
  const source = await fs.readFile(filePath, "utf8");
  return YAML.parse(source);
}

async function walkMarkdown(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const nextPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return walkMarkdown(nextPath);
      }

      if (entry.isFile() && entry.name.endsWith(".md")) {
        return [nextPath];
      }

      return [];
    }),
  );

  return files.flat();
}

export function normalizeArtifact(filePath, parsed) {
  const id = path.basename(filePath, ".md");
  const { data } = parsed;

  if (!data.title || !data.summary || !data.type || !data.authorName || !data.authorId) {
    throw new Error(`Artifact ${id} is missing a required field.`);
  }

  if (!ARTIFACT_TYPES.has(data.type)) {
    throw new Error(`Artifact ${id} has unsupported type "${data.type}".`);
  }

  return {
    id,
    slug: id,
    title: data.title,
    type: data.type,
    authorId: data.authorId,
    authorName: data.authorName,
    canonicalUrl: `/artifacts/${id}/`,
    summary: data.summary,
    pointsBonus: data.pointsBonus ?? 0,
    disclosure: data.disclosure,
    external: Boolean(data.external),
  };
}

export async function loadArtifactSummaries(artifactDirectory) {
  const files = await walkMarkdown(artifactDirectory);
  const artifacts = [];

  for (const filePath of files) {
    const source = await fs.readFile(filePath, "utf8");
    const parsed = matter(source);

    if (parsed.data.published === false || parsed.data.pondEligible === false) {
      continue;
    }

    artifacts.push(normalizeArtifact(filePath, parsed));
  }

  return artifacts.sort((left, right) => left.title.localeCompare(right.title));
}

export function buildManifest({ pond, fish, spawnTables, artifacts }) {
  const fishIds = new Set(fish.map((entry) => entry.id));

  for (const table of spawnTables) {
    for (const entry of table.entries) {
      if (!fishIds.has(entry.fishId)) {
        throw new Error(`Spawn table ${table.id} references unknown fish ${entry.fishId}.`);
      }
    }
  }

  return {
    pond: {
      id: pond.id,
      name: pond.name,
      description: pond.description,
      mask: pond.mask,
      tile: pond.tile,
      origin: pond.origin,
    },
    fish,
    artifacts,
    spawnTables,
    generatedAt: new Date().toISOString(),
  };
}

export async function generateManifest(rootDir = process.cwd()) {
  const pondPath = path.join(rootDir, "content/toys/pond/pond-v1.yaml");
  const fishPath = path.join(rootDir, "content/toys/pond/fish.yaml");
  const spawnPath = path.join(rootDir, "content/toys/pond/spawn-tables.yaml");
  const artifactsPath = path.join(rootDir, "src/content/artifacts");

  const [pond, fish, spawnTables, artifacts] = await Promise.all([
    readYaml(pondPath),
    readYaml(fishPath),
    readYaml(spawnPath),
    loadArtifactSummaries(artifactsPath),
  ]);

  const manifest = buildManifest({ pond, fish, spawnTables, artifacts });
  const output = `${JSON.stringify(manifest, null, 2)}\n`;
  const publicPath = path.join(rootDir, "public/pond/manifest.json");
  const generatedPath = path.join(rootDir, "src/generated/pond-manifest.json");

  await fs.mkdir(path.dirname(publicPath), { recursive: true });
  await fs.mkdir(path.dirname(generatedPath), { recursive: true });
  await fs.writeFile(publicPath, output, "utf8");
  await fs.writeFile(generatedPath, output, "utf8");

  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  generateManifest().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

