from base64 import b64decode
from io import BytesIO
import unittest

from PIL import Image

from website_figures import MAX_WEB_IMAGE_BYTES, _ImageReferenceParser, extract_website_figures


class WebsiteFigureTests(unittest.TestCase):
    def png(self):
        output = BytesIO()
        Image.new("RGB", (180, 120), "#4275a2").save(output, format="PNG")
        return output.getvalue()

    @staticmethod
    def encode(image):
        output = BytesIO()
        image.save(output, format="WEBP", quality=60)
        from base64 import b64encode
        return "data:image/webp;base64," + b64encode(output.getvalue()).decode("ascii")

    def test_parser_keeps_captions_lazy_images_and_page_preview(self):
        parser = _ImageReferenceParser()
        parser.feed("""
            <meta property="og:image" content="/cover.png">
            <figure><img data-src="../plate.png" alt="XLD agar culture">
            <figcaption>Figure 4. Salmonella colonies on XLD agar.</figcaption></figure>
            <img srcset="/small.png 320w, /large.png 1600w" alt="Microscopy slide">
        """)
        self.assertEqual(parser.metadata_references[0]["url"], "/cover.png")
        self.assertEqual(parser.references[0]["url"], "../plate.png")
        self.assertEqual(parser.references[0]["caption"], "Figure 4. Salmonella colonies on XLD agar.")
        self.assertEqual(parser.references[1]["url"], "/large.png")

    def test_extracts_relative_images_as_small_sanitized_webp_with_context(self):
        raw = self.png()
        calls = []

        def fetch(url, max_response_bytes):
            calls.append((url, max_response_bytes))
            return raw, url, "image/png"

        figures = extract_website_figures(
            '<figure><img src="../plate.png" alt="XLD agar"><figcaption>Figure 4: Salmonella colonies</figcaption></figure>',
            "https://example.org/course/chapter.html", "Microbiology culture media",
            fetch, self.encode,
        )
        self.assertEqual(len(figures), 1)
        self.assertEqual(figures[0]["id"], "website-figure-1")
        self.assertEqual(figures[0]["source_ref"], "Website")
        self.assertIn("Salmonella colonies", figures[0]["context"])
        self.assertIn("XLD agar", figures[0]["context"])
        self.assertIn("Microbiology culture media", figures[0]["context"])
        self.assertEqual(calls, [("https://example.org/plate.png", MAX_WEB_IMAGE_BYTES)])
        mime, payload = figures[0]["data_url"].split(",", 1)
        self.assertEqual(mime, "data:image/webp;base64")
        with Image.open(BytesIO(b64decode(payload))) as saved:
            self.assertEqual(saved.format, "WEBP")
            self.assertEqual(saved.size, (180, 120))

    def test_uses_open_graph_image_for_articles_and_skips_non_http_assets(self):
        raw = self.png()
        calls = []

        def fetch(url, max_response_bytes):
            calls.append(url)
            return raw, url, "image/png"

        figures = extract_website_figures(
            '<meta property="og:image" content="//cdn.example.org/cover.png">'
            '<img src="javascript:alert(1)" alt="bad">',
            "https://example.org/article", "A public article about fungi", fetch, self.encode,
        )
        self.assertEqual(calls, ["https://cdn.example.org/cover.png"])
        self.assertEqual(len(figures), 1)
        self.assertIn("A public article about fungi", figures[0]["context"])

    def test_skips_decorative_broken_and_non_image_references_without_failing_text_import(self):
        calls = []

        def fetch(url, max_response_bytes):
            calls.append(url)
            return b"not an image", url, "text/html"

        figures = extract_website_figures(
            '<img src="/pixel.gif" alt="tracking pixel" width="1" height="1">'
            '<img src="/broken.png" alt="Useful diagram">',
            "https://example.org/article", "The text is still readable.", fetch, self.encode,
        )
        self.assertEqual(calls, ["https://example.org/broken.png"])
        self.assertEqual(figures, [])


if __name__ == "__main__":
    unittest.main()
