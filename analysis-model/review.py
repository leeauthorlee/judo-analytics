"""Record manual confirmation separately from model prediction."""
import argparse
import json
from pathlib import Path

from judo_model import CLASSES, LANDINGS, review_result, save_json

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("prediction", type=Path)
    parser.add_argument("--technique", required=True, choices=CLASSES + ["unsupported", "unknown"])
    parser.add_argument("--landing", required=True, choices=list(LANDINGS))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.resolve() == args.prediction.resolve():
        parser.error("Review must not overwrite the original prediction")
    prediction = json.loads(args.prediction.read_text(encoding="utf-8"))
    save_json(args.output, review_result(prediction, args.technique, args.landing))
    print(f"Saved user review: {args.output}")
