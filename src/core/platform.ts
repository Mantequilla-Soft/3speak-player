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
      supportsNativeHLS: false,
      supportsMSE: false,
      supportsHlsJs: false,
    };
    return cached;
  }

  const ua = navigator.userAgent;

  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const isSafari = /^((?!chrome|android).)*safari/i.test(ua);

  const testVideo = document.createElement('video');
  const supportsNativeHLS =
    testVideo.canPlayType('application/vnd.apple.mpegurl') !== '';

  const supportsMSE =
    typeof MediaSource !== 'undefined' &&
    typeof MediaSource.isTypeSupported === 'function';

  cached = {
    isIOS,
    isSafari,
    supportsNativeHLS,
    supportsMSE,
    supportsHlsJs: supportsMSE, // hls.js requires MSE
  };

  return cached;
}
