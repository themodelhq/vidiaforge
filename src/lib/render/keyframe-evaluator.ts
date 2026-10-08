// VidiaForge v19.1 — Keyframe Evaluator
//
// V19.1 §16: Real keyframe interpolation. This is the CANONICAL evaluator
// used by:
//   - buildFilterGraph (to emit time-varying FFmpeg filter expressions)
//   - the graph editor UI (to plot curves)
//   - the preview engine (to compute current values at the playhead)
//   - tests (to verify interpolation is correct)
//
// Supported interpolations (V19.1 §16):
//   - linear       — straight line between keyframes
//   - easeIn       — slow start, fast end (quadratic)
//   - easeOut      — fast start, slow end (quadratic)
//   - easeInOut    — slow at both ends (cubic)
//   - bezier       — cubic bezier with 4 control points (P0, P1, P2, P3)
//                    where P0 = (kf1.t, kf1.v) and P3 = (kf2.t, kf2.v)
//
// V19.1 §53: Deterministic — no random output, no timestamp-based behavior.
// Same input → same output, always.

import type { Keyframe, EasingType } from '../types';

/**
 * Evaluate a sorted list of keyframes at a given time, returning the
 * interpolated value for the named property.
 *
 * Behavior:
 *   - Empty keyframes → returns `defaultValue`
 *   - time < first.t → returns first.value (clamped)
 *   - time > last.t → returns last.value (clamped)
 *   - exact match on a keyframe.t → returns that keyframe.value
 *   - between two keyframes → interpolated per easing
 *
 * V19.1 §16: The keyframes array is sorted by time before evaluation so the
 * caller doesn't have to. This makes evaluation deterministic.
 */
export function evaluateKeyframes(
  keyframes: Keyframe[],
  time: number,
  defaultValue: number = 0,
): number {
  if (!keyframes || keyframes.length === 0) return defaultValue;

  // Sort by time ascending (deterministic — doesn't mutate input)
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);

  // Before the first keyframe → clamp to first value
  if (time <= sorted[0].time) return sorted[0].value;

  // After the last keyframe → clamp to last value
  const last = sorted[sorted.length - 1];
  if (time >= last.time) return last.value;

  // Find the bracketing keyframes
  for (let i = 0; i < sorted.length - 1; i++) {
    const kf1 = sorted[i];
    const kf2 = sorted[i + 1];
    if (time >= kf1.time && time <= kf2.time) {
      // Exact match on the upper keyframe
      if (time === kf2.time) return kf2.value;

      // Compute the local progress (0..1) between kf1 and kf2
      const span = kf2.time - kf1.time;
      if (span <= 0) return kf1.value; // degenerate — both at same time
      const localT = (time - kf1.time) / span;

      // Apply easing
      const easedT = applyEasing(localT, kf1.easing, kf1.bezier);

      // Linear interpolation between values
      return kf1.value + (kf2.value - kf1.value) * easedT;
    }
  }

  // Fallback (shouldn't reach here)
  return last.value;
}

/**
 * Evaluate a property at a given time across multiple keyframes.
 * Convenience wrapper that filters by property name first.
 */
export function evaluateProperty(
  keyframes: Keyframe[],
  property: string,
  time: number,
  defaultValue: number = 0,
): number {
  const filtered = keyframes.filter((k) => k.property === property);
  return evaluateKeyframes(filtered, time, defaultValue);
}

/**
 * V19.1 §16: Apply easing function to a normalized time value (0..1).
 *
 * Returns the eased progress so the caller can do linear interpolation
 * between two keyframe values.
 *
 * Supported easings:
 *   - 'linear'      → t (no easing)
 *   - 'ease-in'     → t² (quadratic ease-in)
 *   - 'ease-out'    → 1 - (1-t)² (quadratic ease-out)
 *   - 'ease-in-out' → cubic: t < 0.5 ? 4t³ : 1 - pow(-2t+2, 3)/2
 *   - 'cubic'       → same as ease-in-out (alias)
 *   - 'bezier'      → cubic bezier with control points [x1, y1, x2, y2]
 *                     (the bezier array on the keyframe)
 *
 * V19.1 §53: Deterministic — same input always produces same output.
 */
export function applyEasing(
  t: number,
  easing: EasingType,
  bezier?: [number, number, number, number],
): number {
  // Clamp t to [0, 1]
  const ct = Math.max(0, Math.min(1, t));

  switch (easing) {
    case 'linear':
      return ct;

    case 'ease-in':
      // Quadratic ease-in: t²
      return ct * ct;

    case 'ease-out':
      // Quadratic ease-out: 1 - (1-t)²
      return 1 - (1 - ct) * (1 - ct);

    case 'ease-in-out':
    case 'cubic':
      // Cubic ease-in-out
      return ct < 0.5
        ? 4 * ct * ct * ct
        : 1 - Math.pow(-2 * ct + 2, 3) / 2;

    case 'bezier':
      // Cubic bezier with 4 control points.
      // The bezier array is [x1, y1, x2, y2] where (0,0) is the start
      // and (1,1) is the end. We use Newton-Raphson to solve for the
      // parameter s where bezierX(s) = ct, then return bezierY(s).
      if (!bezier || bezier.length !== 4) {
        // Fall back to linear if no control points provided
        return ct;
      }
      return cubicBezierY(bezier[0], bezier[1], bezier[2], bezier[3], ct);

    default:
      return ct;
  }
}

/**
 * Solve the cubic bezier for Y given X.
 *
 * The bezier curve is parametrized by s ∈ [0, 1]:
 *   X(s) = 3(1-s)²s·x1 + 3(1-s)s²·x2 + s³
 *   Y(s) = 3(1-s)²s·y1 + 3(1-s)s²·y2 + s³
 *
 * Given a target X (= our normalized time ct), find s such that X(s) = target,
 * then return Y(s).
 *
 * Uses Newton-Raphson iteration (8 iterations is plenty for 1e-6 precision).
 */
function cubicBezierY(
  x1: number, y1: number, x2: number, y2: number,
  targetX: number,
): number {
  // Clamp control points to [0, 1] — they're supposed to be normalized
  const cx1 = clamp(x1, 0, 1);
  const cy1 = clamp(y1, 0, 1);
  const cx2 = clamp(x2, 0, 1);
  const cy2 = clamp(y2, 0, 1);

  // Edge cases: target at endpoints
  if (targetX <= 0) return 0;
  if (targetX >= 1) return 1;

  // Newton-Raphson to find s where X(s) = targetX
  let s = targetX; // initial guess
  for (let i = 0; i < 8; i++) {
    const x = bezierComponent(s, cx1, cx2);
    const dx = bezierDerivative(s, cx1, cx2);
    if (Math.abs(dx) < 1e-6) break;
    s = s - (x - targetX) / dx;
    s = clamp(s, 0, 1);
  }

  // Compute Y at the solved s
  return bezierComponent(s, cy1, cy2);
}

/**
 * Bezier component (X or Y) for a given parameter s.
 * B(s) = 3(1-s)²s·c1 + 3(1-s)s²·c2 + s³
 */
function bezierComponent(s: number, c1: number, c2: number): number {
  const oneMinusS = 1 - s;
  return 3 * oneMinusS * oneMinusS * s * c1
       + 3 * oneMinusS * s * s * c2
       + s * s * s;
}

/**
 * Derivative of the bezier component w.r.t. s.
 * dB/ds = 3(1-s)²·c1 + 6(1-s)s·(c2 - c1) + 3s²·(1 - c2)
 */
function bezierDerivative(s: number, c1: number, c2: number): number {
  const oneMinusS = 1 - s;
  return 3 * oneMinusS * oneMinusS * c1
       + 6 * oneMinusS * s * (c2 - c1)
       + 3 * s * s * (1 - c2);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Sample a keyframe curve at a series of time points. Used by the graph editor
 * to plot the curve and by tests to verify interpolation.
 *
 * V19.1 §17: The graph editor calls this with N samples (e.g. 100) to render
 * the animation curve visually.
 */
export function sampleKeyframeCurve(
  keyframes: Keyframe[],
  startTime: number,
  endTime: number,
  sampleCount: number = 100,
  defaultValue: number = 0,
): Array<{ time: number; value: number }> {
  if (sampleCount < 2) sampleCount = 2;
  const samples: Array<{ time: number; value: number }> = [];
  const step = (endTime - startTime) / (sampleCount - 1);
  for (let i = 0; i < sampleCount; i++) {
    const t = startTime + step * i;
    samples.push({ time: t, value: evaluateKeyframes(keyframes, t, defaultValue) });
  }
  return samples;
}

/**
 * V19.1 §17: Generate the FFmpeg time-varying expression for a property.
 *
 * This is the bridge between the in-memory keyframe array and the FFmpeg
 * filter expression that the renderer emits. The expression uses `t` (the
 * current frame time in seconds) and `between(t, t1, t2)` + `if()` to switch
 * between segments.
 *
 * For linear interpolation between 2 keyframes at t=0,v=0 and t=2,v=1:
 *   "if(between(t,0,2), 0+(1-0)*(t-0)/(2-0), 1)"
 *
 * For multiple segments, chain them:
 *   "if(between(t,0,2), seg1, if(between(t,2,4), seg2, if(between(t,4,6), seg3, last)))"
 *
 * V19.1 §53: Deterministic — same keyframes always produce the same expression.
 */
export function keyframesToFFmpegExpression(
  keyframes: Keyframe[],
  defaultValue: number = 0,
): string {
  if (!keyframes || keyframes.length === 0) return String(defaultValue);

  const sorted = [...keyframes].sort((a, b) => a.time - b.time);

  if (sorted.length === 1) return String(sorted[0].value);

  // Build nested if() expressions for each segment
  let expr = String(sorted[sorted.length - 1].value); // fallback: last value
  for (let i = sorted.length - 2; i >= 0; i--) {
    const kf1 = sorted[i];
    const kf2 = sorted[i + 1];
    const span = kf2.time - kf1.time;
    if (span <= 0) continue; // skip degenerate segments

    // Linear interpolation: v1 + (v2 - v1) * (t - t1) / span
    // For easing, we'd need to apply the easing function to the normalized t.
    // FFmpeg doesn't have native easing, so we approximate ease-in/ease-out
    // with polynomial expressions:
    //   ease-in (quad):  u²                  where u = (t - t1) / span
    //   ease-out (quad): 1 - (1-u)²
    //   ease-in-out:    4u³ for u < 0.5 else 1 - pow(-2u+2, 3)/2
    //   bezier:         too complex for inline expression — fall back to linear
    const u = `(t-${kf1.time})/${span}`;
    let easedU: string;
    switch (kf1.easing) {
      case 'ease-in':
        easedU = `(${u})*(${u})`;
        break;
      case 'ease-out':
        easedU = `(1-(1-(${u}))*(1-(${u})))`;
        break;
      case 'ease-in-out':
      case 'cubic':
        easedU = `(if(lt(${u},0.5),4*pow(${u},3),1-pow(-2*${u}+2,3)/2))`;
        break;
      case 'bezier':
        // Bezier can't be expressed inline easily — fall back to ease-in-out
        // approximation (better than pure linear).
        easedU = `(if(lt(${u},0.5),4*pow(${u},3),1-pow(-2*${u}+2,3)/2))`;
        break;
      case 'linear':
      default:
        easedU = u;
        break;
    }

    const v1 = kf1.value;
    const v2 = kf2.value;
    const segExpr = `${v1}+(${v2}-${v1})*(${easedU})`;

    expr = `if(between(t,${kf1.time},${kf2.time}),${segExpr},${expr})`;
  }

  return expr;
}
