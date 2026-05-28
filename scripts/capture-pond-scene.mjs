import { spawn } from "node:child_process";
import { readdirSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROUTE = "/widget-demo/";
const DEFAULT_PORT = 4173;
const DEFAULT_WIDTH = 1758;
const DEFAULT_HEIGHT = 1035;
const DEFAULT_OUTPUT = "tmp/pond-scene.png";
const DEFAULT_MOVE_SETTLE_MS = 1800;

const require = createRequire(import.meta.url);

function parseArgs(argv) {
  const options = {
    build: true,
    cast: undefined,
    castSettleMs: 2400,
    height: DEFAULT_HEIGHT,
    move: undefined,
    moveSettleMs: DEFAULT_MOVE_SETTLE_MS,
    out: DEFAULT_OUTPUT,
    port: DEFAULT_PORT,
    route: DEFAULT_ROUTE,
    width: DEFAULT_WIDTH,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--out") {
      options.out = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--route") {
      options.route = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--port") {
      options.port = Number.parseInt(argv[index + 1], 10);
      index += 1;
      continue;
    }

    if (value === "--width") {
      options.width = Number.parseInt(argv[index + 1], 10);
      index += 1;
      continue;
    }

    if (value === "--height") {
      options.height = Number.parseInt(argv[index + 1], 10);
      index += 1;
      continue;
    }

    if (value === "--move") {
      options.move = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--cast") {
      options.cast = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--cast-settle-ms") {
      options.castSettleMs = Number.parseInt(argv[index + 1], 10);
      index += 1;
      continue;
    }

    if (value === "--skip-build") {
      options.build = false;
    }

    if (value === "--move-settle-ms") {
      options.moveSettleMs = Number.parseInt(argv[index + 1], 10);
      index += 1;
    }
  }

  return options;
}

function runCommand(command, args, cwd) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
    });

    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

function sleep(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

async function waitForUrl(url, timeoutMs = 15000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: "text/html",
        },
      });

      if (response.ok) {
        return;
      }
    } catch {
      // keep polling until the preview server is ready
    }

    await sleep(250);
  }

  throw new Error(`Timed out waiting for preview server at ${url}`);
}

function stopServer(server) {
  if (!server || server.killed) {
    return Promise.resolve();
  }

  return new Promise((resolvePromise) => {
    const fallbackTimer = setTimeout(() => {
      if (!server.killed) {
        server.kill("SIGKILL");
      }
    }, 3000);

    server.once("exit", () => {
      clearTimeout(fallbackTimer);
      resolvePromise();
    });

    server.kill("SIGTERM");
  });
}

function findBundledPlaywrightPath() {
  const runtimeRoot = join(homedir(), ".cache", "codex-runtimes");

  if (!existsSync(runtimeRoot)) {
    return undefined;
  }

  const runtimeEntries = readdirSync(runtimeRoot);

  for (const entry of runtimeEntries) {
    const candidate = join(
      runtimeRoot,
      entry,
      "dependencies",
      "node",
      "node_modules",
      "playwright",
    );

    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function loadPlaywright() {
  try {
    return require("playwright");
  } catch {
    const bundledPath = findBundledPlaywrightPath();

    if (!bundledPath) {
      throw new Error(
        "Playwright is not available. Install it in the project or use the bundled Codex runtime.",
      );
    }

    return require(bundledPath);
  }
}

function parseTileCoordinate(input) {
  if (!input) {
    return undefined;
  }

  const match = /^(\d+):(\d+)$/.exec(input.trim());

  if (!match) {
    throw new Error(`Invalid tile coordinate "${input}". Use row:col, for example 6:11.`);
  }

  return {
    row: Number.parseInt(match[1], 10),
    col: Number.parseInt(match[2], 10),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cwd = dirname(fileURLToPath(import.meta.url));
  const projectRoot = resolve(cwd, "..");
  const outputPath = resolve(projectRoot, options.out);
  const outputDir = dirname(outputPath);
  const moveTarget = parseTileCoordinate(options.move);
  const castTarget = parseTileCoordinate(options.cast);
  const routePath = options.route.startsWith("/") ? options.route : `/${options.route}`;
  const baseUrl = `http://127.0.0.1:${options.port}`;
  const targetUrl = `${baseUrl}${routePath}`;

  mkdirSync(outputDir, { recursive: true });

  if (options.build) {
    await runCommand("npm", ["run", "build"], projectRoot);
  }

  const previewServer = spawn(
    "npm",
    ["run", "preview", "--", "--host", "127.0.0.1", "--port", String(options.port)],
    {
      cwd: projectRoot,
      stdio: "inherit",
    },
  );

  let browser;
  let page;

  try {
    await waitForUrl(baseUrl);

    const { chromium } = loadPlaywright();

    browser = await chromium.launch({
      headless: true,
    });
    page = await browser.newPage({
      deviceScaleFactor: 1,
      viewport: {
        width: options.width,
        height: options.height,
      },
    });

    await page.goto(targetUrl, { waitUntil: "networkidle" });
    await page.waitForSelector(".harbor-widget__scene canvas");
    await page.waitForTimeout(700);

    if (moveTarget) {
      await page.getByTestId(`shore-${moveTarget.row}-${moveTarget.col}`).click();
      await page.waitForTimeout(options.moveSettleMs);
    }

    if (castTarget) {
      await page.getByTestId(`tile-${castTarget.row}-${castTarget.col}`).click();
      await page.waitForTimeout(options.castSettleMs);
    }

    const scene = page.locator(".harbor-widget__scene");
    await scene.screenshot({
      path: outputPath,
      type: "png",
    });

    const box = await scene.boundingBox();
    console.log(
      JSON.stringify({
        outputPath,
        castTarget,
        moveTarget,
        route: routePath,
        sceneHeight: Math.round(box?.height ?? 0),
        sceneWidth: Math.round(box?.width ?? 0),
        viewportHeight: options.height,
        viewportWidth: options.width,
      }),
    );
  } finally {
    await page?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await stopServer(previewServer);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
