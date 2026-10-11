import { describe, expect, test } from 'bun:test';
import { hasDrawtextFilter } from '../../lib/media/binary-resolver';

describe('hasDrawtextFilter', () => {
  test('accepts an FFmpeg filter listing that contains drawtext', () => {
    expect(hasDrawtextFilter('Filters:\n T.C drawtext V->V Draw text on top of video')).toBe(true);
  });

  test('rejects an FFmpeg filter listing without drawtext', () => {
    expect(hasDrawtextFilter('Filters:\n T.C scale V->V Scale the input video')).toBe(false);
  });
});
