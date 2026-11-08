import ast
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import sys
from types import SimpleNamespace
from urllib.parse import unquote, urlparse
import unittest
from unittest.mock import Mock, patch

from smry_material import SmryUnavailable, extract_public_article


class SmryMaterialTests(unittest.TestCase):
    def response(self, article, status=200):
        response = Mock(status_code=status)
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.iter_content.return_value = [json.dumps({"article": article}).encode()]
        return response

    def article(self, **changes):
        text = "Source paragraph. An exact explanation with supporting details. " * 4
        return {"content": text, "title": "Material", "truncated": False,
                "contentCharacters": len(text), "returnedCharacters": len(text), **changes}

    @patch.dict("os.environ", {"SMRY_API_KEY": ""})
    def test_disabled_reader_makes_no_network_request(self):
        with patch("smry_material.requests.post") as post:
            self.assertIsNone(extract_public_article("https://example.org/article"))
        post.assert_not_called()

    @patch.dict("os.environ", {"SMRY_API_KEY": "test-server-secret"})
    def test_reads_source_not_summary_and_disables_authenticated_redirects(self):
        article = self.article(summary="Invented summary must be ignored")
        with patch("smry_material.requests.post", return_value=self.response(article)) as post:
            result = extract_public_article("https://example.org/article")
        self.assertEqual(result.text, article["content"].strip())
        self.assertEqual(result.source_url, "https://example.org/article")
        self.assertNotIn("summary", result.text)
        self.assertEqual(post.call_args.args, ("https://api.smry.ai/v1/articles/extract",))
        self.assertEqual(post.call_args.kwargs["json"], {"url": "https://example.org/article"})
        self.assertFalse(post.call_args.kwargs["allow_redirects"])

    @patch.dict("os.environ", {"SMRY_API_KEY": "test-server-secret"})
    def test_partial_short_and_malformed_sources_are_rejected(self):
        for article in (self.article(truncated=True), self.article(content="Too short"),
                        self.article(contentCharacters=10000), None):
            with self.subTest(article=article), patch("smry_material.requests.post", return_value=self.response(article)):
                with self.assertRaises(SmryUnavailable):
                    extract_public_article("https://example.org/article")

    @patch.dict("os.environ", {"SMRY_API_KEY": "test-server-secret"})
    def test_rate_limit_is_safe_and_does_not_leak_key(self):
        with patch("smry_material.requests.post", return_value=self.response({}, 429)) as post:
            with self.assertRaises(SmryUnavailable) as error:
                extract_public_article("https://example.org/article")
        self.assertNotIn("test-server-secret", str(error.exception))
        self.assertEqual(post.call_count, 1)

    @patch.dict("os.environ", {"SMRY_API_KEY": "test-server-secret"})
    def test_oversized_response_is_bounded(self):
        response = self.response(self.article())
        response.iter_content.return_value = [b" " * 100]
        with patch("smry_material.requests.post", return_value=response), patch("smry_material.MAX_RESPONSE_BYTES", 50):
            with self.assertRaises(SmryUnavailable):
                extract_public_article("https://example.org/article")


class PublicReaderIntegrationTests(unittest.TestCase):
    """Exercise the actual URL reader without booting unrelated API services."""

    def reader(self, html, fallback):
        class ReaderHTTPError(Exception):
            def __init__(self, status_code, detail):
                self.status_code, self.detail = status_code, detail

        tree = ast.parse(Path(__file__).with_name("main.py").read_text(encoding="utf-8"))
        nodes = [node for node in tree.body if isinstance(node, (ast.ClassDef, ast.FunctionDef))
                 and node.name in {"_PublicPageParser", "extract_public_material_url"}]
        namespace = {"HTMLParser": HTMLParser, "re": re, "os": os, "Any": object,
                     "unquote": unquote, "urlparse": urlparse, "HTTPException": ReaderHTTPError,
                     "SmryUnavailable": SmryUnavailable, "extract_smry_article": fallback,
                     "_fetch_public_material_url": lambda value: (html.encode(), value, "text/html")}
        exec(compile(ast.Module(body=nodes, type_ignores=[]), "main.py", "exec"), namespace)
        return namespace["extract_public_material_url"], ReaderHTTPError

    def test_readable_html_has_consistent_figure_slot_and_skips_external_reader(self):
        fallback = Mock()
        reader, _ = self.reader("<title>Notes</title><p>" + "Study explanation. " * 20 + "</p>", fallback)
        with patch.dict(sys.modules, {"youtube_material": SimpleNamespace(video_id=lambda value: None, extract=None)}):
            result = reader("https://example.org/notes")
        self.assertEqual(len(result), 7)
        self.assertEqual(result[-1], [])
        fallback.assert_not_called()

    def test_public_shell_uses_complete_extracted_text(self):
        from smry_material import SmryArticle
        article = SmryArticle("Exact source text. " * 20, "Source title", "https://example.org/notes")
        reader, _ = self.reader("<title>Loading</title><div id='root'></div>", Mock(return_value=article))
        with patch.dict(sys.modules, {"youtube_material": SimpleNamespace(video_id=lambda value: None, extract=None)}):
            result = reader("https://example.org/notes")
        self.assertEqual(result[0], "[SOURCE: Website]\n" + article.text)
        self.assertEqual(result[2], "Source title")
        self.assertEqual(len(result), 7)

    def test_login_wall_never_reaches_shared_reading_key(self):
        fallback = Mock()
        reader, error_type = self.reader("<title>Sign in</title><p>Please sign in</p>", fallback)
        with patch.dict(sys.modules, {"youtube_material": SimpleNamespace(video_id=lambda value: None, extract=None)}):
            with self.assertRaises(error_type) as error:
                reader("https://example.org/login")
        self.assertEqual(error.exception.status_code, 422)
        fallback.assert_not_called()

if __name__ == "__main__":
    unittest.main()
