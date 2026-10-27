"""Run locally: python -m unittest discover -s tests -v"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
from analyzer import analyze, inspect_candidates, dispatch


class AnalyzerTests(unittest.TestCase):
    def test_direct_with_query(self):
        result = analyze("https://cdn.example.com/video.MP4?token=opaque")
        self.assertEqual(result["type"], "direct_file")
        self.assertEqual(result["format"], "MP4")
        self.assertEqual(result["code"], "DIRECT_FILE")
        self.assertTrue(result["upload_candidate"])
        self.assertFalse(result["verified"])
        self.assertEqual(result["url"], "https://cdn.example.com/video.MP4?token=opaque")

    def test_stream_types(self):
        self.assertEqual(analyze("https://cdn.example.com/master.m3u8")["code"], "HLS_STREAM")
        self.assertEqual(analyze("https://cdn.example.com/manifest.mpd")["code"], "DASH_STREAM")

    def test_page(self):
        self.assertEqual(analyze("https://example.com/movie/8717")["kind"], "page")
        self.assertEqual(analyze("https://example.com/index.html")["code"], "HTML_PAGE")
        self.assertEqual(analyze("https://example.com/movie/8717")["code"], "UNKNOWN_RESOURCE")

    def test_private_and_unsafe_schemes(self):
        for url in ("http://127.0.0.1/movie.mp4", "http://localhost/test.mp4",
                    "http://[::1]/test.mp4", "http://169.254.169.254/test.mp4",
                    "file:///tmp/video.mp4", "blob:https://example.com/opaque",
                    "https://user:pass@example.com/test.mp4"):
            with self.subTest(url=url):
                self.assertEqual(analyze(url)["kind"], "invalid")

    def test_fragment_removed_and_relative_resolved(self):
        result = analyze("../media/video.mp4#section", "https://example.com/sub/page")
        self.assertEqual(result["url"], "https://example.com/media/video.mp4")

    def test_candidates_unique_and_summary(self):
        items = [
            {"url": "https://example.com/a.mp4", "label": "Download"},
            {"url": "https://example.com/a.mp4"},
            {"url": "https://example.com/hls.m3u8"},
            {"url": "javascript:alert(1)"},
            {"url": "/b.webm", "base": "https://example.com/page"},
        ]
        results = inspect_candidates(items)
        self.assertEqual(len(results["items"]), 3)
        self.assertEqual(results["summary"], {"direct": 3, "stream": 1, "page": 0, "invalid": 1})
        self.assertEqual(dispatch({"operation": "candidates", "items": items}), results["items"])

    def test_invalid_payload(self):
        self.assertIn("error", dispatch(None))
        self.assertIn("error", dispatch({"operation": "not_supported"}))


if __name__ == "__main__":
    unittest.main()
