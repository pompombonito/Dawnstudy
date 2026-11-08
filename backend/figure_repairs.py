"""Conservative read repairs for figures saved by the old PDF layout importer.

New imports are fixed by the layout reader. This migration only recognizes
verified legacy image bytes already present in a set; it never fetches artwork,
rewrites questions, or infers an answer from a medical subject.
"""

import hashlib
import re
import unicodedata


KNOWN_IMAGE_SHA256 = {
    "9f62809d87338ee12ddbdf1b4a4dc341d8cfa743f4c01b41628030de3faabd9f": "Figure 1-4",
    "c77337e4b0c0d86a6739ddfe995de433527c7dfafa1a6e7c6419f7bf6a90d9cf": "Figure 1-5",
    "7cf7969c5fdbfbab64336c21e51c6217501a4b24c16f0a251d105f374fb08ed9": "Figure 1-7",
}
_PLATES = {"Figure 1-4", "Figure 1-5"}


def _text(value):
    value = unicodedata.normalize("NFKC", str(value or "")).casefold()
    value = value.replace("\u00ad", "")
    return re.sub(r"[^a-z0-9]+", " ", value).strip()


def _image_label(image):
    if not isinstance(image, str):
        return None
    return KNOWN_IMAGE_SHA256.get(hashlib.sha256(image.encode("utf-8")).hexdigest())


def _plate_for_question(item):
    text = _text(item.get("question"))
    if "bacterial isolate" not in text or "routine stool culture" not in text:
        return None
    if "xld agar" in text:
        return "Figure 1-4"
    if "cin agar" in text:
        return "Figure 1-5"
    return None


def _with_figure(item, image, label):
    return {**item, "images": [image], "image_labels": [label], "image_captions": [label]}


def _smear_question(item):
    text = _text(item.get("question"))
    return all(phrase in text for phrase in ("gram stained smear", "blood culture", "bowel surgery"))


def _colitis_question(item):
    text = _text(item.get("question"))
    return all(phrase in text for phrase in ("pseudomembranous colitis", "difficile", "laboratory findings"))


def _source_documents(item):
    refs = item.get("source_refs", [])
    if not isinstance(refs, list):
        return set()
    return {re.split(r"\s*·\s*PDF page\s+\d+", ref, flags=re.I)[0].casefold()
            for ref in refs if isinstance(ref, str) and re.search(r"·\s*PDF page\s+\d+", ref, re.I)}


def _repair_smear(repaired, assets):
    # The same old page-leading-image bug put the following verified figure on
    # the next, unrelated question. Require both unique question identities so
    # an isolated card cannot lose its only illustration based on proximity.
    owners = [index for index, item in enumerate(repaired)
              if isinstance(item, dict) and item.get("imported") is True and _smear_question(item)]
    followers = [index for index, item in enumerate(repaired)
                 if isinstance(item, dict) and item.get("imported") is True and _colitis_question(item)]
    label = "Figure 1-7"
    if label not in assets or len(owners) != 1 or len(followers) != 1:
        return
    owner, follower = repaired[owners[0]], repaired[followers[0]]
    owner_images, follower_images = owner.get("images", []), follower.get("images", [])
    owner_sources, follower_sources = _source_documents(owner), _source_documents(follower)
    if (owner_sources and follower_sources and owner_sources.isdisjoint(follower_sources)):
        return
    if (not isinstance(owner_images, list) or not isinstance(follower_images, list)
            or not follower_images
            or any(_image_label(image) != label for image in owner_images + follower_images)):
        return
    repaired[owners[0]] = _with_figure(owner, assets[label], label)
    corrected = dict(follower)
    for field in ("images", "image_labels", "image_captions"):
        corrected.pop(field, None)
    repaired[followers[0]] = corrected


def repair_legacy_questionnaire_figures(items):
    """Return corrected cards without mutating cards or their answer metadata.

    Recognition requires both the exact verified source asset and the specific
    imported question. Unknown images are deliberately left alone, including
    another edition or re-encoded scan of the same textbook.
    """
    repaired = list(items)
    assets = {}
    for item in items:
        if not isinstance(item, dict) or item.get("imported") is not True:
            continue
        images = item.get("images", [])
        if not isinstance(images, list):
            continue
        for image in images:
            label = _image_label(image)
            if label:
                assets.setdefault(label, image)

    for index, item in enumerate(items):
        if not isinstance(item, dict) or item.get("imported") is not True:
            continue
        expected = _plate_for_question(item)
        images = item.get("images", [])
        if (expected not in assets or not isinstance(images, list)
                or any(_image_label(image) not in _PLATES for image in images)):
            continue
        repaired[index] = _with_figure(item, assets[expected], expected)
    _repair_smear(repaired, assets)
    return repaired
