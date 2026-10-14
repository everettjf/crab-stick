import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { AudioServices } from "./audio.js";
import { createPiAgent } from "./pi.js";
import { createBridge } from "./server.js";

const env = process.env;
const dataDir = resolve("data");
await mkdir(resolve(dataDir, "workspace"), { recursive: true });
const demo = env.CRAB_DEMO === "true";
if (!demo && !env.STT_URL && !env.STT_COMMAND)
  throw new Error(
    "Configure STT_URL/STT_COMMAND or set CRAB_DEMO=true for transport testing",
  );
const server = createBridge(
  {
    token: env.CRAB_TOKEN || "",
    dataDir,
    saveRecordings: env.CRAB_SAVE_RECORDINGS === "true",
    demo,
  },
  {
    audio: new AudioServices(env),
    agent: () => createPiAgent(resolve(dataDir, "workspace"), env),
  },
);
const port = Number(env.CRAB_PORT || 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid CRAB_PORT");
server.listen(port, env.CRAB_HOST || "127.0.0.1", () =>
  console.log(
    `Crab bridge listening on ${env.CRAB_HOST || "127.0.0.1"}:${port}${demo ? " (demo)" : ""}`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    server.close();
    server.closeAllConnections();
  });
