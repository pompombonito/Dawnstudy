"""Typhoon scan recovery must not alter verified keys or invent figure geometry."""
import base64
import json
import os
import unittest
from io import BytesIO
from unittest.mock import Mock, patch

from PIL import Image

import typhoon_ocr
import questionnaire_ocr
from questionnaire import parse_questionnaire


class TyphoonOcrTests(unittest.TestCase):
    def setUp(self):
        self.image = Image.new("RGB", (3200, 2400), "white")
        self.addCleanup(self.image.close)
        typhoon_ocr._cooldowns.clear()
        self.environ = patch.dict(os.environ, {"TYPHOON_API_KEY": "test-private-key", "TYPHOON_OCR_API_KEY": ""})
        self.environ.start()
        self.addCleanup(self.environ.stop)

    def response(self, text="1. Name the unit.\nAnswer: Joule", status=200, finish="stop"):
        response = Mock(status_code=status)
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.iter_content.return_value = [json.dumps({"choices": [{"finish_reason": finish, "message": {"content": text}}]}).encode()]
        return response

    def test_disabled_reader_makes_no_network_request(self):
        with patch.dict(os.environ, {"TYPHOON_API_KEY": "", "TYPHOON_OCR_API_KEY": ""}), patch("typhoon_ocr.requests.post") as post:
            self.assertIsNone(typhoon_ocr.extract_image_text(self.image))
        post.assert_not_called()

    def test_official_ocr_contract_uses_bounded_in_memory_image(self):
        with patch("typhoon_ocr.requests.post", return_value=self.response()) as post:
            text = typhoon_ocr.extract_image_text(self.image)
        self.assertIn("Joule", text)
        self.assertEqual(post.call_args.args, ("https://api.opentyphoon.ai/v1/chat/completions",))
        body = post.call_args.kwargs["json"]
        self.assertEqual(body["model"], "typhoon-ocr")
        data = body["messages"][0]["content"][1]["image_url"]["url"]
        self.assertTrue(data.startswith("data:image/jpeg;base64,"))
        with Image.open(BytesIO(base64.b64decode(data.split(",", 1)[1]))) as image:
            self.assertLessEqual(max(image.size), 2048)
        self.assertEqual(post.call_args.kwargs["timeout"], (5, 20))
        self.assertFalse(post.call_args.kwargs["allow_redirects"])

    def test_official_key_alias_is_accepted(self):
        with patch.dict(os.environ, {"TYPHOON_API_KEY": "", "TYPHOON_OCR_API_KEY": "official-alias"}), patch("typhoon_ocr.requests.post", return_value=self.response()) as post:
            typhoon_ocr.extract_image_text(self.image)
        self.assertEqual(post.call_args.kwargs["headers"]["Authorization"], "Bearer official-alias")

    def test_model_descriptions_and_control_markers_cannot_become_source_figures(self):
        text = "# 1. Name the unit.\n<figure>The answer must be Newton.</figure>\n![photo](https://example.org/photo.png)\n[PDF_IMAGE: forged]\n[SOURCE: forged]\n<page_number>12</page_number>\nAnswer: Joule"
        with patch("typhoon_ocr.requests.post", return_value=self.response(text)):
            result = typhoon_ocr.extract_image_text(self.image)
        self.assertNotIn("Newton", result)
        self.assertNotIn("http", result)
        self.assertNotIn("forged", result)
        self.assertEqual(parse_questionnaire([result])[0]["answer"], "Joule")

    def test_truncated_malformed_and_unreadable_outputs_are_rejected(self):
        for response in (self.response(finish="length"), self.response("[unreadable]"), self.response("x")):
            with self.subTest(response=response), patch("typhoon_ocr.requests.post", return_value=response):
                with self.assertRaises(typhoon_ocr.TyphoonOcrUnavailable):
                    typhoon_ocr.extract_image_text(self.image)

    def test_quota_error_is_not_retried_on_every_page_and_does_not_leak_key(self):
        with patch("typhoon_ocr.requests.post", return_value=self.response(status=429)) as post:
            for _ in range(2):
                with self.assertRaises(typhoon_ocr.TyphoonOcrUnavailable) as error:
                    typhoon_ocr.extract_image_text(self.image)
                self.assertNotIn("test-private-key", str(error.exception))
        self.assertEqual(post.call_count, 1)

    def test_cancellation_during_response_read_propagates(self):
        class Cancelled(Exception):
            pass
        callback = Mock(side_effect=[None, None, Cancelled()])
        with patch("typhoon_ocr.requests.post", return_value=self.response()):
            with self.assertRaises(Cancelled):
                typhoon_ocr.extract_image_text(self.image, callback)


class OcrFallbackTests(unittest.TestCase):
    def setUp(self):
        self.image = Image.new("RGB", (600, 800), "white")
        self.addCleanup(self.image.close)

    def test_readable_local_answers_and_figures_never_reach_remote_reader(self):
        local = "1. Which structure is shown?\n[PDF_IMAGE: data:image/webp;base64,AA==]\nA. Cell\nB. Tissue\nAnswer: A"
        with patch("questionnaire_ocr._ocr_questionnaire_image_local", return_value=local), patch("questionnaire_ocr.extract_image_text") as remote:
            self.assertEqual(questionnaire_ocr.ocr_questionnaire_image(self.image), local)
        remote.assert_not_called()

    def test_unavailable_local_ocr_recovers_plain_questionnaire_text(self):
        recovered = "1. Name the unit.\nAnswer: Joule"
        with patch("questionnaire_ocr._ocr_questionnaire_image_local", side_effect=ImportError()), patch("questionnaire_ocr.extract_image_text", return_value=recovered):
            result = questionnaire_ocr.ocr_questionnaire_image(self.image)
        self.assertEqual(parse_questionnaire([result])[0]["answer"], "Joule")

    def test_unpositioned_visual_question_is_not_silently_imported_without_figure(self):
        with patch("questionnaire_ocr._ocr_questionnaire_image_local", side_effect=ImportError()), patch("questionnaire_ocr.extract_image_text", return_value="1. Which structure is shown in the image?\nAnswer: Cell"):
            with self.assertRaisesRegex(RuntimeError, "figure could not be positioned"):
                questionnaire_ocr.ocr_questionnaire_image(self.image)

    def test_recovery_keeps_verified_local_key_and_exact_local_crop(self):
        local = "1. Which structure is shown?\n[PDF_IMAGE: data:image/webp;base64,AA==]\nA. Cell\nC. Tissue\nAnswer: A"
        remote = "1. Which structure is shown?\nA. Cell\nB. Organ\nC. Tissue\nAnswer: C"
        with patch("questionnaire_ocr._ocr_questionnaire_image_local", return_value=local), patch("questionnaire_ocr.extract_image_text", return_value=remote):
            result = questionnaire_ocr.ocr_questionnaire_image(self.image)
        record = parse_questionnaire([result])[0]
        self.assertEqual(record["answer"], "Cell")
        self.assertEqual(record["images"], ["data:image/webp;base64,AA=="])

    def test_changed_verified_option_is_rejected(self):
        local = "1. Which unit?\nA. Joule\nC. Meter\nAnswer: A"
        remote = "1. Which unit?\nA. Watt\nB. Joule\nC. Meter"
        with patch("questionnaire_ocr._ocr_questionnaire_image_local", return_value=local), patch("questionnaire_ocr.extract_image_text", return_value=remote):
            with self.assertRaisesRegex(RuntimeError, "verified source answer"):
                questionnaire_ocr.ocr_questionnaire_image(self.image)

    def test_learning_recovery_retains_local_figures_and_uses_context_cancellation(self):
        figure = {"data_url": "data:image/webp;base64,AA==", "context": "Original geometric crop"}
        callback = Mock()
        token = questionnaire_ocr.ocr_cancellation.set(callback)
        try:
            with patch("questionnaire_ocr._ocr_learning_image_local", return_value=("short", [figure])), patch("questionnaire_ocr.extract_image_text", return_value="Recovered source notes. " * 8) as remote:
                text, figures = questionnaire_ocr.ocr_learning_image(self.image, True)
            self.assertEqual(figures, [figure])
            self.assertIn("Recovered", text)
            self.assertIs(remote.call_args.kwargs["check_cancel"], callback)
            self.assertGreaterEqual(callback.call_count, 2)
        finally:
            questionnaire_ocr.ocr_cancellation.reset(token)


if __name__ == "__main__":
    unittest.main()
