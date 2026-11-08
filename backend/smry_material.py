"""Optional clean source text, using SMRY's documented article API.

This is extraction, never AI summarization. It does not replace PDF layout,
highlight, answer-key, or figure extraction. Callers validate public URLs first.
API contract: https://api.smry.ai/openapi.json
"""
from dataclasses import dataclass
import json
import os
from urllib.parse import urlparse

import requests


MAX_RESPONSE_BYTES = 3 * 1024 * 1024
MAX_CONTENT_CHARS = 1_000_000


class SmryUnavailable(Exception):
    """An optional reader cannot supply complete usable source text."""


@dataclass(frozen=True)
class SmryArticle:
    text: str
    title: str
    source_url: str


def extract_public_article(url: str) -> SmryArticle | None:
    """Return complete extracted text, or None if no server key is configured.

    The app must run its public-address checks before calling this function.
    Redirects from the authenticated API are disabled so a credential cannot be
    forwarded to an unexpected host. Errors intentionally omit response bodies,
    request headers, and credentials.
    """
    api_key = os.getenv("SMRY_API_KEY", "").strip()
    if not api_key:
        return None
    parsed = urlparse(url)
    if (parsed.scheme not in {"http", "https"} or not parsed.hostname
            or parsed.username is not None or parsed.password is not None
            or len(url) > 2048):
        raise SmryUnavailable("A validated public source URL is required.")
    try:
        with requests.post(
            "https://api.smry.ai/v1/articles/extract",
            headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
            json={"url": url},
            timeout=(5, 25),
            allow_redirects=False,
            stream=True,
        ) as response:
            if response.status_code != 200:
                raise SmryUnavailable("SMRY could not read this public source.")
            body = bytearray()
            for chunk in response.iter_content(chunk_size=65536):
                body.extend(chunk)
                if len(body) > MAX_RESPONSE_BYTES:
                    raise SmryUnavailable("SMRY returned too much source text.")
            payload = json.loads(body)
    except (requests.RequestException, ValueError, TypeError) as exc:
        raise SmryUnavailable("SMRY is temporarily unavailable.") from exc
    article = payload.get("article") if isinstance(payload, dict) else None
    if not isinstance(article, dict):
        raise SmryUnavailable("SMRY returned an unreadable source.")
    text = article.get("content")
    # A truncated response must not silently become the complete source for a
    # verbatim import or a generation request.
    if (not isinstance(text, str) or len("".join(text.split())) < 80
            or len(text) > MAX_CONTENT_CHARS or article.get("truncated") is not False):
        raise SmryUnavailable("SMRY did not return complete readable source text.")
    declared_length = article.get("contentCharacters")
    returned_length = article.get("returnedCharacters")
    if (isinstance(declared_length, (int, float)) and isinstance(returned_length, (int, float))
            and declared_length > returned_length):
        raise SmryUnavailable("SMRY returned only part of the source.")
    title = article.get("title")
    return SmryArticle(text.strip(), title.strip()[:180] if isinstance(title, str) else "", url)
