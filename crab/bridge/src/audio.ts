import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const MAX_WAV_BYTES = 44 + 16000 * 2 * 20;
export function validateWav(b: Buffer): void {
  if (
    b.length < 44 ||
    b.length > MAX_WAV_BYTES ||
    b.toString("ascii", 0, 4) !== "RIFF" ||
    b.toString("ascii", 8, 12) !== "WAVE" ||
    b.toString("ascii", 12, 16) !== "fmt " ||
    b.readUInt32LE(16) !== 16 ||
    b.readUInt16LE(20) !== 1 ||
    b.readUInt16LE(22) !== 1 ||
    b.readUInt32LE(24) !== 16000 ||
    b.readUInt32LE(28) !== 32000 ||
    b.readUInt16LE(32) !== 2 ||
    b.readUInt16LE(34) !== 16 ||
    b.toString("ascii", 36, 40) !== "data" ||
    b.readUInt32LE(40) !== b.length - 44 ||
    b.readUInt32LE(4) !== b.length - 8 ||
    (b.length - 44) % 2 !== 0
  )
    throw new Error(
      "Expected canonical 16 kHz mono PCM16 WAV, at most 20 seconds",
    );
  if (b.length < 44 + 3200) throw new Error("Recording is too short");
}
export function resample24to16(b: Buffer): Buffer {
  if (b.length % 2) throw new Error("Invalid PCM length");
  const count = Math.floor(((b.length / 2) * 2) / 3);
  const out = Buffer.alloc(count * 2);
  for (let i = 0; i < count; i++) {
    const x = i * 1.5,
      at = Math.floor(x),
      f = x - at;
    const a = b.readInt16LE(at * 2),
      next = Math.min(at + 1, b.length / 2 - 1);
    out.writeInt16LE(
      Math.round(a * (1 - f) + b.readInt16LE(next * 2) * f),
      i * 2,
    );
  }
  return out;
}
function argv(raw: string, values: Record<string, string>): string[] {
  const a: unknown = JSON.parse(raw);
  if (
    !Array.isArray(a) ||
    a.length === 0 ||
    !a.every((x) => typeof x === "string")
  )
    throw new Error("Audio command must be a nonempty JSON argv array");
  return a.map((x) =>
    x.replace(/\{(input|output|text)\}/g, (_, key) => values[key] ?? ""),
  );
}
async function command(
  raw: string,
  values: Record<string, string>,
  signal: AbortSignal,
): Promise<string> {
  const [exe, ...args] = argv(raw, values);
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      signal,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "",
      error = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.length > 65536) child.kill();
    });
    child.stderr.on("data", (chunk) => {
      error = (error + chunk).slice(-4096);
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(output.trim())
        : reject(new Error(`Audio command failed (${code}): ${error}`)),
    );
  });
}
export class AudioServices {
  constructor(private env: NodeJS.ProcessEnv) {}
  async transcribe(wav: Buffer, signal: AbortSignal): Promise<string> {
    if (this.env.STT_COMMAND) {
      const dir = await mkdtemp(join(tmpdir(), "crab-stt-"));
      try {
        const input = join(dir, "recording.wav");
        await writeFile(input, wav);
        return await command(this.env.STT_COMMAND, { input }, signal);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
    if (!this.env.STT_URL) throw new Error("Configure STT_URL or STT_COMMAND");
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(wav)], { type: "audio/wav" }),
      "recording.wav",
    );
    form.append("model", this.env.STT_MODEL || "whisper-1");
    form.append("language", this.env.STT_LANGUAGE || "zh");
    const r = await fetch(this.env.STT_URL, {
      method: "POST",
      headers: this.env.STT_KEY
        ? { Authorization: `Bearer ${this.env.STT_KEY}` }
        : {},
      body: form,
      signal,
    });
    if (!r.ok) throw new Error(`STT HTTP ${r.status}`);
    const result = (await r.json()) as { text?: unknown };
    if (typeof result.text !== "string" || !result.text.trim())
      throw new Error("No speech recognized");
    return result.text.trim();
  }
  async speak(text: string, signal: AbortSignal): Promise<Buffer | null> {
    if (this.env.TTS_COMMAND) {
      const dir = await mkdtemp(join(tmpdir(), "crab-tts-"));
      try {
        const output = join(dir, "speech.pcm");
        await command(this.env.TTS_COMMAND, { output, text }, signal);
        const pcm = await readFile(output);
        if (pcm.length % 2 || pcm.length > 16000 * 2 * 60)
          throw new Error("TTS PCM exceeds 60 seconds or has invalid length");
        return pcm;
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
    if (!this.env.TTS_URL) return null;
    const r = await fetch(this.env.TTS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.env.TTS_KEY
          ? { Authorization: `Bearer ${this.env.TTS_KEY}` }
          : {}),
      },
      body: JSON.stringify({
        model: this.env.TTS_MODEL || "tts-1",
        voice: this.env.TTS_VOICE || "alloy",
        input: text,
        response_format: "pcm",
      }),
      signal,
    });
    if (!r.ok) throw new Error(`TTS HTTP ${r.status}`);
    const b = Buffer.from(await r.arrayBuffer());
    if (b.length > 24000 * 2 * 60)
      throw new Error("TTS response exceeds 60 seconds");
    return resample24to16(b);
  }
}
