/**
 * @3speak/player-sdk
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
 *   import { usePlayer, usePlayerPool } from '@3speak/player-sdk/react';
 */

// Core player
export { Player } from './core/player';

// Multi-player pool
export { PlayerPool } from './core/pool';

// API client
export { ThreeSpeakApi, metadataToSource } from './core/api';

// Platform detection
export { detectPlatform } from './core/platform';

// Types
export type {
  VideoSource,
  VideoMetadata,
  PlayerConfig,
  PlayerState,
  PlayerEvents,
  PlatformInfo,
  EventHandler,
  EventUnsubscribe,
} from './types';
