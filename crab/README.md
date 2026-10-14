# Crab 🦀 — independent StickS3 + Pi companion

[中文操作步骤：你需要做什么](QUICKSTART.zh-CN.md)

This folder contains a standalone StickS3 firmware, a TypeScript computer bridge powered by Pi, and an original animated crab. It does not need the Muse app, Muse account, SDK token, or Muse subscription. The existing `esp32/` and `linux/` applications are unchanged.

```text
StickS3 (16 kHz WAV) → computer bridge → Chinese STT → Pi session
StickS3 (captions + 16 kHz PCM) ← computer bridge ← text + optional TTS
```

## Current verification

- ESP-IDF 6.0.1 StickS3 build passes; application 2.12 MiB, 70% partition space free.
- Bridge TypeScript compilation and tests pass, including real Pi SDK against a local test model server, continuous conversation, no enabled tools, Chinese transcript, PCM transport, invalid input, authentication, and cancellation.
- All eight avatar animations compile and run under address/undefined-behavior sanitizers; GIF previews can be regenerated.
- macOS Chinese TTS produces correct 16 kHz mono PCM on this computer.
- Physical recording, speaker, USB configuration, battery behavior and Wi-Fi reconnection have **not** been tested on a connected StickS3 yet. Local faster-whisper recognized synthesized “你好，我是小螃蟹” as “你好 我是小螃蟹”. Real microphone accuracy and model-provider latency still need physical/provider testing.

## Layout

- `bridge/`: Node.js/TypeScript server, pinned Pi dependency, audio adapters and tests.
- `firmware/`: standalone ESP-IDF application; reuses the parent repository's board, audio, state and Chinese font source files, without linking its cloud transport or default avatar.
- `avatar/crab_pixel.c`: procedural 64×64 character, displayed at 128×128.
- `tools/`: USB configuration, backup/restore, local audio commands, protocol smoke test.

## 1. Start the computer bridge

Requires Node.js >=22.19. From `crab/bridge`:

```sh
npm ci --ignore-scripts
npm run build
npm test
cp -n .env.example .env
```

Set `CRAB_TOKEN` to a random secret with 32–128 ASCII characters. Generate one with:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Use `CRAB_HOST=0.0.0.0` for access from the StickS3 on your home Wi-Fi. The default binds only to localhost. Set `CRAB_DEMO=true` first; it returns a fixed Chinese transcript/reply and a quiet half-second tone, without invoking STT, Pi or TTS:

```sh
npm run dev
```

`tools/smoke.py` sends a test WAV and validates the reply. Pass the same token through the `CRAB_TOKEN` environment variable; do not paste it into a shared transcript.

```sh
python3 ../tools/smoke.py
```

Demo mode tests transport, **not** speech recognition or intelligence.

## 2. Configure Pi and real audio

For real conversation set `CRAB_DEMO=false`. The bridge embeds the **Pi SDK**, rather than scraping CLI output. It inherits Pi's configured model/credentials from `~/.pi/agent`, or `PI_AGENT_DIR`. Set both `PI_PROVIDER` and `PI_MODEL` to select a particular model. To configure credentials interactively:

```sh
./node_modules/.bin/pi
```

Use Pi's `/login` and `/model` commands. A local model endpoint can be configured through Pi's `models.json`, following [Pi model documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md). This does not make a cloud model free; each provider retains its billing/authentication rules.

Each device has its own in-memory conversation. Restarting the bridge forgets conversations. Global extensions, skills, prompt templates, context files and default filesystem/shell tools are disabled. This first version is a chat companion. Adding notes or home-control tools is a later, explicit extension.

### Local Chinese speech on macOS

`tools/local_audio.py` supplies a local STT command with faster-whisper and a TTS command with the built-in Chinese `say` voice. Setup from `crab/`:

```sh
python3 -m venv tools/.venv
tools/.venv/bin/pip install -r tools/requirements-audio.txt
```

Set absolute paths in `bridge/.env`, for example:

```dotenv
STT_COMMAND=["/absolute/repo/crab/tools/.venv/bin/python","/absolute/repo/crab/tools/local_audio.py","stt","{input}","--model","small","--language","zh"]
TTS_COMMAND=["/usr/bin/python3","/absolute/repo/crab/tools/local_audio.py","tts","{text}","{output}"]
```

The first STT invocation downloads its model; prewarm it on a real WAV before hardware testing. This simple command adapter loads the model per turn, so cold-start latency is higher than a persistent STT server. Model quality must be tested with your voice; do not assume it fixes every recognition error. TTS requires an installed `Tingting` voice (`say -v '?'` lists voices). Both commands run as argv arrays without a shell.

### Cloud or local API endpoints

Alternatively set `STT_URL` to a compatible `/audio/transcriptions` endpoint, with `STT_KEY`, `STT_MODEL`, and `STT_LANGUAGE=zh`. Set `TTS_URL` to a compatible `/audio/speech` endpoint, plus its key/model/voice. The TTS API adapter expects raw **24 kHz mono PCM16**, resampled to 16 kHz for StickS3. Different formats require an adapter; compressed MP3/WAV must not be returned as raw PCM. Omitting TTS allows text-only replies.

Audio command adapters override the corresponding API. Provider keys remain on the computer. `CRAB_SAVE_RECORDINGS=true` saves private WAV files in `bridge/data/recordings/` for listening/debugging; default is off. No automatic retention cleanup is configured.

## 3. Build, back up and flash

Requires ESP-IDF **6.0.1**, as the upstream drivers do. From `crab/firmware`:

```sh
. /path/to/esp-idf-v6/export.sh
idf.py build
```

Connect the StickS3 with a USB data cable. Use the Python from the activated IDF environment for `device.py` (it needs pyserial/esptool):

```sh
python ../tools/device.py status --port /dev/cu.usbmodemXXXX
python ../tools/device.py backup --port /dev/cu.usbmodemXXXX
python ../tools/device.py flash --port /dev/cu.usbmodemXXXX --file ../backups/sticks3-TIMESTAMP.bin
```

The helper verifies that the running firmware reports **M5Stack StickS3**, requires a full 8 MiB backup with matching SHA256, then flashes this standalone project. It writes a new partition table: old pairing/config data cannot be assumed to survive or remain usable. Keep the complete backup private because it includes existing credentials. Backups and local credentials are gitignored. Never enable Secure Boot, flash encryption, or burn eFuses for this prototype.

If the old NVS layout prevents first boot, after verifying your backup use `esptool --chip esp32s3 -p PORT erase-region 0x9000 0x6000`, then reboot. This removes the standalone configuration; use only for first-boot migration/recovery. Subsequent normal flashes preserve Crab's NVS settings.

Restore the original full flash:

```sh
python ../tools/device.py restore --port /dev/cu.usbmodemXXXX --file ../backups/sticks3-TIMESTAMP.bin
```

The helper expects working status firmware. For recovery from a nonbooting application, manually verify the chip/board and restore with IDF's `python -m esptool --chip esp32s3 -p PORT write-flash 0 BACKUP.bin`; the ROM download mode remains available.

## 4. Configure over USB

With Crab firmware running:

```sh
python ../tools/device.py configure --port /dev/cu.usbmodemXXXX
```

The helper prompts for SSID, hidden Wi-Fi password, the bridge URL (e.g. `http://192.168.1.10:8787`), and hidden `CRAB_TOKEN`. Settings are stored in NVS and the device restarts. No Muse BLE pairing is needed. The computer and StickS3 must share a reachable network, and the computer must remain awake.

This first version uses **HTTP on a trusted LAN**; its bearer token authenticates requests but does not encrypt traffic. Do not expose the port to the internet. Wi-Fi/password and the token are stored in device flash without encryption, preserving easy reflashing.

## Controls and limits

- Hold the front button to record; release to send, maximum 20 seconds.
- Press front during processing/playback to cancel; after cancellation finishes, press again for the next turn. Cancel checks occur between HTTP reads (1 s timeout) and 20 ms playback chunks.
- Short side-button press pages the text and makes the crab happy.
- Hold side for 3 s while idle to power down; either button wakes via restart.
- On battery: screen turns off after 30 s idle; automatic deep sleep after 120 s. Button interaction wakes the screen. USB prevents automatic sleep. These behaviors still require physical verification.
- Final replies are capped at 1,000 Unicode codepoints and paged for the small display. TTS is limited to 60 s. There is no image-display command yet.
- Bridge has a 120 s turn timeout, four concurrent devices, sixteen idle conversations and thirty-minute idle expiration (checked on new turns). Each device may have only one active turn.

## Avatar previews

The eight states are boot, idle, listening, thinking, speaking, happy, error and off. Happy is a reaction overlaid on the current state.

```sh
python3 -m pip install pillow
python3 ../esp32/tools/muse/make_gifs.py --src avatar/crab_pixel.c avatar/previews
```

The renderer and build use the original crab, not Jollybot. No Muse call is needed to generate it.

## Protocol

Authenticated `POST /v1/turn`, `Content-Type: audio/wav`, `X-Device-ID: crab-XXXXXX` sends canonical RIFF/WAVE with a 16-byte PCM fmt chunk, mono 16 kHz signed 16-bit samples and the final data length. Maximum body: 640,044 bytes.

Response is UTF-8 NDJSON, one event per LF:

```json
{"type":"accepted"}
{"type":"transcript","text":"你好"}
{"type":"text_delta","text":"你好！"}
{"type":"reply","text":"你好！"}
{"type":"audio","rate":16000,"pcm":"BASE64_PCM16_LE"}
{"type":"done"}
```

Audio chunks are at most 6,400 bytes before base64. Errors after acceptance are `{type:"error",text:"..."}`; TTS failures emit a warning and preserve the text reply. `POST /v1/cancel` cancels a device's active turn; `POST /v1/reset` forgets an idle conversation; authenticated `GET /health` checks transport availability. Closing the device's response connection also aborts its turn.

## Remaining acceptance work

1. Attach physical StickS3, verify identity, back up full flash, flash and inspect boot logs.
2. USB configuration + Wi-Fi join, short/20 s recordings, interruption, reconnection, page navigation and speaker playback.
3. Configure real Pi provider and STT; compare Chinese transcription against known phrases and listen to recorded WAV.
4. Check all eight animations on the actual display and measure normal-use battery runtime.

Original code in this folder is MIT (see `LICENSE`). Reused upstream files retain their original headers/licenses; the Chinese font uses upstream's existing provenance. Pi is a separate MIT dependency.
