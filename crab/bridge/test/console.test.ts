import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBridge } from "../src/server.js";
import {
  SettingsStore,
  defaultSettings,
  audioEnvironment,
  Monitor,
} from "../src/control.js";
const token = "console-test-" + "a".repeat(40);
const defaults = defaultSettings({ PI_PROVIDER: "local", PI_MODEL: "first" });
const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};
function wav() {
  const b = Buffer.alloc(6444);
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
async function setup(failure = false, wait?: Promise<void>) {
  let disposed = 0,
    spoken = 0;
  const selected: string[] = [],
    speech: number[] = [];
  const store = new SettingsStore({ ...defaults });
  const server = createBridge(
    {
      token,
      dataDir: "/tmp/crab-console-tests",
      demo: false,
      saveRecordings: false,
      settings: store,
      secrets: ["private-key-value"],
    },
    {
      audio: { transcribe: async () => "你好", speak: async () => null },
      audioFor: (s) => ({
        transcribe: async () => "你好",
        speak: async () => {
          spoken++;
          speech.push(s.rate);
          return null;
        },
      }),
      models: async () =>
        ["first", "second"].map((id) => ({ provider: "local", id, name: id })),
      agent: async (_id, s) => {
        selected.push(s.model);
        return {
          dispose() {
            disposed++;
          },
          reply: async (_text, delta) => {
            delta("<script>安全文字</script>");
            if (wait) await wait;
            if (failure)
              throw new Error(`private-key-value ${token} sk-fake123`);
            return "你好，小螃蟹";
          },
        };
      },
    },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    server,
    url,
    store,
    selected,
    speech,
    counters: () => ({ disposed, spoken }),
    close() {
      server.close();
      server.closeAllConnections();
    },
  };
}
async function turn(url: string) {
  const r = await fetch(url + "/v1/turn", {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "audio/wav",
      "X-Device-ID": "crab-test",
    },
    body: wav(),
  });
  return r.text();
}
test("console assets are public; state/settings/events require auth and reject foreign origins", async () => {
  const a = await setup();
  try {
    const page = await fetch(a.url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Live conversations/);
    assert.match(
      page.headers.get("content-security-policy")!,
      /frame-ancestors 'none'/,
    );
    for (const path of ["/api/state", "/api/events", "/api/models"])
      assert.equal((await fetch(a.url + path)).status, 401);
    assert.equal(
      (
        await fetch(a.url + "/api/settings", {
          method: "PUT",
          headers: { ...headers, Origin: "https://foreign.invalid" },
          body: JSON.stringify(defaults),
        })
      ).status,
      403,
    );
    const state = await (await fetch(a.url + "/api/state", { headers })).json();
    assert.equal(state.settings.model, "first");
    assert.ok(!JSON.stringify(state).includes(token));
  } finally {
    a.close();
  }
});
test("heartbeat and live SSE show deltas and sanitized errors without audio payloads", async () => {
  const a = await setup(true),
    abort = new AbortController();
  try {
    const live = await fetch(a.url + "/api/events", {
        headers,
        signal: abort.signal,
      }),
      reader = live.body!.getReader();
    assert.match(
      Buffer.from((await reader.read()).value!).toString(),
      /data: /,
    );
    const status = await fetch(a.url + "/v1/status", {
      method: "POST",
      headers: { ...headers, "X-Device-ID": "crab-test" },
      body: JSON.stringify({
        battery: 72,
        usb: true,
        mode: 1,
        uptime_ms: 1000,
        free_internal: 50000,
      }),
    });
    assert.equal(status.status, 204);
    await turn(a.url);
    let text = "";
    while (!text.includes("安全文字"))
      text += Buffer.from((await reader.read()).value!).toString();
    const state = await (await fetch(a.url + "/api/state", { headers })).json();
    assert.equal(state.devices[0].battery, 72);
    assert.ok(state.devices[0].heartbeatAt);
    assert.equal(state.devices[0].processing, false);
    assert.equal(state.turns[0].transcript, "你好");
    assert.equal(state.turns[0].state, "error");
    assert.equal(state.logs.at(-1).level, "error");
    for (const secret of [token, "private-key-value", "sk-fake123", '"pcm"'])
      assert.ok(!JSON.stringify(state).includes(secret));
    abort.abort();
    await reader.cancel().catch(() => {});
  } finally {
    abort.abort();
    a.close();
  }
});
test("model switching clears context; speech settings apply next turn and invalid changes are rejected", async () => {
  const a = await setup();
  const save = (v: object) =>
    fetch(a.url + "/api/settings", {
      method: "PUT",
      headers,
      body: JSON.stringify(v),
    });
  try {
    await turn(a.url);
    assert.deepEqual(a.selected, ["first"]);
    for (const v of [
      { ...defaults, model: "missing" },
      { ...defaults, rate: 999 },
      { ...defaults, TTS_COMMAND: ["sh"] },
    ])
      assert.equal((await save(v)).status, 400);
    assert.equal(
      (
        await save({
          ...defaults,
          model: "second",
          rate: 250,
          ttsEnabled: false,
        })
      ).status,
      200,
    );
    assert.equal(a.counters().disposed, 1);
    await turn(a.url);
    assert.deepEqual(a.selected, ["first", "second"]);
    assert.equal(a.counters().spoken, 1);
    assert.equal(
      (await save({ ...defaults, model: "second", rate: 260 })).status,
      200,
    );
    await turn(a.url);
    assert.deepEqual(a.speech, [210, 260]);
    assert.equal(a.counters().disposed, 1);
  } finally {
    a.close();
  }
});
test("settings are blocked while a device is processing", async () => {
  let release!: () => void;
  const waiting = new Promise<void>((r) => (release = r)),
    a = await setup(false, waiting);
  try {
    const response = await fetch(a.url + "/v1/turn", {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "audio/wav",
        "X-Device-ID": "crab-test",
      },
      body: wav(),
    });
    assert.equal(
      (
        await fetch(a.url + "/api/settings", {
          method: "PUT",
          headers,
          body: JSON.stringify(defaults),
        })
      ).status,
      409,
    );
    release();
    await response.text();
  } finally {
    release();
    a.close();
  }
});
test("settings persist privately; speech tuning preserves command executables", async () => {
  const dir = await mkdtemp(join(tmpdir(), "crab-settings-")),
    file = join(dir, "settings.json");
  try {
    const store = await SettingsStore.load(file, defaults);
    await store.save({ ...defaults, rate: 250 });
    assert.equal((await SettingsStore.load(file, defaults)).current.rate, 250);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.doesNotMatch(await readFile(file, "utf8"), /TOKEN|KEY/);
    const env = {
        STT_COMMAND:
          '["python","/repo/local_audio.py","stt","{input}","--model","small"]',
        TTS_COMMAND:
          '["python","/repo/local_audio.py","tts","{text}","{output}"]',
      },
      next = audioEnvironment(env, {
        ...defaults,
        sttModel: "base",
        rate: 250,
      });
    assert.deepEqual(JSON.parse(next.STT_COMMAND!).slice(0, 4), [
      "python",
      "/repo/local_audio.py",
      "stt",
      "{input}",
    ]);
    assert.ok(JSON.parse(next.STT_COMMAND!).includes("base"));
    assert.ok(JSON.parse(next.TTS_COMMAND!).includes("250"));
    assert.equal(
      audioEnvironment({ TTS_COMMAND: '["my-command"]' }, defaults).TTS_COMMAND,
      '["my-command"]',
    );
    assert.equal(
      audioEnvironment(env, { ...defaults, ttsEnabled: false }).TTS_COMMAND,
      undefined,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("monitor retains bounded device, turn and log history", () => {
  const m = new Monitor();
  for (let i = 0; i < 210; i++) {
    m.start(`device-${i}`);
    m.log("error", "test", "x");
  }
  assert.equal(m.devices.size, 50);
  assert.equal(m.turns.length, 100);
  assert.equal(m.logs.length, 200);
});
