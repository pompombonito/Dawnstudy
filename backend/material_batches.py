"""Rotate bounded source windows so later pages participate in large study sets."""
import re


def advance_source_window_index(window_index, completed_count, previous_completed_count, window_count):
    """Advance source context only after a batch yields new usable questions.

    Provider retries therefore see the same evidence instead of silently
    consuming a different page window on every failed call.
    """
    if window_count < 1:
        return 0
    if completed_count > previous_completed_count:
        return (window_index + 1) % window_count
    return window_index % window_count


def source_windows(text, maximum=6000):
    chunks = []
    for block in re.split(r"(?=\[SOURCE: )", text):
        match = re.match(r"\[SOURCE: ([^\]]+)\]\s*", block)
        label = match[1] if match else "Material"
        body = block[match.end():] if match else block
        while body.strip():
            end = min(len(body), maximum - len(label) - 24)
            if end < len(body):
                boundary = body.rfind(" ", 0, end)
                if boundary > end // 2:
                    end = boundary
            chunks.append((label, f"[SOURCE: {label}]\n{body[:end].strip()}"))
            body = body[end:]
    windows, current, size = [], [], 0
    for label, chunk in chunks:
        if current and size + len(chunk) + 2 > maximum:
            windows.append(("\n\n".join(value for _, value in current), list(dict.fromkeys(key for key, _ in current))))
            current, size = [], 0
        current.append((label, chunk))
        size += len(chunk) + 2
    if current:
        windows.append(("\n\n".join(value for _, value in current), list(dict.fromkeys(key for key, _ in current))))
    return windows or [(text, [])]
