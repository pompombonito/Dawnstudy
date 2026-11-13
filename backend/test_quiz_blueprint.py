import json
import random
import unittest
from collections import Counter
from io import BytesIO
from unittest.mock import patch

import accounts
from generation_jobs import GenerationJobs
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
from quiz_blueprint import BlueprintError, allocate_questions, read_quiz_blueprint
import test_generation_delivery as delivery


def blueprint_pdf(total=4):
    writer = PdfWriter()
    font = writer._add_object(DictionaryObject({
        NameObject("/Type"): NameObject("/Font"),
        NameObject("/Subtype"): NameObject("/Type1"),
        NameObject("/BaseFont"): NameObject("/Helvetica"),
    }))
    for rows in (
        [(750, ("Quiz 4 Table of Specifications", "", "")),
         (720, ("Topic", "Content the items are drawn from", "No.")),
         (700, ("Plant physiology", "", "")),
         (680, ("Photosynthesis", "Light-dependent processes.", "3")),
         (660, ("and light absorption", "Chlorophyll and energy conversion.", ""))],
        [(750, ("Earth science", "", "")),
         (730, ("Volcanoes", "Lava flow and rock formation.", "1")),
         (710, ("Total", "", str(total)))],
    ):
        page = writer.add_blank_page(width=640, height=800)
        page[NameObject("/Resources")] = DictionaryObject({
            NameObject("/Font"): DictionaryObject({NameObject("/F1"): font}),
        })
        content = DecodedStreamObject()
        lines = [f"BT /F1 11 Tf {x} {y} Td ({text}) Tj ET"
                 for y, cells in rows for x, text in zip((42, 244, 567), cells) if text]
        content.set_data("\n".join(lines).encode())
        page[NameObject("/Contents")] = writer._add_object(content)
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


class BlueprintTests(unittest.TestCase):
    def test_wrapped_and_continued_topic_rows_scale_without_counting_group_headers(self):
        plan = read_quiz_blueprint("Quiz TOS.pdf", blueprint_pdf())
        self.assertEqual(plan.title, "Quiz 4 Table of Specifications")
        self.assertEqual([(topic.title, topic.group, topic.weight) for topic in plan.topics], [
            ("Photosynthesis and light absorption", "Plant physiology", 3),
            ("Volcanoes", "Earth science", 1),
        ])
        self.assertIn("Chlorophyll and energy conversion.", plan.topics[0].description)
        self.assertEqual(allocate_questions(plan, 10), {"t1": 8, "t2": 2})
        self.assertEqual(allocate_questions(plan, 4), {"t1": 3, "t2": 1})
        with self.assertRaisesRegex(BlueprintError, "add up"):
            read_quiz_blueprint("Quiz TOS.pdf", blueprint_pdf(total=5))


class BlueprintDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.fixture = delivery.DeliveryTests(methodName="runTest")
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.main = delivery.main
        self.provider = self.fixture.fixture.provider
        self.pdf = blueprint_pdf()
        self.material = b"Photosynthesis converts light energy into chemical energy. Chlorophyll absorbs red and blue light. Water splitting releases oxygen. Energy conversion reactions take place in chloroplasts. A volcano has eruptions."

    def submit(self, **fields):
        return self.fixture.client.post("/api/generation-jobs", data={
            "client_request_id": self.fixture.request_id, "format": "flashcards", "question_count": "4", **fields,
        }, files={
            "files": ("notes.txt", self.material, "text/plain"),
            "quiz_blueprint": ("test-tos.pdf", self.pdf, "application/pdf"),
        })

    def test_weighted_topic_cap_and_missing_source_survive_storage_and_restart(self):
        questions = [
            ("What does photosynthesis transform?", "Light energy", "Photosynthesis converts light energy into chemical energy."),
            ("Which wavelengths does chlorophyll absorb here?", "Red and blue light", "Chlorophyll absorbs red and blue light."),
            ("Which gas does water splitting release?", "Oxygen", "Water splitting releases oxygen."),
            ("Where do the energy conversion reactions take place?", "Chloroplasts", "Energy conversion reactions take place in chloroplasts."),
        ]
        cards = [{"question": question, "answer": answer, "source_evidence": evidence,
                  "source_refs": ["test-tos.pdf"]} for question, answer, evidence in questions]

        def model(_provider, _model, _key, prompt, schema, _tokens):
            self.assertNotIn("Quiz 4 Table of Specifications", prompt)
            self.assertNotIn("test-tos.pdf", prompt)
            self.assertIn("insufficient_source", schema["properties"])
            if '"topic": "Volcanoes"' in prompt:
                return {"title": "", "items": [], "insufficient_source": True}
            return {"title": "Practice quiz", "items": cards}

        self.provider.side_effect = model
        response = self.submit()
        self.assertEqual(response.status_code, 202, response.text)
        result = self.fixture.job()["result"]
        self.assertTrue(result["incomplete"])
        self.assertEqual(Counter(item["blueprint_topic"] for item in result["items"]), {"t1": 3})
        self.assertTrue(all(item["source_refs"] == ["notes.txt · Document"] for item in result["items"]))
        self.assertEqual(result["blueprint_coverage"], [
            {"topic_id": "t1", "requested": 3, "completed": 3},
            {"topic_id": "t2", "requested": 1, "completed": 0},
        ])

        user_id = self.fixture.fixture.user["user_id"]
        with patch.object(accounts, "_append") as append:
            accounts.save_study_set({**result, "user_id": user_id})
        row = dict(zip(accounts.SET_COLUMNS, append.call_args.args[1]))
        with patch.object(accounts, "_rows", return_value=[(2, row)]):
            reloaded = accounts.list_study_sets(user_id)[0]
        self.assertEqual(reloaded["quiz_blueprint"], result["quiz_blueprint"])
        self.assertEqual(reloaded["blueprint_coverage"], result["blueprint_coverage"])

        requests_before_restart = self.provider.call_count
        self.main.generation_jobs = GenerationJobs()
        recovered = self.submit()
        self.assertEqual(recovered.status_code, 202, recovered.text)
        self.assertEqual(recovered.json()["status"], "complete")
        self.assertEqual(recovered.json()["completed"], 3)
        self.assertEqual(self.provider.call_count, requests_before_restart)

    def test_checkpoint_must_match_blueprint_and_cannot_exceed_topic_quota(self):
        evidence = "Photosynthesis converts light energy into chemical energy."
        card = {"question": "What kind of energy is converted?", "answer": "Light energy", "source_evidence": evidence}
        self.provider.side_effect = [
            {"items": [card]},
            self.main.ProviderError("groq", "groq:test", 429, "temporary quota", retry_after=91),
        ]
        self.assertEqual(self.submit().status_code, 202)
        checkpoint = self.fixture.job()["checkpoint"]
        self.assertEqual(checkpoint["items"][0]["blueprint_topic"], "t1")
        self.main.generation_jobs = GenerationJobs()
        checkpoint["items"] += [{**checkpoint["items"][0], "question": f"Extra question {index}?"} for index in range(3)]
        rejected = self.submit(checkpoint_json=json.dumps(checkpoint))
        self.assertEqual(rejected.status_code, 422, rejected.text)

    def test_statement_quiz_resumes_from_21_of_110_after_provider_failures(self):
        blueprint = read_quiz_blueprint("test-tos.pdf", self.pdf)
        models = [
            ("antigravity:test", "antigravity", "test", "key", "Agent"),
            ("groq:first", "groq", "first", "key", "First"),
            ("groq:second", "groq", "second", "key", "Second"),
        ]
        evidence = "Photosynthesis converts light energy into chemical energy."
        words = self.material.decode().split()
        rng = random.Random(21)

        def item():
            return {
                "question": " ".join(rng.sample(words, 8)),
                "statements": [
                    {"text": " ".join(rng.sample(words, 7)), "is_true": i % 2 == 0, "evidence": evidence}
                    for i in range(4)
                ],
            }

        fields = {"format": "multiple_choice", "statement_combinations": "true", "question_count": "110", "model": models[0][0]}
        produced = 0
        recovered = False
        calls = Counter()

        def provider(name, model, _key, prompt, schema, _tokens):
            nonlocal produced
            calls[model] += 1
            if name == "antigravity":
                raise self.main.ProviderError(name, "antigravity:test", 400, "bad route")
            if model == "first" and produced >= 21:
                raise self.main.ProviderError(name, "groq:first", 429, "model quota", retry_after=95, model_scoped_quota=True)
            if model == "second" and not recovered:
                raise self.main.ProviderError(name, "groq:second", 429, "model quota", retry_after=90, model_scoped_quota=True)
            self.assertLess(len(prompt), 6000)
            batch = min(schema["properties"]["items"]["maxItems"], 110 - produced)
            if not recovered:
                batch = min(batch, 21 - produced)
            produced += batch
            return {"title": "Statement practice", "items": [item() for _ in range(batch)]}

        self.provider.side_effect = provider
        with patch.object(self.main, "configured_ai_models", return_value=models):
            started = self.submit(**fields)
            self.assertEqual(started.status_code, 202, started.text)
            waiting = self.fixture.job()
            self.assertEqual((waiting["stage"], waiting["completed"]), ("waiting", 21))
            self.assertIn("rate-limited", waiting["message"])
            self.assertIn("retry_at", waiting)
            checkpoint = waiting["checkpoint"]
            self.main.generation_jobs = GenerationJobs()
            recovered = True
            restored = self.submit(**fields, checkpoint_json=json.dumps(checkpoint))
            self.assertEqual(restored.status_code, 202, restored.text)
        job = self.fixture.job()
        self.assertEqual((job["status"], job["completed"]), ("complete", 110))
        self.assertNotIn("retry_at", job)
        self.assertEqual(
            [card["card_id"] for card in job["result"]["items"][:21]],
            [card["card_id"] for card in checkpoint["items"]],
        )
        self.assertEqual(Counter(card["blueprint_topic"] for card in job["result"]["items"]), allocate_questions(blueprint, 110))
        self.assertTrue(all(card["statement_combinations"] for card in job["result"]["items"]))

    def test_cooling_route_does_not_prevent_another_model_from_working_on_later_topics(self):
        models = [
            ("mistral:first", "mistral", "first", "key", "First"),
            ("groq:second", "groq", "second", "key", "Second"),
        ]

        def provider(name, model, _key, prompt, _schema, _tokens):
            if name == "mistral":
                raise self.main.ProviderError(name, "mistral:first", 429, "quota", retry_after=95)
            if '"topic": "Volcanoes"' in prompt:
                return {"items": [{"question": "What can a volcano have?", "answer": "Eruptions",
                                   "source_evidence": "A volcano has eruptions."}]}
            return {"items": []}

        self.provider.side_effect = provider
        with patch.object(self.main, "configured_ai_models", return_value=models):
            response = self.submit(model=models[0][0])
            self.assertEqual(response.status_code, 202, response.text)
        job = self.fixture.job()
        self.assertEqual((job["stage"], job["completed"]), ("waiting", 1))
        self.assertEqual(job["checkpoint"]["items"][0]["blueprint_topic"], "t2")
