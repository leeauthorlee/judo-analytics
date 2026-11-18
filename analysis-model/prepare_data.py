"""Audit decoding and duplicates, then create an explicitly exploratory split."""
import hashlib
import json
import re
from collections import Counter

import cv2
import numpy as np

from judo_model import ROOT, CLASSES, read_clip, save_json


def main():
    rows = json.loads((ROOT / "data/downloads.json").read_text(encoding="utf-8"))
    accepted, rejected, duplicates = [], [], []
    seen_hash, seen_name, seen_visual = {}, {}, {}
    samples = {name: [] for name in CLASSES}
    for n, row in enumerate(rows):
        name_key = (row["label"], re.sub(r"\s+", "", row["source_path"].split("/")[-1]).lower())
        other = seen_hash.get(row["sha256"]) or seen_name.get(name_key)
        if other:
            duplicates.append({"path": row["path"], "duplicate_of": other, "reason": "sha256_or_name"})
            continue
        try:
            frames, info = read_clip(ROOT / row["path"])
            digest = hashlib.sha256(frames.tobytes()).hexdigest()
            if digest in seen_visual:
                duplicates.append({"path": row["path"], "duplicate_of": seen_visual[digest], "reason": "decoded_frames"})
                continue
            accepted.append({**row, **info, "decoded_sha256": digest})
            seen_hash[row["sha256"]] = row["path"]
            seen_name[name_key] = row["path"]
            seen_visual[digest] = row["path"]
            if len(samples[row["label"]]) < 4:
                samples[row["label"]].append((row["path"], frames[[0, 5, 10, 15]]))
        except ValueError as exc:
            rejected.append({"path": row["path"], "reason": str(exc)})
        if (n + 1) % 100 == 0:
            print(f"Audited {n + 1}/{len(rows)}", flush=True)
    # Original split contains repeated clips. Rebuild after deduplication.
    # Match/athlete IDs are unavailable: this is NOT an independent-match benchmark.
    rng = np.random.default_rng(42)
    for label in CLASSES:
        group = [r for r in accepted if r["label"] == label]
        if len(group) < 10:
            raise ValueError(f"Insufficient decodable examples for {label}")
        rng.shuffle(group)
        n_test = max(1, round(len(group) * 0.15))
        n_val = max(1, round(len(group) * 0.15))
        for i, row in enumerate(group):
            row["split"] = "test" if i < n_test else "val" if i < n_test + n_val else "train"
    save_json(ROOT / "data/manifest.json", accepted)
    save_json(ROOT / "data/audit.json", {
        "downloaded": len(rows), "unique_decodable": len(accepted),
        "duplicates": duplicates, "rejected": rejected,
        "class_counts": dict(Counter(r["label"] for r in accepted)),
        "split_counts": dict(Counter(r["split"] for r in accepted)),
        "evaluation_scope": "exploratory_clip_split_not_independent_matches",
        "limitations": ["Original match/athlete IDs unavailable; related clips may cross splits.",
                        "Labels are publisher labels, not expert-verified.",
                        "Original video rights and provenance are not documented by publisher."]})
    for label, clips in samples.items():
        canvas = np.zeros((len(clips) * 152, 171 * 4, 3), dtype=np.uint8)
        for i, (name, frames) in enumerate(clips):
            canvas[i * 152:i * 152 + 128] = np.concatenate(frames, axis=1)
            cv2.putText(canvas, f"{label} sample {i + 1}", (3, i * 152 + 145),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1)
        # imencode/tofile supports Windows Unicode paths.
        destination = ROOT / "data" / f"preview_{label}.jpg"
        cv2.imencode(".jpg", cv2.cvtColor(canvas, cv2.COLOR_RGB2BGR))[1].tofile(str(destination))
    print(f"Valid unique: {len(accepted)}, duplicate: {len(duplicates)}, rejected: {len(rejected)}", flush=True)


if __name__ == "__main__":
    main()
