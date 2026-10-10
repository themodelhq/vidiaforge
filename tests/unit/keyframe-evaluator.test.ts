// VidiaForge v19.1 — Keyframe Evaluator Unit Tests
//
// V19.1 §18: Deterministic tests for keyframe interpolation.
// Verifies:
//   - linear/ease-in/ease-out/ease-in-out/bezier all produce correct values
//   - clamping at endpoints
//   - exact keyframe hits
//   - sampling for the graph editor
//   - FFmpeg expression generation

import { test, expect, describe } from 'bun:test';
import {
  evaluateKeyframes,
  evaluateProperty,
  applyEasing,
  sampleKeyframeCurve,
  keyframesToFFmpegExpression,
} from '../../src/lib/render/keyframe-evaluator';
import type { Keyframe } from '../../src/lib/types';

function makeKf(
  time: number,
  value: number,
  easing: Keyframe['easing'] = 'linear',
  bezier?: [number, number, number, number],
): Keyframe {
  return { id: `kf-${time}`, time, property: 'opacity', value, easing, bezier };
}

describe('V19.1 §16: Keyframe Evaluator', () => {
  // V19.1 §18: linear interpolation
  test('linear: opacity 0 at t=0 → 1 at t=2 — midpoint = 0.5', () => {
    const kfs = [makeKf(0, 0), makeKf(2, 1)];
    expect(evaluateKeyframes(kfs, 0)).toBe(0);
    expect(evaluateKeyframes(kfs, 1)).toBeCloseTo(0.5, 5);
    expect(evaluateKeyframes(kfs, 2)).toBe(1);
  });

  test('linear: clamping at endpoints', () => {
    const kfs = [makeKf(1, 10), makeKf(3, 20)];
    // Before first keyframe → first value (clamped)
    expect(evaluateKeyframes(kfs, 0)).toBe(10);
    // After last keyframe → last value (clamped)
    expect(evaluateKeyframes(kfs, 4)).toBe(20);
  });

  test('linear: exact match on keyframe', () => {
    const kfs = [makeKf(0, 0), makeKf(2, 1), makeKf(4, 0.5)];
    expect(evaluateKeyframes(kfs, 2)).toBe(1);
    expect(evaluateKeyframes(kfs, 4)).toBe(0.5);
  });

  test('empty keyframes → defaultValue', () => {
    expect(evaluateKeyframes([], 5, 42)).toBe(42);
  });

  test('single keyframe → constant value', () => {
    const kfs = [makeKf(1, 7)];
    expect(evaluateKeyframes(kfs, 0)).toBe(7);
    expect(evaluateKeyframes(kfs, 1)).toBe(7);
    expect(evaluateKeyframes(kfs, 2)).toBe(7);
  });

  test('unsorted input → still evaluates correctly (deterministic)', () => {
    const kfs = [makeKf(2, 1), makeKf(0, 0)]; // out of order
    expect(evaluateKeyframes(kfs, 1)).toBeCloseTo(0.5, 5);
  });

  // V19.1 §18: easing
  test('ease-in (quadratic): t=0.5 → 0.25', () => {
    expect(applyEasing(0.5, 'ease-in')).toBeCloseTo(0.25, 5);
  });

  test('ease-out (quadratic): t=0.5 → 0.75', () => {
    expect(applyEasing(0.5, 'ease-out')).toBeCloseTo(0.75, 5);
  });

  test('ease-in-out (cubic): t=0.5 → 0.5', () => {
    expect(applyEasing(0.5, 'ease-in-out')).toBeCloseTo(0.5, 5);
  });

  test('ease-in-out (cubic): t=0.25 → ~0.0625', () => {
    // 4 * 0.25³ = 4 * 0.015625 = 0.0625
    expect(applyEasing(0.25, 'ease-in-out')).toBeCloseTo(0.0625, 5);
  });

  test('ease-in-out (cubic): t=0.75 → ~0.9375', () => {
    // 1 - pow(-2*0.75+2, 3)/2 = 1 - pow(0.5, 3)/2 = 1 - 0.125/2 = 0.9375
    expect(applyEasing(0.75, 'ease-in-out')).toBeCloseTo(0.9375, 5);
  });

  test('bezier: linear control points (0,0,1,1) → identity', () => {
    // Bezier with control points (0, 0, 1, 1) is linear
    expect(applyEasing(0.5, 'bezier', [0, 0, 1, 1])).toBeCloseTo(0.5, 4);
  });

  test('bezier: ease curve (0.42, 0, 0.58, 1) → smooth ease', () => {
    // CSS-standard ease curve
    const v = applyEasing(0.5, 'bezier', [0.42, 0, 0.58, 1]);
    expect(v).toBeGreaterThan(0.4);
    expect(v).toBeLessThan(0.6);
    // Should be exactly 0.5 by symmetry
    expect(v).toBeCloseTo(0.5, 2);
  });

  test('bezier: missing control points → falls back to linear', () => {
    expect(applyEasing(0.5, 'bezier')).toBe(0.5);
  });

  test('clamps t to [0, 1]', () => {
    expect(applyEasing(-1, 'linear')).toBe(0);
    expect(applyEasing(2, 'linear')).toBe(1);
  });

  // V19.1 §17: graph editor sampling
  test('sampleKeyframeCurve: 100 samples between 0 and 2', () => {
    const kfs = [makeKf(0, 0), makeKf(2, 1)];
    const samples = sampleKeyframeCurve(kfs, 0, 2, 100);
    expect(samples.length).toBe(100);
    expect(samples[0].time).toBe(0);
    expect(samples[99].time).toBe(2);
    expect(samples[0].value).toBe(0);
    expect(samples[99].value).toBe(1);
    // Sample 50 is at t = 0 + step*50 = 50/99 * 2 ≈ 1.0101
    // With linear interp, value = t/2 ≈ 0.505
    const expectedValue = samples[50].time / 2;
    expect(samples[50].value).toBeCloseTo(expectedValue, 5);
  });

  test('sampleKeyframeCurve: handles single keyframe (constant)', () => {
    const kfs = [makeKf(0, 7)];
    const samples = sampleKeyframeCurve(kfs, 0, 5, 10);
    for (const s of samples) {
      expect(s.value).toBe(7);
    }
  });

  // V19.1 §16: evaluateProperty filters by property name
  test('evaluateProperty: filters by property name', () => {
    const kfs = [
      { id: 'k1', time: 0, property: 'opacity', value: 0, easing: 'linear' as const },
      { id: 'k2', time: 1, property: 'opacity', value: 1, easing: 'linear' as const },
      { id: 'k3', time: 0, property: 'scale', value: 1, easing: 'linear' as const },
      { id: 'k4', time: 1, property: 'scale', value: 2, easing: 'linear' as const },
    ];
    expect(evaluateProperty(kfs, 'opacity', 0.5, 0)).toBeCloseTo(0.5, 5);
    expect(evaluateProperty(kfs, 'scale', 0.5, 1)).toBeCloseTo(1.5, 5);
  });

  // V19.1 §16: FFmpeg expression generation
  test('keyframesToFFmpegExpression: empty → default value', () => {
    expect(keyframesToFFmpegExpression([], 42)).toBe('42');
  });

  test('keyframesToFFmpegExpression: single keyframe → constant', () => {
    const kfs = [makeKf(0, 7)];
    expect(keyframesToFFmpegExpression(kfs)).toBe('7');
  });

  test('keyframesToFFmpegExpression: linear 2 keyframes → if(between(...))', () => {
    const kfs = [makeKf(0, 0), makeKf(2, 1)];
    const expr = keyframesToFFmpegExpression(kfs);
    // Must contain the between(t,0,2) clause
    expect(expr).toContain('between(t,0,2)');
    // Must contain the linear interpolation formula
    expect(expr).toContain('(t-0)/2');
  });

  test('keyframesToFFmpegExpression: ease-in-out uses pow()', () => {
    const kfs = [makeKf(0, 0, 'ease-in-out'), makeKf(2, 1)];
    const expr = keyframesToFFmpegExpression(kfs);
    expect(expr).toContain('pow(');
  });

  test('keyframesToFFmpegExpression: 3 keyframes → nested if()', () => {
    const kfs = [makeKf(0, 0), makeKf(2, 1), makeKf(4, 0.5)];
    const expr = keyframesToFFmpegExpression(kfs);
    // Should have 2 segments → 2 between() clauses
    expect(expr.match(/between/g)?.length).toBe(2);
  });

  // V19.1 §53: determinism
  test('determinism: same input → same output (100 runs)', () => {
    const kfs = [makeKf(0, 0), makeKf(2, 1, 'ease-in-out')];
    const first = evaluateKeyframes(kfs, 1);
    for (let i = 0; i < 100; i++) {
      expect(evaluateKeyframes(kfs, 1)).toBe(first);
    }
  });
});
