// VidiaForge — Render engine exports

export { FFmpegRenderService, validateProject } from './ffmpeg-render-service';
export type {
  RenderValidationInput,
  RenderValidationResult,
} from './ffmpeg-render-service';
export { buildFilterGraph } from './filter-graph';
export { getRenderOutputKey, getRenderOutputPrefix } from './job-idempotency';
export * from './types';
export type {
  FilterGraph,
  FilterGraphAnyNode,
  SourceNode,
  TrimNode,
  SpeedNode,
  TransformNode,
  CropNode,
  ColorNode,
  EffectNode,
  FilterNode,
  MaskNode,
  TextNode,
  AudioMixNode,
  CompositeNode,
  TransitionNode,
  FadeNode,
  OutputNode,
} from './filter-graph';
