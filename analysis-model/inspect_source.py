"""Inspect the public dataset metadata without downloading video payloads."""
import json
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent
if __name__ == "__main__":
    target = ROOT / "data" / "source"
    target.mkdir(parents=True, exist_ok=True)
    urls = {
        "repository": "https://huggingface.co/api/datasets/adenhaus/judo_throws",
        "readme": "https://huggingface.co/datasets/adenhaus/judo_throws/raw/main/README.md",
    }
    for name, url in urls.items():
        with urlopen(url, timeout=60) as response:
            body = response.read()
        (target / (name + (".json" if name == "repository" else ".md"))).write_bytes(body)
        print(f"Saved {name}: {len(body)} bytes")
