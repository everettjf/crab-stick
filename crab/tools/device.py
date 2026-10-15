#!/usr/bin/env python3
"""USB status/configuration and full-flash backup/restore for StickS3.
Run with the ESP-IDF Python environment (pyserial and esptool are already there).
"""
import argparse
import getpass
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
os.umask(0o077)


def exchange(port, command, prefix="@crab ", seconds=8):
    # POSIX file I/O avoids pyserial's open-time DTR/RTS transitions, which can
    # reset native ESP32 USB. Keep HUPCL off so close doesn't reset it either.
    import select
    import termios
    fd = os.open(port, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
    try:
        attrs = termios.tcgetattr(fd)
        attrs[0] = 0
        attrs[1] = 0
        attrs[2] &= ~(termios.HUPCL | termios.PARENB | termios.CSTOPB | termios.CSIZE)
        attrs[2] |= termios.CLOCAL | termios.CREAD | termios.CS8
        attrs[3] = 0
        attrs[4] = attrs[5] = termios.B115200
        attrs[6][termios.VMIN] = 0
        attrs[6][termios.VTIME] = 0
        termios.tcsetattr(fd, termios.TCSANOW, attrs)
        termios.tcflush(fd, termios.TCIFLUSH)
        message = command if isinstance(command, str) else json.dumps(command, ensure_ascii=False)
        pending = (message + "\n").encode()
        deadline = time.monotonic() + seconds
        while pending and time.monotonic() < deadline:
            if select.select([], [fd], [], 0.2)[1]:
                pending = pending[os.write(fd, pending):]
        buffer = b""
        while time.monotonic() < deadline:
            if not select.select([fd], [], [], 0.2)[0]:
                continue
            buffer += os.read(fd, 4096)
            while b"\n" in buffer:
                line, buffer = buffer.split(b"\n", 1)
                text = line.decode("utf-8", errors="replace").strip()
                if text.startswith(prefix):
                    return json.loads(text[len(prefix):])
            if len(buffer) > 65536:
                raise RuntimeError("Device returned an oversized serial line")
        raise RuntimeError("Device did not answer. Check the port and firmware.")
    finally:
        os.close(fd)


def esptool(port, *args):
    subprocess.run([sys.executable, "-m", "esptool", "--chip", "esp32s3", "-p", port, *args], check=True)


def identify(port):
    # Native S3 USB alone doesn't distinguish M5Stack models. Ask the firmware.
    try:
        state = exchange(port, {"command": "status"}, seconds=2)
    except RuntimeError:
        state = exchange(port, ">status", prefix="@status ")
    if state.get("board") != "M5Stack StickS3":
        raise RuntimeError(f"Expected M5Stack StickS3; device reports {state.get('board')!r}")
    return state


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["status", "configure", "backup", "flash", "restore"])
    parser.add_argument("--port", required=True)
    parser.add_argument("--file", type=Path, help="Backup file (required for flash/restore)")
    args = parser.parse_args()
    if args.action == "status":
        print(json.dumps(identify(args.port), ensure_ascii=False, indent=2))
    elif args.action == "configure":
        identify(args.port)
        config = {"command": "configure", "ssid": input("Wi-Fi SSID: "), "password": getpass.getpass("Wi-Fi password: "), "url": input("Bridge URL, e.g. http://192.168.1.10:8787: ").rstrip("/"), "token": getpass.getpass("CRAB_TOKEN: ")}
        result = exchange(args.port, config)
        if not result.get("ok"):
            raise RuntimeError(result.get("error", "Configuration failed"))
        print("Configuration saved; device restarting.")
    elif args.action == "backup":
        identify(args.port)
        path = args.file or ROOT / "backups" / f"sticks3-{time.strftime('%Y%m%d-%H%M%S')}.bin"
        if path.exists():
            raise RuntimeError("Backup already exists; use a new path")
        path.parent.mkdir(parents=True, exist_ok=True)
        esptool(args.port, "read-flash", "0", "0x800000", str(path))
        if path.stat().st_size != 0x800000:
            raise RuntimeError("Incomplete backup")
        path.chmod(0o600)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        path.with_suffix(".sha256").write_text(digest + "\n")
        print(f"Backup saved to {path}; contains existing device credentials. Keep it private.")
    elif args.action in ("flash", "restore"):
        if not args.file or args.file.stat().st_size != 0x800000:
            raise RuntimeError("Supply an 8 MiB full-flash backup with --file")
        expected = args.file.with_suffix(".sha256").read_text().strip()
        if hashlib.sha256(args.file.read_bytes()).hexdigest() != expected:
            raise RuntimeError("Backup checksum mismatch")
        identify(args.port)
        if args.action == "restore":
            esptool(args.port, "write-flash", "0", str(args.file))
        else:
            subprocess.run(["idf.py", "-p", args.port, "flash"], cwd=ROOT / "firmware", check=True)
        print("Flash finished. Check the boot log before use.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, subprocess.CalledProcessError) as exc:
        sys.exit(str(exc))
