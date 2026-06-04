import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(fileURLToPath(new URL("..", import.meta.url)));
const kindleVolume = process.env.KINDLE_VOLUME ?? "/Volumes/Kindle";
const intervalMinutes = Number(process.env.SYNC_INTERVAL_MINUTES ?? 30);
const intervalMs = Math.max(1, intervalMinutes) * 60 * 1000;

function timestamp() {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date());
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function kindleIsMounted() {
  try {
    await stat(kindleVolume);
    return true;
  } catch {
    return false;
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: "inherit"
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

async function syncOnce() {
  if (!(await kindleIsMounted())) {
    console.log(`[${timestamp()}] Kindle not mounted at ${kindleVolume}; skipped.`);
    return;
  }

  console.log(`[${timestamp()}] Kindle mounted; rendering and syncing...`);
  await run("npm", ["run", "sync"]);
  console.log(`[${timestamp()}] Sync complete.`);
}

async function main() {
  console.log(`Kindle auto-sync started. Interval: ${intervalMinutes} minutes.`);
  console.log(`Watching volume: ${kindleVolume}`);

  while (true) {
    try {
      await syncOnce();
    } catch (error) {
      console.error(`[${timestamp()}] ${error.message}`);
    }
    await wait(intervalMs);
  }
}

main();
