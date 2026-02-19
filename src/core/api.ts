import type { VideoMetadata, VideoSource } from '../types';

const DEFAULT_API_BASE = 'https://play.3speak.tv';

/**
 * 3Speak video API client.
 * Fetches video metadata and HLS URLs from the snapie player API.
 */
export class ThreeSpeakApi {
  private apiBase: string;
  private debug: boolean;

  constructor(apiBase?: string, debug = false) {
    this.apiBase = (apiBase || DEFAULT_API_BASE).replace(/\/$/, '');
    this.debug = debug;
  }

  private log(...args: unknown[]) {
    if (this.debug) console.log('[3Speak API]', ...args);
  }

  /**
   * Fetch full video metadata.
   * Tries /api/embed (shorts/embed-video collection) first, then falls back
   * to /api/watch (legacy videos collection) for regular long-form videos.
   * @param author - Hive account name
   * @param permlink - 3Speak video permlink
   */
  async fetchVideoMetadata(author: string, permlink: string): Promise<VideoMetadata> {
    // Try embed endpoint first (shorts / embed-video collection)
    const embedUrl = `${this.apiBase}/api/embed?v=${author}/${permlink}`;
    this.log('Fetching (embed):', embedUrl);

    const embedResponse = await fetch(embedUrl);
    if (embedResponse.ok) {
      const data = await embedResponse.json();
      if (!data.error) {
        this.log('Got metadata (embed):', data.owner, data.permlink, data.status);
        return data as VideoMetadata;
      }
    }

    // Fall back to watch endpoint (legacy videos collection)
    const watchUrl = `${this.apiBase}/api/watch?v=${author}/${permlink}`;
    this.log('Fetching (watch):', watchUrl);

    const watchResponse = await fetch(watchUrl);
    if (!watchResponse.ok) {
      const error = await watchResponse.json().catch(() => ({ error: `HTTP ${watchResponse.status}` }));
      throw new Error(error.error || `Failed to fetch video: HTTP ${watchResponse.status}`);
    }

    const data = await watchResponse.json();
    if (data.error) {
      throw new Error(data.error);
    }
    this.log('Got metadata (watch):', data.owner, data.permlink, data.status);
    return data as VideoMetadata;
  }

  /**
   * Fetch just the HLS source URLs (convenience wrapper).
   * Returns a VideoSource ready to pass to the player.
   */
  async fetchSource(author: string, permlink: string): Promise<VideoSource> {
    const meta = await this.fetchVideoMetadata(author, permlink);
    return metadataToSource(meta);
  }

  /**
   * Prefetch an HLS manifest AND its first video segment to warm CDN + browser cache.
   * This means when hls.js actually starts playback, the first segment is already cached.
   */
  async prefetchManifest(hlsUrl: string): Promise<void> {
    try {
      const resp = await fetch(hlsUrl, { mode: 'cors', credentials: 'omit' });
      const text = await resp.text();
      this.log('Prefetched manifest:', hlsUrl.substring(0, 80));

      // Resolve relative URLs against manifest base
      const baseUrl = hlsUrl.substring(0, hlsUrl.lastIndexOf('/') + 1);

      const resolveUrl = (ref: string) =>
        ref.startsWith('http') ? ref : baseUrl + ref;

      // Check if this is a master playlist (contains quality variants)
      if (text.includes('#EXT-X-STREAM-INF')) {
        // Master playlist — find first variant (lowest bandwidth = fastest)
        const lines = text.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            // This is the first variant URL
            const variantUrl = resolveUrl(trimmed);
            this.log('Prefetching first variant:', variantUrl.substring(0, 80));
            const varResp = await fetch(variantUrl, { mode: 'cors', credentials: 'omit' });
            const varText = await varResp.text();
            // Now find and prefetch the first segment from this variant
            this.prefetchFirstSegment(varText, variantUrl);
            break;
          }
        }
      } else {
        // Media playlist — directly find first segment
        this.prefetchFirstSegment(text, hlsUrl);
      }
    } catch {
      // Silently fail — this is just an optimization
    }
  }

  /**
   * Parse a media playlist and prefetch its first .ts/.m4s segment.
   */
  private prefetchFirstSegment(playlistText: string, playlistUrl: string): void {
    const base = playlistUrl.substring(0, playlistUrl.lastIndexOf('/') + 1);
    const lines = playlistText.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const segUrl = trimmed.startsWith('http') ? trimmed : base + trimmed;
        this.log('Prefetching first segment:', segUrl.substring(0, 80));
        fetch(segUrl, { mode: 'cors', credentials: 'omit' }).catch(() => {});
        break;
      }
    }
  }

  /**
   * Increment view count for a video.
   */
  async recordView(owner: string, permlink: string, type = 'embed'): Promise<void> {
    try {
      await fetch(`${this.apiBase}/api/view`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner, permlink, type }),
      });
      this.log('View recorded:', owner, permlink);
    } catch {
      // Non-critical — don't throw
    }
  }
}

/**
 * Convert API metadata to a VideoSource with fallback chain.
 */
export function metadataToSource(meta: VideoMetadata): VideoSource {
  const fallbacks: string[] = [];
  if (meta.videoUrlFallback1 && meta.videoUrlFallback1 !== meta.videoUrl) {
    fallbacks.push(meta.videoUrlFallback1);
  }
  if (meta.videoUrlFallback2 && meta.videoUrlFallback2 !== meta.videoUrl) {
    fallbacks.push(meta.videoUrlFallback2);
  }
  if (meta.videoUrlFallback3 && meta.videoUrlFallback3 !== meta.videoUrl) {
    fallbacks.push(meta.videoUrlFallback3);
  }

  return {
    url: meta.videoUrl,
    fallbacks,
    poster: meta.thumbnail || undefined,
  };
}

/** Default API instance */
export const api = new ThreeSpeakApi();
