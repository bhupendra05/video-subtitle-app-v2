# 🎬 AI Shorts Studio v2 — Image to Video

An upgraded AI pipeline that turns a text prompt into a **YouTube Shorts / TikTok / Instagram Reels** video with **real animated video clips** via Wan2.1-I2V — completely free, runs locally.

## 🆕 What's New in v2

- **Image-to-Video (I2V)** — Each generated image is animated into a real ~5s video clip using **Wan2.1-I2V-14B** (SiliconFlow, free tier)
- **Replicate fallback** — Auto-falls back to `wavespeedai/wan-2.1-i2v-720p` if SiliconFlow fails
- **Public image hosting** — Auto-uploads images to catbox.moe for I2V API access
- **Graceful degradation** — Falls back to Ken Burns if no I2V API key is set

## ✨ Features

- **Script generation** via Gemini AI (or Claude / Ollama)
- **Neural TTS** via Microsoft Edge-TTS (10+ free voices)
- **Word-level captions** via Whisper.cpp — perfectly synced
- **Cinematic images** via Pollinations.ai FLUX (free, no API key)
- **🎥 Image-to-Video** via Wan2.1-I2V-14B (animated real video clips)
- **Ken Burns fallback** — 6 animated camera movements if no I2V key
- **Remotion rendering** — programmatic 1080×1920 video composition
- **FFmpeg color grade** — cinematic LUT applied automatically
- **Web Studio UI** — type a topic, pick I2V mode, watch it render live

## 🚀 Quick Start

```bash
# Install dependencies
npm install
pip install edge-tts

# Add API keys
echo "GEMINI_API_KEY=your_key_here" >> .env
echo "SILICONFLOW_API_KEY=your_key_here" >> .env  # free at siliconflow.cn

# Create a video with AI animated clips (I2V)
node scripts/create-short.mjs --topic "AI is taking over every job" --i2v

# OR without I2V (Ken Burns on images)
node scripts/create-short.mjs --topic "How Bitcoin will hit $1M" --images

# OR start the Web Studio
node server.mjs
# → open http://localhost:3132/studio.html
```

## 🎛️ CLI Options

```
--topic      Topic for AI script generation
--voice      Edge-TTS voice (default: en-US-AriaNeural)
--color      teal-gold | cyber-green | fire-red | electric-blue
--i2v        ⭐ Animate images into real video clips (Wan2.1-I2V)
--images     Generate images only, Ken Burns animation
--count      Number of images to generate (default: 4, max: 6)
--no-grade   Skip FFmpeg color grade
--dry-run    Print steps without executing
```

## 📦 Pipeline Steps (with --i2v)

```
1. Script   → Gemini AI generates narration + title + hashtags
2. TTS      → Edge-TTS synthesises neural voice audio
3. Whisper  → Word-level transcription for synced captions
4. Images   → Pollinations FLUX generates cinematic stills
5. I2V      → Wan2.1-I2V animates each image into a ~5s video clip
6. Remotion → Renders 1080×1920 composition using video clips as broll
7. FFmpeg   → Applies cinematic color grade
```

## 🔑 Environment Variables

```env
GEMINI_API_KEY=          # Free at aistudio.google.com
SILICONFLOW_API_KEY=     # Free at siliconflow.cn — for I2V
REPLICATE_API_KEY=       # Optional I2V fallback at replicate.com
PORT=3132                # Web server port
```

## 🎨 Color Schemes

| Scheme | Use Case |
|--------|----------|
| `teal-gold` | Finance & Crypto |
| `cyber-green` | Tech & AI |
| `fire-red` | Health & Urgent |
| `electric-blue` | Space & Future |

## 🛠️ Requirements

- Node.js 18+
- Python 3.8+ with `edge-tts` (`pip install edge-tts`)
- FFmpeg in PATH
- Remotion (included via npm)
- Whisper.cpp (auto-downloaded by Remotion)

## 📁 Project Structure

```
scripts/
  create-short.mjs    # Master pipeline orchestrator (7 steps)
  generate-script.mjs # AI script generation
  generate-images.mjs # Image generation (Pollinations FLUX)
  i2v.mjs             # Image-to-Video (Wan2.1-I2V + Replicate fallback)
  upload-image.mjs    # catbox.moe uploader for public image URLs
  transcribe.ts       # Whisper word-level captions
  tts.py              # Edge-TTS voice synthesis
src/
  UniversalShort.tsx  # Remotion composition
  index.tsx           # Remotion root
web/
  studio.html         # Web Studio UI (with I2V toggle)
server.mjs            # Express API server
```

## 🎥 I2V Model Details

| Provider | Model | Speed | Quality |
|----------|-------|-------|---------|
| SiliconFlow (primary) | Wan-AI/Wan2.1-I2V-14B-480P | ~3-5 min/clip | High |
| Replicate (fallback) | wavespeedai/wan-2.1-i2v-720p | ~2-4 min/clip | Very High |

---

> **v1** with Ken Burns static images: [video-subtitle-app](https://github.com/bhupendra05/video-subtitle-app)
