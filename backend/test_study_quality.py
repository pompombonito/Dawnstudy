import unittest
from study_quality import is_source_lookup_question
import test_generation_limits as fixtures

main = fixtures.main


class QuestionQualityTests(unittest.TestCase):
    def test_rejects_source_lookup_variants(self):
        for question in [
            "Which antiviral agent is listed on page 465?",
            "On page 465, which agent is mentioned?",
            "Which term is shown on slide #12?",
            "What is listed in Chapter IV?",
            "Which organelle is mentioned in the uploaded material?",
            "Which page discusses cellular respiration?",
            "How many pages does the uploaded document contain?",
            "What is the file name of the uploaded PDF?",
        ]:
            with self.subTest(question=question):
                self.assertTrue(is_source_lookup_question(question))

    def test_preserves_subject_questions_and_legitimate_numbers(self):
        for question in [
            "Which organelle produces most ATP during aerobic respiration?",
            "According to the material, how does osmosis differ from diffusion?",
            "What happens in stage 2 of this process?",
            "What distinguishes type IV from type III?",
            "Which algorithm replaces the least recently used virtual memory page?",
        ]:
            with self.subTest(question=question):
                self.assertFalse(is_source_lookup_question(question))


class GenerationQualityIntegrationTests(unittest.TestCase):
    setUp = fixtures.GenerationLimitTests.setUp
    provide = fixtures.GenerationLimitTests.provide
    update = fixtures.GenerationLimitTests.update
    generate = fixtures.GenerationLimitTests.generate

    def test_rejected_questions_are_refilled_and_good_work_is_kept(self):
        bad={"question":"Which antiviral agent is listed on page 465?", "answer":"Valacyclovir"}
        good={"question":"Which organelle produces most ATP during aerobic respiration?", "answer":"Mitochondrion"}
        replacement={"question":"What do ribosomes synthesize?", "answer":"Proteins"}
        self.provider.side_effect=[{"items":[bad,good]}, {"items":[replacement]}]
        generated=self.generate(2)
        self.assertEqual(generated.status_code,200,generated.text)
        self.assertEqual(generated.json()["items"],[{**good,"source_refs":[]},{**replacement,"source_refs":[]}])
        self.assertFalse(generated.json()["incomplete"])
        self.assertEqual(self.provider.call_count,2)
        self.assertIn("not the layout",self.provider.call_args.args[3])

    def test_partial_provider_responses_are_checked_too(self):
        bad={"question":"Which term is listed on slide 5?", "answer":"Diffusion"}
        good={"question":"What do ribosomes synthesize?", "answer":"Proteins"}
        self.provider.side_effect=[main.ProviderError("groq","test",200,"truncated",[bad,good])]
        generated=self.generate(1)
        self.assertEqual(generated.status_code,200,generated.text)
        self.assertEqual(generated.json()["items"],[{**good,"source_refs":[]}])

    def test_choice_questions_are_checked_before_they_are_accepted(self):
        options=["Mitochondrion","Golgi complex","Nucleolus","Lysosome"]
        bad={"question":"Which organelle is listed on page 465?","answer":"Mitochondrion","options":options}
        good={"question":"Which organelle produces most ATP during aerobic respiration?","answer":"Mitochondrion","options":options}
        for kind in ["multiple_choice","checkbox","identification"]:
            with self.subTest(kind=kind):
                self.provider.side_effect=[{"items":[bad]}, {"items":[good]}]
                result=self.client.post("/api/generate",data={"format":kind,"question_count":"1"},files={"files":("notes.txt",self.material,"text/plain")})
                self.assertEqual(result.status_code,200,result.text)
                self.assertEqual(result.json()["items"][0]["question"],good["question"])


if __name__ == "__main__":
    unittest.main()
