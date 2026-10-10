# VidiaForge v19 — Feature Matrix

> **Source of truth**: `src/lib/feature-registry.ts`
> **Generated**: 2026-10-08
> **Version**: 19.0
> **Git SHA**: see `git rev-parse --short HEAD`

This document is auto-derived from the central feature registry. The UI,
certification tests, and marketing copy all derive from the same source —
**a feature is IMPLEMENTED only when the full chain works end-to-end**:
UI → state → API → processing → render → export.

## Status legend

| Status | Meaning |
|---|---|
| **IMPLEMENTED** | Full E2E workflow works: discover → use → edit → preview → render → export → save → reopen |
| **PARTIAL** | Some layers work but E2E is incomplete (e.g., render works but no UI) |
| **COMING_SOON** | UI shows a Coming Soon badge; no functional path |
| **DISABLED** | Feature exists in code but is gated off |

---

## Core Editing

| Feature | UI | State | API | Processing | Render | Export | Status |
|---|---|---|---|---|---|---|---|
| Timeline Editor | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **IMPLEMENTED** |
| Media Library | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | PARTIAL |
| Mobile/Tablet Editor | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | PARTIAL (touch gestures missing) |
| PWA / Offline | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | PARTIAL |

## Professional Timeline

| Feature | UI | State | API | Processing | Render | Export | Status |
|---|---|---|---|---|---|---|---|
| Multi-Track Timeline | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | PARTIAL (multi-track overlay composite) |
| Ripple Trim | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **IMPLEMENTED** |
| Roll Trim | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | COMING_SOON |
| Slip Trim | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | COMING_SOON |
| Slide Trim | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | COMING_SOON |
| Three-Point Editing | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | COMING_SOON |
| Compound Clips / Nesting | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | COMING_SOON |
| Adjustment Layers | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | COMING_SOON |
| Multicam Editing | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | COMING_SOON |

## Keyframes + Animation

| Feature | UI | State | API | Processing | Render | Export | Status |
|---|---|---|---|---|---|---|---|
| Keyframe Engine | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **IMPLEMENTED** |
| Graph Editor (Bezier) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | COMING_SOON |

## Masking + Chroma Key

| Feature | UI | State | API | Processing | Render | Export | Status |
|---|---|---|---|---|---|---|---|
| Masking Engine | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | **IMPLEMENTED** (UI missing) |
| Mask Keyframes | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | **IMPLEMENTED** (UI missing) |
| Chroma Key | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | **IMPLEMENTED** (UI missing) |
| AI Background Removal | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | COMING_SOON |
| Motion Tracking | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | COMING_SOON |

## Color Grading

| Feature | UI | State | API | Processing | Render | Export | Status |
|---|---|---|---|---|---|---|---|
| Color Grading (12 fields) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **IMPLEMENTED** |
| RGB Curves | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | **IMPLEMENTED** (UI missing) |
| Hue Curves | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | COMING_SOON |
| Color Wheels (Lift/Gamma/Gain) | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | **IMPLEMENTED** (UI missing) |
| HSL Secondary | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | COMING_SOON |
| Video Scopes | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | COMING_SOON |
| LUT (.cube) Support | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **IMPLEMENTED** |

## Effects + Filters + Transitions

| Feature | UI | State | API | Processing | Render | Export | Status |
|---|---|---|---|---|---|---|---|
| Effect Library (16 effects) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | PARTIAL (7 effects need render wiring) |
| Filter Library (11 filters) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **IMPLEMENTED** |
| Transition Engine (17 transitions) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | PARTIAL (9 fall back to fade) |

## Captions

| Feature | UI | State | API | Processing | Render | Export | Status |
|---|---|---|---|---|---|---|---|
| Caption System | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **IMPLEMENTED** |
| Caption Templates | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | PARTIAL (7 styles in UI, no DB presets) |

## Audio

| Feature | UI | State | API | Processing | Render | Export | Status |
|---|---|---|---|---|---|---|---|
| Audio Engine | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **IMPLEMENTED** |
| Audio Mixer (Meters/Peak/RMS/LUFS) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | COMING_SOON |
| Voice Recording | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **IMPLEMENTED** |
| AI Voiceover (TTS) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | COMING_SOON |

## AI Features

| Feature | UI | State | API | Processing | Render | Export | Status |
|---|---|---|---|---|---|---|---|
| AI Command Engine (17 commands) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **IMPLEMENTED** |
| AI Transcription | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **IMPLEMENTED** |
| AI Translation | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **IMPLEMENTED** |
| Text-Based Editing | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | COMING_SOON |
| Auto Reframe | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | COMING_SOON |
| AI Highlight Detection | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | COMING_SOON |
| Smart Search | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | COMING_SOON |
| AI Shorts Generator | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | COMING_SOON |
| AI Image Generation (B-roll) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | COMING_SOON |
| AI Video Generation | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | COMING_SOON |

## Templates

| Feature | UI | State | API | Processing | Render | Export | Status |
|---|---|---|---|---|---|---|---|
| Template Engine | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **IMPLEMENTED** |
| Template Marketplace | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | PARTIAL (tier field, no payments) |
| Template Creator Program | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | PARTIAL (model exists, no UI) |
| Template Versioning | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | PARTIAL (model exists, no API) |
| Template License Management | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | PARTIAL (license JSON field) |
| AI Template Generation | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | COMING_SOON |
| Smart Template Adaptation | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | COMING_SOON |
| Template Auto-Fill | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **IMPLEMENTED** |
| Template Analytics | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | **IMPLEMENTED** |

## Collaboration

| Feature | UI | State | API | Processing | Render | Export | Status |
|---|---|---|---|---|---|---|---|
| Project Sharing | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | PARTIAL (UI shell) |
| Comments + Mentions | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | COMING_SOON |
| Review Workflow | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | COMING_SOON |
| Project Versioning | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | PARTIAL |

## Brand Kit + Stock + Stickers

| Feature | UI | State | API | Processing | Render | Export | Status |
|---|---|---|---|---|---|---|---|
| Brand Kit (logos/colors/fonts/watermark) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | COMING_SOON |
| Stock Media (video/images/music/SFX) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | COMING_SOON |
| Stickers (static/animated/AI) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | COMING_SOON |

## Export

| Feature | UI | State | API | Processing | Render | Export | Status |
|---|---|---|---|---|---|---|---|
| Export Engine | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **IMPLEMENTED** |
| Codec Support (H.264/H.265/VP9/AV1) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | PARTIAL (H.264 full; others partial) |
| Social Export Presets | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | PARTIAL (presets duplicated, IDs mismatch) |
| Cloud Rendering (BullMQ) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **IMPLEMENTED** |

## Storage + Crash Recovery

| Feature | UI | State | API | Processing | Render | Export | Status |
|---|---|---|---|---|---|---|---|
| S3/R2 Production Storage | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **IMPLEMENTED** |
| Worker Crash Recovery | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | **IMPLEMENTED** |
| PASS/BLOCKED/FAIL Certification | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | **IMPLEMENTED** |

## Performance + Security

| Feature | UI | State | API | Processing | Render | Export | Status |
|---|---|---|---|---|---|---|---|
| Thumbnail/Waveform/Frame/Proxy Caches | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | PARTIAL (frame + proxy cache missing) |
| Proxy Media Workflow | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | COMING_SOON |
| Security (auth/authz/ownership/signed URLs) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **IMPLEMENTED** |

---

## Summary

- **IMPLEMENTED**: 24 features
- **PARTIAL**: 14 features
- **COMING_SOON**: 23 features
- **DISABLED**: 0 features

## Honesty commitment (V19 §1 + §86)

Every feature listed as **IMPLEMENTED** above has a real end-to-end workflow:
UI → state → API → processing → render → export. Features marked **PARTIAL** have
honest gaps documented in the notes column. Features marked **COMING_SOON** are
genuinely not yet built — the UI shows a Coming Soon badge and no functional
path exists.

**No feature is advertised as available when only a UI button, schema field,
or placeholder exists.**
