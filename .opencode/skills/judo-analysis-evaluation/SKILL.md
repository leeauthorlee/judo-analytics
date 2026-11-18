---
name: Judo Analysis Evaluation and Release
description: Evaluate judo technique and scoring estimates against expert ground truth, choose safe thresholds, monitor quality, and prepare a Vercel release.
---

# Evaluation, monitoring, and release gate

Use before selecting a model/prompt, changing the inference pipeline, or claiming the system can judge matches.

## 1. Make a frozen expert-labelled benchmark

Use the annotation workflow in `judo-dataset-labeling`. Split by entire bout and ideally by event/source/venue; never allow neighboring frames from one bout into both tuning and test. Freeze a held-out test set before prompt/model selection. Retain difficult clips: no score, ambiguous/occluded action, replay, counterattack, boundary, hold-down, and scoreboard/referee disagreement.

Each reference needs the applicable ruleset, event timestamps, expert labels, adjudication state, and provenance. If official result and visible evidence differ, keep both labels rather than collapsing them.

## 2. Report meaningful metrics

Do not report a single overall “accuracy” only. Measure:

- Technique: per-class precision/recall/F1 and confusion matrix; include unknown/other.
- Score event: per-class precision/recall/F1 for ippon, waza-ari, yuko (when applicable), no-score, and uncertain; report false-positive score rate.
- Event localization: temporal intersection-over-union or onset/offset error within a declared tolerance.
- Coverage/abstention: what proportion is confidently auto-reported, and error rate on that covered subset. Include uncertain/abstain rate.
- Subgroups: camera angle/source, resolution/FPS, lighting, division/ruleset, occlusion, and technique family.
- Calibration: only if emitting numeric probabilities; report calibration error/reliability and choose thresholds on validation data, not test.
- Operations: processing latency, API cost per minute/bout, failure/retry rate, and deletion completion.

Set launch thresholds with a qualified referee and product owner. High false-positive “score awarded” risk should favor abstention/manual review rather than forced output. Do not call an LLM's self-reported confidence calibrated.

## 3. Evaluate the whole system, not just the prompt

Compare a simple baseline (human-selected event clip or fixed frame sampling), the proposed pipeline, and any model alternatives. Test on full upload conditions: rotation, variable frame rate, cuts/replays, low resolution, missing audio, occlusion, invalid MP4, and long-duration videos. Run regression tests on every prompt, model, frame-sampling, ruleset, schema, or dependency change.

OpenAI's Evals API guide currently announces the Evals platform becoming read-only on 2026-10-31 and scheduled shutdown on 2026-11-30. Prefer a local/version-controlled evaluation harness and data manifests for this project rather than depending on the hosted Evals platform for a long-lived workflow. Do not upload private benchmark video to a third-party evaluation service without rights/privacy approval.

## 4. Shadow mode and human review

Before public-facing scoring, run in shadow mode on rights-cleared bouts; compare outputs with expert/official labels. Route low-confidence, evidence-conflicting, or high-impact cases to human review. Track corrections and disagreement, but do not silently turn user corrections into training truth—record provenance and expert adjudication.

At launch, label outputs as estimates; provide evidence timestamps and rule version; maintain a disable/rollback switch for model or rules changes. Do not market as official or replace referees without validation, governance, and appropriate authorization.

## 5. Release checks

- Current ruleset confirmed for supported competitions; incompatible/unknown rule versions are rejected or marked unsupported.
- Benchmark is rights-cleared, expert-adjudicated, frozen, and leakage-checked.
- Per-class results, false-positive score rate, abstention, subgroup gaps, latency, cost, and failure rates meet agreed thresholds.
- Auth, upload permissions, private storage, retention/deletion, rate limits, and secrets pass checks.
- End-to-end preview deployment completes with sample video and manual-review workflow.
- UI describes score as AI estimate and clearly exposes uncertainty and evidence.
- Model, prompt, sampling code, ruleset, and dataset versions are logged for every analysis.
- Alerts, retries, dead-letter/review queue, and rollback path are exercised.

## 6. Post-release monitoring

Monitor drift in camera sources, rules, technique distribution, abstention, corrections, and false positives. Sample outcomes for expert review under a documented sampling policy. Revalidate before changing model version, rulebook, prompt, or video-processing parameters. Honor deletion requests for original media and derived artifacts.

## References

- OpenAI evaluation guide (including current Evals API deprecation notice): https://developers.openai.com/api/docs/guides/evals
- OpenAI Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- IJF rules portal: https://rules.ijf.org/
- Vercel background workers: https://vercel.com/docs/background-workers
