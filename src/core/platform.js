/**
 * Platform detection utilities for 3Speak Player SDK.
 * Determines HLS playback strategy based on browser capabilities.
 */

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';

/** iOS device (iPhone, iPad, iPod) — uses native HLS, single active video limit */
export const isIOS =
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/** Any Safari browser (including macOS) — has native HLS support */
export const isSafari =
  typeof navigator !== 'undefined' &&
  /^((?!chrome|android).)*safari/i.test(ua);

/** Mobile device (iOS or Android) */
export const isMobile =
  typeof navigator !== 'undefined' &&
  (/Mobi|Android/i.test(ua) || isIOS);

/**
 * Can this browser play HLS natively (without hls.js)?
 * True for all Safari (iOS + macOS) and some Android browsers.
 */
export const supportsNativeHLS = (() => {
  if (typeof document === 'undefined') return false;
  const video = document.createElement('video');
  return (
    video.canPlayType('application/vnd.apple.mpegurl') !== '' ||
    video.canPlayType('application/x-mpegURL') !== ''
  );
})();

/**
 * Returns the recommended playback strategy for this platform.
 *
 * - 'native'  → Set video.src directly (Safari, some Android)
 * - 'hlsjs'   → Use hls.js via MediaSource Extensions (Chrome, Firefox, Edge)
 * - 'none'    → No HLS support available
 */
export function getPlaybackStrategy() {
  // Always prefer native on iOS (hls.js can't use MSE on iOS Safari)
  if (isIOS) return 'native';
  if (isSafari && supportsNativeHLS) return 'native';

  // hls.js needs to be checked at runtime since it might not be loaded yet
  // Callers should use this after ensuring Hls is available
  if (typeof window !== 'undefined' && window.Hls?.isSupported?.()) return 'hlsjs';

  // Fallback: check native HLS on non-Safari browsers (some Android)
  if (supportsNativeHLS) return 'native';

  return 'none';
}

/**
 * Recommended preload strategy for this platform.
 *
 * - 'aggressive' → Desktop/Android: preload multiple <video> elements ahead
 * - 'conservative' → iOS: only one active video, prefetch manifests for others
 */
export function getPreloadStrategy() {
  return isIOS ? 'conservative' : 'aggressive';
}
