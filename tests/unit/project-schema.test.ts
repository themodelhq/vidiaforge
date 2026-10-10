// VidiaForge — Unit tests for ProjectDocument schema versioning
//
// Tests that:
//   - emptyProjectDocument produces a doc with schemaVersion: 1
//   - The full document round-trips through JSON.stringify/parse
//     (critical for storing timelineData in the DB JSON column)
//   - schemaVersion is preserved across the round-trip
//
// Run: bun run test:unit

import { test, expect, describe } from 'bun:test';
import {
  emptyProjectDocument,
  emptyTimelineState,
  createClip,
  createTrack,
} from '../../src/lib/timeline';
import type { ProjectDocument, TimelineClip, TimelineTrack } from '../../src/lib/types';

describe('emptyProjectDocument schema version', () => {
  test('has schemaVersion: 1', () => {
    const doc = emptyProjectDocument('proj1', 'Test Project');
    expect(doc.schemaVersion).toBe(1);
  });

  test('emptyTimelineState also has schemaVersion: 1', () => {
    const ts = emptyTimelineState();
    expect(ts.schemaVersion).toBe(1);
  });

  test('multiple emptyProjectDocument calls all return schemaVersion: 1', () => {
    const docs = [
      emptyProjectDocument('a', 'A'),
      emptyProjectDocument('b', 'B'),
      emptyProjectDocument('c', 'C'),
    ];
    for (const d of docs) {
      expect(d.schemaVersion).toBe(1);
    }
  });
});

describe('ProjectDocument JSON round-trip', () => {
  test('empty document round-trips through JSON.stringify/parse', () => {
    const doc = emptyProjectDocument('proj1', 'Test');
    const json = JSON.stringify(doc);
    const parsed: ProjectDocument = JSON.parse(json);

    expect(parsed.schemaVersion).toBe(doc.schemaVersion);
    expect(parsed.project).toEqual(doc.project);
    expect(parsed.tracks).toEqual(doc.tracks);
    expect(parsed.clips).toEqual(doc.clips);
    expect(parsed.markers).toEqual(doc.markers);
    expect(parsed.assets).toEqual(doc.assets);
  });

  test('document with clips round-trips preserving all clip fields', () => {
    const doc = emptyProjectDocument('proj1', 'Test');
    const videoTrack = doc.tracks.find((t) => t.kind === 'video')!;
    const clip: TimelineClip = createClip({
      trackId: videoTrack.id,
      kind: 'video',
      assetId: 'asset_1',
      assetName: 'sample.mp4',
      sourceStart: 5,
      sourceEnd: 15,
      timelineStart: 10,
      duration: 10,
      speed: 2,
      reverse: true,
    });
    doc.clips.push(clip);

    const json = JSON.stringify(doc);
    const parsed: ProjectDocument = JSON.parse(json);

    expect(parsed.clips.length).toBe(1);
    expect(parsed.clips[0]).toEqual(clip);
    expect(parsed.clips[0].sourceStart).toBe(5);
    expect(parsed.clips[0].sourceEnd).toBe(15);
    expect(parsed.clips[0].timelineStart).toBe(10);
    expect(parsed.clips[0].duration).toBe(10);
    expect(parsed.clips[0].speed).toBe(2);
    expect(parsed.clips[0].reverse).toBe(true);
    expect(parsed.clips[0].assetId).toBe('asset_1');
  });

  test('document with a text clip round-trips preserving text style', () => {
    const doc = emptyProjectDocument('proj1', 'Test');
    const textTrack = doc.tracks.find((t) => t.kind === 'text')!;
    const clip = createClip({
      trackId: textTrack.id,
      kind: 'text',
      duration: 3,
      timelineStart: 1,
      text: {
        text: 'Hello, World!',
        fontFamily: 'Inter',
        fontSize: 48,
        fontWeight: 700,
        italic: true,
        letterSpacing: 0.5,
        lineHeight: 1.2,
        align: 'center',
        color: '#FFFFFF',
        stroke: { color: '#000000', width: 2 },
        shadow: { color: '#000000', blur: 4, x: 2, y: 2 },
        background: { color: '#FF0000', rounded: 8, padding: 12 },
        animation: 'fade',
      },
    });
    doc.clips.push(clip);

    const json = JSON.stringify(doc);
    const parsed: ProjectDocument = JSON.parse(json);

    expect(parsed.clips.length).toBe(1);
    expect(parsed.clips[0].text).toEqual(clip.text);
    expect(parsed.clips[0].text?.text).toBe('Hello, World!');
    expect(parsed.clips[0].text?.fontSize).toBe(48);
    expect(parsed.clips[0].text?.italic).toBe(true);
    expect(parsed.clips[0].text?.animation).toBe('fade');
  });

  test('document with multiple tracks round-trips preserving track fields', () => {
    const doc = emptyProjectDocument('proj1', 'Test');
    const customTrack: TimelineTrack = createTrack('overlay', 'Picture-in-picture');
    customTrack.locked = true;
    customTrack.color = '#FF0000';
    doc.tracks.push(customTrack);

    const json = JSON.stringify(doc);
    const parsed: ProjectDocument = JSON.parse(json);

    const parsedCustomTrack = parsed.tracks.find((t) => t.id === customTrack.id);
    expect(parsedCustomTrack).toBeDefined();
    expect(parsedCustomTrack!.name).toBe('Picture-in-picture');
    expect(parsedCustomTrack!.kind).toBe('overlay');
    expect(parsedCustomTrack!.locked).toBe(true);
    expect(parsedCustomTrack!.color).toBe('#FF0000');
  });

  test('document with assets round-trips preserving asset refs', () => {
    const doc = emptyProjectDocument('proj1', 'Test');
    doc.assets = [
      {
        id: 'asset_1',
        name: 'video.mp4',
        kind: 'video',
        mimeType: 'video/mp4',
        size: 1234567,
        duration: 30,
        width: 1920,
        height: 1080,
        fps: 30,
        thumbnailUrl: '/thumbnails/asset_1.jpg',
        storagePath: 'uploads/user1/asset_1.mp4',
      },
      {
        id: 'asset_2',
        name: 'audio.wav',
        kind: 'audio',
        mimeType: 'audio/wav',
        size: 500000,
        duration: 15,
        storagePath: 'uploads/user1/asset_2.wav',
      },
    ];

    const json = JSON.stringify(doc);
    const parsed: ProjectDocument = JSON.parse(json);

    expect(parsed.assets.length).toBe(2);
    expect(parsed.assets[0]).toEqual(doc.assets[0]);
    expect(parsed.assets[1]).toEqual(doc.assets[1]);
  });

  test('document with markers round-trips preserving markers', () => {
    const doc = emptyProjectDocument('proj1', 'Test');
    doc.markers = [
      { id: 'm1', time: 0, label: 'Start', color: '#00FF00', note: 'Beginning' },
      { id: 'm2', time: 10, label: 'Middle', color: '#FFFF00' },
      { id: 'm3', time: 30, label: 'End', color: '#FF0000', note: 'Conclusion' },
    ];

    const json = JSON.stringify(doc);
    const parsed: ProjectDocument = JSON.parse(json);

    expect(parsed.markers.length).toBe(3);
    expect(parsed.markers).toEqual(doc.markers);
  });

  test('document with clips having effects + filters + transitions round-trips', () => {
    const doc = emptyProjectDocument('proj1', 'Test');
    const videoTrack = doc.tracks.find((t) => t.kind === 'video')!;
    const clip = createClip({
      trackId: videoTrack.id,
      kind: 'video',
      duration: 10,
      effects: [
        { id: 'eff1', type: 'blur', intensity: 0.5, enabled: true, params: { radius: 10 } },
        { id: 'eff2', type: 'vignette', intensity: 0.3, enabled: true },
      ],
      filters: [
        { id: 'flt1', type: 'cinematic', intensity: 0.7, enabled: true },
        { id: 'flt2', type: 'warm', intensity: 0.4, enabled: false },
      ],
      transitions: [
        { id: 'tr1', type: 'cross-dissolve', duration: 0.5 },
        { id: 'tr2', type: 'fade', duration: 0.3 },
      ],
    });
    doc.clips.push(clip);

    const json = JSON.stringify(doc);
    const parsed: ProjectDocument = JSON.parse(json);

    expect(parsed.clips[0].effects).toEqual(clip.effects);
    expect(parsed.clips[0].filters).toEqual(clip.filters);
    expect(parsed.clips[0].transitions).toEqual(clip.transitions);
    expect(parsed.clips[0].effects.length).toBe(2);
    expect(parsed.clips[0].filters.length).toBe(2);
    expect(parsed.clips[0].transitions.length).toBe(2);
  });

  test('document with keyframes round-trips preserving keyframes + bezier curves', () => {
    const doc = emptyProjectDocument('proj1', 'Test');
    const videoTrack = doc.tracks.find((t) => t.kind === 'video')!;
    const clip = createClip({
      trackId: videoTrack.id,
      kind: 'video',
      duration: 5,
      keyframes: [
        { id: 'kf1', time: 0, property: 'opacity', value: 0, easing: 'linear' },
        { id: 'kf2', time: 1, property: 'opacity', value: 1, easing: 'bezier', bezier: [0.4, 0, 0.2, 1] },
        { id: 'kf3', time: 4, property: 'opacity', value: 1, easing: 'ease-in-out' },
        { id: 'kf4', time: 5, property: 'opacity', value: 0, easing: 'cubic' },
      ],
    });
    doc.clips.push(clip);

    const json = JSON.stringify(doc);
    const parsed: ProjectDocument = JSON.parse(json);

    expect(parsed.clips[0].keyframes).toEqual(clip.keyframes);
    expect(parsed.clips[0].keyframes.length).toBe(4);
    expect(parsed.clips[0].keyframes[1].bezier).toEqual([0.4, 0, 0.2, 1]);
  });
});

describe('schema version is preserved on save', () => {
  // Simulates the DB save round-trip:
  //   1. Editor produces a ProjectDocument in memory.
  //   2. JSON.stringify before saving to Project.timelineData (TEXT column).
  //   3. JSON.parse when loading the project from the DB.
  //   4. The loaded doc's schemaVersion must equal the saved doc's schemaVersion.

  test('schemaVersion is preserved after a single save/load cycle', () => {
    const original = emptyProjectDocument('proj1', 'Test');
    const saved = JSON.stringify(original);
    const loaded: ProjectDocument = JSON.parse(saved);

    expect(loaded.schemaVersion).toBe(original.schemaVersion);
    expect(loaded.schemaVersion).toBe(1);
  });

  test('schemaVersion is preserved after multiple save/load cycles', () => {
    let doc: ProjectDocument = emptyProjectDocument('proj1', 'Test');

    // Simulate 5 save/load cycles
    for (let i = 0; i < 5; i++) {
      doc = JSON.parse(JSON.stringify(doc));
    }

    expect(doc.schemaVersion).toBe(1);
  });

  test('schemaVersion is preserved after edits + save/load', () => {
    const original = emptyProjectDocument('proj1', 'Test');
    original.clips.push(
      createClip({
        trackId: original.tracks[0].id,
        kind: 'video',
        duration: 10,
      })
    );

    const saved = JSON.stringify(original);
    const loaded: ProjectDocument = JSON.parse(saved);

    expect(loaded.schemaVersion).toBe(1);
    expect(loaded.clips.length).toBe(1);
  });

  test('schemaVersion is preserved when the doc is stored as Project.timelineData JSON', () => {
    // Simulate the actual DB pattern: project.timelineData = JSON.stringify(doc)
    const original = emptyProjectDocument('proj1', 'Test');
    // Simulate Project.timelineData column (TEXT)
    const timelineData: string = JSON.stringify(original);

    // Simulate loading: project = db.project.findUnique(...)
    //                  doc = JSON.parse(project.timelineData)
    const loaded: ProjectDocument = JSON.parse(timelineData);

    expect(loaded.schemaVersion).toBe(1);
    expect(loaded.project.id).toBe('proj1');
    expect(loaded.tracks.length).toBe(3);
  });
});

describe('schemaVersion field is at the top level', () => {
  test('schemaVersion is a direct property of ProjectDocument', () => {
    const doc = emptyProjectDocument('proj1', 'Test');
    expect(Object.prototype.hasOwnProperty.call(doc, 'schemaVersion')).toBe(true);
  });

  test('schemaVersion is a number, not a string', () => {
    const doc = emptyProjectDocument('proj1', 'Test');
    expect(typeof doc.schemaVersion).toBe('number');
  });

  test('schemaVersion is 1 (the only currently supported version)', () => {
    const doc = emptyProjectDocument('proj1', 'Test');
    expect(doc.schemaVersion).toBe(1);
    // Future versions (2, 3, ...) would require a migration + version check
    // in the loader. For now, only version 1 is supported.
  });
});

describe('ProjectDocument deep equality after round-trip', () => {
  test('a complex document deeply equals itself after JSON round-trip', () => {
    const doc = emptyProjectDocument('proj_complex', 'Complex Project');

    // Add a video clip with effects
    const videoTrack = doc.tracks.find((t) => t.kind === 'video')!;
    doc.clips.push(
      createClip({
        trackId: videoTrack.id,
        kind: 'video',
        duration: 10,
        sourceStart: 0,
        sourceEnd: 10,
        timelineStart: 0,
        assetId: 'asset_1',
        effects: [
          { id: 'e1', type: 'blur', intensity: 0.5, enabled: true },
        ],
        transitions: [
          { id: 't1', type: 'fade', duration: 0.5 },
        ],
      })
    );

    // Add a text clip
    const textTrack = doc.tracks.find((t) => t.kind === 'text')!;
    doc.clips.push(
      createClip({
        trackId: textTrack.id,
        kind: 'text',
        duration: 5,
        timelineStart: 2,
        text: {
          text: 'Test',
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

    // Add a marker
    doc.markers.push({
      id: 'm1',
      time: 5,
      label: 'Mid',
      color: '#FFFF00',
    });

    // Add an asset
    doc.assets.push({
      id: 'asset_1',
      name: 'video.mp4',
      kind: 'video',
      mimeType: 'video/mp4',
      size: 1000000,
      duration: 10,
      width: 1920,
      height: 1080,
      fps: 30,
      storagePath: 'uploads/asset_1.mp4',
    });

    const json = JSON.stringify(doc);
    const parsed: ProjectDocument = JSON.parse(json);

    // Deep equality — every field preserved.
    expect(parsed).toEqual(doc);
  });
});
