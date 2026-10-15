#!/usr/bin/env python3
"""Deliberate USB checks for an idle Crab StickS3 (no credentials printed).
The optional sleep test powers down briefly, then wakes by a three-second timer.
"""
import argparse
import json
from pathlib import Path
import time
from device import exchange


def ready(port, timeout=25):
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        try:
            state = exchange(port, {'command':'status'}, seconds=2)
            if state.get('board') != 'M5Stack StickS3':
                raise RuntimeError('Unexpected board')
            if state.get('wifi') and not state.get('busy'):
                return state
        except (OSError, RuntimeError) as exc:
            last = exc
        time.sleep(.5)
    raise RuntimeError(f'Device not ready: {last}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', required=True)
    parser.add_argument('--sleep', action='store_true')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    state = ready(args.port)
    report = {'initial_uptime_ms':state['uptime_ms']}
    previous = state['uptime_ms']
    heaps = []
    for _ in range(12):
        state = exchange(args.port, {'command':'status'})
        if state['uptime_ms'] <= previous:
            raise RuntimeError('Serial inspection reset the device')
        previous = state['uptime_ms']; heaps.append(state['free_internal']); time.sleep(.1)
    report['serial_checks'] = 12
    report['internal_heap_range'] = [min(heaps), max(heaps)]
    assert exchange(args.port, {'command':'record','milliseconds':5000})['ok']
    time.sleep(.3)
    assert exchange(args.port, {'command':'cancel'})['ok']
    ready(args.port)
    report['record_cancel'] = True
    assert exchange(args.port, {'command':'reconnect'})['ok']
    ready(args.port)
    report['wifi_reconnect'] = True
    if args.sleep:
        assert exchange(args.port, {'command':'sleep_test'})['ok']
        time.sleep(4)
        state = ready(args.port, timeout=30)
        # ESP_RST_DEEPSLEEP == 8; ordinary USB reset is not equivalent evidence.
        if state['reset_reason'] != 8:
            raise RuntimeError(f"Expected deep-sleep reset, got {state['reset_reason']}")
        report['deep_sleep_timer_wake'] = True
        report['wake_uptime_ms'] = state['uptime_ms']
    print(json.dumps(report, indent=2))
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
