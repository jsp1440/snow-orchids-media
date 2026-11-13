# Santa Claus and the Quest for the Snow Orchids — 60-second Three.js cinematic

A procedurally built 3D animation: no paid services, no AI image or video generation, and no build step.
Everything is drawn with Three.js and code-generated geometry. The landscapes, Santa, the sleigh, the
reindeer and all six orchids are modelled in code.

## Open the animation

You need Node.js 18 or newer. There is nothing to install for the preview.

```bash
cd animation
node tools/serve.mjs            # then open http://localhost:8080/animation/
```

The page has to be served over HTTP because it uses ES modules and loads `../song-N.mp3` and
`../earth-december.jpg.jpg` from the repository root. Opening the file directly does not work.

**Controls:** Play/Pause (Space), Restart, a timeline scrubber (←/→ moves 1 s), one button per scene,
a music picker (Song 1–4 or Silent) and a quality picker. Phones and tablets start in **Low** quality:
no bloom, half the trees, fewer snowflakes and a pixel ratio of 1.
The URL can also take `?t=33.5` (start time) and `?quality=low`.

## Export the MP4

You need Playwright with Chromium, plus FFmpeg.

```bash
node tools/render-mp4.mjs --song 1 --workers 3        # -> animation/output/snow-orchids-60s.mp4
node tools/render-mp4.mjs --song 0 --start 20 --end 30 # silent excerpt
```

Each frame is rendered at exactly t = n/30 s, 1920×1080, in headless Chromium, then encoded with
H.264 (CRF 18) and AAC audio, which fades in and out. Software WebGL needs about 1 s per frame per
worker, so a full render takes about 25–30 minutes on 4 CPU cores.

Other tools:
- `node tools/snap.mjs <dir> 5 12.5 …` renders PNG stills at the given times.
- `node tools/test-preview.mjs` smoke-tests the interactive player: launch, play, pause, scrub,
  restart, the end-stop and console errors.

## Timeline (exactly 60.0 s, 30 fps = 1800 frames)

| Time | Scene | Orchid reveal |
|---|---|---|
| 0–10 s | Swedish Lapland: spruce forest, aurora, silhouette against the aurora | *Calypso bulbosa* (Fairy slipper) |
| 10–20 s | Himalayas: rise out of a sea of cloud, glacial valley, sparkling stream | *Pleione humilis* on a mossy boulder |
| 20–30 s | Japan: globe flight from the Himalayas to Japan, then misty alpine peaks | *Ponerorchis graminifolia* on a wet rock ledge |
| 30–40 s | Pacific Northwest: giant conifers in mist | *Cephalanthera austiniae* (Phantom orchid) |
| 40–50 s | Northern Rockies: snowy valley, descent to the cedar-forest floor | *Goodyera oblongifolia* (Western rattlesnake plantain) |
| 50–60 s | Finale: six glowing orchids, including *Myrosmodes*, joined in a golden constellation, flight toward the aurora, title, fade to black | — |

`render(t)` in `src/main.js` is a pure function of time, and nothing uses `Math.random()`.
Preview, scrubbing and export therefore always show identical frames.

## Code map

- `src/main.js`: renderer, bloom, timeline, on-screen titles and captions, transitions, controls, audio sync, export hook.
- `src/scenes.js`: the six scenes, each with its world, flight path, environment, camera keyframes and reveal.
- `src/characters.js`: Santa, the sleigh, the reindeer (with a flying-gallop leg cycle) and the harness.
- `src/orchids.js`: procedural orchid models, with morphology notes at the top of the file.
- `src/sky.js`, `src/particles.js`, `src/world.js`, `src/textures.js`: sky, aurora, moon, snow, magic trail and motes, mist, terrain, trees and rocks.
- `vendor/`: Three.js r170 (MIT) and the Cinzel and Cormorant Garamond fonts (SIL OFL), copied into the folder so it works offline.

## Botanical honesty

The orchids are stylized models built from flora descriptions, not measured specimens. They are
shown at about 3.5× life size so they read on screen. Read the notes at the top of
`src/orchids.js` before treating any detail as authoritative. In particular, the *Pleione humilis*
colouring follows published descriptions (white tepals, a fringed lip with crimson spots). It
differs from `rune-pleione.jpg` in this repository, so one of the two should be checked by a botanist.

## Asset credits

- Music: `song-1.mp3`–`song-4.mp3` from this repository, used with the owner's permission.
- `earth-december.jpg.jpg` from this repository is used as the globe texture. It looks like NASA's
  public-domain Blue Marble (December), but its source should be confirmed.
- No other external assets are used.
