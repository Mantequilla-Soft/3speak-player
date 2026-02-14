/** Video source with CDN fallback chain */
export interface VideoSource {
  /** Primary HLS URL (.m3u8) */
  url: string;
  /** Fallback HLS URLs in priority order */
  fallbacks?: string[];
  /** Poster/thumbnail image URL */
  poster?: string;
}

/** Video metadata returned by the 3Speak API */
export interface VideoMetadata {
  owner: string;
  permlink: string;
  title: string;
  status: string;
  videoUrl: string;
  videoUrlFallback1: string | null;
  videoUrlFallback2: string | null;
  videoUrlFallback3: string | null;
  thumbnail: string | null;
  duration: number;
  views: number;
  short: boolean;
  isPlaceholder: boolean;
}

/** Player state snapshot */
export interface PlayerState {
  currentTime: number;
  duration: number;
  paused: boolean;
  muted: boolean;
  volume: number;
  ready: boolean;
  loading: boolean;
  isVertical: boolean | null;
  videoWidth: number;
  videoHeight: number;
  /** Buffered progress (0-1) */
  buffered: number;
  /** Picture-in-Picture active */
  pip: boolean;
  /** Fullscreen active */
  fullscreen: boolean;
  /** Audio-only mode active */
  audioOnly: boolean;
}

/** HLS quality level (hls.js only) */
export interface QualityLevel {
  index: number;
  height: number;
  width: number;
  bitrate: number;
}

/** Events emitted by the player */
export interface PlayerEvents {
  ready: (state: { isVertical: boolean; width: number; height: number }) => void;
  play: () => void;
  pause: () => void;
  ended: () => void;
  timeupdate: (state: { currentTime: number; duration: number; paused: boolean }) => void;
  error: (error: { message: string; code?: number; fatal: boolean }) => void;
  /** Fired when falling back to an alternate CDN source */
  fallback: (info: { url: string; index: number }) => void;
  /** Fired when video dimensions are known */
  resize: (info: { width: number; height: number; isVertical: boolean }) => void;
  /** Loading state changed */
  loading: (isLoading: boolean) => void;
  /** Buffered progress changed (0-1) */
  buffered: (progress: number) => void;
  /** Picture-in-Picture state changed */
  pip: (active: boolean) => void;
  /** Fullscreen state changed */
  fullscreen: (active: boolean) => void;
  /** Quality level changed (hls.js only) */
  qualitychange: (level: QualityLevel) => void;
  /** Video element visibility changed (IntersectionObserver) */
  visibility: (visible: boolean) => void;
  /** Playback resumed from saved position */
  resume: (info: { time: number; ref: string }) => void;
}

/** Configuration for creating a player instance */
export interface PlayerConfig {
  /** 3Speak player API base URL (default: https://play.3speak.tv) */
  apiBase?: string;
  /** Enable debug logging */
  debug?: boolean;
  /** Start muted (required for autoplay on most browsers) */
  muted?: boolean;
  /** Loop playback */
  loop?: boolean;
  /** Show poster/thumbnail image during loading (default: true) */
  poster?: boolean;
  /** hls.js configuration overrides */
  hlsConfig?: Record<string, unknown>;
  /** Start in audio-only mode */
  audioOnly?: boolean;
  /** Auto-pause when video scrolls out of viewport (IntersectionObserver) */
  autopause?: boolean;
  /** Resume playback from last position (uses localStorage) */
  resume?: boolean;
}

/** Platform detection results */
export interface PlatformInfo {
  isIOS: boolean;
  isSafari: boolean;
  supportsNativeHLS: boolean;
  supportsMSE: boolean;
  supportsHlsJs: boolean;
}

/** Type-safe event emitter */
export type EventHandler<T extends keyof PlayerEvents> = PlayerEvents[T];
export type EventUnsubscribe = () => void;
