import { Player } from './player';
import { ThreeSpeakApi } from './api';
import { detectPlatform } from './platform';
import type { PlayerConfig, VideoSource } from '../types';

/**
 * Manages a pool of Player instances for feed/shorts-style UIs.
 *
 * Handles:
 * - Creating/recycling players for visible videos
 * - Pausing all except the active player
 * - Manifest prefetching for upcoming videos on iOS
 * - Cleaning up off-screen players
 *
 * @example
 * ```js
 * const pool = new PlayerPool({ muted: true, loop: true });
 *
 * // Add videos as they enter the viewport
 * pool.add('vid-1', videoElement1, { url: 'https://...' });
 * pool.add('vid-2', videoElement2, { url: 'https://...' });
 *
 * // Activate the current video (pauses all others)
 * pool.activate('vid-1');
 *
 * // Remove when scrolled out of range
 * pool.remove('vid-2');
 *
 * // Clean up
 * pool.destroy();
 * ```
 */
export class PlayerPool {
  private players = new Map<string, Player>();
  private activeId: string | null = null;
  private config: PlayerConfig;
  private api: ThreeSpeakApi;
  private platform = detectPlatform();

  constructor(config?: PlayerConfig) {
    this.config = config || {};
    this.api = new ThreeSpeakApi(config?.apiBase, config?.debug);
  }

  /**
   * Add a player to the pool.
   * @param id - Unique identifier for this video slot
   * @param element - The <video> element to attach to
   * @param source - Video source (optional — can call load() later)
   */
  add(id: string, element: HTMLVideoElement, source?: VideoSource): Player {
    // Reuse existing player if same element
    let player = this.players.get(id);
    if (player && player.element === element) {
      if (source) player.load(source);
      return player;
    }

    // Clean up old player for this id
    if (player) player.destroy();

    player = new Player(this.config);
    player.attach(element);
    this.players.set(id, player);

    if (source) player.load(source);

    return player;
  }

  /**
   * Add a player by 3Speak author/permlink (auto-fetches HLS URL).
   */
  async addByRef(id: string, element: HTMLVideoElement, author: string, permlink: string): Promise<Player> {
    const player = this.add(id, element);
    await player.load(`${author}/${permlink}`);
    return player;
  }

  /**
   * Get a player by id.
   */
  get(id: string): Player | undefined {
    return this.players.get(id);
  }

  /**
   * Remove a player from the pool and destroy it.
   */
  remove(id: string): void {
    const player = this.players.get(id);
    if (player) {
      player.destroy();
      this.players.delete(id);
      if (this.activeId === id) this.activeId = null;
    }
  }

  /**
   * Activate a player (play it, pause all others).
   */
  activate(id: string): void {
    this.activeId = id;

    for (const [playerId, player] of this.players) {
      if (playerId === id) {
        player.play();
      } else {
        player.pause();
      }
    }
  }

  /** Pause all players. */
  pauseAll(): void {
    for (const player of this.players.values()) {
      player.pause();
    }
  }

  /** Set muted state on all players. */
  setAllMuted(muted: boolean): void {
    for (const player of this.players.values()) {
      player.setMuted(muted);
    }
  }

  /** Set loop on all players. */
  setAllLoop(loop: boolean): void {
    for (const player of this.players.values()) {
      player.setLoop(loop);
    }
  }

  /** Get the currently active player. */
  getActive(): Player | undefined {
    return this.activeId ? this.players.get(this.activeId) : undefined;
  }

  /** Get the active player's id. */
  get activePlayerId(): string | null {
    return this.activeId;
  }

  /** Number of players in the pool. */
  get size(): number {
    return this.players.size;
  }

  /** All player ids in the pool. */
  get ids(): string[] {
    return [...this.players.keys()];
  }

  /**
   * Prefetch an HLS manifest (warms CDN, ~1-5KB).
   * Especially useful on iOS where we can't preload actual video data.
   */
  async prefetch(hlsUrl: string): Promise<void> {
    return this.api.prefetchManifest(hlsUrl);
  }

  /**
   * Prefetch a manifest by author/permlink.
   */
  async prefetchByRef(author: string, permlink: string): Promise<void> {
    const source = await this.api.fetchSource(author, permlink);
    return this.api.prefetchManifest(source.url);
  }

  /**
   * Retain only the given ids, destroy all others.
   * Useful for keeping a sliding window of players around the current index.
   */
  retainOnly(ids: Set<string> | string[]): void {
    const keep = ids instanceof Set ? ids : new Set(ids);
    for (const [id, player] of this.players) {
      if (!keep.has(id)) {
        player.destroy();
        this.players.delete(id);
        if (this.activeId === id) this.activeId = null;
      }
    }
  }

  /**
   * Destroy all players and the pool.
   */
  destroy(): void {
    for (const player of this.players.values()) {
      player.destroy();
    }
    this.players.clear();
    this.activeId = null;
  }
}
