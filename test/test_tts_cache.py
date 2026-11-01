import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from lib.tts_cache import prune_cache


class CacheTests(unittest.TestCase):
    def test_ttl_size_and_file_quota(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name, size, age in [('old.wav', 2, 90000), ('large.wav', 11, 1),
                                    ('first.wav', 4, 50), ('second.wav', 4, 20), ('third.wav', 4, 10)]:
                file = root / name
                file.write_bytes(b'x' * size)
                os.utime(file, (100000 - age, 100000 - age))
            with patch('lib.tts_cache.MAX_AUDIO_BYTES', 10), patch('lib.tts_cache.MAX_CACHE_BYTES', 10), patch('lib.tts_cache.MAX_FILES', 3):
                prune_cache(root, reserve_bytes=4, now=100000)
            self.assertEqual(sorted(p.name for p in root.iterdir()), ['third.wav'])

    def test_symlinks_are_not_followed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            outside = root / 'keep.txt'
            outside.write_text('keep')
            (root / 'linked.wav').symlink_to(outside)
            prune_cache(root, now=10**12)
            self.assertEqual(outside.read_text(), 'keep')


if __name__ == '__main__':
    unittest.main()
