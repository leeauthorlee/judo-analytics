import sys
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from judo_model import LANDINGS, ranked_candidates, read_clip, review_result


class ReviewTests(unittest.TestCase):
    def test_all_landing_states_and_prediction_preservation(self):
        prediction = {"candidates": [{"technique": "o_goshi"}], "service_score": "unreviewed"}
        for landing, expected in LANDINGS.items():
            result = review_result(prediction, "unknown", landing)
            self.assertEqual(result["review"]["service_score"], expected)
            self.assertEqual(result["prediction"], prediction)
            self.assertEqual(prediction["service_score"], "unreviewed")
        self.assertNotEqual(LANDINGS["unknown"], LANDINGS["none"])
        self.assertNotEqual(LANDINGS["unreviewed"], LANDINGS["none"])

    def test_invalid_review_is_rejected(self):
        with self.assertRaises(ValueError):
            review_result({}, "fabricated", "full")
        with self.assertRaises(ValueError):
            review_result({}, "o_goshi", "invalid")

    def test_top_three_keeps_class_order(self):
        result = ranked_candidates([0.0, 4.0, 1.0, 2.0])
        self.assertEqual([r["technique"] for r in result], ["o_goshi", "uchi_mata", "osoto_gari"])


class VideoTests(unittest.TestCase):
    def test_time_crop_and_invalid_intervals(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sample.avi"
            writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), 10, (64, 64))
            self.assertTrue(writer.isOpened())
            for i in range(20):
                writer.write(np.full((64, 64, 3), i * 10, dtype=np.uint8))
            writer.release()
            frames, info = read_clip(path, 1, 2)
            self.assertEqual(frames.shape, (16, 128, 171, 3))
            self.assertGreater(frames[0].mean(), 85)
            self.assertEqual(info["start"], 1)
            for start, end in [(-1, 1), (1, 1), (0, 3), (float("nan"), 1)]:
                with self.assertRaises(ValueError):
                    read_clip(path, start, end)


if __name__ == "__main__":
    unittest.main()
