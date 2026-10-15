import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";

export type RuntimeSettings = {
  provider: string;
  model: string;
  sttModel: string;
  language: string;
  ttsEnabled: boolean;
  voice: string;
  rate: number;
};
export type ModelChoice = { provider: string; id: string; name: string };
export const sttModels = [
  "tiny",
  "base",
  "small",
  "medium",
  "large-v3",
  "large-v3-turbo",
];
export function validateSettings(value: unknown): RuntimeSettings {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("设置格式无效");
  const v = value as RuntimeSettings;
  const keys = [
    "provider",
    "model",
    "sttModel",
    "language",
    "ttsEnabled",
    "voice",
    "rate",
  ];
  if (
    Object.keys(v).some((k) => !keys.includes(k)) ||
    keys.some((k) => !(k in v))
  )
    throw new Error("设置字段无效");
  if (
    ![v.provider, v.model].every(
      (x) => typeof x === "string" && x.length <= 160 && !/[\x00-\x1f]/.test(x),
    ) ||
    !!v.provider !== !!v.model
  )
    throw new Error("请选择完整的模型与服务商");
  if (
    !sttModels.includes(v.sttModel) ||
    !["zh", "en", "ja", "ko", "de", "fr", "es"].includes(v.language)
  )
    throw new Error("识别模型或语言无效");
  if (
    typeof v.ttsEnabled !== "boolean" ||
    typeof v.voice !== "string" ||
    !/^[\p{L}\p{N} _.'()-]{1,120}$/u.test(v.voice) ||
    !Number.isInteger(v.rate) ||
    v.rate < 80 ||
    v.rate > 350
  )
    throw new Error("语音设置无效：语速应为 80–350");
  return {
    provider: v.provider,
    model: v.model,
    sttModel: v.sttModel,
    language: v.language,
    ttsEnabled: v.ttsEnabled,
    voice: v.voice,
    rate: v.rate,
  };
}
function commandOption(
  raw: string | undefined,
  name: string,
  fallback: string,
) {
  try {
    const args = JSON.parse(raw || "[]");
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : fallback;
  } catch {
    return fallback;
  }
}
export function defaultSettings(env: NodeJS.ProcessEnv): RuntimeSettings {
  return validateSettings({
    provider: env.PI_PROVIDER || "",
    model: env.PI_MODEL || "",
    sttModel: commandOption(env.STT_COMMAND, "--model", "small"),
    language: commandOption(
      env.STT_COMMAND,
      "--language",
      env.STT_LANGUAGE || "zh",
    ),
    ttsEnabled: true,
    voice: commandOption(
      env.TTS_COMMAND,
      "--voice",
      env.TTS_COMMAND ? "Tingting" : env.TTS_VOICE || "alloy",
    ),
    rate: Number(commandOption(env.TTS_COMMAND, "--rate", "210")),
  });
}
export class SettingsStore {
  constructor(
    public current: RuntimeSettings,
    private file?: string,
  ) {}
  static async load(file: string, defaults: RuntimeSettings) {
    try {
      return new SettingsStore(
        validateSettings(JSON.parse(await readFile(file, "utf8"))),
        file,
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      return new SettingsStore(defaults, file);
    }
  }
  async save(value: RuntimeSettings) {
    const next = validateSettings(value);
    if (this.file) {
      await mkdir(dirname(this.file), { recursive: true });
      const temp = this.file + ".tmp";
      await writeFile(temp, JSON.stringify(next, null, 2) + "\n", {
        mode: 0o600,
      });
      await rename(temp, this.file);
    }
    this.current = next;
  }
}
// The browser can tune the bundled adapter, never supply executable commands.
export function audioEnvironment(
  env: NodeJS.ProcessEnv,
  settings: RuntimeSettings,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {
    ...env,
    STT_LANGUAGE: settings.language,
    TTS_VOICE: settings.voice,
  };
  function patch(raw: string | undefined, options: Record<string, string>) {
    if (!raw) return raw;
    const args: string[] = JSON.parse(raw);
    if (!args.some((x) => /(?:^|\/)local_audio\.py$/.test(x))) return raw;
    for (const [flag, value] of Object.entries(options)) {
      const i = args.indexOf(flag);
      if (i >= 0) args[i + 1] = value;
      else args.push(flag, value);
    }
    return JSON.stringify(args);
  }
  result.STT_COMMAND = patch(env.STT_COMMAND, {
    "--model": settings.sttModel,
    "--language": settings.language,
  });
  result.TTS_COMMAND = patch(env.TTS_COMMAND, {
    "--voice": settings.voice,
    "--rate": String(settings.rate),
  });
  if (!settings.ttsEnabled) {
    delete result.TTS_COMMAND;
    delete result.TTS_URL;
  }
  return result;
}

export class Monitor {
  devices = new Map<string, Record<string, unknown>>();
  turns: {
    id: number;
    device: string;
    started: number;
    state: string;
    transcript: string;
    reply: string;
    timing?: object;
    error?: string;
  }[] = [];
  logs: { at: number; level: string; device: string; text: string }[] = [];
  listeners = new Set<() => void>();
  private sequence = 0;
  constructor(private secrets: string[] = []) {}
  clean(text: string) {
    for (const secret of this.secrets.filter(Boolean))
      text = text.split(secret).join("[redacted]");
    return text.replace(/sk-[\w-]+/g, "[redacted]").slice(0, 4000);
  }
  changed() {
    for (const listener of this.listeners) listener();
  }
  touch(id: string, fields: object = {}) {
    if (!this.devices.has(id) && this.devices.size >= 50)
      this.devices.delete(this.devices.keys().next().value!);
    this.devices.set(id, {
      ...this.devices.get(id),
      id,
      lastSeen: Date.now(),
      ...fields,
    });
    this.changed();
  }
  start(device: string) {
    const turn: Monitor["turns"][number] = {
      id: ++this.sequence,
      device,
      started: Date.now(),
      state: "upload",
      transcript: "",
      reply: "",
    };
    this.turns.push(turn);
    if (this.turns.length > 100) this.turns.shift();
    this.touch(device, { processing: true });
    return turn;
  }
  log(level: string, device: string, text: string) {
    this.logs.push({ at: Date.now(), level, device, text: this.clean(text) });
    if (this.logs.length > 200) this.logs.shift();
    this.changed();
  }
  snapshot() {
    return {
      devices: [...this.devices.values()],
      turns: this.turns,
      logs: this.logs,
      now: Date.now(),
    };
  }
}
