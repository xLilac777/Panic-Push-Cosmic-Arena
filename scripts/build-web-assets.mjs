import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function copyVendorAsset(from, to) {
  await ensureDir(path.dirname(to));
  await fs.copyFile(from, to);
}

async function writeRuntimeConfig() {
  const serverUrl = (process.env.PANIC_SERVER_URL || "").trim();
  const isVercelBuild = process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);
  if (isVercelBuild && !serverUrl) {
    throw new Error("PANIC_SERVER_URL is required for Vercel builds.");
  }
  const file = path.join(root, "public", "runtime-config.js");
  const contents = `window.PanicRuntime = ${JSON.stringify({ serverUrl })};\n`;
  await fs.writeFile(file, contents, "utf8");
}

async function main() {
  await copyVendorAsset(
    path.join(root, "node_modules", "phaser", "dist", "phaser.min.js"),
    path.join(root, "public", "vendor", "phaser", "phaser.min.js")
  );

  await copyVendorAsset(
    path.join(root, "node_modules", "socket.io", "client-dist", "socket.io.min.js"),
    path.join(root, "public", "vendor", "socket.io", "socket.io.min.js")
  );

  await writeRuntimeConfig();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
