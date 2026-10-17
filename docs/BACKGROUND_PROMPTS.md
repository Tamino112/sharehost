# Background prompts

ShareHost ships with an animated "aurora" background, but you can upload your own **image** or **looping
video** in *Admin → Appearance*. The prompts below are tuned for the glass UI: dark, calm, low-detail
backgrounds with plenty of negative space, so the frosted panels stay readable and the result does not
look like generic "AI art".

Works with Midjourney, Flux, Ideogram, DALL·E / GPT-Image, Stable Diffusion (images) and Runway, Kling,
Veo, Sora, Pika, Luma (video). Prompts are in English because image models follow English best.

## General rules

- **Aspect ratio 16:9**, at least **2560 × 1440** (3840 × 2160 for 4K screens). Midjourney: `--ar 16:9 --style raw`.
- Keep the **centre and left side calm** — that's where the headline and upload card sit.
- Avoid saturated purple/blue gradients, neon and HDR looks; they are what makes things look "AI-made".
- Use this **negative prompt** where supported:

  ```
  text, letters, watermark, logo, people, faces, hands, busy pattern, high contrast, neon, purple-blue gradient,
  oversaturated, HDR, clutter, sharp details in the centre, lens flare, bokeh balls, sci-fi HUD
  ```

---

## Image prompts

### 1 · Graphite Aurora (closest to the built-in default)
```
Ultra-minimal abstract background, deep graphite black with a soft, diffused aurora of desaturated teal and
muted warm sand light drifting in from the top-left corner, gentle volumetric haze, extremely smooth gradients,
fine analog film grain, large calm empty area in the centre, no objects, no text, quiet and premium,
cinematic colour grading, 8k, 16:9
```
Accent colour: `#d4ff5e` (lime) or `#8ee3ff` (ice blue).

### 2 · Frosted Glass Monoliths
```
Abstract 3D still life of large translucent frosted-glass slabs and softly rounded panels floating in a dark
charcoal void, subtle refraction and light caustics, thin rim light in pale lime and cool white, objects only
at the right and bottom edges, the left two thirds of the frame calm and empty, matte surfaces, shallow depth
of field, studio product lighting, minimal Scandinavian design, no text, 8k, 16:9
```
Accent colour: `#d4ff5e`.

### 3 · Smoked Silk
```
Slow flowing sheet of smoked dark glass-like silk folding gently across the lower third of the frame, deep
near-black background, soft specular highlights in champagne and grey, long gentle curves, very low contrast,
elegant and quiet, extreme macro photography, fine grain, lots of negative space above, no text, 16:9
```
Accent colour: `#ffd66b` (warm gold) or `#f2f2ef` (off-white).

### 4 · Night Concrete
```
Minimal architectural photograph at night, a smooth curved concrete wall lit by a single soft cyan-green wash
of light from below, deep shadows, misty air, brutalist yet calm, long exposure, muted colours, 35mm film look,
fine grain, the upper half of the frame almost black and empty, no people, no text, 16:9
```
Accent colour: `#7ef0b4` (mint).

### 5 · Porcelain Light (for the light theme)
```
Soft minimal abstract background in porcelain white, warm stone and very pale sage, diffused morning light
falling through frosted glass, blurred soft shadows of window frames, airy and calm, extremely subtle
gradients, matte paper texture, high-key, plenty of empty space, no objects in focus, no text, 16:9
```
Accent colour: `#9bd400` (deeper lime) or `#3aa6ff` (blue) — pale accents get lost on light backgrounds.
Set *Theme* to **Light** and *Background dimming* to ~15 %.

### 6 · Deep Water Ink
```
Abstract macro of dark ink clouds slowly diffusing in deep black water, wisps of desaturated teal and smoky
grey, soft volumetric light from the top, ultra smooth, mysterious but calm, low contrast, fine grain,
empty dark centre, no text, 8k, 16:9
```
Accent colour: `#8ee3ff`.

---

## Video prompts (seamless loops)

Best workflow: **generate one of the images above first, then use image-to-video** with the same image as
**start and end frame** (Runway Gen-4 / Kling / Luma all support an end frame). That gives a perfect loop.

### A · Drifting Aurora
```
Seamless loop, 10 seconds, locked-off static camera. Very slow drifting aurora of muted teal and warm sand
light behind a layer of frosted glass, soft volumetric haze, deep graphite background, subtle film grain.
Motion is extremely slow, smooth and continuous; nothing appears or disappears. Calm, minimal, no objects,
no text. The last frame matches the first frame.
```

### B · Rotating Glass
```
Seamless loop, 12 seconds, static camera. Large frosted glass panels floating in a dark charcoal void rotate
very slowly around their vertical axis, soft light caustics sweep gently across their surfaces, thin pale lime
rim light. Slow, weightless, hypnotic motion, shallow depth of field, studio lighting, no text, minimal.
The last frame matches the first frame.
```

### C · Smoked Silk Wave
```
Seamless loop, 10 seconds, static camera. A sheet of dark smoked silk ripples in slow motion along the lower
third of the frame, soft champagne specular highlights glide along the folds, near-black background, very low
contrast, elegant and calm, no text. The last frame matches the first frame.
```

### D · Ink in Water
```
Seamless loop, 10 seconds, static macro camera. Dark ink clouds slowly bloom and drift in black water, wisps of
desaturated teal and grey, soft top light, extremely slow and smooth motion, no sudden changes, no text.
The last frame matches the first frame.
```

---

## Preparing the files

Videos should be **muted, 1080p, 8–15 s, under ~15 MB**. With [ffmpeg](https://ffmpeg.org):

```bash
# MP4 (H.264) — works everywhere
ffmpeg -i input.mp4 -an -vf "scale=1920:-2,fps=30" -c:v libx264 -crf 26 -preset slow \
       -pix_fmt yuv420p -movflags +faststart background.mp4

# Optional smaller WebM (VP9)
ffmpeg -i input.mp4 -an -vf "scale=1920:-2" -c:v libvpx-vp9 -crf 36 -b:v 0 background.webm

# Poster frame (upload as "Video poster" — shown while loading and for reduced motion)
ffmpeg -i background.mp4 -vframes 1 -q:v 3 poster.jpg

# No end-frame feature? Make a ping-pong loop (plays forward, then backward)
ffmpeg -i input.mp4 -filter_complex "[0]reverse[r];[0][r]concat=n=2:v=1:a=0" -an loop.mp4

# Images: convert to WebP for a much smaller file
ffmpeg -i background.png -c:v libwebp -quality 82 background.webp
```

Then in **Admin → Appearance**: upload the file, pick *Background → Image/Video*, and adjust
*Background dimming* (30–45 % is a good start for dark images) and *Glass blur/opacity* until text is easy to read.
