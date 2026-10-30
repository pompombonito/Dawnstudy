import unittest
from unittest.mock import patch, Mock
from fastapi import HTTPException
from youtube_material import video_id, extract, _output_text


class YouTubeTests(unittest.TestCase):
    def test_accepts_supported_video_links_without_fetching_arbitrary_hosts(self):
        for url in ("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=2", "https://youtu.be/dQw4w9WgXcQ", "https://youtube.com/shorts/dQw4w9WgXcQ"):
            self.assertEqual(video_id(url), "dQw4w9WgXcQ")
        self.assertIsNone(video_id("https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ"))
        with self.assertRaises(HTTPException):
            video_id("https://youtube.com/playlist?list=secret")

    def test_captions_have_timestamps_and_stable_fingerprint(self):
        transcript = Mock(language_code="en")
        transcript.fetch.return_value = [Mock(start=65, text="This is enough educational material to make a small quiz. " * 5)]
        with patch("youtube_transcript_api.YouTubeTranscriptApi.list", return_value=[transcript]):
            result = extract("https://youtu.be/dQw4w9WgXcQ")
        self.assertIn("[01:05]", result[0]); self.assertEqual(result[-1], b"youtube:dQw4w9WgXcQ")
        self.assertEqual(result[3], "https://www.youtube.com/watch?v=dQw4w9WgXcQ")

    def test_unreadable_video_returns_clear_error_instead_of_webpage_chrome(self):
        with patch("youtube_transcript_api.YouTubeTranscriptApi.list", side_effect=RuntimeError()), patch.dict("os.environ", {"GEMINI_API_KEY": ""}):
            with self.assertRaises(HTTPException) as error:
                extract("https://youtu.be/dQw4w9WgXcQ")
        self.assertEqual(error.exception.status_code, 422)
        self.assertIn("transcript", error.exception.detail)

    def test_interactions_output_parser(self):
        self.assertEqual(_output_text({"steps": [{"type": "model_output", "content": [{"type": "text", "text": "Study notes"}]}]}), "Study notes")
