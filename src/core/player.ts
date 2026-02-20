import Hls from 'hls.js';
import { detectPlatform } from './platform';
import { ThreeSpeakApi } from './api';
import type {
  VideoSource,
  PlayerConfig,
  PlayerState,
  PlayerEvents,
  EventHandler,
  EventUnsubscribe,
  QualityLevel,
} from '../types';

const DEFAULT_CONFIG: Required<PlayerConfig> = {
  apiBase: 'https://play.3speak.tv',
  debug: false,
  muted: true,
  loop: false,
  poster: true,
  hlsConfig: {},
  audioOnly: false,
  autopause: false,
  resume: false,
};

/**
 * 3Speak HLS Video Player.
 *
 * Framework-agnostic — works with any <video> element.
 * Handles HLS playback via native Safari HLS or hls.js (Chrome/Firefox/Edge).
 *
 * @example
 * ```js
 * import { Player } from '@mantequilla-soft/3speak-player';
 *
 * const player = new Player({ muted: true, loop: true });
 * player.attach(document.querySelector('video'));
 * player.load('@author/permlink');
 * player.on('ready', ({ isVertical }) => console.log('vertical?', isVertical));
 * ```
 */
export class Player {
  private config: Required<PlayerConfig>;
  private api: ThreeSpeakApi;
  private platform = detectPlatform();
  private video: HTMLVideoElement | null = null;
  private hls: Hls | null = null;
  private listeners = new Map<string, Set<Function>>();
  private fallbackIndex = 0;
  private fallbacks: string[] = [];
  private _ready = false;
  private _destroyed = false;
  private _audioOnly = false;
  private _currentRef: string | null = null;
  private _resumeSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private _observer: IntersectionObserver | null = null;
  private cleanupFns: (() => void)[] = [];

  constructor(config?: PlayerConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.api = new ThreeSpeakApi(this.config.apiBase, this.config.debug);
    this._audioOnly = this.config.audioOnly;
  }

  private log(...args: unknown[]) {
    if (this.config.debug) console.log('[3Speak Player]', ...args);
  }

  // ─── Event Emitter ───

  /**
   * Subscribe to a player event.
   * @returns Unsubscribe function
   */
  on<T extends keyof PlayerEvents>(event: T, handler: EventHandler<T>): EventUnsubscribe {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
    return () => this.off(event, handler);
  }

  /** Unsubscribe from a player event. */
  off<T extends keyof PlayerEvents>(event: T, handler: EventHandler<T>): void {
    this.listeners.get(event)?.delete(handler);
  }

  /** Subscribe to a player event, auto-unsubscribe after first call. */
  once<T extends keyof PlayerEvents>(event: T, handler: EventHandler<T>): EventUnsubscribe {
    const wrapped = ((...args: unknown[]) => {
      unsub();
      (handler as Function)(...args);
    }) as EventHandler<T>;
    const unsub = this.on(event, wrapped);
    return unsub;
  }

  private emit<T extends keyof PlayerEvents>(event: T, ...args: Parameters<PlayerEvents[T]>): void {
    this.listeners.get(event)?.forEach((handler) => {
      try {
        (handler as Function)(...args);
      } catch (e) {
        console.error(`[3Speak Player] Error in ${event} handler:`, e);
      }
    });
  }

  // ─── Lifecycle ───

  /**
   * Attach the player to a <video> element.
   * Sets required attributes (playsinline, etc.) automatically.
   */
  attach(element: HTMLVideoElement): this {
    if (this._destroyed) throw new Error('Player is destroyed');
    if (this.video === element) return this;

    // Clean up previous attachment
    this.detach();

    this.video = element;

    // Set required attributes for iOS
    element.setAttribute('playsinline', '');
    element.setAttribute('webkit-playsinline', '');
    element.muted = this.config.muted;
    element.loop = this.config.loop;

    // Bind events
    this.bindVideoEvents(element);

    // Auto-pause on scroll out
    if (this.config.autopause) {
      this.setupAutopause(element);
    }

    this.log('Attached to video element');
    return this;
  }

  /**
   * Detach from the current video element and clean up HLS.
   */
  detach(): this {
    this.destroyHls();
    this.cleanupFns.forEach((fn) => fn());
    this.cleanupFns = [];

    if (this.video) {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();
    }

    this.destroyAutopause();
    if (this._resumeSaveTimer) {
      clearTimeout(this._resumeSaveTimer);
      this._resumeSaveTimer = null;
    }

    this.video = null;
    this._ready = false;
    this.fallbackIndex = 0;
    this.fallbacks = [];
    return this;
  }

  /**
   * Load a video by author/permlink (fetches HLS URL from 3Speak API).
   * @param ref - Either "author/permlink" or "@author/permlink"
   */
  async load(ref: string): Promise<this>;
  /**
   * Load a video from a direct VideoSource.
   */
  async load(source: VideoSource): Promise<this>;
  async load(refOrSource: string | VideoSource): Promise<this> {
    if (!this.video) throw new Error('No video element attached. Call attach() first.');

    let source: VideoSource;

    if (typeof refOrSource === 'string') {
      const clean = refOrSource.replace(/^@/, '');
      const [author, permlink] = clean.split('/');
      if (!author || !permlink) throw new Error(`Invalid video ref: "${refOrSource}". Use "author/permlink".`);

      this._currentRef = clean;
      this.log('Loading from API:', author, permlink);
      this.emit('loading', true as any);
      source = await this.api.fetchSource(author, permlink);
    } else {
      this._currentRef = null;
      source = refOrSource;
    }

    this._ready = false;
    this.fallbackIndex = 0;
    this.fallbacks = source.fallbacks || [];

    if (this.config.poster && source.poster && this.video) {
      this.video.poster = source.poster;
    }

    this.loadSource(source.url);
    this.emit('loading', true as any);
    return this;
  }

  // ─── Playback Controls ───

  play(): Promise<void> {
    if (!this.video) return Promise.resolve();
    const promise = this.video.play();
    return promise || Promise.resolve();
  }

  pause(): void {
    this.video?.pause();
  }

  togglePlay(): void {
    if (!this.video) return;
    if (this.video.paused) {
      this.play();
    } else {
      this.pause();
    }
  }

  seek(time: number): void {
    if (this.video) this.video.currentTime = time;
  }

  /** Set muted state */
  setMuted(muted: boolean): void {
    if (this.video) this.video.muted = muted;
  }

  /** Set volume (0-1) */
  setVolume(volume: number): void {
    if (this.video) this.video.volume = Math.max(0, Math.min(1, volume));
  }

  /** Set loop mode */
  setLoop(loop: boolean): void {
    this.config.loop = loop;
    if (this.video) this.video.loop = loop;
  }

  /** Set playback rate */
  setPlaybackRate(rate: number): void {
    if (this.video) this.video.playbackRate = rate;
  }

  /** Toggle Picture-in-Picture mode */
  async togglePip(): Promise<void> {
    if (!this.video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (this.video.requestPictureInPicture) {
        await this.video.requestPictureInPicture();
      }
    } catch (e) {
      this.log('PiP toggle failed:', e);
    }
  }

  /** Toggle fullscreen mode */
  async toggleFullscreen(): Promise<void> {
    if (!this.video) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await this.video.requestFullscreen();
      }
    } catch (e) {
      this.log('Fullscreen toggle failed:', e);
    }
  }

  /** Get available quality levels (hls.js only, empty for native HLS) */
  getQualities(): QualityLevel[] {
    if (!this.hls) return [];
    return this.hls.levels.map((level, index) => ({
      index,
      height: level.height,
      width: level.width,
      bitrate: level.bitrate,
    }));
  }

  /** Set quality level (-1 for auto, hls.js only) */
  setQuality(index: number): void {
    if (!this.hls) return;
    this.log('setQuality:', index);
    this.hls.currentLevel = index;
    // Also set nextLevel so the switch persists across segment boundaries
    this.hls.nextLevel = index;
  }

  /** Get current quality level index (-1 = auto, hls.js only) */
  getCurrentQuality(): number {
    return this.hls?.currentLevel ?? -1;
  }

  /**
   * Get thumbnail at a given time. Currently returns the poster image.
   * Reserved for future sprite sheet support.
   */
  getThumbnailAt(_time: number): string | null {
    return this.video?.poster || null;
  }

  /** Set audio-only mode (hides video, keeps audio playing) */
  setAudioOnly(enabled: boolean): void {
    this._audioOnly = enabled;
    if (this.video) {
      this.video.style.visibility = enabled ? 'hidden' : '';
    }
    this.log('Audio-only:', enabled);
  }

  /** Enable auto-pause when video scrolls out of viewport */
  enableAutopause(): void {
    this.config.autopause = true;
    if (this.video && !this._observer) {
      this.setupAutopause(this.video);
    }
  }

  /** Disable auto-pause on scroll out */
  disableAutopause(): void {
    this.config.autopause = false;
    this.destroyAutopause();
  }

  /** Clear saved resume position for a video ref. Clears current video if no ref given. */
  clearResumePosition(ref?: string): void {
    const key = ref || this._currentRef;
    if (key) {
      try { localStorage.removeItem(`3speak_pos_${key}`); } catch {}
      this.log('Cleared resume position for', key);
    }
  }

  // ─── State ───

  /** Get current player state snapshot */
  getState(): PlayerState {
    const v = this.video;
    let buffered = 0;
    if (v && v.buffered.length > 0 && v.duration > 0) {
      buffered = v.buffered.end(v.buffered.length - 1) / v.duration;
    }
    return {
      currentTime: v?.currentTime || 0,
      duration: v?.duration || 0,
      paused: v?.paused ?? true,
      muted: v?.muted ?? this.config.muted,
      volume: v?.volume ?? 1,
      ready: this._ready,
      loading: !this._ready && !!this.video?.src,
      isVertical: v ? (v.videoHeight > v.videoWidth ? true : v.videoWidth > 0 ? false : null) : null,
      videoWidth: v?.videoWidth || 0,
      videoHeight: v?.videoHeight || 0,
      buffered,
      pip: !!document.pictureInPictureElement && document.pictureInPictureElement === v,
      fullscreen: !!document.fullscreenElement && document.fullscreenElement === v,
      audioOnly: this._audioOnly,
      playbackRate: v?.playbackRate ?? 1,
    };
  }

  /** Whether the player has loaded metadata and is ready to play */
  get ready(): boolean {
    return this._ready;
  }

  /** Whether this player instance has been destroyed */
  get destroyed(): boolean {
    return this._destroyed;
  }

  /** The underlying <video> element (if attached) */
  get element(): HTMLVideoElement | null {
    return this.video;
  }

  /** Access the 3Speak API client */
  get apiClient(): ThreeSpeakApi {
    return this.api;
  }

  // ─── Cleanup ───

  /**
   * Destroy the player and release all resources.
   * Cannot be used after this.
   */
  destroy(): void {
    this.detach();
    this.listeners.clear();
    this._destroyed = true;
    this.log('Destroyed');
  }

  // ─── Private ───

  private loadSource(hlsUrl: string): void {
    if (!this.video) return;

    // Clean up any existing HLS instance
    this.destroyHls();

    const platform = this.platform;

    if (platform.supportsHlsJs) {
      // Prefer hls.js when MSE is available (Chrome, Firefox, Edge, modern Safari/iOS).
      // This avoids relying on UA detection which can be spoofed by browser
      // device-emulation tools (Firefox responsive-design-mode, Chrome DevTools).
      this.log('Using hls.js');
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferSize: 10 * 1000 * 1000,
        maxBufferLength: 15,
        startLevel: 0,
        startFragPrefetch: true,
        ...this.config.hlsConfig,
      });

      hls.loadSource(hlsUrl);
      hls.attachMedia(this.video);

      hls.on(Hls.Events.LEVEL_SWITCHING, (_event, data) => {
        const level = hls.levels[data.level];
        if (level) {
          this.log('Quality switching to:', data.level, `${level.height}p`);
          this.emit('qualitychange', {
            index: data.level,
            height: level.height,
            width: level.width,
            bitrate: level.bitrate,
          });
        }
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
        const level = hls.levels[data.level];
        if (level) {
          this.log('Quality switched to:', data.level, `${level.height}p`);
        }
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          this.log('Fatal HLS error:', data.type, data.details);
          if (this.tryFallback(hls)) return;

          this.emit('error', {
            message: `HLS fatal error: ${data.details}`,
            code: data.response?.code,
            fatal: true,
          });
          hls.destroy();
          this.hls = null;
        } else {
          this.emit('error', {
            message: `HLS error: ${data.details}`,
            fatal: false,
          });
        }
      });

      this.hls = hls;
    } else if (platform.supportsNativeHLS) {
      // Fallback: native HLS (old iOS/Safari without MSE)
      this.log('Using native HLS');
      this.video.src = hlsUrl;
    } else {
      this.emit('error', {
        message: 'No HLS support detected. Cannot play this video.',
        fatal: true,
      });
    }
  }

  private tryFallback(hls?: Hls): boolean {
    if (this.fallbackIndex < this.fallbacks.length) {
      const fallbackUrl = this.fallbacks[this.fallbackIndex];
      this.fallbackIndex++;
      this.log(`Trying fallback ${this.fallbackIndex}:`, fallbackUrl.substring(0, 80));
      this.emit('fallback', { url: fallbackUrl, index: this.fallbackIndex });

      if (hls) {
        hls.loadSource(fallbackUrl);
      } else if (this.video) {
        this.video.src = fallbackUrl;
      }
      return true;
    }
    return false;
  }

  private destroyHls(): void {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
  }

  private setupAutopause(element: HTMLVideoElement): void {
    if (typeof IntersectionObserver === 'undefined') return;
    this.destroyAutopause();
    this._observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        const visible = entry.isIntersecting;
        this.emit('visibility', visible);
        if (!visible && !this.video?.paused) {
          this.pause();
          this.log('Auto-paused (scrolled out of view)');
        }
      },
      { threshold: 0.25 },
    );
    this._observer.observe(element);
  }

  private destroyAutopause(): void {
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
  }

  private saveResumePosition(): void {
    if (!this.config.resume || !this._currentRef || !this.video) return;
    const time = this.video.currentTime;
    if (time < 1) return; // Don't save near the start
    try { localStorage.setItem(`3speak_pos_${this._currentRef}`, String(time)); } catch {}
  }

  private restoreResumePosition(): void {
    if (!this.config.resume || !this._currentRef || !this.video) return;
    try {
      const saved = localStorage.getItem(`3speak_pos_${this._currentRef}`);
      if (!saved) return;
      const time = parseFloat(saved);
      if (isNaN(time) || time < 1) return;
      // Skip if near the end (within 3s)
      const duration = this.video.duration;
      if (duration && time > duration - 3) return;
      this.video.currentTime = time;
      this.emit('resume', { time, ref: this._currentRef });
      this.log('Resumed at', time.toFixed(1) + 's');
    } catch {}
  }

  private bindVideoEvents(video: HTMLVideoElement): void {
    const on = <K extends keyof HTMLVideoElementEventMap>(
      event: K,
      handler: (e: HTMLVideoElementEventMap[K]) => void
    ) => {
      video.addEventListener(event, handler);
      this.cleanupFns.push(() => video.removeEventListener(event, handler));
    };

    on('loadedmetadata', () => {
      if (this._ready) return;
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w && h) {
        this._ready = true;
        const isVertical = h > w;
        this.restoreResumePosition();
        this.emit('ready', { isVertical, width: w, height: h });
        this.emit('resize', { isVertical, width: w, height: h });
        this.emit('loading', false as any);
        this.log(`Ready: ${w}x${h} (${isVertical ? 'vertical' : 'horizontal'})`);
      }
    });

    // Fallback for browsers that fire loadeddata before loadedmetadata has dimensions
    on('loadeddata', () => {
      if (!this._ready && video.videoWidth && video.videoHeight) {
        this._ready = true;
        const isVertical = video.videoHeight > video.videoWidth;
        this.emit('ready', { isVertical, width: video.videoWidth, height: video.videoHeight });
        this.emit('resize', { isVertical, width: video.videoWidth, height: video.videoHeight });
        this.emit('loading', false as any);
      }
    });

    on('timeupdate', () => {
      this.emit('timeupdate', {
        currentTime: video.currentTime,
        duration: video.duration || 0,
        paused: video.paused,
      });
      // Throttle-save resume position (every 3s)
      if (this.config.resume && this._currentRef && !this._resumeSaveTimer) {
        this._resumeSaveTimer = setTimeout(() => {
          this._resumeSaveTimer = null;
          this.saveResumePosition();
        }, 3000);
      }
    });

    on('play', () => this.emit('play'));
    on('pause', () => this.emit('pause'));
    on('ended', () => this.emit('ended'));

    on('waiting', () => this.emit('loading', true as any));
    on('canplay', () => { if (this._ready) this.emit('loading', false as any); });

    on('progress', () => {
      if (video.buffered.length > 0 && video.duration > 0) {
        this.emit('buffered', video.buffered.end(video.buffered.length - 1) / video.duration);
      }
    });

    on('ratechange', () => {
      this.emit('ratechange', video.playbackRate);
    });

    on('enterpictureinpicture' as any, () => this.emit('pip', true));
    on('leavepictureinpicture' as any, () => this.emit('pip', false));

    const onFullscreenChange = () => {
      this.emit('fullscreen', document.fullscreenElement === video);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    this.cleanupFns.push(() => document.removeEventListener('fullscreenchange', onFullscreenChange));

    // Native fallback on error (iOS / non-hls.js)
    on('error', () => {
      if (!this.hls && !this.tryFallback()) {
        this.emit('error', {
          message: video.error?.message || 'Video playback error',
          code: video.error?.code,
          fatal: true,
        });
      }
    });
  }
}
