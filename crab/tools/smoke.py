#!/usr/bin/env python3
"""Exercise bridge NDJSON framing and PCM playback data without a physical board."""
import argparse
import base64
import io
import json
import math
import os
import struct
import urllib.request
import wave

p = argparse.ArgumentParser(description=__doc__)
p.add_argument("--url", default="http://127.0.0.1:8787")
p.add_argument("--wav", help="Real 16 kHz mono PCM16 recording; omit only for demo mode")
args = p.parse_args()
if args.wav:
    # Canonicalize standard WAV containers (macOS say may use an 18-byte fmt
    # chunk); the device protocol uses the compact 44-byte PCM header.
    with wave.open(args.wav, "rb") as recording:
        if (recording.getnchannels(), recording.getsampwidth(), recording.getframerate()) != (1, 2, 16000):
            raise SystemExit("Expected a 16 kHz mono PCM16 recording")
        samples = recording.readframes(recording.getnframes())
    out = io.BytesIO()
    with wave.open(out, "wb") as canonical:
        canonical.setnchannels(1); canonical.setsampwidth(2); canonical.setframerate(16000); canonical.writeframes(samples)
    wav = out.getvalue()
else:
    raw = b"".join(struct.pack("<h", int(math.sin(i * 2 * math.pi * 440 / 16000) * 1000)) for i in range(8000))
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000); w.writeframes(raw)
    wav = out.getvalue()
request = urllib.request.Request(args.url.rstrip("/") + "/v1/turn", data=wav, headers={"Authorization": "Bearer " + os.environ["CRAB_TOKEN"], "Content-Type": "audio/wav", "X-Device-ID": "crab-smoke"})
seen = []
audio_bytes = 0
with urllib.request.urlopen(request, timeout=130) as response:
    for line in response:
        event = json.loads(line)
        seen.append(event["type"])
        if event["type"] == "audio":
            assert event["rate"] == 16000
            pcm = base64.b64decode(event["pcm"], validate=True)
            assert len(pcm) % 2 == 0 and len(pcm) <= 6400
            audio_bytes += len(pcm)
        else:
            print(json.dumps(event, ensure_ascii=False))
assert seen[0] == "accepted" and "transcript" in seen and "reply" in seen and seen[-1] == "done", seen
print(f"Complete turn: {audio_bytes // 2} PCM frames ({audio_bytes / 32000:.2f}s).")
