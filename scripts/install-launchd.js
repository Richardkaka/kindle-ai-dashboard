import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = join(fileURLToPath(new URL("..", import.meta.url)));
const label = process.env.LAUNCHD_LABEL ?? "com.local.kindle-ai-dashboard";
const plistPath = join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
const logsDir = join(rootDir, "logs");
const npmPath = process.env.NPM_PATH ?? "/opt/homebrew/bin/npm";
const kindleHost = process.env.KINDLE_HOST;
const kindlePort = process.env.KINDLE_PORT ?? "2222";
const intervalMinutes = process.env.SYNC_INTERVAL_MINUTES ?? "30";
const uid = process.getuid?.();
const domain = `gui/${uid}`;

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
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

function plist() {
  const env = {
    KINDLE_HOST: kindleHost,
    KINDLE_PORT: kindlePort,
    KINDLE_USER: "root",
    SYNC_INTERVAL_MINUTES: intervalMinutes,
    PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  };

  const envXml = Object.entries(env)
    .map(
      ([key, value]) => `
        <key>${xmlEscape(key)}</key>
        <string>${xmlEscape(value)}</string>`
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>

  <key>WorkingDirectory</key>
  <string>${xmlEscape(rootDir)}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(npmPath)}</string>
    <string>run</string>
    <string>auto:ssh</string>
  </array>

  <key>EnvironmentVariables</key>
  <dict>${envXml}
  </dict>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>${xmlEscape(join(logsDir, "launchd.out.log"))}</string>

  <key>StandardErrorPath</key>
  <string>${xmlEscape(join(logsDir, "launchd.err.log"))}</string>
</dict>
</plist>
`;
}

async function main() {
  if (!kindleHost) {
    throw new Error("KINDLE_HOST is required, for example: KINDLE_HOST=192.168.1.100 npm run service:install");
  }

  await mkdir(dirname(plistPath), { recursive: true });
  await mkdir(logsDir, { recursive: true });
  await writeFile(plistPath, plist(), "utf8");

  await run("launchctl", ["bootout", domain, plistPath]).catch(() => {});
  await run("launchctl", ["bootstrap", domain, plistPath]);
  await run("launchctl", ["kickstart", "-k", `${domain}/${label}`]);

  console.log(`Installed ${label}`);
  console.log(`Plist: ${plistPath}`);
  console.log(`Logs:  ${logsDir}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
