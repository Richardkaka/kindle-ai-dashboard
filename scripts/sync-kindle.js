import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(fileURLToPath(new URL("..", import.meta.url)));
const sourcePath = join(rootDir, "output", "dashboard.png");
const kindleVolume = process.env.KINDLE_VOLUME ?? "/Volumes/Kindle";
const targetPath =
  process.env.KINDLE_TARGET ?? join(kindleVolume, "documents", "dashboard.png");

async function assertFile(path, label) {
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error(`${label} is not a file: ${path}`);
  } catch {
    throw new Error(`${label} not found: ${path}`);
  }
}

async function main() {
  await assertFile(sourcePath, "Dashboard image");
  await stat(kindleVolume);
  await mkdir(dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
  console.log(`Copied ${sourcePath}`);
  console.log(`To     ${targetPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
