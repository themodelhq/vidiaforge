// VidiaForge — Queue name constants shared between API + worker
export const QUEUE_NAMES = {
  MEDIA_INGEST: 'media-ingestion',
  RENDER: 'render',
  AI: 'ai',
  THUMBNAIL: 'thumbnail',
  PROXY: 'proxy',
  TRANSCRIPTION: 'transcription',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const ALL_QUEUE_NAMES = Object.values(QUEUE_NAMES);
