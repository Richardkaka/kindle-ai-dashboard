import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(fileURLToPath(new URL("..", import.meta.url)));
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

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: "inherit",
      env: process.env
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
  console.log(`[${timestamp()}] Rendering, syncing, and displaying over SSH...`);
  await run("npm", ["run", "push:ssh"]);
  console.log(`[${timestamp()}] SSH push complete.`);
}

async function main() {
  if (!process.env.KINDLE_HOST) {
    throw new Error("KINDLE_HOST is required, for example: KINDLE_HOST=192.168.1.100 npm run auto:ssh");
  }

  console.log(`Kindle SSH auto-sync started. Interval: ${intervalMinutes} minutes.`);
  console.log(`Target host: ${process.env.KINDLE_HOST}`);

  while (true) {
    try {
      await syncOnce();
    } catch (error) {
      console.error(`[${timestamp()}] ${error.message}`);
    }
    await wait(intervalMs);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
