"""Exercise real POSIX serial framing with a pseudo-terminal, without hardware."""
import importlib.util
import json
import os
from pathlib import Path
import threading
import time
import unittest

spec = importlib.util.spec_from_file_location('crab_device', Path(__file__).parents[1] / 'device.py')
device = importlib.util.module_from_spec(spec)
spec.loader.exec_module(device)

class SerialProtocolTests(unittest.TestCase):
    def test_fragmented_utf8_reply_and_command_roundtrip(self):
        master, slave = os.openpty()
        seen = []
        errors = []
        def board():
            try:
                line = b''
                while b'\n' not in line:
                    line += os.read(master, 1024)
                seen.append(json.loads(line))
                reply = ('boot log\r\n@crab ' + json.dumps({'ok': True, 'caption': '小螃蟹已连接'}, ensure_ascii=False) + '\r\n').encode()
                for at in range(0, len(reply), 3):
                    os.write(master, reply[at:at+3]); time.sleep(.001)
            except Exception as e:
                errors.append(e)
        worker = threading.Thread(target=board, daemon=True); worker.start()
        try:
            result = device.exchange(os.ttyname(slave), {'command':'status'}, seconds=2)
            self.assertEqual(result, {'ok':True,'caption':'小螃蟹已连接'})
            self.assertEqual(seen, [{'command':'status'}])
            worker.join(1); self.assertFalse(errors)
        finally:
            os.close(master); os.close(slave)

    def test_timeout_has_bounded_wait(self):
        master, slave = os.openpty()
        try:
            start = time.monotonic()
            with self.assertRaisesRegex(RuntimeError, 'did not answer'):
                device.exchange(os.ttyname(slave), {'command':'status'}, seconds=.1)
            self.assertLess(time.monotonic()-start, 1)
        finally:
            os.close(master); os.close(slave)

if __name__ == '__main__':
    unittest.main()
