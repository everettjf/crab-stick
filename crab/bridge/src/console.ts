import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import {
  SettingsStore,
  Monitor,
  validateSettings,
  type ModelChoice,
} from "./control.js";

export async function jsonBody(
  req: IncomingMessage,
  limit = 8192,
): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("请求内容过大");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
export function json(res: ServerResponse, value: unknown, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
}
const assets: Record<string, [string, string]> = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/i18n.js": ["i18n.js", "text/javascript; charset=utf-8"],
  "/console.js": ["console.js", "text/javascript; charset=utf-8"],
  "/console.css": ["console.css", "text/css; charset=utf-8"],
};
export async function consoleAsset(req: IncomingMessage, res: ServerResponse) {
  const asset = req.method === "GET" && assets[req.url || ""];
  if (!asset) return false;
  res.writeHead(200, {
    "Content-Type": asset[1],
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  res.end(await readFile(new URL(`../web/${asset[0]}`, import.meta.url)));
  return true;
}
export function consoleRoutes(
  store: SettingsStore,
  monitor: Monitor,
  models: () => Promise<ModelChoice[]>,
  apply: (next: unknown) => Promise<void>,
  info: object,
) {
  const streams = new Set<ServerResponse>();
  const snapshot = () => ({
    ...monitor.snapshot(),
    settings: store.current,
    ...info,
  });
  return {
    close() {
      for (const stream of streams) stream.end();
    },
    async handle(req: IncomingMessage, res: ServerResponse) {
      if (!req.url?.startsWith("/api/")) return false;
      try {
        if (req.method === "GET" && req.url === "/api/state")
          json(res, snapshot());
        else if (req.method === "GET" && req.url === "/api/models")
          json(res, await models());
        else if (req.method === "PUT" && req.url === "/api/settings") {
          await apply(validateSettings(await jsonBody(req)));
          monitor.log(
            "info",
            "bridge",
            "设置已保存，将用于下一轮对话；模型切换会清空对话上下文",
          );
          json(res, store.current);
        } else if (req.method === "GET" && req.url === "/api/events") {
          if (streams.size >= 8) {
            json(res, { error: "控制台连接数已满" }, 503);
            return true;
          }
          streams.add(res);
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",
          });
          const send = () => {
            if (res.destroyed || res.writableLength > 1024 * 1024) {
              res.destroy();
              return;
            }
            res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
          };
          monitor.listeners.add(send);
          const timer = setInterval(send, 10000);
          res.on("close", () => {
            clearInterval(timer);
            monitor.listeners.delete(send);
            streams.delete(res);
          });
          send();
        } else json(res, { error: "接口不存在" }, 404);
      } catch (e) {
        const text = e instanceof Error ? e.message : "控制台请求失败";
        monitor.log("error", "bridge", text);
        if (!res.headersSent)
          json(
            res,
            { error: monitor.clean(text) },
            text.includes("处理中") ? 409 : 400,
          );
        else res.end();
      }
      return true;
    },
  };
}
