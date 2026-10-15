import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { parseMacVoices, resolveVoiceName } from "../src/voices.js";
import { createBridge } from "../src/server.js";
import {
  SettingsStore,
  defaultSettings,
  validateSettings,
} from "../src/control.js";

test("macOS voice catalog supports spaces, accents, full names, deduplication and unique legacy aliases", () => {
  const voices = parseMacVoices(
    "Bad News en_US # Hello\nAmélie fr_CA # Bonjour\nTingting (Chinese (China mainland)) zh_CN # 你好\nTingting (Chinese (China mainland)) zh_CN # 你好\nnot a voice\n",
  );
  assert.equal(voices.length, 3);
  assert.equal(
    resolveVoiceName(voices, "Tingting"),
    "Tingting (Chinese (China mainland))",
  );
  assert.equal(resolveVoiceName(voices, "Bad News"), "Bad News");
  assert.equal(resolveVoiceName(voices, "Missing"), undefined);
  assert.equal(
    resolveVoiceName(
      [
        { name: "Eddy (English)", language: "en_US" },
        { name: "Eddy (Chinese)", language: "zh_CN" },
      ],
      "Eddy",
    ),
    undefined,
  );
  assert.doesNotThrow(() =>
    validateSettings({
      ...defaultSettings({}),
      voice: "Tingting (Chinese (China mainland))",
    }),
  );
});
test("voice endpoint is authenticated and unavailable local voices cannot be saved", async () => {
  const token = "voice-test-" + "a".repeat(40),
    settings = new SettingsStore(defaultSettings({}));
  const server = createBridge(
    {
      token,
      dataDir: "/tmp/crab-voice-test",
      demo: true,
      saveRecordings: false,
      settings,
    },
    {
      audio: { transcribe: async () => "你好", speak: async () => null },
      agent: async () => {
        throw new Error("unused");
      },
      voices: async () => [
        { name: "Tingting (Chinese (China mainland))", language: "zh_CN" },
      ],
    },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  try {
    assert.equal((await fetch(url + "/api/voices")).status, 401);
    assert.deepEqual(
      await (await fetch(url + "/api/voices", { headers })).json(),
      [{ name: "Tingting (Chinese (China mainland))", language: "zh_CN" }],
    );
    const save = (voice: string, ttsEnabled = true) =>
      fetch(url + "/api/settings", {
        method: "PUT",
        headers,
        body: JSON.stringify({ ...settings.current, voice, ttsEnabled }),
      });
    assert.equal((await save("Made up voice")).status, 400);
    assert.equal((await save("Tingting")).status, 200);
    assert.equal(settings.current.voice, "Tingting (Chinese (China mainland))");
    assert.equal((await save("Unavailable", false)).status, 200);
  } finally {
    server.close();
    server.closeAllConnections();
  }
});
