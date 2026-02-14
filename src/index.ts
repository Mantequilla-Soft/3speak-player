/**
 * @mantequilla-soft/3speak-player
 *
 * Framework-agnostic HLS video player for 3Speak.
 *
 * Core:
 *   Player      — Single video player (attach to any <video> element)
 *   PlayerPool  — Manage multiple players (for feeds/shorts)
 *   ThreeSpeakApi — Fetch video metadata & HLS URLs
 *   detectPlatform — iOS/Safari/HLS capability detection
 *
 * React:
 *   import { usePlayer, usePlayerPool } from '@mantequilla-soft/3speak-player/react';
 */

// Core player
export { Player } from './core/player';

// Multi-player pool
export { PlayerPool } from './core/pool';

// API client
export { ThreeSpeakApi, metadataToSource } from './core/api';

// Platform detection & autoplay probe
export { detectPlatform, canAutoplay } from './core/platform';

// Types
export type {
  VideoSource,
  VideoMetadata,
  PlayerConfig,
  PlayerState,
  PlayerEvents,
  PlatformInfo,
  QualityLevel,
  EventHandler,
  EventUnsubscribe,
} from './types';
