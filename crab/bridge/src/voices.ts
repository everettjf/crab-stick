import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
export type VoiceChoice = { name: string; language: string };
export function parseMacVoices(output: string): VoiceChoice[] {
  const voices = new Map<string, VoiceChoice>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^(.+?)\s+([a-z]{2,3}_[A-Za-z0-9_-]+)\s+#/.exec(line);
    if (match)
      voices.set(match[1].trim(), {
        name: match[1].trim(),
        language: match[2],
      });
  }
  return [...voices.values()].sort(
    (a, b) =>
      a.language.localeCompare(b.language) || a.name.localeCompare(b.name),
  );
}
export async function listMacVoices(): Promise<VoiceChoice[]> {
  if (process.platform !== "darwin") return [];
  const { stdout } = await run("/usr/bin/say", ["-v", "?"], {
    timeout: 5000,
    maxBuffer: 256 * 1024,
  });
  return parseMacVoices(stdout);
}

export function resolveVoiceName(
  voices: VoiceChoice[],
  name: string,
): string | undefined {
  if (voices.some((v) => v.name === name)) return name;
  // macOS accepts legacy short names such as Tingting. Expand only unique aliases.
  const matches = voices.filter((v) => v.name.split(" (")[0] === name);
  return matches.length === 1 ? matches[0].name : undefined;
}
