import Hls from 'hls.js';
import type { PlatformInfo } from '../types';

let cached: PlatformInfo | null = null;

/**
 * Detect platform capabilities for HLS playback strategy.
 * Results are cached after first call.
 */
export function detectPlatform(): PlatformInfo {
  if (cached) return cached;

  if (typeof navigator === 'undefined' || typeof document === 'undefined') {
    // SSR / non-browser
    cached = {
      isIOS: false,
      isSafari: false,
      isAppleWebKit: false,
      supportsNativeHLS: false,
      supportsMSE: false,
      supportsManagedMSE: false,
      supportsHlsJs: false,
    };
    return cached;
  }

  const ua = navigator.userAgent;

  // Detect actual browser engine via CSS property (immune to UA spoofing by
  // Firefox responsive-design-mode or Chrome device-emulation which change the
  // User-Agent to match the emulated device but can't play HLS natively).
  const isFirefox = 'MozAppearance' in (document.documentElement?.style || {});

  const isIOS = !isFirefox && (
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );

  const isSafari = !isFirefox && /^((?!chrome|android).)*safari/i.test(ua);

  const testVideo = document.createElement('video');
  const supportsNativeHLS =
    testVideo.canPlayType('application/vnd.apple.mpegurl') !== '';

  const supportsMSE =
    typeof MediaSource !== 'undefined' &&
    typeof MediaSource.isTypeSupported === 'function';

  // iPhone (iOS 17.1+) has no classic MediaSource, only Apple's
  // ManagedMediaSource, which hls.js 1.5+ drives. Checking MediaSource alone
  // left every iPhone on native HLS: no gateway fallback, no loader tuning,
  // and a cold IPFS segment simply stalls. Hls.isSupported() knows both.
  const supportsManagedMSE =
    typeof (globalThis as any).ManagedMediaSource !== 'undefined';

  // Apple WebKit (Safari on macOS, and every browser on iOS/iPadOS) enforces a
  // strict SourceBuffer memory quota. See appleBufferCaps in player.ts.
  const isAppleWebKit = isIOS || isSafari;

  cached = {
    isIOS,
    isSafari,
    isAppleWebKit,
    supportsNativeHLS,
    supportsMSE,
    supportsManagedMSE,
    supportsHlsJs: Hls.isSupported(),
  };

  return cached;
}

// Minimal silent MP4 (1 frame, ~300 bytes) for autoplay probe
const SILENT_MP4 =
  'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAABltZGF0AAAA' +
  'EgYJpAAQ//728PAppAAAAARBAAVcAAAAUG1vb3YAAABsbXZoZAAAAAAAAAAAAAAAAAAAA+gAAAAAAAEAAAEA' +
  'AAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAACAAACknRyYWsAAABcdGtoZAAAAA8AAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAEAAAABAAAAAAACNm1kaWEAAAAgbWRoZAAAAAAAAAAAAAAAAAAA' +
  'KAAAAAAAAFXEAAAAAAAtaGRscgAAAAAAAAAAdmlkZQAAAAAAAAAAAAAAAFZpZGVvSGFuZGxlcgAAAOFtaW5m' +
  'AAAAFHZtaGQAAAABAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAAChdGJn' +
  'AAAAABN0c2QAAAAAAAAAAQAAAINhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAEAAQAEgAAABIAAAAAAAA' +
  'AAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY//8AAAAxYXZjQwFkAAr/4QAZZ2QACqzZQoeAXmAh' +
  'AAADAAEAAAMAA8SJZYABAAZo6+PLIsAAAAAbcmVhcAAAAB1jb2xybmNseAAGAAYABgAAAAAQcGFzcAAAAAEA' +
  'AAABAAAAFHN0dHMAAAAAAAAAAQAAAAEAAAABAAAAFHN0c3oAAAAAAAAAEwAAAAEAAAAUc3RzYwAAAAAAAAABAA' +
  'AAAQAAAAEAAAABAAAAFHNkdHAAAAAAICAAAAAUc3RzYwAAAAAAAA==';

const autoplayCache = new Map<string, boolean>();

/**
 * Detect whether the browser allows autoplay.
 * @param muted - Test muted autoplay (default: true). Unmuted autoplay is blocked on most browsers.
 * @returns Promise resolving to true if autoplay is allowed.
 */
export async function canAutoplay(muted: boolean = true): Promise<boolean> {
  const key = muted ? 'muted' : 'unmuted';
  if (autoplayCache.has(key)) return autoplayCache.get(key)!;

  if (typeof document === 'undefined') {
    autoplayCache.set(key, false);
    return false;
  }

  const video = document.createElement('video');
  video.setAttribute('playsinline', '');
  video.muted = muted;
  video.src = SILENT_MP4;

  try {
    await video.play();
    video.pause();
    autoplayCache.set(key, true);
    return true;
  } catch {
    autoplayCache.set(key, false);
    return false;
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}
