"""Frozen Kinetics R3D-18 features + validation-selected linear classifier."""
import hashlib
import json
import time

import numpy as np
import torch
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score, top_k_accuracy_score
from sklearn.preprocessing import StandardScaler

from judo_model import ROOT, CLASSES, FRAMES, embed, make_encoder, read_clip, save_json


def main():
    started = time.time()
    manifest_path = ROOT / "data/manifest.json"
    rows = json.loads(manifest_path.read_text(encoding="utf-8"))
    model, transform = make_encoder()
    cache = ROOT / "data/cache/r3d18_16frames_v1"
    cache.mkdir(parents=True, exist_ok=True)
    features = []
    cache_hits = 0
    for i, row in enumerate(rows):
        path = cache / (row["sha256"] + ".npy")
        if path.exists():
            vector = np.load(path, allow_pickle=False)
            cache_hits += 1
        else:
            frames, _ = read_clip(ROOT / row["path"])
            vector = embed(model, transform, frames)
            np.save(path, vector)
        features.append(vector)
        if (i + 1) % 10 == 0:
            print(f"Features {i + 1}/{len(rows)}, elapsed {time.time() - started:.0f}s", flush=True)
    x = np.stack(features)
    y = np.array([CLASSES.index(r["label"]) for r in rows])
    masks = {s: np.array([r["split"] == s for r in rows]) for s in ["train", "val", "test"]}
    scaler = StandardScaler().fit(x[masks["train"]])
    x = scaler.transform(x)
    candidates, best, best_score = [], None, -1
    for c in [0.001, 0.01, 0.1, 1.0]:
        clf = LogisticRegression(C=c, max_iter=2000, class_weight="balanced", random_state=42)
        clf.fit(x[masks["train"]], y[masks["train"]])
        score = f1_score(y[masks["val"]], clf.predict(x[masks["val"]]), average="macro")
        candidates.append({"C": c, "validation_macro_f1": score})
        if score > best_score:
            best, best_score = clf, score
    test_x, test_y = x[masks["test"]], y[masks["test"]]
    pred, scores = best.predict(test_x), best.predict_proba(test_x)
    majority = int(np.bincount(y[masks["train"]]).argmax())
    frequent_three = np.argsort(np.bincount(y[masks["train"]]))[-3:]
    report = {
        "model": "frozen_r3d18_kinetics400_linear_v1", "classes": CLASSES,
        "selection": candidates, "selected_C": best.C,
        "test_count": len(test_y), "top1_accuracy": accuracy_score(test_y, pred),
        "top3_accuracy": top_k_accuracy_score(test_y, scores, k=3, labels=list(range(4))),
        "macro_f1": f1_score(test_y, pred, average="macro"),
        "majority_baseline_accuracy": float(np.mean(test_y == majority)),
        "majority_baseline_macro_f1": f1_score(test_y, np.full_like(test_y, majority), average="macro", zero_division=0),
        "frequent_three_baseline_top3": float(np.isin(test_y, frequent_three).mean()),
        "confusion_matrix": confusion_matrix(test_y, pred, labels=list(range(4))).tolist(),
        "per_class": classification_report(test_y, pred, labels=list(range(4)), target_names=CLASSES,
                                           output_dict=True, zero_division=0),
        "elapsed_seconds": time.time() - started,
        "feature_cache_hits": cache_hits,
        "new_feature_extractions": len(rows) - cache_hits,
        "device": "cpu", "threads": 4, "frames_per_clip": FRAMES,
        "status": "experimental_requires_user_review",
        "evaluation_scope": "deduplicated_clip_split_not_independent_matches",
        "limitations": "Unknown original matches/athletes and unverified labels; not a deployment accuracy claim.",
        "manifest_sha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest()}
    bundle = {"encoder": model.state_dict(), "mean": torch.from_numpy(scaler.mean_.astype(np.float32)),
              "scale": torch.from_numpy(scaler.scale_.astype(np.float32)),
              "weight": torch.from_numpy(best.coef_.astype(np.float32)),
              "bias": torch.from_numpy(best.intercept_.astype(np.float32)),
              "classes": CLASSES, "version": report["model"], "frames": FRAMES,
              "manifest_sha256": report["manifest_sha256"]}
    (ROOT / "models").mkdir(exist_ok=True)
    torch.save(bundle, ROOT / "models/judo_r3d18.pt")
    save_json(ROOT / "data/evaluation.json", report)
    save_json(ROOT / "data/test_predictions.json", [
        {"path": row["path"], "label": row["label"], "prediction": CLASSES[int(p)], "scores": s.tolist()}
        for row, p, s in zip([r for r in rows if r["split"] == "test"], pred, scores)])
    print(json.dumps({k: report[k] for k in ["top1_accuracy", "top3_accuracy", "macro_f1", "elapsed_seconds"]}), flush=True)


if __name__ == "__main__":
    main()
