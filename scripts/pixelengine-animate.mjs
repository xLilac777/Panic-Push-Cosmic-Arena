import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const API_BASE = "https://api.pixelengine.ai/functions/v1";
const apiKey = process.env.PIXEL_ENGINE_API_KEY;

if (!apiKey) {
  throw new Error("PIXEL_ENGINE_API_KEY is not set.");
}

const args = parseArgs(process.argv.slice(2));

if (!args.image || !args.prompt || !args.out) {
  printUsage();
  process.exit(1);
}

const imagePath = path.resolve(process.cwd(), args.image);
const outPath = path.resolve(process.cwd(), args.out);
const imageBuffer = await readFile(imagePath);
const imageBase64 = imageBuffer.toString("base64");
const imageDataUrl = `data:image/png;base64,${imageBase64}`;

const animateBody = {
  image: imageDataUrl,
  prompt: args.prompt,
  model: args.model || "pixel-engine-v1.1",
  output_frames: Number(args.frames || 6),
  output_format: args.format || "spritesheet",
  matte_color: args.matteColor || "#808080"
};

if (args.negativePrompt) animateBody.negative_prompt = args.negativePrompt;
if (args.seed) animateBody.seed = Number(args.seed);
if (args.colors) animateBody.pixel_config = { colors: Number(args.colors) };

const job = await requestJson(`${API_BASE}/animate`, {
  method: "POST",
  headers: authHeaders(),
  body: JSON.stringify(animateBody)
});

if (!job.api_job_id) {
  throw new Error(`Unexpected animate response: ${JSON.stringify(job)}`);
}

process.stdout.write(`Pixel Engine job queued: ${job.api_job_id}\n`);

const pollIntervalMs = Number(args.pollMs || 4000);
const timeoutMs = Number(args.timeoutMs || 180000);
const startedAt = Date.now();

let finalJob = null;
while (Date.now() - startedAt < timeoutMs) {
  await sleep(pollIntervalMs);
  const status = await requestJson(`${API_BASE}/jobs?id=${encodeURIComponent(job.api_job_id)}`, {
    headers: authHeaders()
  });
  process.stdout.write(`status=${status.status} progress=${status.progress ?? "n/a"}\n`);
  if (status.status === "success") {
    finalJob = status;
    break;
  }
  if (status.status === "failure" || status.status === "cancelled") {
    throw new Error(`Pixel Engine job failed: ${JSON.stringify(status.error || status)}`);
  }
}

if (!finalJob || !finalJob.output?.url) {
  throw new Error("Pixel Engine job timed out before completion.");
}

const outputResponse = await fetch(finalJob.output.url);
if (!outputResponse.ok) {
  throw new Error(`Failed to download output: ${outputResponse.status}`);
}

await mkdir(path.dirname(outPath), { recursive: true });
const outputBuffer = Buffer.from(await outputResponse.arrayBuffer());
await writeFile(outPath, outputBuffer);

process.stdout.write(`Saved Pixel Engine output to ${outPath}\n`);

function authHeaders() {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Request failed ${response.status}: ${text}`);
  }
  return response.json();
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      result[key] = true;
      continue;
    }
    result[key] = value;
    i += 1;
  }
  return result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  npm run pixelengine:animate -- --image public/assets/characters/player-variant-01.png --prompt \"floating idle, 6 frames\" --out output/pixelengine/player-idle.webp",
      "",
      "Optional flags:",
      "  --frames 6",
      "  --format spritesheet|webp|gif",
      "  --model pixel-engine-v1.1",
      "  --negativePrompt \"blurry, distorted\"",
      "  --colors 24",
      "  --seed 12345",
      "  --matteColor #808080",
      "  --pollMs 4000",
      "  --timeoutMs 180000"
    ].join("\n")
  );
}
