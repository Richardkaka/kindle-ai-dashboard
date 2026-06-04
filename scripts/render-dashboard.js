import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(fileURLToPath(new URL("..", import.meta.url)));
const outputPath = join(rootDir, "output", "dashboard.png");
const dashboardUrl = process.env.DASHBOARD_URL ?? "http://127.0.0.1:8787/d";
const viewport = "758,1024";

function withCacheBust(url) {
  const parsed = new URL(url);
  parsed.searchParams.set("t", String(Date.now()));
  return parsed.toString();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function canOpenDashboard() {
  try {
    const response = await fetch(dashboardUrl, { signal: AbortSignal.timeout(5000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForDashboard() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20000) {
    if (await canOpenDashboard()) return;
    await wait(500);
  }
  throw new Error(`Dashboard did not become ready: ${dashboardUrl}`);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: "inherit",
      ...options
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function main() {
  let serverProcess = null;

  if (!(await canOpenDashboard())) {
    console.log("Dashboard server is not running; starting a temporary server...");
    serverProcess = spawn("node", ["src/server.js"], {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "pipe"]
    });
    serverProcess.stdout.on("data", (data) => process.stdout.write(data));
    serverProcess.stderr.on("data", (data) => process.stderr.write(data));
    await waitForDashboard();
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await run("npx", [
    "--yes",
    "playwright",
    "screenshot",
    "--browser=chromium",
    `--viewport-size=${viewport}`,
    "--wait-for-selector=.screen",
    "--wait-for-timeout=1000",
    "--timeout=30000",
    withCacheBust(dashboardUrl),
    outputPath
  ]);

  await run("python3", ["scripts/postprocess-dashboard.py"]);

  console.log(`Rendered ${outputPath}`);

  if (serverProcess) {
    serverProcess.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
