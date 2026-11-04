import json
import unittest
from io import BytesIO
from unittest.mock import Mock, patch

from pypdf import PdfWriter
import test_generation_limits as fixtures

main = fixtures.main
generate_with_provider = main.generate_with_provider


class VisualGenerationTests(unittest.TestCase):
    update = fixtures.GenerationLimitTests.update
    provide = fixtures.GenerationLimitTests.provide

    def setUp(self):
        fixtures.GenerationLimitTests.setUp(self)
        pdf = PdfWriter()
        pdf.add_blank_page(width=600, height=800)
        buffer = BytesIO()
        pdf.write(buffer)
        self.pdf = buffer.getvalue()
        self.image = "data:image/webp;base64,AA=="
        self.figure = {"id": "pdf-p1-figure-1", "data_url": self.image, "source_ref": "PDF page 1", "context": "The diagram shows a chloroplast containing thylakoids."}

    def request(self, kind, include_images):
        return self.client.post("/api/generation-jobs", data={"format": kind, "question_count": "1", "include_images": str(include_images).lower()}, files={"files": ("notes.pdf", self.pdf, "application/pdf")})

    def test_optional_images_reach_saved_cards_in_every_notes_format(self):
        for kind in ("flashcards", "identification", "multiple_choice", "checkbox"):
            with self.subTest(kind=kind):
                def provide(_provider, _model, _key, prompt, _schema, _max_tokens):
                    if prompt.startswith("Inspect this actual image"):
                        self.assertEqual(main._provider_images.get(), (("file-0-pdf-p1-figure-1", self.image),))
                        return {"title": "Figure", "items": [{"question": "file-0-pdf-p1-figure-1", "answer": self.figure["context"], "relevant": True}]}
                    return {"title": "Plant biology", "items": [{"question": "Which structure in the attached diagram contains thylakoids?", "answer": "Chloroplast", "correct_answer": "Chloroplast", "options": ["Chloroplast", "Mitochondria", "Nucleoplasm", "Cytoplasmic"], "figure_refs": ["file-0-pdf-p1-figure-1"], "source_refs": ["notes.pdf · PDF page 1"]}]}
                with patch.object(main, "extract_material", return_value=("[SOURCE: notes.pdf · PDF page 1]\n" + self.material.decode(), ["PDF page 1"], [])), patch.object(main, "extract_pdf_figures", return_value=[self.figure]), patch.object(main, "configured_ai_models", return_value=[("gemini:gemini-3.8-flash", "gemini", "gemini-3.8-flash", "test-key", "Vision")]), patch.object(main, "generate_with_provider", side_effect=provide):
                    response = self.request(kind, True)
                self.assertEqual(response.status_code, 202, response.text)
                job = self.client.get("/api/generation-jobs/" + response.json()["job_id"]).json()
                self.assertEqual(job["status"], "complete", job)
                self.assertEqual(job["result"]["items"][0]["images"], [self.image])
                self.assertEqual(job["result"]["type"], kind)
                self.assertTrue(job["result"]["include_images"])
                self.assertEqual(next(iter(self.sets.values()))["items"][0]["images"], [self.image])
                self.sets.clear()

    def test_opt_out_never_extracts_or_sends_visuals(self):
        with patch.object(main, "extract_material", return_value=("[SOURCE: PDF page 1]\n" + self.material.decode(), ["PDF page 1"], [])), patch.object(main, "extract_pdf_figures") as extract:
            response = self.request("flashcards", False)
        self.assertEqual(response.status_code, 202, response.text)
        job = self.client.get("/api/generation-jobs/" + response.json()["job_id"]).json()
        self.assertEqual(job["status"], "complete", job)
        self.assertFalse(job["result"]["include_images"])
        self.assertNotIn("images", job["result"]["items"][0])
        extract.assert_not_called()

    def test_unknown_figures_and_unseen_visual_questions_are_rejected(self):
        self.assertIsNone(main.ground_visual_item({"question": "Identify this cell.", "answer": "Cell", "figure_refs": ["invented"]}))
        self.assertIsNone(main.ground_visual_item({"question": "Identify the attached image.", "answer": "Cell"}))

    def test_empty_voice_provider_choices_trigger_fallback_error(self):
        response = Mock(ok=True, status_code=200)
        response.json.return_value = {"choices": []}
        with patch.object(main, "post_provider_json", return_value=response):
            with self.assertRaises(main.ProviderError):
                main.generate_voice_reply("groq", "test", "key", "Study", [], "Hello")

    def test_vision_protocol_sends_pixels_only_to_supported_models(self):
        self.provider.side_effect = generate_with_provider
        response = Mock(ok=True, status_code=200)
        response.json.return_value = {"choices": [{"message": {"content": json.dumps({"title": "Q", "items": [{"question": "Q?", "answer": "A"}]})}}]}
        token = main._provider_images.set((("Question 1 figure 1", self.image),))
        try:
            with patch.object(main, "post_provider_json", return_value=response) as post:
                main.generate_with_provider("zai", "glm-4.6v-flash", "key", "Inspect", {}, 1000)
                content = post.call_args.kwargs["payload"]["messages"][0]["content"]
                self.assertEqual(content[-1]["image_url"]["url"], self.image)
                main.generate_with_provider("groq", "openai/gpt-oss-20b", "key", "Study", {}, 1000)
                self.assertIsInstance(post.call_args.kwargs["payload"]["messages"][0]["content"], str)
        finally:
            main._provider_images.reset(token)

    def test_invalid_saved_cards_are_rejected_before_storage(self):
        for item in ({}, {"question": None, "answer": "A"}, {"question": "Q?", "answer": "A", "options": "broken"}):
            response = self.client.post("/api/study-sets", json={"title": "Broken", "type": "flashcards", "items": [item]})
            self.assertEqual(response.status_code, 422, response.text)
        self.assertFalse(self.sets)

    def test_no_progress_continuation_is_an_error_instead_of_an_identical_success(self):
        source = "1. First question?\nAnswer: Alpha\n2. Second question?"
        existing = [{"question": "First question?", "answer": "Alpha", "source_number": "1", "questionnaire_index": 1, "imported": True, "card_id": "saved"}]
        with patch.object(main, "configured_ai_models", return_value=[]):
            with self.assertRaises(main.HTTPException) as caught:
                main.import_questionnaire([source], "flashcards", "auto", existing_items=existing)
        self.assertEqual(caught.exception.status_code, 503)
        self.assertIn("No new questions were added", caught.exception.detail)
        self.assertIn("Pending questions: 2", caught.exception.detail)
        self.assertEqual(existing[0]["answer"], "Alpha")

    def test_duplicate_distractors_are_not_usable_multiple_choice(self):
        self.assertIsNone(main.normalize_choice_item({"question": "Which language?", "answer": "Python", "options": ["Python", "Java", "java", "C#"]}, "multiple_choice"))

    def test_actual_provider_rejects_invented_supporting_quotes(self):
        self.provider.side_effect = generate_with_provider
        schema = {"properties": {"items": {"items": {"properties": {"source_evidence": {"type": "string"}}}}}}
        response = Mock(ok=True, status_code=200)
        item = {"question": "What absorbs light?", "answer": "Chlorophyll", "source_evidence": "Chlorophyll is located in the liver."}
        response.json.side_effect = lambda: {"choices": [{"message": {"content": json.dumps({"title": "Q", "items": [item]})}}]}
        token = main._generation_grounding_text.set("Chlorophyll absorbs light in chloroplasts.")
        try:
            with patch.object(main, "post_provider_json", return_value=response):
                with self.assertRaises(main.ProviderError) as caught:
                    main.generate_with_provider("zai", "glm-4.7-flash", "key", "Study", schema, 1000)
                self.assertEqual(caught.exception.partial_items, [])
                item["source_evidence"] = "Chlorophyll absorbs light"
                result = main.generate_with_provider("zai", "glm-4.7-flash", "key", "Study", schema, 1000)
                self.assertEqual(result["items"][0]["answer"], "Chlorophyll")
        finally:
            main._generation_grounding_text.reset(token)


if __name__ == "__main__":
    unittest.main()
