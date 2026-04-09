import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  throw new Error("OPENAI_API_KEY is not set.");
}

const outputDir = path.resolve(process.cwd(), "public", "assets", "audio", "voice");

const clips = [
  {
    file: "countdown-3.wav",
    input: "Three.",
    instructions: "Original female sci-fi arena announcer voice with energetic idol-like stage energy. Bright, sparkling, upbeat, playful, cute, and polished. Youthful pop performance feel with clean articulation and confident rhythm. Short one-beat callout. Not an imitation of any existing character."
  },
  {
    file: "countdown-2.wav",
    input: "Two.",
    instructions: "Original female sci-fi arena announcer voice with energetic idol-like stage energy. Bright, sparkling, upbeat, playful, cute, and polished. Youthful pop performance feel with clean articulation and confident rhythm. Short one-beat callout. Not an imitation of any existing character."
  },
  {
    file: "countdown-1.wav",
    input: "One.",
    instructions: "Original female sci-fi arena announcer voice with energetic idol-like stage energy. Bright, sparkling, upbeat, playful, cute, and polished. Youthful pop performance feel with clean articulation and confident rhythm. Short one-beat callout. Not an imitation of any existing character."
  },
  {
    file: "round-start.wav",
    input: "Fight!",
    instructions: "Original female battle announcer voice with energetic idol-like stage energy. Bright, sparkling, punchy, exciting, and polished. Cute pop-performance confidence with sharp delivery, like a futuristic tournament host. Short and crisp. Not an imitation of any existing character."
  },
  {
    file: "victory.wav",
    input: "Victory!",
    instructions: "Original female sci-fi announcer voice with energetic idol-like stage energy. Sparkling, triumphant, upbeat, cute, and polished. A celebratory pop-show finish with confident sweetness and crisp clarity. Short and satisfying. Not an imitation of any existing character."
  }
];

await mkdir(outputDir, { recursive: true });

for (const clip of clips) {
  process.stdout.write(`Generating ${clip.file}...\n`);
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: "shimmer",
      response_format: "wav",
      input: clip.input,
      instructions: clip.instructions
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to generate ${clip.file}: ${response.status} ${errorText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(path.join(outputDir, clip.file), buffer);
}

process.stdout.write(`Saved ${clips.length} voice clips to ${outputDir}\n`);
