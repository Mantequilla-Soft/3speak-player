/**
 * React adapter for @mantequilla-soft/3speak-player
 *
 * @example
 * ```tsx
 * import { usePlayer } from '@mantequilla-soft/3speak-player/react';
 *
 * function VideoPlayer({ author, permlink }) {
 *   const { ref, state, play, pause, togglePlay, setMuted } = usePlayer({
 *     autoLoad: `${author}/${permlink}`,
 *     muted: true,
 *     loop: true,
 *     onReady: ({ isVertical }) => console.log('vertical?', isVertical),
 *   });
 *
 *   return <video ref={ref} playsInline style={{ width: '100%' }} />;
 * }
 * ```
 */
import { useRef, useEffect, useCallback, useState } from 'react';
import { Player } from './core/player';
import { PlayerPool } from './core/pool';
import type { PlayerConfig, PlayerState, PlayerEvents, VideoSource } from './types';

// ─── usePlayer ───

export interface UsePlayerOptions extends PlayerConfig {
  /** Auto-load a video by ref ("author/permlink") or source object */
  autoLoad?: string | VideoSource;
  /** Auto-play after ready */
  autoPlay?: boolean;
  /** Event callbacks */
  onReady?: PlayerEvents['ready'];
  onPlay?: PlayerEvents['play'];
  onPause?: PlayerEvents['pause'];
  onEnded?: PlayerEvents['ended'];
  onTimeUpdate?: PlayerEvents['timeupdate'];
  onError?: PlayerEvents['error'];
}

export interface UsePlayerReturn {
  /** Ref to attach to your <video> element */
  ref: (element: HTMLVideoElement | null) => void;
  /** Current player state (reactive) */
  state: PlayerState;
  /** The underlying Player instance */
  player: Player;
  /** Load a video */
  load: (refOrSource: string | VideoSource) => Promise<void>;
  play: () => Promise<void>;
  pause: () => void;
  togglePlay: () => void;
  seek: (time: number) => void;
  setMuted: (muted: boolean) => void;
  setVolume: (volume: number) => void;
  setLoop: (loop: boolean) => void;
  togglePip: () => Promise<void>;
  toggleFullscreen: () => Promise<void>;
  setQuality: (index: number) => void;
  getQualities: () => import('./types').QualityLevel[];
  setAudioOnly: (enabled: boolean) => void;
  enableAutopause: () => void;
  disableAutopause: () => void;
  clearResumePosition: (ref?: string) => void;
}

const EMPTY_STATE: PlayerState = {
  currentTime: 0,
  duration: 0,
  paused: true,
  muted: true,
  volume: 1,
  ready: false,
  loading: false,
  isVertical: null,
  videoWidth: 0,
  videoHeight: 0,
  buffered: 0,
  pip: false,
  fullscreen: false,
  audioOnly: false,
};

/**
 * React hook for a single 3Speak video player.
 */
export function usePlayer(options: UsePlayerOptions = {}): UsePlayerReturn {
  const {
    autoLoad,
    autoPlay,
    onReady,
    onPlay,
    onPause,
    onEnded,
    onTimeUpdate,
    onError,
    ...config
  } = options;

  const playerRef = useRef<Player | null>(null);
  const [state, setState] = useState<PlayerState>(EMPTY_STATE);

  // Stable refs for callbacks
  const callbackRefs = useRef({ onReady, onPlay, onPause, onEnded, onTimeUpdate, onError });
  callbackRefs.current = { onReady, onPlay, onPause, onEnded, onTimeUpdate, onError };

  // Create player once
  if (!playerRef.current) {
    playerRef.current = new Player(config);
  }
  const player = playerRef.current;

  // Subscribe to events
  useEffect(() => {
    const unsubs: (() => void)[] = [];

    unsubs.push(player.on('ready', (info) => {
      setState(player.getState());
      callbackRefs.current.onReady?.(info);
      if (autoPlay) player.play();
    }));

    unsubs.push(player.on('timeupdate', (info) => {
      // Throttle state updates to ~4fps to avoid excessive re-renders
      setState(player.getState());
      callbackRefs.current.onTimeUpdate?.(info);
    }));

    unsubs.push(player.on('play', () => {
      setState(s => ({ ...s, paused: false }));
      callbackRefs.current.onPlay?.();
    }));

    unsubs.push(player.on('pause', () => {
      setState(s => ({ ...s, paused: true }));
      callbackRefs.current.onPause?.();
    }));

    unsubs.push(player.on('ended', () => {
      callbackRefs.current.onEnded?.();
    }));

    unsubs.push(player.on('error', (err) => {
      callbackRefs.current.onError?.(err);
    }));

    return () => unsubs.forEach(fn => fn());
  }, [player, autoPlay]);

  // Ref callback for the <video> element
  const ref = useCallback((element: HTMLVideoElement | null) => {
    if (element) {
      player.attach(element);

      // Auto-load if specified
      if (autoLoad) {
        player.load(autoLoad as any);
      }
    }
  }, [player, autoLoad]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, []);

  return {
    ref,
    state,
    player,
    load: useCallback(async (refOrSource) => { await player.load(refOrSource as any); }, [player]),
    play: useCallback(() => player.play(), [player]),
    pause: useCallback(() => player.pause(), [player]),
    togglePlay: useCallback(() => player.togglePlay(), [player]),
    seek: useCallback((time: number) => player.seek(time), [player]),
    setMuted: useCallback((muted: boolean) => player.setMuted(muted), [player]),
    setVolume: useCallback((volume: number) => player.setVolume(volume), [player]),
    setLoop: useCallback((loop: boolean) => player.setLoop(loop), [player]),
    togglePip: useCallback(() => player.togglePip(), [player]),
    toggleFullscreen: useCallback(() => player.toggleFullscreen(), [player]),
    setQuality: useCallback((index: number) => player.setQuality(index), [player]),
    getQualities: useCallback(() => player.getQualities(), [player]),
    setAudioOnly: useCallback((enabled: boolean) => player.setAudioOnly(enabled), [player]),
    enableAutopause: useCallback(() => player.enableAutopause(), [player]),
    disableAutopause: useCallback(() => player.disableAutopause(), [player]),
    clearResumePosition: useCallback((ref?: string) => player.clearResumePosition(ref), [player]),
  };
}

// ─── usePlayerPool ───

export interface UsePlayerPoolOptions extends PlayerConfig {}

export interface UsePlayerPoolReturn {
  /** The underlying PlayerPool instance */
  pool: PlayerPool;
  /** Add a player to the pool */
  add: (id: string, element: HTMLVideoElement, source?: VideoSource) => Player;
  /** Remove a player */
  remove: (id: string) => void;
  /** Activate a player (play it, pause others) */
  activate: (id: string) => void;
  /** Pause all */
  pauseAll: () => void;
  /** Set muted on all */
  setAllMuted: (muted: boolean) => void;
  /** Set loop on all */
  setAllLoop: (loop: boolean) => void;
  /** Keep only these ids, destroy rest */
  retainOnly: (ids: string[]) => void;
  /** Prefetch an HLS manifest */
  prefetch: (hlsUrl: string) => Promise<void>;
}

/**
 * React hook for managing a pool of 3Speak video players.
 * Ideal for shorts/feed UIs.
 */
export function usePlayerPool(options: UsePlayerPoolOptions = {}): UsePlayerPoolReturn {
  const poolRef = useRef<PlayerPool | null>(null);

  if (!poolRef.current) {
    poolRef.current = new PlayerPool(options);
  }
  const pool = poolRef.current;

  useEffect(() => {
    return () => {
      poolRef.current?.destroy();
      poolRef.current = null;
    };
  }, []);

  return {
    pool,
    add: useCallback((id, el, src) => pool.add(id, el, src), [pool]),
    remove: useCallback((id) => pool.remove(id), [pool]),
    activate: useCallback((id) => pool.activate(id), [pool]),
    pauseAll: useCallback(() => pool.pauseAll(), [pool]),
    setAllMuted: useCallback((muted) => pool.setAllMuted(muted), [pool]),
    setAllLoop: useCallback((loop) => pool.setAllLoop(loop), [pool]),
    retainOnly: useCallback((ids) => pool.retainOnly(ids), [pool]),
    prefetch: useCallback((url) => pool.prefetch(url), [pool]),
  };
}
