"""Extract relevant, bounded raster figures referenced by public webpages."""
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from io import BytesIO
import re
from urllib.parse import urljoin, urlsplit, urlunsplit

from PIL import Image, ImageOps


MAX_WEB_IMAGE_BYTES = 4 * 1024 * 1024
MAX_WEB_IMAGES_BYTES = 12 * 1024 * 1024
MAX_WEB_FIGURES = 13  # Generation inspects 12 and reports when more were found.
MAX_WEB_IMAGE_PIXELS = 40_000_000


def _srcset_candidate(value):
    candidates = []
    for item in value.split(","):
        fields = item.strip().split()
        if not fields or fields[0].lower().startswith("data:"):
            continue
        descriptor = fields[1] if len(fields) > 1 else "1x"
        match = re.fullmatch(r"(\d+(?:\.\d+)?)(w|x)", descriptor)
        weight = float(match[1]) if match else 1.0
        if match and match[2] == "x":
            weight *= 1200
        candidates.append((min(weight, 2400), fields[0]))
    return max(candidates, default=(0, ""))[1]


class _ImageReferenceParser(HTMLParser):
    """Keep image URLs, accessible labels, and their nearest figure captions."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.references = []
        self.metadata_references = []
        self.figure_stack = []

    @staticmethod
    def _reference(attrs, source):
        attrs = dict(attrs)
        def value(key):
            item = attrs.get(key)
            return item.strip() if isinstance(item, str) else ""
        srcset = _srcset_candidate(value("srcset"))
        url = srcset or value("data-src") or value("data-lazy-src") or value("data-original") or value("src")
        if not url:
            return None
        return {
            "url": url,
            "alt": value("alt"),
            "title": value("title"),
            "width": value("width"),
            "height": value("height"),
            "role": value("role").casefold(),
            "aria_hidden": value("aria-hidden").casefold() == "true",
            "class": value("class").casefold(),
            "source": source,
            "caption": "",
        }

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "figure":
            self.figure_stack.append({"images": [], "text": []})
        elif tag == "img":
            reference = self._reference(attrs, "img")
            if reference:
                (self.figure_stack[-1]["images"] if self.figure_stack else self.references).append(reference)
        elif tag == "source" and self.figure_stack:
            reference = self._reference(attrs, "source")
            if reference:
                self.figure_stack[-1]["images"].append(reference)
        elif tag == "meta":
            key = (values.get("property") or values.get("name") or "").casefold()
            if key in {"og:image", "og:image:url", "twitter:image", "twitter:image:src"}:
                reference = self._reference([("src", values.get("content", "")), ("alt", values.get("alt", ""))], "meta")
                if reference:
                    self.metadata_references.append(reference)

    def handle_data(self, data):
        for figure in self.figure_stack:
            figure["text"].append(data)

    def handle_endtag(self, tag):
        if tag == "figure" and self.figure_stack:
            figure = self.figure_stack.pop()
            caption = re.sub(r"\s+", " ", " ".join(figure["text"])).strip()[:500]
            for reference in figure["images"]:
                if caption:
                    reference["caption"] = caption
                (self.figure_stack[-1]["images"] if self.figure_stack else self.references).append(reference)


def _usable_reference(reference):
    if reference["aria_hidden"] or reference["role"] == "presentation":
        return False
    signals = " ".join((reference["alt"], reference["title"], reference["caption"], reference["class"])).casefold()
    decorative = bool(re.search(r"\b(?:tracking|spacer|pixel|decorative|separator|bullet|icon)\b", signals))
    try:
        width, height = int(reference["width"] or 0), int(reference["height"] or 0)
    except ValueError:
        width = height = 0
    if decorative and (not width or not height or min(width, height) < 96):
        return False
    if width and height and min(width, height) < 40 and not reference["caption"]:
        return False
    return True


def _public_image_url(base_url, value):
    try:
        parsed = urlsplit(urljoin(base_url, value.strip()))
        if parsed.scheme.casefold() not in {"http", "https"} or not parsed.hostname:
            return ""
        if parsed.username is not None or parsed.password is not None or len(parsed.geturl()) > 2048:
            return ""
        return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ""))
    except ValueError:
        return ""


def _raster_figure(reference, base_url, page_context, fetch, encode_image):
    url = _public_image_url(base_url, reference["url"])
    if not url:
        return None
    raw, final_url, content_type = fetch(url, max_response_bytes=MAX_WEB_IMAGE_BYTES)
    if len(raw) > MAX_WEB_IMAGE_BYTES or (content_type and not content_type.startswith("image/")):
        return None
    try:
        with Image.open(BytesIO(raw)) as original:
            if original.width * original.height > MAX_WEB_IMAGE_PIXELS:
                return None
            original.seek(0)
            image = ImageOps.exif_transpose(original).convert("RGB")
        try:
            if min(image.size) < 48:
                return None
            image.thumbnail((1800, 1800), Image.Resampling.LANCZOS)
            data_url = encode_image(image)
        finally:
            image.close()
    except (OSError, ValueError, Image.DecompressionBombError):
        return None
    context = []
    if reference["caption"]:
        context.append("Figure caption: " + reference["caption"])
    if reference["alt"]:
        context.append("Image alt text: " + reference["alt"])
    if reference["title"]:
        context.append("Image title: " + reference["title"])
    if page_context:
        context.append("Nearby webpage text: " + re.sub(r"\s+", " ", page_context).strip()[:1400])
    if not context:
        context.append("Image from public webpage: " + final_url)
    return {"source_ref": "Website", "context": "\n".join(context)[:1800], "data_url": data_url,
            "_source_bytes": len(raw)}


def extract_website_figures(page_source, page_url, page_context, fetch, encode_image, check_cancel=None):
    """Fetch and rasterize a few meaningful page figures using the caller's safe fetcher."""
    parser = _ImageReferenceParser()
    try:
        parser.feed(page_source)
    except Exception:
        return []
    references = parser.metadata_references + parser.references
    unique, seen = [], set()
    for reference in references:
        if not _usable_reference(reference):
            continue
        url = _public_image_url(page_url, reference["url"])
        if not url or url in seen:
            continue
        seen.add(url)
        reference["url"] = url
        unique.append(reference)
        if len(unique) >= MAX_WEB_FIGURES:
            break

    figures, total_bytes = [], 0
    # Small bounded parallelism avoids a slow site serializing a dozen image
    # timeouts while keeping worst-case memory and remote requests controlled.
    with ThreadPoolExecutor(max_workers=4, thread_name_prefix="web-figure") as pool:
        pending = []
        for reference in unique:
            if check_cancel:
                check_cancel()
            pending.append(pool.submit(_raster_figure, reference, page_url, page_context, fetch, encode_image))
        for future in pending:
            if check_cancel:
                check_cancel()
            try:
                figure = future.result()
            except Exception:
                continue
            if not figure:
                continue
            payload_size = figure.pop("_source_bytes", 0)
            if total_bytes + payload_size > MAX_WEB_IMAGES_BYTES:
                break
            total_bytes += payload_size
            figure["id"] = f"website-figure-{len(figures) + 1}"
            figures.append(figure)
    return figures
