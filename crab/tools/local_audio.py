#!/usr/bin/env python3
"""Local audio commands. STT uses faster-whisper; TTS uses macOS say."""
import argparse
from pathlib import Path
import subprocess
import tempfile
import sys
import wave


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="action", required=True)
    stt = sub.add_parser("stt")
    stt.add_argument("input", type=Path)
    stt.add_argument("--model", default="small")
    stt.add_argument("--language", default="zh")
    tts = sub.add_parser("tts")
    tts.add_argument("text")
    tts.add_argument("output", type=Path)
    tts.add_argument("--voice", default="Tingting")
    args = p.parse_args()
    if args.action == "stt":
        from faster_whisper import WhisperModel
        model = WhisperModel(args.model, device="cpu", compute_type="int8")
        segments, _ = model.transcribe(str(args.input), language=args.language, beam_size=5, vad_filter=True)
        text = "".join(part.text for part in segments).strip()
        if not text:
            sys.exit("No speech recognized")
        print(text)
    else:
        if sys.platform != "darwin":
            sys.exit("This TTS adapter requires macOS; configure a TTS API or another command on other systems")
        with tempfile.TemporaryDirectory(prefix="crab-tts-") as d:
            wav = str(Path(d) / "speech.wav")
            subprocess.run(["say", "-v", args.voice, "-o", wav, "--file-format=WAVE", "--data-format=LEI16@16000", "--", args.text], check=True)
            with wave.open(wav, "rb") as audio:
                if audio.getnchannels() != 1 or audio.getsampwidth() != 2 or audio.getframerate() != 16000:
                    sys.exit("Unexpected speech format")
                args.output.write_bytes(audio.readframes(audio.getnframes()))


if __name__ == "__main__":
    main()
