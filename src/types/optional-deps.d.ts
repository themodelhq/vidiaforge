// VidiaForge — Optional dependency type declarations
//
// These packages are optional runtime dependencies (used via dynamic import
// in src/lib/media/binary-resolver.ts). They are NOT installed by default —
// the resolver falls through to system PATH if they're missing.
//
// This declarations file lets TypeScript understand the dynamic imports
// without requiring the packages to be installed at type-check time.

declare module 'ffmpeg-static' {
  const path: string;
  export default path;
}

declare module 'ffprobe-static' {
  interface FFprobeStaticExports {
    path: string;
    [platform: string]: string | { path: string };
  }
  const exports: FFprobeStaticExports;
  export = exports;
}
