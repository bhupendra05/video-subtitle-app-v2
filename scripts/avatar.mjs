#!/usr/bin/env node
/**
 * avatar.mjs — AI talking-head video generator
 *
 * Generates an animated robot/AI avatar video from a text script.
 * Priority:
 *   1. D-ID API  (photorealistic talking-head — needs D_ID_API_KEY)
 *   2. Replicate SadTalker (open-source, needs REPLICATE_API_KEY)
 *   3. Static fallback (no avatar, pipeline continues without it)
 *
 * Usage:
 *   node scripts/avatar.mjs --text "Your narration text" --out output/avatar.mp4
 *   node scripts/avatar.mjs --audio output/narration.mp3 --out output/avatar.mp4
 *
 * Output: MP4 file with talking-head avatar (circular crop recommended in renderer)
 */

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

try { const { config } = await import('dotenv'); config(); } catch {}

const log  = (...a) => process.stderr.write(a.join(' ') + '\n');
const logE = (...a) => process.stderr.write('❌ ' + a.join(' ') + '\n');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args   = process.argv.slice(2);
const getArg = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };

const textArg  = getArg('--text');
const audioArg = getArg('--audio');
const outFile  = getArg('--out');

if (!outFile) {
  logE('Usage: node scripts/avatar.mjs --text "..." --out output/avatar.mp4');
  logE('       node scripts/avatar.mjs --audio narration.mp3 --out output/avatar.mp4');
  process.exit(1);
}

if (!textArg && !audioArg) {
  logE('Need either --text or --audio');
  process.exit(1);
}

// Ensure output directory exists
const outDir = dirname(outFile);
if (outDir && !existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const DID_KEY       = process.env.D_ID_API_KEY || '';
const REPLICATE_KEY = process.env.REPLICATE_API_KEY || '';

// ── Robot/AI avatar image URL (royalty-free AI robot face) ───────────────────
// Using a neutral, professional AI avatar image
const AVATAR_IMAGE_URL = process.env.AVATAR_IMAGE_URL ||
  'https://files.catbox.moe/gk6ato.jpg'; // Default: friendly robot/AI face

// ── D-ID generator (primary — photorealistic) ────────────────────────────────
async function generateWithDID(text, audioPath) {
  if (!DID_KEY) throw new Error('D_ID_API_KEY not set');
  log('  🎭 Using D-ID (talking-head)…');

  const headers = {
    'Authorization': `Basic ${DID_KEY}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  // Build request body — supports both text-to-speech or external audio
  const body = audioPath ? {
    script: {
      type: 'audio',
      audio_url: await uploadLocalAudio(audioPath),
    },
    source_url: AVATAR_IMAGE_URL,
    config: { fluent: true, pad_audio: 0.0 },
  } : {
    script: {
      type: 'text',
      input: text.slice(0, 1000),
      provider: { type: 'microsoft', voice_id: 'en-US-GuyNeural' },
    },
    source_url: AVATAR_IMAGE_URL,
    config: { fluent: true, pad_audio: 0.0 },
  };

  // Create talk
  log('  Creating D-ID talk…');
  const createRes = await fetch('https://api.d-id.com/talks', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`D-ID create failed ${createRes.status}: ${err.slice(0, 300)}`);
  }
  const { id } = await createRes.json();
  log(`  D-ID talk ID: ${id}`);

  // Poll for completion
  for (let attempt = 0; attempt < 60; attempt++) {
    await sleep(5000);
    const statusRes = await fetch(`https://api.d-id.com/talks/${id}`, { headers });
    const data = await statusRes.json();
    log(`  D-ID status: ${data.status} (${attempt + 1}/60)`);

    if (data.status === 'done') {
      const videoUrl = data.result_url;
      if (!videoUrl) throw new Error('D-ID returned no result_url');
      log(`  Downloading D-ID video…`);
      const videoRes = await fetch(videoUrl, { signal: AbortSignal.timeout(60_000) });
      const buffer = Buffer.from(await videoRes.arrayBuffer());
      writeFileSync(outFile, buffer);
      log(`  ✅ D-ID avatar saved → ${outFile} (${(buffer.length / 1024).toFixed(0)} KB)`);
      return true;
    }
    if (data.status === 'error') {
      throw new Error(`D-ID error: ${JSON.stringify(data.error)}`);
    }
  }
  throw new Error('D-ID timed out after 5 minutes');
}

// ── Replicate SadTalker generator (fallback) ──────────────────────────────────
async function generateWithReplicate(text, audioPath) {
  if (!REPLICATE_KEY) throw new Error('REPLICATE_API_KEY not set');
  log('  🤖 Using Replicate SadTalker…');

  const headers = {
    'Authorization': `Token ${REPLICATE_KEY}`,
    'Content-Type': 'application/json',
  };

  // Upload audio if provided
  let audioUrl = null;
  if (audioPath) {
    audioUrl = await uploadLocalAudio(audioPath);
    log(`  Audio uploaded: ${audioUrl}`);
  }

  const input = {
    source_image: AVATAR_IMAGE_URL,
    ...(audioUrl ? { driven_audio: audioUrl } : { text }),
    preprocess: 'full',
    still: false,
    use_enhancer: true,
    batch_size: 1,
    size: 256,
    pose_style: 0,
    facerender: 'facevid2vid',
    exp_scale: 1.2,
  };

  // Submit prediction
  const createRes = await fetch(
    'https://api.replicate.com/v1/models/vinthony/sadtalker/predictions',
    { method: 'POST', headers, body: JSON.stringify({ input }), signal: AbortSignal.timeout(30_000) },
  );
  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Replicate create failed ${createRes.status}: ${err.slice(0, 300)}`);
  }
  const pred = await createRes.json();
  const pollUrl = pred.urls?.get || `https://api.replicate.com/v1/predictions/${pred.id}`;
  log(`  Replicate prediction: ${pred.id}`);

  // Poll
  for (let attempt = 0; attempt < 90; attempt++) {
    await sleep(6000);
    const statusRes = await fetch(pollUrl, { headers });
    const data = await statusRes.json();
    log(`  Replicate status: ${data.status} (${attempt + 1}/90)`);

    if (data.status === 'succeeded') {
      const videoUrl = Array.isArray(data.output) ? data.output[0] : data.output;
      if (!videoUrl) throw new Error('Replicate returned no output URL');
      log(`  Downloading Replicate avatar…`);
      const videoRes = await fetch(videoUrl, { signal: AbortSignal.timeout(60_000) });
      const buffer = Buffer.from(await videoRes.arrayBuffer());
      writeFileSync(outFile, buffer);
      log(`  ✅ Replicate avatar saved → ${outFile} (${(buffer.length / 1024).toFixed(0)} KB)`);
      return true;
    }
    if (data.status === 'failed') {
      throw new Error(`Replicate failed: ${data.error}`);
    }
  }
  throw new Error('Replicate timed out after 9 minutes');
}

// ── Upload local audio to catbox.moe for public URL ──────────────────────────
async function uploadLocalAudio(localPath) {
  if (!existsSync(localPath)) throw new Error(`Audio file not found: ${localPath}`);
  const { uploadToCatbox } = await import('./upload-image.mjs');
  log(`  Uploading audio to catbox.moe…`);
  const url = await uploadToCatbox(localPath);
  log(`  Audio URL: ${url}`);
  return url;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  log('\n🤖 Generating AI avatar…');
  log('─'.repeat(50));

  let success = false;

  // 1. Try D-ID first (best quality)
  if (DID_KEY) {
    try {
      success = await generateWithDID(textArg, audioArg);
    } catch (err) {
      log(`  ⚠️  D-ID failed: ${err.message}`);
    }
  } else {
    log('  (No D_ID_API_KEY — skipping D-ID)');
  }

  // 2. Try Replicate SadTalker
  if (!success && REPLICATE_KEY) {
    try {
      success = await generateWithReplicate(textArg, audioArg);
    } catch (err) {
      log(`  ⚠️  Replicate failed: ${err.message}`);
    }
  } else if (!success) {
    log('  (No REPLICATE_API_KEY — skipping Replicate)');
  }

  if (!success) {
    logE('All avatar generators failed or no API keys set.');
    logE('To enable AI avatar:');
    logE('  D-ID (best):      add D_ID_API_KEY to .env — https://d-id.com');
    logE('  Replicate:        add REPLICATE_API_KEY to .env — https://replicate.com');
    logE('Pipeline will continue without avatar (AvatarPiP hidden).');
    process.exit(2);  // exit code 2 = graceful skip (not fatal error)
  }
}

main();
