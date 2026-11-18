"""Check data separation, saved model inference and review on held-out examples."""
import json
import math

from judo_model import ROOT, CLASSES, review_result, save_json
from predict import predict


if __name__ == "__main__":
    rows = json.loads((ROOT / "data/manifest.json").read_text(encoding="utf-8"))
    expected = {r["path"]: r for r in json.loads((ROOT / "data/test_predictions.json").read_text(encoding="utf-8"))}
    for key in ["sha256", "decoded_sha256"]:
        groups = {split: {r[key] for r in rows if r["split"] == split} for split in ["train", "val", "test"]}
        assert not groups["train"] & groups["val"]
        assert not groups["train"] & groups["test"]
        assert not groups["val"] & groups["test"]
    outputs = []
    for label in CLASSES:
        row = next(r for r in rows if r["label"] == label and r["split"] == "test")
        result = predict(ROOT / row["path"])
        assert result["service_score"] == "unreviewed"
        assert len(result["candidates"]) == 3
        assert result["candidates"][0]["technique"] == expected[row["path"]]["prediction"]
        for candidate in result["candidates"]:
            index = CLASSES.index(candidate["technique"])
            assert math.isclose(candidate["model_score"], expected[row["path"]]["scores"][index], abs_tol=1e-5)
        # Exercise the manual workflow, without claiming a contact annotation.
        review = review_result(result, "unknown", "unknown")
        assert review["review"]["service_score"] == "undetermined"
        save_json(ROOT / "runs" / f"example_{label}.json", result)
        outputs.append({"label": label, "predicted": result["candidates"][0]["technique"],
                        "seconds": result["elapsed_seconds"]})
    save_json(ROOT / "data/smoke_check.json", {"hash_overlap": False, "examples": outputs,
              "scope": "smoke_test_only_not_additional_accuracy_estimate"})
    print(json.dumps(outputs), flush=True)
