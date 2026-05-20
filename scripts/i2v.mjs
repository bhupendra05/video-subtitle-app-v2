#!/usr/bin/env node
/**
 * i2v.mjs — Image-to-Video using Wan2.1-I2V-14B (SiliconFlow primary, Replicate fallback)
 *
 * Usage:
 *   node scripts/i2v.mjs --image /path/to/img.jpg --out /path/to/clip.mp4
 *   node scripts/i2v.mjs --images path1.jpg,path2.jpg --outdir /path/to/clips/
 *
 * Outputs JSON array of local clip paths to stdout (for pipeline integration).
 *
 * Env vars:
 *   SILICONFLOW_API_KEY  — required for primary provider
 *   REPLICATE_API_KEY    — optional fallback
 */

import { existsSync, mkdirSync, writeFileSync, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import path from 'path';
import { fileURLToPath } from 'url';

try { const { config } = await import('dotenv'); config(); } catch {}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.join(__dirname, '..');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const getArg  = (flag, def = null) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] ?? def : def; };

const singleImage  = getArg('--image');
const multiImages  = getArg('--images');   // comma-separated
const outFile      = getArg('--out');
const outDir       = getArg('--outdir', path.join(ROOT, 'public', 'broll'));
const promptArg    = getArg('--prompt', '');
const durationArg  = parseInt(getArg('--duration', '5'), 10);  // 5s clips

const imageList = singleImage
  ? [singleImage]
  : multiImages
    ? multiImages.split(',').map(s => s.trim()).filter(Boolean)
    : [];

if (!imageList.length) {
  console.error('Usage: node i2v.mjs --image <path> [--out <path>] [--prompt "..."]');
  console.error('   or: node i2v.mjs --images path1,path2 [--outdir <dir>] [--prompt "..."]');
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function log(msg) { process.stderr.write(`[i2v] ${msg}\n`); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function downloadFile(url, destPath) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} for ${url}`);
  const writer = createWriteStream(destPath);
  await pipeline(res.body, writer);
}

// ── catbox upload (for local images) ─────────────────────────────────────────
async function ensurePublicUrl(localPath) {
  if (localPath.startsWith('http://') || localPath.startsWith('https://')) {
    return localPath;
  }
  log(`Uploading ${path.basename(localPath)} to catbox.moe…`);
  const { uploadToCatbox } = await import('./upload-image.mjs');
  const url = await uploadToCatbox(localPath);
  log(`  → ${url}`);
  return url;
}

// ── SiliconFlow Wan2.1-I2V ────────────────────────────────────────────────────
const SF_API  = 'https://api.siliconflow.cn/v1';
const SF_MODEL = 'Wan-AI/Wan2.1-I2V-14B-480P';   // portrait-compatible, 480p
const SF_KEY   = process.env.SILICONFLOW_API_KEY;

async function sfSubmit(imageUrl, prompt) {
  const body = {
    model:    SF_MODEL,
    image:    imageUrl,
    prompt:   prompt || 'cinematic motion, smooth camera movement, 4K, photorealistic',
    // 480P portrait: 480×832 (closest to 9:16)
    image_size: '480x832',
    seed:     Math.floor(Math.random() * 9999999),
  };

  log(`  SiliconFlow submit: ${SF_MODEL}`);
  const res = await fetch(`${SF_API}/video/submit`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${SF_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`SiliconFlow submit failed: HTTP ${res.status} — ${txt.slice(0, 200)}`);
  }

  const data = await res.json();
  const requestId = data.requestId ?? data.request_id ?? data.id;
  if (!requestId) throw new Error(`SiliconFlow: no requestId in response: ${JSON.stringify(data)}`);
  log(`  Job submitted: ${requestId}`);
  return requestId;
}

async function sfPoll(requestId, timeoutMs = 10 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  let attempts   = 0;

  while (Date.now() < deadline) {
    await sleep(attempts === 0 ? 5000 : 10_000);
    attempts++;

    const res = await fetch(`${SF_API}/video/status/${requestId}`, {
      headers: { 'Authorization': `Bearer ${SF_KEY}` },
      signal:  AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      log(`  Poll HTTP ${res.status} — retrying…`);
      continue;
    }

    const data = await res.json();
    const status = (data.status ?? '').toLowerCase();
    log(`  [attempt ${attempts}] status: ${status}`);

    if (status === 'succeed' || status === 'succeeded' || status === 'completed') {
      // Video URL may be nested in different shapes
      const videoUrl =
        data.results?.videos?.[0]?.url ??
        data.video?.url ??
        data.output?.video_url ??
        data.url ??
        data.videoUrl;

      if (!videoUrl) throw new Error(`SiliconFlow: status Succeed but no video URL in: ${JSON.stringify(data)}`);
      log(`  ✅ Video ready: ${videoUrl}`);
      return videoUrl;
    }

    if (status === 'failed' || status === 'error') {
      throw new Error(`SiliconFlow job failed: ${JSON.stringify(data)}`);
    }

    // InQueue / Running / Processing — keep polling
  }

  throw new Error(`SiliconFlow: timed out after ${timeoutMs / 1000}s`);
}

async function generateWithSiliconFlow(imageUrl, prompt, destPath) {
  if (!SF_KEY) throw new Error('SILICONFLOW_API_KEY not set');
  const requestId = await sfSubmit(imageUrl, prompt);
  const videoUrl  = await sfPoll(requestId);
  log(`  Downloading clip…`);
  await downloadFile(videoUrl, destPath);
  log(`  Saved → ${destPath}`);
  return destPath;
}

// ── Replicate fallback (wavespeedai/wan-2.1-i2v-720p) ─────────────────────────
const REP_KEY   = process.env.REPLICATE_API_KEY;
const REP_MODEL = 'wavespeedai/wan-2.1-i2v-720p'; // id resolved at runtime

async function generateWithReplicate(imageUrl, prompt, destPath) {
  if (!REP_KEY) throw new Error('REPLICATE_API_KEY not set for fallback');

  log(`  Replicate fallback: ${REP_MODEL}`);

  // Create prediction
  const res = await fetch('https://api.replicate.com/v1/models/wavespeedai/wan-2.1-i2v-720p/predictions', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${REP_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'wait=60',
    },
    body: JSON.stringify({
      input: {
        image:  imageUrl,
        prompt: prompt || 'cinematic motion, smooth camera pan, photorealistic, 4K quality',
        num_frames: durationArg === 5 ? 81 : Math.min(161, durationArg * 16 + 1),
        fast_mode:  true,
      },
    }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Replicate submit failed: HTTP ${res.status} — ${txt.slice(0, 200)}`);
  }

  let pred = await res.json();
  log(`  Replicate prediction: ${pred.id} status: ${pred.status}`);

  // Poll until completed
  const deadline = Date.now() + 10 * 60 * 1000;
  while (pred.status !== 'succeeded' && pred.status !== 'failed' && pred.status !== 'canceled') {
    if (Date.now() > deadline) throw new Error('Replicate: timed out');
    await sleep(8000);
    const pollRes = await fetch(pred.urls.get, {
      headers: { 'Authorization': `Bearer ${REP_KEY}` },
      signal:  AbortSignal.timeout(15_000),
    });
    pred = await pollRes.json();
    log(`  Replicate status: ${pred.status}`);
  }

  if (pred.status !== 'succeeded') {
    throw new Error(`Replicate prediction ${pred.status}: ${pred.error ?? 'unknown'}`);
  }

  const videoUrl = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  if (!videoUrl) throw new Error('Replicate: no output URL');

  log(`  Downloading clip from Replicate…`);
  await downloadFile(videoUrl, destPath);
  log(`  Saved → ${destPath}`);
  return destPath;
}

// ── Main per-image generator ──────────────────────────────────────────────────
async function imageToVideo(localPath, destPath, prompt, index) {
  log(`\n[${index + 1}] ${path.basename(localPath)} → ${path.basename(destPath)}`);

  // Upload to catbox for public URL
  const imageUrl = await ensurePublicUrl(localPath);

  // Try SiliconFlow first
  if (SF_KEY) {
    try {
      return await generateWithSiliconFlow(imageUrl, prompt, destPath);
    } catch (err) {
      log(`  ⚠️  SiliconFlow failed: ${err.message}`);
      log('  Trying Replicate fallback…');
    }
  } else {
    log('  ⚠️  SILICONFLOW_API_KEY not set — trying Replicate directly');
  }

  // Replicate fallback
  return await generateWithReplicate(imageUrl, prompt, destPath);
}

// ── Entry point ───────────────────────────────────────────────────────────────
async function main() {
  mkdirSync(outDir, { recursive: true });

  const results = [];

  for (let i = 0; i < imageList.length; i++) {
    const imgPath = imageList[i];

    if (!existsSync(imgPath) && !imgPath.startsWith('http')) {
      log(`⚠️  Skipping missing file: ${imgPath}`);
      continue;
    }

    // Determine output path
    const destPath = imageList.length === 1 && outFile
      ? outFile
      : path.join(outDir, `i2v-${Date.now()}-${i}.mp4`);

    try {
      const clipPath = await imageToVideo(imgPath, destPath, promptArg, i);
      results.push(clipPath);
    } catch (err) {
      log(`❌ Failed to generate clip for ${path.basename(imgPath)}: ${err.message}`);
      // Don't abort the whole batch — skip this clip
    }

    // Small delay between API calls to avoid rate limiting
    if (i < imageList.length - 1) {
      await sleep(2000);
    }
  }

  log(`\n✅ Generated ${results.length}/${imageList.length} clips`);

  // Output JSON array for pipeline consumption
  process.stdout.write(JSON.stringify(results));
}

main().catch(err => {
  log(`Fatal: ${err.message}`);
  process.exit(1);
});
