---
name: run-effectshow
description: Run, build, or screenshot EffectShow - the webcam-driven 3D hand/face tracking visual effects playground
---

# EffectShow

A Vite + React + Three.js web app with real-time webcam-driven visual effects.
Uses MediaPipe for hand/face tracking, WebGL shaders for 74+ effects, and Web Audio for beat-reactive visuals.

**Driver:** `chromium-cli` or any browser automation tool. The app requires webcam access for full functionality but renders a landing page without it.

All paths below are relative to the project root (`EffectShow/`).

## Prerequisites

```bash
# Node.js 18+ required
node --version  # Should be 18.x or higher

# Install dependencies
npm install
```

## Build

```bash
npm run build
```

Output goes to `dist/`. Build produces ~1.2MB of vendor chunks (Three.js, MediaPipe, Leva).

## Run (Agent Path)

### Dev Server

```bash
npm run dev
```

Server starts on `http://localhost:5173` (or next available port). The app has two routes:

1. **Landing Page** (`/`) - Comic-themed intro with "ALLOW CAMERA" button and privacy info
2. **Effect Canvas** (`/app`) - Main effect playground (requires camera permission + session state)

### Driving with curl (verify server is up)

```bash
# Check server responds
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/

# Fetch landing page HTML
curl -s http://localhost:5173/ | head -50
```

### Driving with chromium-cli / Playwright

The app renders without webcam (shows landing page), but full effect testing requires:
- Granting camera permission
- Clicking "ALLOW CAMERA" button
- Pinching in mid-air (or bypassing by directly navigating to `/app` with session state)

```javascript
// Example Playwright script
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    permissions: ['camera'],
    // Fake webcam not needed for screenshot - landing page renders without it
  });
  const page = await context.newPage();
  await page.goto('http://localhost:5173/');
  await page.waitForSelector('.comic-title');
  await page.screenshot({ path: 'landing.png' });
  await browser.close();
})();
```

### Direct Navigation to Effect Canvas

To bypass the landing page flow (useful for testing):

```javascript
// Set session storage before navigating
await page.goto('http://localhost:5173/');
await page.evaluate(() => sessionStorage.setItem('effectShow_hasStarted', 'true'));
await page.goto('http://localhost:5173/app');
```

## Run (Human Path)

```bash
npm run dev
# Opens browser -> Click "ALLOW CAMERA" -> Pinch thumb+index finger to start
# Ctrl+C to stop
```

## Production Preview

```bash
npm run build
npm run preview
# Serves from dist/ on port 4173
```

## Project Structure

```
src/
├── App.jsx                    # Router: / -> LandingPage, /app -> ComicFrame
├── main.jsx                   # React entry point
├── components/
│   ├── LandingPage.jsx        # Camera permission + 3D hand interaction to start
│   ├── ComicFrame.jsx         # Main layout with canvas + settings panels
│   ├── EffectCanvas.jsx       # Mounts the effect engine
│   └── SettingsUI.jsx         # Leva-based controls
├── core/
│   ├── EffectEngine.js        # Main engine: webcam, MediaPipe, Three.js, shaders
│   └── HandInteractionEngine.js # 3D hand rendering for landing page
├── effects.js                 # 74 shader effects definitions
└── shaders/
    ├── vertex.glsl
    └── fragment.glsl
```

## Key APIs

The `EffectEngine` returns an API object:

```javascript
const api = initEngine(containerElement);

api.randomizeEffects()           // Shuffle all finger effects
api.setBgEffect(effectIndex)     // Set background effect (-1 to disable)
api.updateSettings('enableFaceMask', true)  // Toggle features
api.updateDebug('landmarks', true)          // Show debug overlays
api.getCurrentEffects()          // Get current effect indices
api.destroy()                    // Cleanup
```

## Gotchas

- **Webcam required for effects** - Without camera permission, only the landing page renders. The effect canvas at `/app` requires both camera access and session state (`effectShow_hasStarted`).

- **MediaPipe models load from CDN** - First load downloads ~15MB of WASM + model files from `cdn.jsdelivr.net`. Subsequent loads are cached.

- **Pinch detection** - The app uses thumb-to-index distance (< 0.05 normalized) to detect pinches. In headless testing, you can't trigger this without synthetic MediaPipe results.

- **Session state gating** - Direct navigation to `/app` redirects to `/` unless `sessionStorage.getItem('effectShow_hasStarted') === 'true'`.

- **Port conflicts** - Vite auto-increments ports (5173 -> 5174 -> ...) if busy.

## Troubleshooting

| Error | Fix |
|-------|-----|
| `Port 5173 is in use` | Server auto-selects next port. Check terminal output for actual URL. |
| `getUserMedia is not supported` | Running in non-secure context or headless without permissions. |
| Build warning about chunk size | Expected - Three.js and MediaPipe are large. Chunks are code-split. |
