#!/usr/bin/env node
/**
 * upload-image.mjs — Upload a local image to catbox.moe for a public URL.
 * catbox.moe is completely free, no API key required.
 * Returned URL is permanent and publicly accessible.
 *
 * Usage:
 *   node scripts/upload-image.mjs /path/to/image.jpg
 *   → prints the public URL to stdout
 */

import { createReadStream, statSync } from 'fs';
import path from 'path';

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node upload-image.mjs <filepath>');
  process.exit(1);
}

/**
 * Upload a file to catbox.moe and return the public URL.
 * Uses native fetch + FormData (Node.js 18+).
 */
export async function uploadToCatbox(localPath, retries = 3) {
  const ext      = path.extname(localPath).slice(1) || 'jpg';
  const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
  const fileName = path.basename(localPath);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Read file as buffer and create a Blob
      const { readFileSync } = await import('fs');
      const buffer = readFileSync(localPath);
      const blob   = new Blob([buffer], { type: mimeType });

      const form = new FormData();
      form.append('reqtype',      'fileupload');
      form.append('fileToUpload', blob, fileName);

      const res = await fetch('https://catbox.moe/user.php', {
        method: 'POST',
        body:   form,
        signal: AbortSignal.timeout(45_000),
      });

      if (!res.ok) throw new Error(`catbox HTTP ${res.status}`);

      const url = (await res.text()).trim();
      if (!url.startsWith('https://')) throw new Error(`Unexpected response: ${url}`);

      return url;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
}

// CLI usage
if (process.argv[2]) {
  const url = await uploadToCatbox(filePath);
  process.stdout.write(url);
}
