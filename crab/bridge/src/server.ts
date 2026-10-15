import {
  createServer,
  type ServerResponse,
  type IncomingMessage,
} from "node:http";
import { timingSafeEqual } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AudioServices, MAX_WAV_BYTES, validateWav } from "./audio.js";
import type { Agent } from "./pi.js";

export type BridgeConfig = {
  token: string;
  dataDir: string;
  saveRecordings: boolean;
  demo: boolean;
};
export type Services = {
  audio: Pick<AudioServices, "transcribe" | "speak">;
  agent: (id: string) => Promise<Agent>;
};
function displayError(error: unknown): string {
  const message = error instanceof Error ? error.message : "对话失败，请重试";
  if (/No speech recognized/i.test(message))
    return "没有听清，请靠近麦克风再说一次";
  if (/\b(401|403)\b/.test(message))
    return "模型或语音服务认证失败，请检查电脑端配置";
  return message.replace(/sk-[a-zA-Z0-9_-]+/g, "[redacted]").slice(0, 500);
}

export function createBridge(config: BridgeConfig, services: Services) {
  if (!/^[\x21-\x7e]{32,128}$/.test(config.token))
    throw new Error(
      "CRAB_TOKEN must contain 32–128 printable ASCII characters",
    );
  const active = new Map<string, AbortController>();
  const agents = new Map<string, Promise<Agent>>();
  const lastUsed = new Map<string, number>();
  function auth(req: IncomingMessage) {
    const got = Buffer.from(req.headers.authorization || "");
    const want = Buffer.from(`Bearer ${config.token}`);
    return got.length === want.length && timingSafeEqual(got, want);
  }
  async function event(res: ServerResponse, value: object) {
    if (res.destroyed) throw new Error("Device disconnected");
    if (!res.write(JSON.stringify(value) + "\n")) {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          res.off("drain", drain);
          res.off("close", close);
          res.off("error", error);
        };
        const drain = () => {
          cleanup();
          resolve();
        };
        const close = () => {
          cleanup();
          reject(new Error("Device disconnected"));
        };
        const error = (e: Error) => {
          cleanup();
          reject(e);
        };
        res.once("drain", drain);
        res.once("close", close);
        res.once("error", error);
      });
    }
  }
  const server = createServer(async (req, res) => {
    if (!auth(req)) {
      res.writeHead(401);
      res.end("Unauthorized");
      return;
    }
    if (req.method === "GET" && req.url === "/health") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, demo: config.demo }));
      return;
    }
    const id = req.headers["x-device-id"];
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
      res.writeHead(400);
      res.end("Invalid device ID");
      return;
    }
    if (req.method === "POST" && req.url === "/v1/cancel") {
      active.get(id)?.abort();
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === "POST" && req.url === "/v1/reset") {
      if (active.has(id)) {
        res.writeHead(409);
        res.end("Device busy");
        return;
      }
      const old = agents.get(id);
      agents.delete(id);
      lastUsed.delete(id);
      if (old) await old.then((a) => a.dispose()).catch(() => {});
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method !== "POST" || req.url !== "/v1/turn") {
      res.writeHead(404);
      res.end();
      return;
    }
    if (active.has(id)) {
      res.writeHead(409);
      res.end("Device busy");
      return;
    }
    if (req.headers["content-type"] !== "audio/wav") {
      res.writeHead(415);
      res.end("Expected audio/wav");
      return;
    }
    if (active.size >= 4) {
      res.writeHead(503);
      res.end("Bridge busy");
      return;
    }
    const controller = new AbortController();
    active.set(id, controller);
    const timeout = setTimeout(
      () => controller.abort(new Error("Turn timed out")),
      120000,
    );
    res.on("close", () => {
      if (!res.writableFinished) controller.abort();
    });
    const startedAt = performance.now();
    const timing: Record<string, number> = {};
    try {
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of req) {
        controller.signal.throwIfAborted();
        total += chunk.length;
        if (total > MAX_WAV_BYTES) {
          res.writeHead(413);
          res.end("Recording exceeds 20 seconds");
          return;
        }
        chunks.push(chunk);
      }
      const wav = Buffer.concat(chunks);
      validateWav(wav);
      if (config.saveRecordings) {
        await mkdir(join(config.dataDir, "recordings"), { recursive: true });
        await writeFile(
          join(config.dataDir, "recordings", `${id}-${Date.now()}.wav`),
          wav,
          { mode: 0o600 },
        );
      }
      res.writeHead(200, {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
      });
      await event(res, { type: "accepted" });
      const transcript = config.demo
        ? "你好，小螃蟹。"
        : await services.audio.transcribe(wav, controller.signal);
      if (!transcript.trim()) throw new Error("No speech recognized");
      timing.stt_ms = Math.round(performance.now() - startedAt);
      await event(res, { type: "transcript", text: transcript });
      let answer: string;
      if (config.demo) {
        answer = "我是小螃蟹！设备连接、字幕和音频链路正常。";
        await event(res, { type: "text_delta", text: answer });
      } else {
        // Bound idle sessions to avoid unbounded memory use from device IDs.
        for (const [key, used] of lastUsed)
          if (!active.has(key) && Date.now() - used > 30 * 60 * 1000) {
            const old = agents.get(key);
            agents.delete(key);
            lastUsed.delete(key);
            if (old) (await old).dispose();
          }
        if (!agents.has(id)) {
          if (agents.size >= 16)
            throw new Error("Too many sessions; reset an idle device");
          agents.set(id, services.agent(id));
        }
        const promise = agents.get(id)!;
        let agent: Agent;
        try {
          agent = await promise;
        } catch (e) {
          agents.delete(id);
          throw e;
        }
        let streamedChars = 0;
        answer = await agent.reply(
          transcript,
          (text) => {
            const remaining = Math.max(0, 1000 - streamedChars);
            text = [...text].slice(0, remaining).join("");
            streamedChars += [...text].length;
            if (!text) return;
            // Pi callback is synchronous. Small text deltas are bounded by the 4 KiB answer budget.
            if (res.writableLength > 65536)
              controller.abort(new Error("Device is not consuming replies"));
            if (!controller.signal.aborted && !res.destroyed)
              res.write(JSON.stringify({ type: "text_delta", text }) + "\n");
          },
          controller.signal,
        );
        lastUsed.set(id, Date.now());
      }
      timing.reply_ms = Math.round(performance.now() - startedAt);
      answer = [...answer].slice(0, 1000).join("");
      await event(res, { type: "reply", text: answer });
      let pcm: Buffer | null;
      if (config.demo) {
        pcm = Buffer.alloc(16000);
        for (let i = 0; i < 8000; i++)
          pcm.writeInt16LE(
            Math.round(Math.sin((i * 2 * Math.PI * 440) / 16000) * 1200),
            i * 2,
          );
      } else {
        try {
          pcm = await services.audio.speak(answer, controller.signal);
        } catch (e) {
          controller.signal.throwIfAborted();
          pcm = null;
          await event(res, {
            type: "warning",
            text: "TTS unavailable; text reply only",
          });
        }
      }
      timing.tts_ms = Math.round(performance.now() - startedAt);
      if (pcm)
        for (let at = 0; at < pcm.length; at += 6400) {
          controller.signal.throwIfAborted();
          await event(res, {
            type: "audio",
            rate: 16000,
            pcm: pcm.subarray(at, at + 6400).toString("base64"),
          });
        }
      timing.total_ms = Math.round(performance.now() - startedAt);
      console.info(
        JSON.stringify({
          device: id,
          ...timing,
          audio_ms: pcm ? Math.round(pcm.length / 32) : 0,
        }),
      );
      await event(res, { type: "done" });
      res.end();
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(400);
        res.end(e instanceof Error ? e.message : "Invalid request");
      } else if (!res.destroyed) {
        res.write(
          JSON.stringify({
            type: "error",
            text: controller.signal.aborted
              ? "已取消或处理超时，请重试"
              : displayError(e),
          }) + "\n",
        );
        res.end();
      }
    } finally {
      clearTimeout(timeout);
      active.delete(id);
    }
  });
  server.headersTimeout = 15000;
  server.requestTimeout = 30000;
  server.on("close", () => {
    for (const c of active.values()) c.abort();
    for (const a of agents.values())
      void a.then((x) => x.dispose()).catch(() => {});
  });
  return server;
}
