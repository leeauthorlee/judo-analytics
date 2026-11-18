---
name: Judo Dataset and Annotation
description: Design a lawful, expert-labelled dataset for judo technique and scoring analysis, including annotation schema, splits, and provenance.
---

# Dataset and annotation workflow

Use this skill when collecting existing bouts, defining labels, preparing training/reference data, or reviewing dataset quality.

## 1. Confirm rights, scope, and rule version first

- Record source URL/file, owner, licence/permission, event/date, camera/source, age/division, and allowed purposes (display, inference, evaluation, training).
- Verify consent/privacy and deletion requirements for identifiable athletes, coaches, officials, and bystanders. Avoid face/identity recognition; use anonymous roles `tori`/`uke` scoped to a bout.
- Attach the exact IJF or event rule version to each bout. If unavailable or contested, label `ruleset_unknown` and exclude it from rule-dependent score training/evaluation until resolved.
- Do not scrape, redistribute, or use broadcast footage for training without appropriate rights.

## 2. Build an annotation guide with a qualified expert

Define label meanings with a certified referee/coach before annotation. Keep separate fields for what is **visibly observed**, what an expert adjudicates, and what the official match result was. Useful per-event fields:

```json
{
  "boutId": "opaque-id",
  "ruleSetId": "event-rules-2026-x",
  "startMs": 12340,
  "endMs": 16800,
  "toriRole": "blue",
  "ukeRole": "white",
  "techniqueId": "seoi_nage",
  "techniqueVariant": null,
  "observations": ["continuous_attack", "landing_partly_occluded"],
  "visibleScore": "uncertain",
  "officialScore": "waza_ari",
  "officialCallMs": 17120,
  "officialSource": "referee_call_and_scoreboard",
  "penaltyOrHoldContext": null,
  "annotatorIds": ["expert-01", "expert-02"],
  "adjudicationStatus": "resolved"
}
```

This is a starting point, not a final production schema. Define allowed values and required/nullable rules from the chosen competition context. Distinguish `no_score` from `uncertain`: the former means enough view/context exists to judge no score; the latter means evidence is insufficient.

For score analysis, capture event type and relevant evidence separately: technique/continuity, landing orientation/control, osaekomi duration, official referee/scoreboard signal, bout clock, penalties, and golden-score context as applicable. Image-only labels cannot ground facts absent from the sampled view.

## 3. Annotate clips, not isolated keyframes

- Keep the complete temporal window around each event, including setup, execution, landing, and immediate continuation.
- Annotate event start/end and official call times against the source video's timeline. Preserve frame-rate/time-base metadata.
- Use at least two independent qualified annotations for a representative subset; adjudicate disagreements and track the reason, not just the winning label.
- Mark occlusion, camera cuts, motion blur, low resolution, out-of-frame action, replay/slow motion, and uncertain athlete roles.
- If replay and live sequence both appear, mark them; do not count replay as a second event.
- Keep expert labels separate from model suggestions to avoid confirmation bias.

## 4. Quality checks and dataset splits

- Check class coverage across technique families, score outcomes, no-score events, ambiguous cases, camera angles, lighting, divisions, and rulesets.
- Measure inter-annotator agreement and adjudication rate; investigate disagreement by label category.
- Split by **bout/event/video source**, never random frames from the same bout across train and test. Where possible, hold out events, venues, or broadcast sources to test generalization.
- Keep a frozen, access-controlled test set; do not tune prompts or thresholds against it.
- Track dataset manifest and content hashes; use a dataset version and an annotation-guide version.
- Avoid class balancing that erases real deployment prevalence; report both stratified per-class results and realistic prevalence-weighted results.

## 5. Privacy and storage

Store the original video separately from labels, use least-privilege/private storage, define retention and delete flows, and prevent public bucket URLs. Avoid retaining extracted frames or model request payloads longer than needed. Review the chosen provider's current retention policy and organization settings before sending any identifiable footage to it.

## Acceptance criteria

- Every score label maps to a stated rulebook version and has a provenance source.
- Unclear visual evidence is explicitly labelled rather than guessed.
- The evaluation split has no bout/video leakage.
- A domain expert has signed off the annotation guide and sampled labels.

## References

- IJF rules portal: https://rules.ijf.org/
- IJF rule changes overview (2025 implementation; confirm later updates): https://ijf.org/news/judo-presents-the-new-rules
- OpenAI data controls: https://developers.openai.com/api/docs/guides/your-data
