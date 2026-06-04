import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const label = process.env.LAUNCHD_LABEL ?? "com.local.kindle-ai-dashboard";
const plistPath = join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
const uid = process.getuid?.();
const domain = `gui/${uid}`;

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
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
  await run("launchctl", ["bootout", domain, plistPath]).catch(() => {});
  await rm(plistPath, { force: true });
  console.log(`Uninstalled ${label}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
