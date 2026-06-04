import { spawn } from "node:child_process";

const host = process.env.KINDLE_HOST;
const user = process.env.KINDLE_USER ?? "root";
const port = process.env.KINDLE_PORT ?? "22";
const target = process.env.KINDLE_REMOTE_TARGET ?? "/mnt/us/documents/dashboard.png";
const identity = process.env.KINDLE_IDENTITY ?? "";

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
  if (!host) {
    throw new Error("KINDLE_HOST is required, for example: KINDLE_HOST=192.168.1.100 npm run display:ssh");
  }

  const args = [
    "-p",
    port,
    "-o",
    "ConnectTimeout=10",
    "-o",
    "StrictHostKeyChecking=accept-new"
  ];
  if (identity) args.push("-i", identity);
  args.push(`${user}@${host}`, `eips -c && eips -g '${target}' -w gc16 -f`);

  await run("ssh", args);
  console.log(`Displayed ${target} on ${user}@${host}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
