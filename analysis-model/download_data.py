"""Download original MP4s at a pinned Hugging Face revision; never execute dataset code."""
import hashlib
import json
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path, PurePosixPath
from urllib.parse import quote
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent
REPO = "adenhaus/judo_throws"


def download(item):
    relative, revision = item
    parts = PurePosixPath(relative).parts
    if len(parts) != 3 or parts[0] not in {"train", "val", "test"} or any(p in {".", ".."} for p in parts):
        raise ValueError(f"Unexpected dataset path: {relative}")
    target = ROOT / "data" / "raw" / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        url = f"https://huggingface.co/datasets/{REPO}/resolve/{revision}/{quote(relative)}"
        for attempt in range(3):
            try:
                with urlopen(url, timeout=120) as source, target.with_suffix(".part").open("wb") as dest:
                    while block := source.read(1024 * 1024):
                        dest.write(block)
                target.with_suffix(".part").replace(target)
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(2 ** attempt)
    with target.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    return {"path": target.relative_to(ROOT).as_posix(), "source_path": relative,
            "source_split": relative.split("/")[0], "label": relative.split("/")[1],
            "sha256": digest,
            "bytes": target.stat().st_size}


if __name__ == "__main__":
    meta = json.loads((ROOT / "data/source/repository.json").read_text(encoding="utf-8"))
    names = [x["rfilename"] for x in meta["siblings"]
             if x["rfilename"].lower().endswith(".mp4") and ".DS_Store" not in x["rfilename"]]
    rows = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        for row in pool.map(download, [(name, meta["sha"]) for name in names]):
            rows.append(row)
            if len(rows) % 50 == 0:
                print(f"Downloaded {len(rows)}/{len(names)}", flush=True)
    (ROOT / "data/downloads.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")
    print(json.dumps({"files": len(rows), "bytes": sum(r["bytes"] for r in rows),
                      "revision": meta["sha"], "classes": sorted({r["label"] for r in rows})}), flush=True)
