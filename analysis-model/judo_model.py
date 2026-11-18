"""Shared video preprocessing, frozen encoder and manual review rules."""
import json
import math
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent
CLASSES = ["ippon_seoi_nage", "o_goshi", "osoto_gari", "uchi_mata"]
NAMES = ["한팔업어치기", "허리껴치기", "밭다리후리기", "허벅다리걸기"]
FRAMES = 16
LANDINGS = {"full": "ippon", "partial": "waza_ari", "none": "no_score",
            "unknown": "undetermined", "unreviewed": "unreviewed"}


def save_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def read_clip(path, start=0.0, end=None):
    """Uniform sampling over the chosen interval, returning RGB uint8 frames."""
    cap = cv2.VideoCapture(str(path))
    try:
        fps = cap.get(cv2.CAP_PROP_FPS)
        count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if not cap.isOpened() or not math.isfinite(fps) or fps <= 0 or count < 2:
            raise ValueError(f"Cannot decode video: {path}")
        duration = count / fps
        end = duration if end is None else end
        if not (math.isfinite(start) and math.isfinite(end) and 0 <= start < end <= duration + 0.001):
            raise ValueError(f"Interval must satisfy 0 <= start < end <= {duration:.3f}")
        if end - start > 30:
            raise ValueError("Select one attack interval of at most 30 seconds")
        indices = np.linspace(int(start * fps), min(count - 1, math.ceil(end * fps) - 1), FRAMES).astype(int)
        frames = []
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(indices[0]))
        current = int(indices[0])
        previous = -1
        for index in indices:
            if index == previous:
                frames.append(frames[-1].copy())
                continue
            while current < index:
                if not cap.grab():
                    raise ValueError(f"Cannot decode frame {current}: {path}")
                current += 1
            ok, frame = cap.read()
            if not ok:
                raise ValueError(f"Cannot decode frame {index}: {path}")
            # Bound memory before the official R3D resize/normalization transform.
            frame = cv2.resize(frame, (171, 128), interpolation=cv2.INTER_AREA)
            frames.append(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            current += 1
            previous = index
        return np.stack(frames), {"fps": fps, "frames": count, "duration": duration,
                                  "start": start, "end": end}
    finally:
        cap.release()


def make_encoder(pretrained=True):
    import torch
    from torchvision.models.video import R3D_18_Weights, r3d_18

    torch.set_num_threads(4)
    torch.hub.set_dir(str(ROOT / "models/backbone"))
    weights = R3D_18_Weights.KINETICS400_V1
    model = r3d_18(weights=weights if pretrained else None)
    model.fc = torch.nn.Identity()
    model.eval().requires_grad_(False)
    return model, weights.transforms()


def embed(model, transform, frames):
    import torch

    batch = transform(torch.from_numpy(frames).permute(0, 3, 1, 2)).unsqueeze(0)
    with torch.inference_mode():
        return model(batch).squeeze(0).numpy()


def ranked_candidates(logits):
    import torch

    scores = torch.softmax(torch.as_tensor(logits), dim=0).tolist()
    return [{"technique": CLASSES[i], "name_ko": NAMES[i], "model_score": scores[i]}
            for i in sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:3]]


def review_result(prediction, technique, landing):
    if technique not in CLASSES + ["unsupported", "unknown"]:
        raise ValueError("Invalid reviewed technique")
    if landing not in LANDINGS:
        raise ValueError("Invalid landing")
    # Preserve the model output; this never infers contact or an official score.
    return {"prediction": prediction, "review": {"technique": technique,
            "landing": landing, "service_score": LANDINGS[landing], "source": "user",
            "status": "incomplete" if landing == "unreviewed" else "user_reviewed"}}
