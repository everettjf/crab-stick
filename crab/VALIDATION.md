# First-version validation — 2026-10-14

This report separates automated checks, actual board evidence and remaining human acceptance. It is not a claim of exhaustive testing or measured all-day battery life.

## Verified on the connected StickS3

- Identified by the running firmware as **M5Stack StickS3**; esptool confirmed ESP32-S3-PICO-1 with 8 MiB flash and 8 MiB PSRAM.
- Read the complete 8 MiB original flash and verified its SHA256 before replacing it. The private backup, migrated Wi-Fi configuration and local API keys are excluded from Git.
- Built/flashed the standalone image; booted without panic or a reboot loop; device joined Wi-Fi and acquired an address. The firmware link map contains no Muse account/chat/pairing transport or default Jollybot avatar.
- Audio self-test captured the board's left microphone input. The right slot is unused. Speaker tones were detected in the microphone loopback test across frequencies and gains.
- On the timeout-adjusted image, a timed microphone turn completed with HTTP 200, 351,439 response bytes, `done=1`, approximately 8.2 s of audio and a return to idle. This verifies one full transport/playback turn, not the cause of the earlier failure.
- A 6.5 s real microphone recording reached the computer as a valid WAV; DeepSeek replied, captions updated and the device entered the speaker-playback state, then returned to idle.
- That acoustic speech test used the Mac's external playback and picked up weak speech plus a loud unrelated transient; recognition was incorrect. It does **not** establish good near-mouth human Chinese recognition. The user subsequently confirmed accurate recognition of a near-mouth sentence (“明天下午三点去取快递”).
- Cancelling while recording returned the board to idle without resetting it.
- Forced Wi-Fi disconnect was observed, followed by automatic reconnection.
- The 20 s recording limit delivered exactly 320,000 PCM frames / 640,044 WAV bytes. Cancellation after upload returned the device to idle. One serial-status request during this test timed out; a subsequent raw read recovered the response, and follow-up status checks passed.
- Twelve successive status requests maintained increasing uptime, with stable internal/PSRAM memory, rather than resetting the chip. A sustained memory/uptime soak is still longer-term work.
- Side-button-equivalent page/pet command was accepted. The user confirmed the crab is visible and speaker test audio is audible; physical push-to-talk produced an accurate transcript.
- A controlled deep-sleep cycle turned off display/audio rails, woke by a 3 s timer, reported `ESP_RST_DEEPSLEEP`, and rejoined Wi-Fi with configuration retained.
- Battery voltage/percentage and USB supply are read; charging percentage increased during testing. Actual battery-only timeout/button wake and disconnected runtime have **not** been measured.

## Verified on the computer

- Real DeepSeek `deepseek-flash` response through the **Pi SDK**, using locally stored credentials. Credentials are not compiled into the device.
- Synthesized Chinese “你好，我是小螃蟹” transcribed locally as “你好 我是小螃蟹”, then completed a real Pi/TTS turn.
- One board turn measured approximately 2.3 s through transcription, 5.0 s through the model reply, and 6.0 s through speech synthesis (cumulative from receipt of the WAV), plus 2.1 s of playback. These are individual observations, not latency guarantees.
- Eight Node tests: WAV validation/resampling, authenticated complete protocol turn, Chinese transcript/reply, invalid input, cancellation/overlap, real Pi SDK streaming/context/tool isolation against a local test model, no-speech recovery and text fallback on TTS failure.
- Two Python pseudo-terminal tests: fragmented UTF-8 serial reply/command roundtrip, and bounded response timeout.
- Original crab's eight animations passed native compiler warnings-as-errors plus address/undefined-behavior sanitizers and were rendered as GIF previews.

## Fixes from board testing

- Replaced serial control-line manipulation with POSIX I/O and disabled HUPCL so opening/closing a configuration connection doesn't reset native ESP32 USB.
- Added private USB diagnostics for timed recording, cancellation, audio self-test, reconnect, pet/page, and uptime/memory/caption status.
- Kept the record-start cancellation fix and preserved meaningful service errors on screen.
- Raised connection/upload/header timeout from 1 s to 10 s while retaining 1 s response polling, and added credential-free transport-stage diagnostics. This addresses a possible Wi-Fi sensitivity; both subsequent human retries completed with subtitles and speech. A subsequent timed microphone turn on the new image received a real model reply and entered audio playback; external Mac speech was again contaminated by ambient speech and is not an STT accuracy measurement.
- Shortened the assistant prompt and clarified that the first version has no file/reminder/home-control tools. Increased local speech rate moderately.
- Added stage timings, readable Chinese no-speech errors, a local DeepSeek setup helper, and canonical WAV conversion in the computer smoke test.

## Human acceptance and remaining checks

1. **Core voice interaction accepted by the user:** after the timeout adjustment and with the computer service stable, both “明天下午三点去取快递” and “你好，你是谁” produced visible replies and audible speech. Crab appearance, speaker test and human push-to-talk recognition are also confirmed. The earlier failure did not recur in these two retries; its exact cause remains unproven.
2. Real battery-only screen-off timeout, physical-button wake and runtime test (timer-based deep-sleep recovery passed).
3. Longer soak and off-network/recovery testing; this prototype uses LAN HTTP and does not support roaming automatically.

The computer bridge must be running, the Mac awake, and the device able to reach the Mac's current LAN address. A changed Mac address requires updating the device URL over USB. Conversations are in-memory only; this version cannot save reminders or promise persistent notes.

## Reproduce board checks

With the bridge running and the board idle:

```sh
python3 crab/tools/hardware_check.py --port /dev/cu.usbmodemXXXX --sleep --output crab/bridge/data/hardware-check.json
```

This checks serial stability, record cancellation, Wi-Fi reconnect and optional timed deep sleep. It deliberately operates the device, so do not press buttons or speak a test sentence concurrently. Full 20 s upload validation was performed separately with the retained private WAV; the quick checker does not claim to cover it.

## Browser console validation — 2026-10-14

- TypeScript build and 14 Node tests pass, including six console regressions covering authenticated state/events/settings, foreign-origin rejection, live SSE deltas, heartbeats, secret redaction, busy-setting rejection, model/context replacement, per-turn speech settings, private persistence and bounded history. Both Python serial tests also pass.
- Browser exercised against an isolated local fixture: login, incorrect-token handling, live device/conversation rendering, model selection and voice/TTS save. Model/context replacement is tested through HTTP with injected agents.
- New firmware built/flashed to the connected StickS3; the authenticated browser showed its real heartbeat, battery and USB state. Twelve serial checks, recording cancellation and Wi-Fi reconnection passed, with internal heap around 63.6 KiB.
- Production browser listed configured Pi models and saved a change to the built-in DeepSeek Flash provider and local speech rate 230. Replaying a private real recording completed STT/Pi/TTS, with its live transcript/reply visible in the browser and 5.77 s of PCM received by the host smoke client. The prior model selection and rate 210 were restored afterward. This replay validates the bridge, not physical speaker playback.
- Restarted the production service with the console open: the browser automatically reconnected without re-entering its token, restored the current device snapshot and retained the saved model/voice settings. Prior transient conversation/log history cleared as designed.
- Battery runtime, every installed voice/model combination and long-duration network stability remain unmeasured.

## Console language validation

- Default English UI with a Chinese/English toggle and a browser-local language preference. Transcript/reply text is preserved; language changes do not update speech settings or reconnect the device.
- TypeScript build and 17 Node tests pass, including default locale, parameterized status/error translations, multiline static labels, numeric values, preference restoration and unavailable browser storage.
- Browser verified default English, Chinese login/console, Chinese preference after refresh, dynamic device/status/save messages, and retention of an unsaved model choice across language switches. Finished with the English interface and original model/voice settings.
