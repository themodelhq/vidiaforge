// VidiaForge — Unit tests for buildFilterGraph
//
// Tests src/lib/render/filter-graph.ts → buildFilterGraph().
//
// Verifies:
//   - Empty project produces a graph with just a black background + OutputNode
//   - Single video clip produces SourceNode + OutputNode (+ optional TrimNode)
//   - Multiple video clips produce composite nodes (TransitionNode between chains)
//   - Text overlay adds a TextNode
//   - Transition adds a TransitionNode
//
// Run: bun run test:unit

import { test, expect, describe } from 'bun:test';
import {
  buildFilterGraph,
  type FilterGraph,
  type FilterGraphAnyNode,
  type SourceNode,
  type TrimNode,
  type OutputNode,
  type TextNode,
  type TransitionNode,
  type CompositeNode,
} from '../../src/lib/render/filter-graph';
import { emptyProjectDocument, createClip, createTrack } from '../../src/lib/timeline';
import type { ProjectDocument, AssetRef, TimelineTrack } from '../../src/lib/types';

function makeAssetRef(overrides: Partial<AssetRef> = {}): AssetRef & { storageKey: string } {
  return {
    id: overrides.id ?? 'asset_1',
    name: overrides.name ?? 'sample.mp4',
    kind: overrides.kind ?? 'video',
    mimeType: overrides.mimeType ?? 'video/mp4',
    size: overrides.size ?? 1000000,
    duration: overrides.duration ?? 5,
    width: overrides.width ?? 1920,
    height: overrides.height ?? 1080,
    fps: overrides.fps ?? 30,
    storagePath: overrides.storagePath ?? 'uploads/asset_1.mp4',
    ...overrides,
  } as AssetRef & { storageKey: string };
}

function makeProjectWithVideoClips(clipSpecs: Array<{ sourceStart?: number; sourceEnd?: number; timelineStart?: number; duration?: number; transitions?: any[]; trackId?: string }>): { project: ProjectDocument; assetsById: Record<string, any> } {
  const doc = emptyProjectDocument('proj1', 'Test');
  const videoTrack = doc.tracks.find((t) => t.kind === 'video')!;

  const assetsById: Record<string, any> = {};
  let clipIndex = 0;
  for (const spec of clipSpecs) {
    const assetId = `asset_${++clipIndex}`;
    assetsById[assetId] = {
      id: assetId,
      name: `sample-${clipIndex}.mp4`,
      kind: 'video',
      mimeType: 'video/mp4',
      size: 1000000,
      duration: spec.sourceEnd ?? 10,
      width: 1920,
      height: 1080,
      fps: 30,
      storagePath: `uploads/${assetId}.mp4`,
      storageKey: `uploads/${assetId}.mp4`,
    };

    const clip = createClip({
      trackId: spec.trackId ?? videoTrack.id,
      kind: 'video',
      assetId,
      assetName: `sample-${clipIndex}.mp4`,
      sourceStart: spec.sourceStart ?? 0,
      sourceEnd: spec.sourceEnd ?? 5,
      timelineStart: spec.timelineStart ?? 0,
      duration: spec.duration ?? 5,
      transitions: spec.transitions ?? [],
    });
    doc.clips.push(clip);
  }
  return { project: doc, assetsById };
}

describe('buildFilterGraph — empty project', () => {
  test('empty project produces a graph with a black background source + output', () => {
    const doc = emptyProjectDocument('proj1', 'Test');
    const assetsById = {};
    const graph = buildFilterGraph(doc, assetsById);

    // Should have at least one source node (the black background)
    const sourceNodes = graph.nodes.filter((n) => n.type === 'source');
    expect(sourceNodes.length).toBeGreaterThanOrEqual(1);

    // The black background source uses __black__ as its assetId
    const blackSource = sourceNodes.find((s: any) => s.assetId === '__black__');
    expect(blackSource).toBeDefined();

    // Should have an OutputNode
    const outputNodes = graph.nodes.filter((n) => n.type === 'output');
    expect(outputNodes.length).toBe(1);

    // Duration should be 0 (no clips)
    expect(graph.duration).toBe(0);

    // Should have videoOut + audioOut labels
    expect(graph.videoOut).toBeTruthy();
    expect(graph.audioOut).toBeTruthy();
  });
});

describe('buildFilterGraph — single video clip', () => {
  test('single video clip produces a SourceNode + OutputNode', () => {
    const { project, assetsById } = makeProjectWithVideoClips([
      { sourceStart: 0, sourceEnd: 5, timelineStart: 0, duration: 5 },
    ]);
    const graph = buildFilterGraph(project, assetsById);

    // Should have at least one SourceNode (the video source)
    const videoSourceNodes = graph.nodes.filter(
      (n) => n.type === 'source' && (n as SourceNode).kind === 'video'
    );
    expect(videoSourceNodes.length).toBe(1);

    // Should have an OutputNode
    const outputNodes = graph.nodes.filter((n) => n.type === 'output');
    expect(outputNodes.length).toBe(1);

    // Duration should match the clip's timelineEnd
    expect(graph.duration).toBe(5);
  });

  test('single video clip with non-zero sourceStart produces a TrimNode', () => {
    const { project, assetsById } = makeProjectWithVideoClips([
      { sourceStart: 2, sourceEnd: 7, timelineStart: 0, duration: 5 },
    ]);
    const graph = buildFilterGraph(project, assetsById);

    const trimNodes = graph.nodes.filter((n) => n.type === 'trim');
    expect(trimNodes.length).toBeGreaterThanOrEqual(1);

    const trim = trimNodes[0] as TrimNode;
    expect(trim.start).toBe(2);
    expect(trim.end).toBe(7);
  });

  test('single video clip — SourceNode references the asset storageKey', () => {
    const { project, assetsById } = makeProjectWithVideoClips([
      { sourceStart: 0, sourceEnd: 5, timelineStart: 0, duration: 5 },
    ]);
    const graph = buildFilterGraph(project, assetsById);

    const source = graph.nodes.find((n) => n.type === 'source' && (n as SourceNode).kind === 'video') as SourceNode;
    expect(source).toBeDefined();
    expect(source.storageKey).toBe('uploads/asset_1.mp4');
    expect(source.assetId).toBe('asset_1');
    expect(source.sourceStart).toBe(0);
    expect(source.sourceEnd).toBe(5);
  });
});

describe('buildFilterGraph — multiple video clips', () => {
  test('two video clips produce 2 SourceNodes + a TransitionNode (xfade)', () => {
    const { project, assetsById } = makeProjectWithVideoClips([
      { sourceStart: 0, sourceEnd: 3, timelineStart: 0, duration: 3 },
      { sourceStart: 0, sourceEnd: 3, timelineStart: 3, duration: 3 },
    ]);
    const graph = buildFilterGraph(project, assetsById);

    const videoSourceNodes = graph.nodes.filter(
      (n) => n.type === 'source' && (n as SourceNode).kind === 'video'
    );
    expect(videoSourceNodes.length).toBe(2);

    // Two video chains → at least 1 transition node between them
    const transitionNodes = graph.nodes.filter((n) => n.type === 'transition');
    expect(transitionNodes.length).toBe(1);

    // Duration is max(clip.timelineStart + clip.duration) = 6
    expect(graph.duration).toBe(6);
  });

  test('three video clips produce 3 SourceNodes + 2 TransitionNodes', () => {
    const { project, assetsById } = makeProjectWithVideoClips([
      { sourceStart: 0, sourceEnd: 2, timelineStart: 0, duration: 2 },
      { sourceStart: 0, sourceEnd: 2, timelineStart: 2, duration: 2 },
      { sourceStart: 0, sourceEnd: 2, timelineStart: 4, duration: 2 },
    ]);
    const graph = buildFilterGraph(project, assetsById);

    const videoSourceNodes = graph.nodes.filter(
      (n) => n.type === 'source' && (n as SourceNode).kind === 'video'
    );
    expect(videoSourceNodes.length).toBe(3);

    const transitionNodes = graph.nodes.filter((n) => n.type === 'transition');
    expect(transitionNodes.length).toBe(2);

    // Duration is 6
    expect(graph.duration).toBe(6);
  });

  test('clips are processed in timelineStart order (not insertion order)', () => {
    // Insert clips out of order; the graph should still produce transitions
    // between them in timeline-start order.
    const { project, assetsById } = makeProjectWithVideoClips([
      { sourceStart: 0, sourceEnd: 2, timelineStart: 4, duration: 2 }, // late
      { sourceStart: 0, sourceEnd: 2, timelineStart: 0, duration: 2 }, // early
      { sourceStart: 0, sourceEnd: 2, timelineStart: 2, duration: 2 }, // middle
    ]);
    const graph = buildFilterGraph(project, assetsById);

    // 3 video sources + 2 transitions
    const videoSourceNodes = graph.nodes.filter(
      (n) => n.type === 'source' && (n as SourceNode).kind === 'video'
    );
    expect(videoSourceNodes.length).toBe(3);

    const transitionNodes = graph.nodes.filter((n) => n.type === 'transition');
    expect(transitionNodes.length).toBe(2);

    // Duration is 6
    expect(graph.duration).toBe(6);
  });
});

describe('buildFilterGraph — text overlay', () => {
  test('text clip adds a TextNode to the graph', () => {
    const doc = emptyProjectDocument('proj1', 'Test');
    const textTrack = doc.tracks.find((t) => t.kind === 'text')!;
    doc.clips.push(
      createClip({
        trackId: textTrack.id,
        kind: 'text',
        duration: 3,
        timelineStart: 0,
        text: {
          text: 'Hello',
          fontFamily: 'Inter',
          fontSize: 48,
          fontWeight: 700,
          italic: false,
          letterSpacing: 0,
          lineHeight: 1.2,
          align: 'center',
          color: '#FFFFFF',
        },
      })
    );

    const graph = buildFilterGraph(doc, {});

    const textNodes = graph.nodes.filter((n) => n.type === 'text') as TextNode[];
    expect(textNodes.length).toBe(1);
    expect(textNodes[0].text).toBe('Hello');
    expect(textNodes[0].fontSize).toBe(48);
    expect(textNodes[0].color).toBe('#FFFFFF');
    expect(textNodes[0].start).toBe(0);
    expect(textNodes[0].end).toBe(3);
  });

  test('text clip start/end times are computed from timelineStart + duration', () => {
    const doc = emptyProjectDocument('proj1', 'Test');
    const textTrack = doc.tracks.find((t) => t.kind === 'text')!;
    doc.clips.push(
      createClip({
        trackId: textTrack.id,
        kind: 'text',
        duration: 2,
        timelineStart: 5,
        text: {
          text: 'Delayed',
          fontFamily: 'Inter',
          fontSize: 36,
          fontWeight: 400,
          italic: false,
          letterSpacing: 0,
          lineHeight: 1.2,
          align: 'left',
          color: '#000000',
        },
      })
    );

    const graph = buildFilterGraph(doc, {});

    const textNodes = graph.nodes.filter((n) => n.type === 'text') as TextNode[];
    expect(textNodes.length).toBe(1);
    expect(textNodes[0].start).toBe(5);
    expect(textNodes[0].end).toBe(7);
  });

  test('text clip without a text field is skipped (no TextNode added)', () => {
    const doc = emptyProjectDocument('proj1', 'Test');
    const textTrack = doc.tracks.find((t) => t.kind === 'text')!;
    doc.clips.push(
      createClip({
        trackId: textTrack.id,
        kind: 'text',
        duration: 3,
        timelineStart: 0,
        // no `text` field — should be skipped
      })
    );

    const graph = buildFilterGraph(doc, {});

    const textNodes = graph.nodes.filter((n) => n.type === 'text');
    expect(textNodes.length).toBe(0);
  });
});

describe('buildFilterGraph — transitions', () => {
  test('a fade transition between two video clips produces a TransitionNode with type="fade"', () => {
    const { project, assetsById } = makeProjectWithVideoClips([
      {
        sourceStart: 0, sourceEnd: 3, timelineStart: 0, duration: 3,
        transitions: [{ id: 'tr1', type: 'fade', duration: 0.5 }],
      },
      { sourceStart: 0, sourceEnd: 3, timelineStart: 3, duration: 3 },
    ]);
    const graph = buildFilterGraph(project, assetsById);

    const transitionNodes = graph.nodes.filter((n) => n.type === 'transition') as TransitionNode[];
    expect(transitionNodes.length).toBe(1);
    expect(transitionNodes[0].transitionType).toBe('fade');
    expect(transitionNodes[0].duration).toBe(0.5);
  });

  test('a cross-dissolve transition produces a TransitionNode with type="cross-dissolve"', () => {
    const { project, assetsById } = makeProjectWithVideoClips([
      {
        sourceStart: 0, sourceEnd: 3, timelineStart: 0, duration: 3,
        transitions: [{ id: 'tr1', type: 'cross-dissolve', duration: 0.4 }],
      },
      { sourceStart: 0, sourceEnd: 3, timelineStart: 3, duration: 3 },
    ]);
    const graph = buildFilterGraph(project, assetsById);

    const transitionNodes = graph.nodes.filter((n) => n.type === 'transition') as TransitionNode[];
    expect(transitionNodes.length).toBe(1);
    expect(transitionNodes[0].transitionType).toBe('cross-dissolve');
    expect(transitionNodes[0].duration).toBe(0.4);
  });

  test('multiple transitions between sequential clips produce multiple TransitionNodes', () => {
    const { project, assetsById } = makeProjectWithVideoClips([
      {
        sourceStart: 0, sourceEnd: 2, timelineStart: 0, duration: 2,
        transitions: [{ id: 'tr1', type: 'fade', duration: 0.5 }],
      },
      {
        sourceStart: 0, sourceEnd: 2, timelineStart: 2, duration: 2,
        transitions: [{ id: 'tr2', type: 'wipe', duration: 0.3 }],
      },
      { sourceStart: 0, sourceEnd: 2, timelineStart: 4, duration: 2 },
    ]);
    const graph = buildFilterGraph(project, assetsById);

    const transitionNodes = graph.nodes.filter((n) => n.type === 'transition') as TransitionNode[];
    expect(transitionNodes.length).toBe(2);
    // First transition is fade (from clip 1)
    expect(transitionNodes[0].transitionType).toBe('fade');
    // Second transition is wipe (from clip 2)
    expect(transitionNodes[1].transitionType).toBe('wipe');
  });

  test('a "cut" transition is treated as no transition (skipped)', () => {
    // The graph builder only inserts a transition node if the transition type
    // is NOT "cut" — see filter-graph.ts line 392.
    const { project, assetsById } = makeProjectWithVideoClips([
      {
        sourceStart: 0, sourceEnd: 2, timelineStart: 0, duration: 2,
        transitions: [{ id: 'tr1', type: 'cut', duration: 0 }],
      },
      { sourceStart: 0, sourceEnd: 2, timelineStart: 2, duration: 2 },
    ]);
    const graph = buildFilterGraph(project, assetsById);

    // With a cut transition, the graph still inserts 1 TransitionNode (because
    // there are 2 video chains), but the transitionType defaults to
    // 'cross-dissolve' (the fallback when no non-cut transition is found).
    const transitionNodes = graph.nodes.filter((n) => n.type === 'transition') as TransitionNode[];
    expect(transitionNodes.length).toBe(1);
    expect(transitionNodes[0].transitionType).toBe('cross-dissolve');
  });
});

describe('buildFilterGraph — output node', () => {
  test('OutputNode has the project canvas dimensions + fps', () => {
    const doc = emptyProjectDocument('proj1', 'Test');
    doc.project.width = 1280;
    doc.project.height = 720;
    doc.project.fps = 24;
    const graph = buildFilterGraph(doc, {});

    const outputNodes = graph.nodes.filter((n) => n.type === 'output') as OutputNode[];
    expect(outputNodes.length).toBe(1);
    expect(outputNodes[0].width).toBe(1280);
    expect(outputNodes[0].height).toBe(720);
    expect(outputNodes[0].fps).toBe(24);
    expect(outputNodes[0].format).toBe('yuv420p');
  });

  test('OutputNode is the videoOut of the graph', () => {
    const { project, assetsById } = makeProjectWithVideoClips([
      { sourceStart: 0, sourceEnd: 2, timelineStart: 0, duration: 2 },
    ]);
    const graph = buildFilterGraph(project, assetsById);

    const outputNodes = graph.nodes.filter((n) => n.type === 'output') as OutputNode[];
    expect(outputNodes.length).toBe(1);
    expect(graph.videoOut).toBe(outputNodes[0].id);
  });
});

describe('buildFilterGraph — disabled / hidden clips are skipped', () => {
  test('disabled video clip is NOT included in the graph', () => {
    const doc = emptyProjectDocument('proj1', 'Test');
    const videoTrack = doc.tracks.find((t) => t.kind === 'video')!;
    const assetsById = {
      asset_1: makeAssetRef({ id: 'asset_1' }),
    };
    doc.clips.push(
      createClip({
        trackId: videoTrack.id,
        kind: 'video',
        assetId: 'asset_1',
        duration: 5,
        enabled: false, // DISABLED
      })
    );

    const graph = buildFilterGraph(doc, assetsById);

    // No video source (the clip was skipped) → graph falls back to the
    // black background source.
    const videoSources = graph.nodes.filter(
      (n) => n.type === 'source' && (n as SourceNode).kind === 'video'
    );
    expect(videoSources.length).toBe(0);

    // But the black background source IS present
    const blackSource = graph.nodes.find(
      (n) => n.type === 'source' && (n as SourceNode).assetId === '__black__'
    );
    expect(blackSource).toBeDefined();
  });

  test('clip on a hidden track is NOT included in the graph', () => {
    const doc = emptyProjectDocument('proj1', 'Test');
    const videoTrack = doc.tracks.find((t) => t.kind === 'video')!;
    videoTrack.hidden = true; // HIDDEN TRACK

    const assetsById = {
      asset_1: makeAssetRef({ id: 'asset_1' }),
    };
    doc.clips.push(
      createClip({
        trackId: videoTrack.id,
        kind: 'video',
        assetId: 'asset_1',
        duration: 5,
      })
    );

    const graph = buildFilterGraph(doc, assetsById);

    const videoSources = graph.nodes.filter(
      (n) => n.type === 'source' && (n as SourceNode).kind === 'video'
    );
    expect(videoSources.length).toBe(0);
  });
});

describe('buildFilterGraph — missing asset is skipped honestly', () => {
  test('clip referencing an asset NOT in assetsById is skipped (no SourceNode)', () => {
    const doc = emptyProjectDocument('proj1', 'Test');
    const videoTrack = doc.tracks.find((t) => t.kind === 'video')!;
    doc.clips.push(
      createClip({
        trackId: videoTrack.id,
        kind: 'video',
        assetId: 'asset_missing', // NOT in assetsById
        duration: 5,
      })
    );

    const graph = buildFilterGraph(doc, {});

    // No video source — the graph builder logs + skips the clip
    const videoSources = graph.nodes.filter(
      (n) => n.type === 'source' && (n as SourceNode).kind === 'video'
    );
    expect(videoSources.length).toBe(0);

    // But the black background source IS present
    const blackSource = graph.nodes.find(
      (n) => n.type === 'source' && (n as SourceNode).assetId === '__black__'
    );
    expect(blackSource).toBeDefined();
  });
});

describe('buildFilterGraph — audio clips', () => {
  test('single audio clip produces a SourceNode + AudioMixNode', () => {
    const doc = emptyProjectDocument('proj1', 'Test');
    const audioTrack = doc.tracks.find((t) => t.kind === 'audio')!;
    doc.clips.push(
      createClip({
        trackId: audioTrack.id,
        kind: 'audio',
        assetId: 'asset_audio_1',
        duration: 5,
        sourceStart: 0,
        sourceEnd: 5,
        audio: { volume: 0.8, pan: 0, fadeIn: 0, fadeOut: 0, muted: false },
      })
    );
    const assetsById = {
      asset_audio_1: makeAssetRef({
        id: 'asset_audio_1',
        kind: 'audio',
        mimeType: 'audio/wav',
        duration: 5,
        storagePath: 'uploads/audio_1.wav',
      }),
    };

    const graph = buildFilterGraph(doc, assetsById);

    const audioSources = graph.nodes.filter(
      (n) => n.type === 'source' && (n as SourceNode).kind === 'audio'
    );
    expect(audioSources.length).toBe(1);

    const audioMixNodes = graph.nodes.filter((n) => n.type === 'audio_mix');
    expect(audioMixNodes.length).toBe(1);

    // audioOut points at the AudioMixNode
    expect(graph.audioOut).toBe(audioMixNodes[0].id);
  });

  test('no audio clips produces a silent audio source', () => {
    const doc = emptyProjectDocument('proj1', 'Test');
    const graph = buildFilterGraph(doc, {});

    // Should have a silent audio source
    const silentSources = graph.nodes.filter(
      (n) => n.type === 'source' && (n as SourceNode).assetId === '__silent__'
    );
    expect(silentSources.length).toBe(1);

    // audioOut points at the silent source
    expect(graph.audioOut).toBe(silentSources[0].id);
  });

  test('multiple audio clips produce a CompositeNode for mixing', () => {
    const doc = emptyProjectDocument('proj1', 'Test');
    const audioTrack = doc.tracks.find((t) => t.kind === 'audio')!;
    const assetsById = {
      asset_a1: makeAssetRef({ id: 'asset_a1', kind: 'audio', storagePath: 'uploads/a1.wav' }),
      asset_a2: makeAssetRef({ id: 'asset_a2', kind: 'audio', storagePath: 'uploads/a2.wav' }),
    };
    doc.clips.push(
      createClip({
        trackId: audioTrack.id,
        kind: 'audio',
        assetId: 'asset_a1',
        duration: 5,
        timelineStart: 0,
        sourceStart: 0,
        sourceEnd: 5,
      })
    );
    doc.clips.push(
      createClip({
        trackId: audioTrack.id,
        kind: 'audio',
        assetId: 'asset_a2',
        duration: 5,
        timelineStart: 0,
        sourceStart: 0,
        sourceEnd: 5,
      })
    );

    const graph = buildFilterGraph(doc, assetsById);

    const audioSources = graph.nodes.filter(
      (n) => n.type === 'source' && (n as SourceNode).kind === 'audio'
    );
    expect(audioSources.length).toBe(2);

    const compositeNodes = graph.nodes.filter((n) => n.type === 'composite') as CompositeNode[];
    expect(compositeNodes.length).toBe(1);

    // audioOut points at the composite node
    expect(graph.audioOut).toBe(compositeNodes[0].id);
  });
});
