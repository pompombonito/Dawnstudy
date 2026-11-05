import ast
import http
from pathlib import Path
import unittest
from urllib.parse import urljoin, urlparse


class PublicMaterialSizeTests(unittest.TestCase):
    def fetcher(self, body, content_type="text/html", declared_length=None):
        class ReaderError(Exception):
            def __init__(self, status_code, detail):
                self.status_code = status_code
                self.detail = detail

        class Response:
            status = 200
            def __init__(self):
                self.headers = {"Content-Type": content_type, "Content-Length": str(declared_length if declared_length is not None else len(body))}
                self.sent = False
            def read(self, _size):
                if self.sent:
                    return b""
                self.sent = True
                return body
            def close(self):
                pass

        class Connection:
            def request(self, *_args, **_kwargs):
                pass
            def getresponse(self):
                return Response()
            def close(self):
                pass

        tree = ast.parse(Path(__file__).with_name("main.py").read_text(encoding="utf-8"))
        node = next(item for item in tree.body if isinstance(item, ast.FunctionDef) and item.name == "_fetch_public_material_url")
        limit_node = next(item for item in tree.body if isinstance(item, ast.Assign)
                          and any(isinstance(target, ast.Name) and target.id == "MAX_WEBPAGE_BYTES" for target in item.targets))
        page_limit = eval(compile(ast.Expression(limit_node.value), "main.py", "eval"), {})
        namespace = {
            "MAX_WEBPAGE_BYTES": page_limit,
            "MAX_BYTES": 15 * 1024 * 1024,
            "HTTPException": ReaderError,
            "_validate_public_material_url": lambda value: value,
            "pinned_public_connection": lambda _url: Connection(),
            "urljoin": urljoin,
            "urlparse": urlparse,
            "http": http,
        }
        exec(compile(ast.Module(body=[node], type_ignores=[]), "main.py", "exec"), namespace)
        return namespace["_fetch_public_material_url"], ReaderError

    def test_webpage_over_previous_three_megabyte_cap_is_streamed(self):
        source = Path(__file__).with_name("main.py").read_text(encoding="utf-8")
        limit_node = next(item for item in ast.parse(source).body if isinstance(item, ast.Assign)
                          and any(isinstance(target, ast.Name) and target.id == "MAX_WEBPAGE_BYTES" for target in item.targets))
        page_limit = eval(compile(ast.Expression(limit_node.value), "main.py", "eval"), {})
        self.assertEqual(page_limit, 15 * 1024 * 1024)
        body = b"x" * (4 * 1024 * 1024)
        fetch, _ = self.fetcher(body)
        raw, url, content_type = fetch("https://example.org/notes")
        self.assertEqual(len(raw), len(body))
        self.assertEqual(url, "https://example.org/notes")
        self.assertEqual(content_type, "text/html")

    def test_oversized_page_returns_a_clear_bounded_limit_error(self):
        fetch, error_type = self.fetcher(b"", declared_length=16 * 1024 * 1024)
        with self.assertRaises(error_type) as error:
            fetch("https://example.org/notes")
        self.assertEqual(error.exception.status_code, 413)
        self.assertIn("15 MB reading limit", error.exception.detail)


if __name__ == "__main__":
    unittest.main()
