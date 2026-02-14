# @mantequilla-soft/3speak-player

Framework-agnostic HLS video player SDK for [3Speak](https://3speak.tv). Works with vanilla JavaScript, React, Vue, Svelte, or any framework.

Eliminates iframes entirely — plays 3Speak videos using native `<video>` elements with [hls.js](https://github.com/video-dev/hls.js) (Chrome/Firefox) or native HLS (Safari/iOS).

## Why?

- **iPhone/Safari compatible** — No iframes means no cross-origin blocking, no throttled media playback
- **Lightweight** — ~60KB gzipped (hls.js), no Video.js, no iframe overhead
- **CDN fallback chain** — Automatically falls back through 3Speak CDN nodes
- **iOS-optimized** — Native HLS on Safari, manifest prefetching, single-player strategy
- **TypeScript** — Full type definitions included

## Install

```bash
npm install @mantequilla-soft/3speak-player
```

## Quick Start

### Vanilla JavaScript

```html
<video id="player" playsinline></video>

<script type="module">
  import { Player } from '@mantequilla-soft/3speak-player';

  const player = new Player({ muted: true, loop: true });
  player.attach(document.getElementById('player'));
  player.load('author/permlink');

  player.on('ready', ({ isVertical }) => {
    console.log('Video is', isVertical ? 'vertical' : 'horizontal');
    player.play();
  });

  player.on('timeupdate', ({ currentTime, duration }) => {
    console.log(`${currentTime.toFixed(1)}s / ${duration.toFixed(1)}s`);
  });
</script>
```

### React

```tsx
import { usePlayer } from '@mantequilla-soft/3speak-player/react';

function VideoPlayer({ author, permlink }) {
  const { ref, state, togglePlay, setMuted } = usePlayer({
    autoLoad: `${author}/${permlink}`,
    autoPlay: true,
    muted: true,
    loop: true,
    onReady: ({ isVertical }) => console.log('vertical?', isVertical),
  });

  return (
    <div>
      <video ref={ref} playsInline style={{ width: '100%' }} />
      <button onClick={togglePlay}>{state.paused ? 'Play' : 'Pause'}</button>
      <button onClick={() => setMuted(!state.muted)}>
        {state.muted ? 'Unmute' : 'Mute'}
      </button>
    </div>
  );
}
```

### Vue 3

```vue
<template>
  <video ref="videoEl" playsinline />
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { Player } from '@mantequilla-soft/3speak-player';

const videoEl = ref(null);
let player;

onMounted(() => {
  player = new Player({ muted: true, loop: true });
  player.attach(videoEl.value);
  player.load('author/permlink');
  player.on('ready', () => player.play());
});

onUnmounted(() => player?.destroy());
</script>
```

### Svelte

```svelte
<script>
  import { onMount, onDestroy } from 'svelte';
  import { Player } from '@mantequilla-soft/3speak-player';

  let videoEl;
  let player;

  onMount(() => {
    player = new Player({ muted: true, loop: true });
    player.attach(videoEl);
    player.load('author/permlink');
    player.on('ready', () => player.play());
  });

  onDestroy(() => player?.destroy());
</script>

<video bind:this={videoEl} playsinline />
```

## API Reference

### `Player`

Single video player instance.

```ts
const player = new Player(config?: PlayerConfig);
```

**Config:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiBase` | `string` | `'https://play.3speak.tv'` | 3Speak player API URL |
| `debug` | `boolean` | `false` | Enable console logging |
| `muted` | `boolean` | `true` | Start muted (needed for autoplay) |
| `loop` | `boolean` | `false` | Loop playback |
| `hlsConfig` | `object` | `{}` | hls.js config overrides |
| `autopause` | `boolean` | `false` | Auto-pause when scrolled out of viewport |
| `resume` | `boolean` | `false` | Resume playback from last position (localStorage) |

**Methods:**
```ts
player.attach(videoElement)          // Attach to a <video> element
player.load('author/permlink')       // Load by 3Speak ref (fetches HLS URL)
player.load({ url, fallbacks, poster }) // Load from direct source
player.play()                        // Play
player.pause()                       // Pause
player.togglePlay()                  // Toggle play/pause
player.seek(time)                    // Seek to time in seconds
player.setMuted(boolean)             // Set mute state
player.setVolume(0-1)                // Set volume
player.setLoop(boolean)              // Set loop mode
player.setPlaybackRate(rate)         // Set speed (0.5, 1, 2, etc.)
player.togglePip()                   // Toggle Picture-in-Picture
player.toggleFullscreen()            // Toggle fullscreen
player.getQualities()                // Get available quality levels (hls.js only)
player.setQuality(index)             // Set quality (-1 for auto, hls.js only)
player.getCurrentQuality()           // Get current quality index
player.setAudioOnly(boolean)         // Audio-only mode (hides video)
player.getThumbnailAt(time)          // Get thumbnail URL at time (stub)
player.enableAutopause()             // Enable auto-pause on scroll out
player.disableAutopause()            // Disable auto-pause
player.clearResumePosition(ref?)     // Clear saved resume position
player.getState()                    // Get current PlayerState
player.detach()                      // Detach from element
player.destroy()                     // Destroy and release resources
```

**Events:**
```ts
player.on('ready', ({ isVertical, width, height }) => {})
player.on('play', () => {})
player.on('pause', () => {})
player.on('ended', () => {})
player.on('timeupdate', ({ currentTime, duration, paused }) => {})
player.on('error', ({ message, fatal }) => {})
player.on('fallback', ({ url, index }) => {})
player.on('loading', (isLoading) => {})
player.on('resize', ({ width, height, isVertical }) => {})
player.on('buffered', (progress) => {})
player.on('pip', (active) => {})
player.on('fullscreen', (active) => {})
player.on('qualitychange', ({ index, height, width, bitrate }) => {})
player.on('visibility', (visible) => {})
player.on('resume', ({ time, ref }) => {})
```

### `PlayerPool`

Manage multiple players for feed/shorts UIs.

```ts
const pool = new PlayerPool(config?: PlayerConfig);
```

```ts
pool.add(id, videoElement, source?)   // Add a player
pool.addByRef(id, el, author, perm)   // Add + load by 3Speak ref
pool.get(id)                          // Get player by id
pool.remove(id)                       // Remove + destroy player
pool.activate(id)                     // Play this, pause all others
pool.pauseAll()                       // Pause all
pool.setAllMuted(boolean)             // Mute/unmute all
pool.setAllLoop(boolean)              // Set loop on all
pool.retainOnly(ids)                  // Keep only these, destroy rest
pool.prefetch(hlsUrl)                 // Prefetch manifest (CDN warm)
pool.prefetchByRef(author, permlink)  // Prefetch by 3Speak ref
pool.destroy()                        // Destroy everything
```

### `ThreeSpeakApi`

Direct API access.

```ts
import { ThreeSpeakApi } from '@mantequilla-soft/3speak-player';

const api = new ThreeSpeakApi('https://play.3speak.tv');
const meta = await api.fetchVideoMetadata('author', 'permlink');
const source = await api.fetchSource('author', 'permlink');
await api.prefetchManifest(source.url);
await api.recordView('author', 'permlink');
```

### `detectPlatform()`

```ts
import { detectPlatform } from '@mantequilla-soft/3speak-player';

const platform = detectPlatform();
// { isIOS, isSafari, supportsNativeHLS, supportsMSE, supportsHlsJs }
```

### `canAutoplay()`

```ts
import { canAutoplay } from '@mantequilla-soft/3speak-player';

// Test muted autoplay (default)
const canMuted = await canAutoplay();

// Test unmuted autoplay
const canUnmuted = await canAutoplay(false);
```

Results are cached — safe to call multiple times.

### React Hooks

```ts
import { usePlayer, usePlayerPool } from '@mantequilla-soft/3speak-player/react';
```

**`usePlayer(options)`** — Single player hook (see Quick Start above)

**`usePlayerPool(options)`** — Pool hook for shorts/feeds:
```tsx
function ShortsFeed({ videos }) {
  const { pool, add, activate, setAllMuted, retainOnly } = usePlayerPool({
    muted: true,
    loop: true,
  });

  // In your scroll handler:
  // add(video.id, videoElement, source)
  // activate(currentVideoId)
  // retainOnly(visibleVideoIds)
}
```

## How It Works

```
┌─────────────────────────────────────────────┐
│                Your App                      │
│  (React / Vue / Svelte / Vanilla JS)         │
├─────────────────────────────────────────────┤
│            @mantequilla-soft/3speak-player                │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐ │
│  │  Player   │  │ PlayerPool│  │   API    │ │
│  └─────┬────┘  └─────┬─────┘  └────┬─────┘ │
│        │              │              │       │
│  ┌─────▼──────────────▼──────┐ ┌────▼─────┐ │
│  │   HLS Engine              │ │ 3Speak   │ │
│  │  ┌─────────┐ ┌─────────┐ │ │  embed   │ │
│  │  │ hls.js  │ │ Native  │ │ │   API    │ │
│  │  │(Chrome) │ │ (Safari)│ │ │          │ │
│  │  └────┬────┘ └────┬────┘ │ └──────────┘ │
│  └───────┼───────────┼──────┘              │
├──────────┼───────────┼──────────────────────┤
│      <video>     <video>                     │
│     elements     elements                    │
└─────────────────────────────────────────────┘
```

- **Safari/iOS**: Uses native HLS (just sets `video.src = m3u8`). Zero JavaScript HLS overhead.
- **Chrome/Firefox/Edge**: Uses hls.js (MediaSource Extensions) to play HLS streams.
- **CDN fallback**: If the primary CDN fails, automatically tries fallback nodes.
- **iOS single-player**: iOS only allows one active video — the pool handles this transparently.

## Migrating from iframes

If you're currently using `<iframe src="https://play.3speak.tv/embed?v=...">`, replace with:

```diff
- <iframe src="https://play.3speak.tv/embed?v=author/permlink&controls=0" />
+ <video ref={videoRef} playsinline />
```

```diff
- // postMessage to control playback
- iframe.contentWindow.postMessage({ type: 'play' }, '*');
+ // Direct control
+ player.play();
```

No more cross-origin restrictions, no more postMessage timing issues, no more iOS iframe throttling.

## License

MIT
