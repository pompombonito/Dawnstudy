"""Provider retry metadata regressions; no keys, network or inference used."""

import unittest
from datetime import datetime, timezone

from provider_recovery import embedded_provider_error, model_scoped_quota, parse_reset_duration, parse_retry_after, retry_delay_from_response


class RetryHintTests(unittest.TestCase):
    def test_retry_after_supports_seconds_fractional_seconds_and_http_date(self):
        self.assertEqual(parse_retry_after("75"), 75)
        self.assertEqual(parse_retry_after("1.25"), 1.25)
        self.assertEqual(parse_retry_after(0), 0)
        now = datetime(2026, 11, 9, tzinfo=timezone.utc).timestamp()
        self.assertEqual(parse_retry_after("Mon, 09 Nov 2026 00:02:05 GMT", now=now), 125)
        self.assertEqual(parse_retry_after("Sun, 08 Nov 2026 23:59:59 GMT", now=now), 0)

    def test_invalid_hints_do_not_become_immediate_or_infinite_retries(self):
        for value in (None, "", "-1", -1, "nan", "inf", "1e1000", float("nan"),
                      float("inf"), True, [], {}, "not a date", "5 seconds", "0" * 129):
            with self.subTest(value=value):
                self.assertIsNone(parse_retry_after(value, now=0))

    def test_provider_durations_support_compound_units_and_subseconds(self):
        self.assertEqual(parse_reset_duration("7.66s"), 7.66)
        self.assertEqual(parse_reset_duration("2m59.56s"), 179.56)
        self.assertEqual(parse_reset_duration("1h2m3s"), 3723)
        self.assertEqual(parse_reset_duration("125ms"), .125)
        self.assertEqual(parse_reset_duration("0s"), 0)
        for value in (None, 10, "", "10", "-1s", "nans", "infs", "1s2m", "2s2s", "1s trailing"):
            with self.subTest(value=value):
                self.assertIsNone(parse_reset_duration(value))

    def test_google_retry_info_survives_missing_retry_after(self):
        body = {"error": {"code": 429, "details": [
            {"@type": "type.googleapis.com/google.rpc.QuotaFailure", "violations": []},
            {"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "42.5s"},
        ]}}
        self.assertEqual(retry_delay_from_response({}, body), 42.5)
        self.assertEqual(retry_delay_from_response({"Retry-After": "invalid"}, body), 42.5)

    def test_longest_applicable_hint_is_honored_without_clipping(self):
        headers = {"Retry-After": "5", "X-RateLimit-Remaining-Requests": "0",
                   "X-RateLimit-Reset-Requests": "2h", "X-RateLimit-Remaining-Tokens": "0",
                   "X-RateLimit-Reset-Tokens": "1m"}
        self.assertEqual(retry_delay_from_response(headers), 7200)

    def test_always_present_unexhausted_reset_headers_do_not_delay_retry(self):
        headers = {"retry-after": "7", "x-ratelimit-remaining-requests": "100",
                   "x-ratelimit-reset-requests": "23h", "x-ratelimit-remaining-tokens": "0",
                   "x-ratelimit-reset-tokens": "6.5s"}
        self.assertEqual(retry_delay_from_response(headers), 7)
        self.assertIsNone(retry_delay_from_response({"x-ratelimit-reset-requests": "23h"}))
        self.assertIsNone(retry_delay_from_response({"x-ratelimit-remaining-tokens": "invalid",
                                                    "x-ratelimit-reset-tokens": "1m"}))

    def test_malformed_error_shapes_are_absent_hints(self):
        for body in (None, [], {"error": "oops"}, {"error": {"details": "bad"}},
                     {"error": {"details": [None, [], {"@type": "other.RetryInfo", "retryDelay": "5s"},
                                               {"@type": "google.rpc.RetryInfo", "retryDelay": "not a duration"}]}}):
            with self.subTest(body=body):
                self.assertIsNone(retry_delay_from_response({}, body))


class EmbeddedErrorTests(unittest.TestCase):
    def test_top_level_http_200_failure_retains_numeric_status_and_safe_identifiers(self):
        self.assertEqual(embedded_provider_error({"error": {"code": 429, "message": "private source data"}}),
                         (429, "429", None))
        self.assertEqual(embedded_provider_error({"error": {"code": "503", "param": "model"}}),
                         (503, "503", "model"))

    def test_first_choice_error_is_classified_without_discarding_partial_content(self):
        body = {"choices": [{"finish_reason": "error", "error": {"code": 502},
                             "message": {"content": '{"items": [{"question": "Q", "answer": "A"}]}'}}]}
        self.assertEqual(embedded_provider_error(body), (502, "502", None))
        self.assertEqual(body["choices"][0]["message"]["content"], '{"items": [{"question": "Q", "answer": "A"}]}')

    def test_successful_and_malformed_envelopes_do_not_become_provider_errors(self):
        for body in (None, [], {"choices": []}, {"choices": [None]}, {"error": "502"},
                     {"choices": [{"message": {"content": "A useful answer"}, "finish_reason": "stop"}]},
                     {"error": {"code": 200}}, {"error": {"code": 429.5}},
                     {"error": {"code": "NaN"}}, {"error": {"code": float("inf")}},
                     {"error": {"code": True}}, {"error": {"code": "rate_limit_exceeded"}}):
            with self.subTest(body=body):
                self.assertIsNone(embedded_provider_error(body))

    def test_safe_identifiers_are_bounded_and_messages_are_not_exposed(self):
        result = embedded_provider_error({"error": {"code": 503, "param": "x" * 200, "message": "secret"}})
        self.assertEqual(result, (503, "503", "x" * 120))


class QuotaScopeTests(unittest.TestCase):
    def test_gemini_distinguishes_model_quota_and_project_wide_violation(self):
        violations = [{"quotaDimensions": {"model": "gemini-3.1-flash-lite", "location": "global"}}]
        body = {"error": {"details": [
            {"@type": "type.googleapis.com/google.rpc.QuotaFailure", "violations": violations},
        ]}}
        self.assertTrue(model_scoped_quota("gemini", body))
        violations.append({"quotaDimensions": {"location": "global"}})
        self.assertFalse(model_scoped_quota("gemini", body))

    def test_model_limit_codes_and_router_metadata_are_not_generalized(self):
        self.assertTrue(model_scoped_quota("groq", {"error": {"code": "rate_limit_exceeded"}}))
        self.assertFalse(model_scoped_quota("groq", {"error": {"code": "429"}}))
        for scope in ("upstream_provider_shared_pool", "openrouter_free_tier_per_minute"):
            body = {"choices": [{"error": {"code": 429, "metadata": {"limit_source": scope}}}]}
            self.assertEqual(model_scoped_quota("openrouter", body), scope == "upstream_provider_shared_pool")
        self.assertFalse(model_scoped_quota("zai", {"error": {"code": "1302"}}))


if __name__ == "__main__":
    unittest.main()
