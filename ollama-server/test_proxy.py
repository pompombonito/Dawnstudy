import http.client
import threading
import unittest
from unittest.mock import MagicMock, patch

from proxy import (
    MAX_REQUEST_BYTES,
    LimitedThreadingHTTPServer,
    OllamaProxyHandler,
)


class OllamaProxyTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict("os.environ", {"OLLAMA_API_KEY": "test-secret"})
        self.environment.start()
        self.server = LimitedThreadingHTTPServer(("127.0.0.1", 0), OllamaProxyHandler)
        self.server_thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.server_thread.start()
        self.port = self.server.server_address[1]

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.server_thread.join(timeout=2)
        self.environment.stop()

    def request(self, method, path, body=b"", headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=2)
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        result = response.status, response.read()
        connection.close()
        return result

    def test_requires_shared_secret_and_only_accepts_completion_route(self):
        with patch("proxy.urlopen") as upstream:
            status, _ = self.request("POST", "/v1/chat/completions", b"{}", {
                "Content-Type": "application/json",
            })
            self.assertEqual(status, 401)
            status, _ = self.request("POST", "/other", b"{}", {
                "Authorization": "Bearer test-secret",
            })
            self.assertEqual(status, 404)
            upstream.assert_not_called()

    def test_bounds_request_body_before_forwarding(self):
        status, _ = self.request("POST", "/v1/chat/completions", headers={
            "Authorization": "Bearer test-secret",
            "Content-Length": str(MAX_REQUEST_BYTES + 1),
        })
        self.assertEqual(status, 413)

    def test_forwards_authorized_request_only_to_local_ollama(self):
        upstream_response = MagicMock()
        upstream_response.__enter__.return_value = upstream_response
        upstream_response.read.return_value = b'{"choices":[]}'
        upstream_response.status = 200
        upstream_response.headers = {"Content-Type": "application/json"}
        with patch("proxy.urlopen", return_value=upstream_response) as upstream:
            status, body = self.request("POST", "/v1/chat/completions", b'{"model":"qwen3:4b"}', {
                "Authorization": "Bearer test-secret",
                "Content-Type": "application/json",
            })
        self.assertEqual((status, body), (200, b'{"choices":[]}'))
        forwarded = upstream.call_args.args[0]
        self.assertEqual(forwarded.full_url, "http://127.0.0.1:11434/v1/chat/completions")
        self.assertEqual(forwarded.get_header("Authorization"), "Bearer ollama")
        self.assertEqual(forwarded.data, b'{"model":"qwen3:4b"}')

    def test_busy_proxy_returns_503_without_queueing_another_inference(self):
        entered_upstream = threading.Event()
        release_upstream = threading.Event()
        upstream_response = MagicMock()
        upstream_response.__enter__.return_value = upstream_response
        upstream_response.read.return_value = b'{"choices":[]}'
        upstream_response.status = 200
        upstream_response.headers = {"Content-Type": "application/json"}

        def slow_upstream(*_args, **_kwargs):
            entered_upstream.set()
            release_upstream.wait(timeout=2)
            return upstream_response

        first_result = []
        with patch("proxy.urlopen", side_effect=slow_upstream):
            first_request = threading.Thread(
                target=lambda: first_result.append(self.request(
                    "POST", "/v1/chat/completions", b"{}",
                    {"Authorization": "Bearer test-secret"},
                ))
            )
            first_request.start()
            self.assertTrue(entered_upstream.wait(timeout=2))
            second_status, _ = self.request(
                "POST", "/v1/chat/completions", b"{}",
                {"Authorization": "Bearer test-secret"},
            )
            release_upstream.set()
            first_request.join(timeout=3)
        self.assertEqual(second_status, 503)
        self.assertEqual(first_result, [(200, b'{"choices":[]}')])

    def test_health_is_available_without_exposing_other_paths(self):
        self.assertEqual(self.request("GET", "/health"), (200, b"ok"))
        self.assertEqual(self.request("GET", "/v1/models")[0], 404)


if __name__ == "__main__":
    unittest.main()
