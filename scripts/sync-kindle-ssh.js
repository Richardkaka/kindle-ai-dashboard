import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(fileURLToPath(new URL("..", import.meta.url)));
const sourcePath = join(rootDir, "output", "dashboard.png");
const host = process.env.KINDLE_HOST;
const user = process.env.KINDLE_USER ?? "root";
const port = process.env.KINDLE_PORT ?? "22";
const target = process.env.KINDLE_REMOTE_TARGET ?? "/mnt/us/documents/dashboard.png";
const identity = process.env.KINDLE_IDENTITY ?? "";

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

async function main() {
  if (!host) {
    throw new Error("KINDLE_HOST is required, for example: KINDLE_HOST=192.168.1.100 npm run sync:ssh");
  }

  const destination = `${user}@${host}:${target}`;
  const args = [
    "-P",
    port,
    "-o",
    "ConnectTimeout=10",
    "-o",
    "StrictHostKeyChecking=accept-new",
  ];
  if (identity) args.push("-i", identity);
  args.push(sourcePath, destination);

  await run("scp", args);
  console.log(`Copied ${sourcePath}`);
  console.log(`To     ${destination}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
