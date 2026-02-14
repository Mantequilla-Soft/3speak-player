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
} from '../types';

const DEFAULT_CONFIG: Required<PlayerConfig> = {
  apiBase: 'https://play.3speak.tv',
  debug: false,
  muted: true,
  loop: false,
  poster: true,
  hlsConfig: {},
};

/**
 * 3Speak HLS Video Player.
 *
 * Framework-agnostic — works with any <video> element.
 * Handles HLS playback via native Safari HLS or hls.js (Chrome/Firefox/Edge).
 *
 * @example
 * ```js
 * import { Player } from '@3speak/player-sdk';
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
  private cleanupFns: (() => void)[] = [];

  constructor(config?: PlayerConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.api = new ThreeSpeakApi(this.config.apiBase, this.config.debug);
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

      this.log('Loading from API:', author, permlink);
      this.emit('loading', true as any);
      source = await this.api.fetchSource(author, permlink);
    } else {
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

  // ─── State ───

  /** Get current player state snapshot */
  getState(): PlayerState {
    const v = this.video;
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

    if (platform.isIOS || (platform.isSafari && !platform.supportsHlsJs)) {
      // iOS Safari / older Safari: native HLS
      this.log('Using native HLS');
      this.video.src = hlsUrl;
    } else if (platform.supportsHlsJs) {
      // Chrome, Firefox, Edge: use hls.js
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
      // Fallback: native HLS on non-Safari (unlikely but safe)
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
    });

    on('play', () => this.emit('play'));
    on('pause', () => this.emit('pause'));
    on('ended', () => this.emit('ended'));

    on('waiting', () => this.emit('loading', true as any));
    on('canplay', () => { if (this._ready) this.emit('loading', false as any); });

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
