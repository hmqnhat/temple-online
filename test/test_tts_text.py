import io
import json
import tempfile
import wave
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
import numpy as np
import tts_worker as worker


class TextTests(unittest.TestCase):
    def test_full_text_and_tail_at_bounds(self):
        for size in (140, 200, 320):
            tail = 'Cầu chúc gia đình an lành.'
            text = ('Nguyễn Thị Thanh Tâm ' * 20)[:size - len(tail) - 1].rsplit(' ', 1)[0] + ' ' + tail
            normalized = worker.clean_and_normalize_text(text)
            chunks = worker.chunk_text(normalized)
            self.assertTrue(normalized.endswith(tail))
            self.assertEqual(' '.join(chunks), normalized)
            self.assertTrue(all(len(chunk) <= 160 for chunk in chunks))
            self.assertLessEqual(len(chunks), 8)

    def test_expansion_and_unbreakable_fail_explicitly(self):
        with patch.object(worker, 'normalize_vi_text', return_value='xin ' * 321):
            with self.assertRaisesRegex(ValueError, 'normalized_text_too_long'):
                worker.clean_and_normalize_text('Xin chào')
        with self.assertRaisesRegex(ValueError, 'unbreakable_word'):
            worker.chunk_text('a' * 161)

    def test_versioned_key_includes_whole_tail(self):
        a = worker.cache_key('maichi', 'Xin chào. Câu cuối một.')
        self.assertNotEqual(a, worker.cache_key('maichi', 'Xin chào. Câu cuối hai.'))
        with patch.object(worker, 'NORMALIZATION_VERSION', 'old'):
            self.assertNotEqual(a, worker.cache_key('maichi', 'Xin chào. Câu cuối một.'))

    def test_chunk_boundary_sentence_preferred_no_duplication(self):
        normalized = 'Xin chào. ' + 'bình an ' * 25 + 'Hết.'
        normalized = ' '.join(normalized.split())
        chunks = worker.chunk_text(normalized)
        self.assertEqual(chunks[0], 'Xin chào.')
        self.assertEqual(' '.join(chunks), normalized)

    def test_newline_is_a_longer_pause_between_title_and_verse(self):
        normalized = worker.clean_and_normalize_text('Quẻ số 1, quẻ thượng. Tích Chung Ly thành đạo.\nThơ. Đất mở trời khai kết mối duyên.')
        plan = worker.chunk_plan(normalized)
        self.assertEqual(len(plan), 2)
        self.assertEqual(plan[0][1], 0.0)
        self.assertEqual(plan[1][1], worker.PARAGRAPH_PAUSE_SEC)
        self.assertTrue(plan[1][0].startswith('Thơ'))

    def run_worker(self, synthesize, text=None, repeats=1):
        text = text or ('Xin cảm ơn Nguyễn Thị Thanh Tâm. ' * 7)
        tts = Mock(sample_rate=1000)
        tts.list_voices.return_value = ['maichi']
        tts.synthesize.side_effect = synthesize
        def save(audio, filename):
            with wave.open(filename, 'wb') as output:
                output.setnchannels(1)
                output.setsampwidth(2)
                output.setframerate(1000)
                output.writeframes((audio.reshape(-1) * 10000).astype(np.int16).tobytes())
        tts.save_audio.side_effect = save
        requests = ''.join(json.dumps({'id': i, 'text': text, 'voice': 'maichi'}) + '\n' for i in range(repeats))
        with tempfile.TemporaryDirectory() as tmp:
            output = io.StringIO()
            with patch.object(worker, 'CACHE_DIR', Path(tmp)), patch.object(worker.ZeroTTS, 'from_pretrained', return_value=tts), patch.object(worker.sys, 'stdin', io.StringIO(requests)), patch.object(worker.sys, 'stdout', output):
                worker.main()
            messages = [json.loads(line) for line in output.getvalue().splitlines()]
            results = [m for m in messages if m['type'] == 'result']
            files = list(Path(tmp).glob('*.wav'))
            return results, tts, len(files)

    def test_complete_chain_and_cache_hit_return_complete_metadata(self):
        results, tts, files = self.run_worker(lambda *a, **kw: np.ones(1000), repeats=2)
        self.assertTrue(all(r['ok'] for r in results))
        self.assertGreater(results[0]['chunkCount'], 1)
        self.assertEqual(tts.synthesize.call_count, results[0]['chunkCount'])
        self.assertEqual(results[0]['durationMs'], results[1]['durationMs'])
        self.assertEqual(results[0]['normalizedText'], results[1]['normalizedText'])
        self.assertTrue(results[1]['cached'])
        self.assertEqual(files, 1)

    def test_failed_middle_chunk_never_publishes_partial_wav(self):
        results, tts, files = self.run_worker([np.ones(1000), RuntimeError('chunk_failed')])
        self.assertFalse(results[0]['ok'])
        self.assertEqual(results[0]['errorCode'], 'chunk_failed')
        self.assertIsNone(results[0]['url'])
        self.assertEqual(files, 0)

    def test_total_duration_guard_counts_all_chunks(self):
        results, _, files = self.run_worker(lambda *a, **kw: np.ones(31000))
        self.assertEqual(results[0]['errorCode'], 'audio_duration_limit')
        self.assertEqual(files, 0)

    def test_native_chain_timeout_is_failure_not_partial_success(self):
        with patch.object(worker.time, 'monotonic', side_effect=[0, 0, 181]):
            results, _, files = self.run_worker(lambda *a, **kw: np.ones(1000))
        self.assertEqual(results[0]['errorCode'], 'synthesis_timeout')
        self.assertEqual(files, 0)

    def test_number_expansion_preserves_repeated_digits(self):
        self.assertIn('nghìn', worker.clean_and_normalize_text('Cảm ơn một nghìn lần 1000'))


if __name__ == '__main__':
    unittest.main()
