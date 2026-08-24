# FalFoos Game Artwork — Generation Prompts (Phase 10D)

Six original key-art pieces, one per game. Generate at **16:9**, then export
exactly as specified. No code changes are needed — files drop into
`client/public/assets/images/games/` and the cards pick them up automatically.

---

## Shared style block (prepend to every prompt)

> Dark premium gaming key-art, stylized semi-realistic 3D illustration, deep
> charcoal-navy environment (#0d1017 to #141824), single dominant neon
> rim-light color ACCENT, volumetric haze, high contrast, clean bold shapes
> readable at small card sizes, focal point centered slightly above the middle,
> bottom third of the frame kept dark and simple for text overlay, cinematic
> wide composition.

## Shared negative prompt (append to every generation)

> text, letters, numbers, words, watermark, signature, logo, real people,
> faces, celebrities, copyrighted characters, franchise branding, game UI,
> screenshots, borders, frames, clutter, oversaturated colors, random extra
> characters

## Export checklist (per image)

1. Crop/resize master to exactly **1920×1080** (16:9).
2. Keep the focal subject inside the **central ~66% vertical band** (the
   compact card crops top/bottom; the bottom ~42% gets a dark legibility
   gradient in the UI).
3. Export → **960×540 WebP, quality ≈ 80**.
4. Target ≤ **70 KB** (hard cap 120 KB).
5. Rename to the EXACT filename below and place in
   `client/public/assets/images/games/`.

---

## 1) Trivia — `trivia.webp` — accent cyan #00f0ff

> [Shared style with ACCENT = electric cyan #00f0ff] Floating glowing
> holographic quiz answer panels arranged in dramatic perspective, a sleek
> game-show buzzer podium with a bright light streak, stage spotlights beaming
> down through volumetric haze, energetic quiz-show atmosphere.
>
> [Shared negative]

## 2) Musical Chairs — `musical_chairs.webp` — accent pink #ff00aa

> [Shared style with ACCENT = hot magenta pink #ff00aa] Circular gaming stage
> arena viewed from a low dramatic angle, a ring of stylized empty chairs,
> glowing music-note light particles orbiting the stage, an energetic motion
> ring glowing on the floor, party-energy lighting.
>
> [Shared negative]

## 3) Mafia — `mafia.webp` — accent red #ff3355

> [Shared style with ACCENT = neon crimson red #ff3355] Noir night city alley,
> back-view silhouette of a lone figure wearing a fedora standing under a
> street-lamp cone of fog, wet asphalt reflections, subtle detective mystery
> motifs, tense social-deduction atmosphere.
>
> [Shared negative]

## 4) Guessing — `guessing.webp` — accent yellow #ffdd00

> [Shared style with ACCENT = vivid golden yellow #ffdd00] A giant luminous
> question-mark monolith floating above concentric target rings of light on
> the ground, drifting glowing mystery orbs, suspenseful god-rays cutting
> through haze, mysterious oracle atmosphere.
>
> [Shared negative]

## 5) Drawing — `drawing.webp` — accent green #00ff88

> [Shared style with ACCENT = neon spring green #00ff88] A tilted glowing
> pixel-grid canvas, a neon paint-brush stroke comet crossing the frame
> leaving light trails, floating color palette chips, creative spark
> particles, playful digital-art studio energy.
>
> [Shared negative]

## 6) Hide & Seek — `hide_and_seek.webp` — accent purple #aa00ff

> [Shared style with ACCENT = electric violet purple #aa00ff] Dark park at
> dusk, several pairs of glowing hidden eyes peeking among geometric blocks
> and bushes, one wide sweeping searchlight beam cutting through fog, playful
> suspenseful hide-and-seek atmosphere.
>
> [Shared negative]
