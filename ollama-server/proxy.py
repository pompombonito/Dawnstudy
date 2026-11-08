"""Loopback-only authentication proxy for exposing Ollama through a Quick Tunnel."""

import hmac
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import BoundedSemaphore
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


MAX_REQUEST_BYTES = 2 * 1024 * 1024
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
MAX_CONCURRENT_REQUESTS = 1
_request_slots = BoundedSemaphore(MAX_CONCURRENT_REQUESTS)
_UPSTREAM = "http://127.0.0.1:11434/v1/chat/completions"


class LimitedThreadingHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 8

    def process_request(self, request, client_address):
        if not _request_slots.acquire(blocking=False):
            try:
                request.sendall(
                    b"HTTP/1.1 503 Service Unavailable\r\n"
                    b"Content-Length: 0\r\nConnection: close\r\n\r\n"
                )
            finally:
                self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            _request_slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            _request_slots.release()


class OllamaProxyHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        if self.path == "/health":
            self._respond(200, b"ok", "text/plain; charset=utf-8")
            return
        self._respond(404, b"not found", "text/plain; charset=utf-8")

    def do_POST(self):
        if self.path != "/v1/chat/completions":
            self._respond(404, b"not found", "text/plain; charset=utf-8")
            return

        expected_key = os.getenv("OLLAMA_API_KEY", "").strip()
        authorization = self.headers.get("Authorization", "")
        supplied_key = authorization.removeprefix("Bearer ").strip()
        if not expected_key or not hmac.compare_digest(supplied_key, expected_key):
            self._respond(401, b"unauthorized", "text/plain; charset=utf-8")
            return

        if self.headers.get("Transfer-Encoding"):
            self._respond(400, b"transfer encoding not supported", "text/plain; charset=utf-8")
            return
        try:
            content_length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            content_length = 0
        if content_length < 1 or content_length > MAX_REQUEST_BYTES:
            self._respond(413, b"invalid request size", "text/plain; charset=utf-8")
            return

        request_body = self.rfile.read(content_length)
        upstream_request = Request(
            _UPSTREAM,
            data=request_body,
            headers={
                "Authorization": "Bearer ollama",
                "Content-Type": self.headers.get("Content-Type", "application/json"),
                "Content-Length": str(len(request_body)),
            },
            method="POST",
        )
        try:
            with urlopen(upstream_request, timeout=240) as response:
                body = response.read(MAX_RESPONSE_BYTES + 1)
                status = response.status
                content_type = response.headers.get("Content-Type", "application/json")
        except HTTPError as error:
            body = error.read(MAX_RESPONSE_BYTES + 1)
            status = error.code
            content_type = error.headers.get("Content-Type", "application/json")
        except (URLError, TimeoutError, OSError):
            self._respond(502, b"local Ollama is unavailable", "text/plain; charset=utf-8")
            return

        if len(body) > MAX_RESPONSE_BYTES:
            self._respond(502, b"local Ollama response is too large", "text/plain; charset=utf-8")
            return
        self._respond(status, body, content_type)

    def _respond(self, status, body, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)
        self.close_connection = True

    def log_message(self, _format, *_args):
        return


def main():
    if not os.getenv("OLLAMA_API_KEY", "").strip():
        raise SystemExit("Set the OLLAMA_API_KEY environment variable before starting the proxy.")
    server = LimitedThreadingHTTPServer(("127.0.0.1", 8787), OllamaProxyHandler)
    print("Authenticated Ollama proxy listening on 127.0.0.1:8787")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Ollama proxy.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
