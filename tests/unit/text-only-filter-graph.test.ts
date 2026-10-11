import { describe, expect, test } from 'bun:test';
import { buildFilterGraph } from '../../lib/render/filter-graph';

describe('text-only render filter graph', () => {
  test('creates the black video source before text and connects drawtext to it', () => {
    const project = {
      project: { width: 1080, height: 1920, fps: 30 },
      tracks: [{ id: 'text-track', hidden: false }],
      clips: [{
        id: 'text-clip',
        trackId: 'text-track',
        enabled: true,
        kind: 'text',
        timelineStart: 0,
        duration: 2,
        text: { text: 'Hello VidiaForge', fontSize: 48, color: '#ffffff' },
      }],
      assets: [],
    } as any;

    const graph = buildFilterGraph(project, {});
    const blackIndex = graph.nodes.findIndex((node) => node.type === 'source' && node.assetId === '__black__');
    const textIndex = graph.nodes.findIndex((node) => node.type === 'text');
    const textNode = graph.nodes[textIndex];

    expect(blackIndex).toBeGreaterThanOrEqual(0);
    expect(textIndex).toBeGreaterThan(blackIndex);
    expect(textNode.inputs).toEqual([graph.nodes[blackIndex].id]);
    expect(graph.videoOut).toBe(textNode.id);
  });
});
