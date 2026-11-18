"""Offline clip prediction. Scores are uncalibrated, never automatic judgements."""
import argparse
import json
import time
from pathlib import Path

import torch

from judo_model import ROOT, CLASSES, embed, make_encoder, ranked_candidates, read_clip, save_json


def predict(video, start=0.0, end=None):
    begun = time.time()
    bundle = torch.load(ROOT / "models/judo_r3d18.pt", map_location="cpu", weights_only=True)
    if bundle["classes"] != CLASSES:
        raise ValueError("Checkpoint class order does not match code")
    encoder, transform = make_encoder(pretrained=False)
    encoder.load_state_dict(bundle["encoder"])
    frames, info = read_clip(video, start, end)
    vector = torch.from_numpy(embed(encoder, transform, frames))
    normalized = (vector - bundle["mean"]) / bundle["scale"]
    logits = bundle["weight"] @ normalized + bundle["bias"]
    return {"video": str(Path(video).resolve()), "interval": info,
            "model_version": bundle["version"], "candidates": ranked_candidates(logits),
            "status": "requires_user_review", "score_semantics": "uncalibrated_model_score_not_accuracy",
            "landing": "unreviewed", "service_score": "unreviewed",
            "elapsed_seconds": time.time() - begun}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("video")
    parser.add_argument("--start", type=float, default=0)
    parser.add_argument("--end", type=float)
    parser.add_argument("--output", type=Path, default=ROOT / "runs/prediction.json")
    parser.add_argument("--stdout", action="store_true", help="Return JSON to the worker without writing a result file")
    args = parser.parse_args()
    result = predict(args.video, args.start, args.end)
    if args.stdout:
        print(json.dumps(result, ensure_ascii=True))
    else:
        save_json(args.output, result)
        print(f"Saved {args.output}; top candidate: {result['candidates'][0]['technique']}")
