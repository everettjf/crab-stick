import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createBridge } from "../src/server.js";
import { validateWav, resample24to16 } from "../src/audio.js";
function wav() {
  const b = Buffer.alloc(44 + 6400);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(6400, 40);
  return b;
}
const token = "a".repeat(64);
async function setup(
  demo = true,
  reply?: (signal: AbortSignal) => Promise<string>,
) {
  const server = createBridge(
    { token, dataDir: "/tmp/crab-test", saveRecordings: false, demo },
    {
      audio: {
        transcribe: async () => "明天三点取快递",
        speak: async () => Buffer.alloc(6400),
      },
      agent: async () => ({
        reply: async (_t, delta, signal) => {
          delta("好的");
          return reply ? reply(signal) : "好的，记下了。";
        },
        dispose() {},
      }),
    },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address() as { port: number };
  return { server, url: `http://127.0.0.1:${addr.port}` };
}
const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "audio/wav",
  "X-Device-ID": "crab-test",
};
test("WAV validation and resampling", () => {
  validateWav(wav());
  const b = wav();
  b.writeUInt32LE(44100, 24);
  assert.throws(() => validateWav(b));
  const pcm = Buffer.alloc(12);
  for (let i = 0; i < 6; i++) pcm.writeInt16LE(i * 100, i * 2);
  const out = resample24to16(pcm);
  assert.equal(out.length, 8);
  assert.equal(out.readInt16LE(2), 150);
});
test("authenticated demo is a complete transcript/text/PCM/done turn", async () => {
  const { server, url } = await setup();
  try {
    assert.equal((await fetch(url + "/health")).status, 401);
    const r = await fetch(url + "/v1/turn", {
      method: "POST",
      headers,
      body: wav(),
    });
    assert.equal(r.status, 200);
    const events = (await r.text())
      .trim()
      .split("\n")
      .map((x) => JSON.parse(x));
    assert.deepEqual(
      events.map((x) => x.type),
      [
        "accepted",
        "transcript",
        "text_delta",
        "reply",
        "audio",
        "audio",
        "audio",
        "done",
      ],
    );
    assert.equal(
      Buffer.concat(
        events
          .filter((x) => x.type === "audio")
          .map((x) => Buffer.from(x.pcm, "base64")),
      ).length,
      16000,
    );
  } finally {
    server.close();
    server.closeAllConnections();
  }
});
test("real pipeline preserves Chinese transcript and agent reply", async () => {
  const { server, url } = await setup(false);
  try {
    const r = await fetch(url + "/v1/turn", {
      method: "POST",
      headers,
      body: wav(),
    });
    const events = (await r.text())
      .trim()
      .split("\n")
      .map((x) => JSON.parse(x));
    assert.equal(
      events.find((x) => x.type === "transcript").text,
      "明天三点取快递",
    );
    assert.equal(events.find((x) => x.type === "reply").text, "好的，记下了。");
    assert.equal(events.at(-1).type, "done");
  } finally {
    server.close();
    server.closeAllConnections();
  }
});
test("invalid WAV rejected before transcription", async () => {
  const { server, url } = await setup();
  try {
    const r = await fetch(url + "/v1/turn", {
      method: "POST",
      headers,
      body: Buffer.from("bad"),
    });
    assert.equal(r.status, 400);
  } finally {
    server.close();
    server.closeAllConnections();
  }
});
test("cancellation reaches active agent; same device cannot overlap", async () => {
  const { server, url } = await setup(
    false,
    (signal) =>
      new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        }),
      ),
  );
  try {
    const first = await fetch(url + "/v1/turn", {
      method: "POST",
      headers,
      body: wav(),
    });
    const second = await fetch(url + "/v1/turn", {
      method: "POST",
      headers,
      body: wav(),
    });
    assert.equal(second.status, 409);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(
      (await fetch(url + "/v1/cancel", { method: "POST", headers })).status,
      204,
    );
    const events = (await first.text())
      .trim()
      .split("\n")
      .map((x) => JSON.parse(x));
    assert.equal(events.at(-1).type, "error");
  } finally {
    server.close();
    server.closeAllConnections();
  }
});
