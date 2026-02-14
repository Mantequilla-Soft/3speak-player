/**
 * ThreeSpeakAPI — Fetches HLS video URLs and metadata from the 3Speak player API.
 *
 * Usage:
 *   const api = new ThreeSpeakAPI('https://play.3speak.tv');
 *   const video = await api.getVideoSources('author', 'permlink');
 *   // video.sources = [{ url, type: 'application/x-mpegURL', priority }]
 *   // video.thumbnail, video.duration, video.title, ...
 */

/** @typedef {{ url: string, type: string, priority: number }} VideoSource */

/**
 * @typedef {Object} VideoInfo
 * @property {VideoSource[]} sources  - HLS sources sorted by priority (CDN first, then fallbacks)
 * @property {string|null} thumbnail  - Thumbnail URL
 * @property {number} duration        - Duration in seconds
 * @property {string} title           - Video title
 * @property {string} owner           - Video owner (Hive username)
 * @property {string} permlink        - Video permlink
 * @property {string} status          - Encoding status
 * @property {number} views           - View count
 * @property {boolean} isShort        - Whether this is a short
 */

export const DEFAULT_BASE_URL = 'https://play.3speak.tv';

export default class ThreeSpeakAPI {
  /**
   * @param {string} [baseUrl] - Base URL of the 3Speak player API
   * @param {Object} [options]
   * @param {number} [options.timeout=10000] - Fetch timeout in ms
   * @param {function} [options.fetch] - Custom fetch implementation (for SSR/testing)
   */
  constructor(baseUrl = DEFAULT_BASE_URL, options = {}) {
    // Strip trailing slash
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeout = options.timeout ?? 10000;
    this._fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this._cache = new Map(); // Simple in-memory cache: "author/permlink" -> VideoInfo
  }

  /**
   * Fetch HLS sources and metadata for a video.
   * Returns cached data if available.
   *
   * @param {string} author  - Hive username / video owner
   * @param {string} permlink - Video permlink (3Speak embed permlink, not Hive permlink)
   * @param {Object} [options]
   * @param {boolean} [options.bypassCache=false] - Skip cache lookup
   * @param {'embed'|'watch'} [options.endpoint='embed'] - API endpoint to use
   * @returns {Promise<VideoInfo|null>}
   */
  async getVideoSources(author, permlink, options = {}) {
    const cacheKey = `${author}/${permlink}`;

    if (!options.bypassCache && this._cache.has(cacheKey)) {
      return this._cache.get(cacheKey);
    }

    try {
      const endpoint = options.endpoint === 'watch' ? '/api/watch' : '/api/embed';
      const url = `${this.baseUrl}${endpoint}?v=${author}/${permlink}`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);

      const response = await this._fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${response.status}`);
      }

      const data = await response.json();

      // Build prioritized source list
      const sources = [];
      if (data.videoUrl) {
        sources.push({ url: data.videoUrl, type: 'application/x-mpegURL', priority: 0 });
      }
      if (data.videoUrlFallback1 && data.videoUrlFallback1 !== data.videoUrl) {
        sources.push({ url: data.videoUrlFallback1, type: 'application/x-mpegURL', priority: 1 });
      }
      if (data.videoUrlFallback2 && data.videoUrlFallback2 !== data.videoUrl) {
        sources.push({ url: data.videoUrlFallback2, type: 'application/x-mpegURL', priority: 2 });
      }
      if (data.videoUrlFallback3 && data.videoUrlFallback3 !== data.videoUrl) {
        sources.push({ url: data.videoUrlFallback3, type: 'application/x-mpegURL', priority: 3 });
      }

      /** @type {VideoInfo} */
      const info = {
        sources,
        thumbnail: data.thumbnail || null,
        duration: data.duration || 0,
        title: data.title || `${author}/${permlink}`,
        owner: data.owner || author,
        permlink: data.permlink || permlink,
        status: data.status || 'unknown',
        views: data.views || 0,
        isShort: data.short || false,
        isPlaceholder: data.isPlaceholder || false,
        encodingProgress: data.encodingProgress || 0,
        raw: data, // Keep raw API response for custom use
      };

      this._cache.set(cacheKey, info);
      return info;
    } catch (err) {
      if (err.name === 'AbortError') {
        console.warn(`[ThreeSpeakAPI] Timeout fetching ${author}/${permlink}`);
      } else {
        console.error(`[ThreeSpeakAPI] Error fetching ${author}/${permlink}:`, err);
      }
      return null;
    }
  }

  /**
   * Increment view count for a video.
   *
   * @param {string} owner
   * @param {string} permlink
   * @param {string} [type='embed']
   */
  async incrementView(owner, permlink, type = 'embed') {
    try {
      await this._fetch(`${this.baseUrl}/api/view`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner, permlink, type }),
      });
    } catch (err) {
      // Silently fail — view counting is non-critical
      console.warn(`[ThreeSpeakAPI] View count failed:`, err);
    }
  }

  /**
   * Prefetch just the .m3u8 manifest to warm CDN and browser cache.
   * This is a tiny text file (~1-5KB). Useful for upcoming videos in a feed.
   *
   * @param {string} hlsUrl - Direct URL to the .m3u8 manifest
   * @returns {Promise<boolean>} - Whether prefetch succeeded
   */
  async prefetchManifest(hlsUrl) {
    if (!hlsUrl) return false;
    try {
      await this._fetch(hlsUrl, { mode: 'cors', credentials: 'omit' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Prefetch video sources (fetch URLs + warm manifest cache).
   * Useful for preloading the next video in a feed.
   *
   * @param {string} author
   * @param {string} permlink
   * @returns {Promise<VideoInfo|null>}
   */
  async prefetchVideo(author, permlink) {
    const info = await this.getVideoSources(author, permlink);
    if (info?.sources?.[0]) {
      await this.prefetchManifest(info.sources[0].url);
    }
    return info;
  }

  /** Clear the source cache */
  clearCache() {
    this._cache.clear();
  }

  /** Remove a specific entry from cache */
  invalidate(author, permlink) {
    this._cache.delete(`${author}/${permlink}`);
  }
}
