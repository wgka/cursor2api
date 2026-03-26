#!/usr/bin/env node
/**
 * Pre-download tesseract.js language data to avoid runtime CDN fetches.
 * Run via: npm run tessdata:download
 *
 * Downloads LSTM-only (best_int) trained data for eng + chi_sim
 * from the jsdelivr CDN used by tesseract.js internally.
 */
import { mkdir, access, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data', 'tessdata');

const LANGS = ['eng', 'chi_sim'];
const CDN_BASE = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data';
const VERSION = '4.0.0_best_int';

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function download(lang) {
  const outPath = join(DATA_DIR, `${lang}.traineddata`);
  if (await fileExists(outPath)) {
    console.log(`  [skip] ${lang}.traineddata already exists`);
    return;
  }

  const url = `${CDN_BASE}/${lang}/${VERSION}/${lang}.traineddata.gz`;
  console.log(`  [fetch] ${lang} <- ${url}`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);

  const gzBuf = Buffer.from(await res.arrayBuffer());
  const raw = gunzipSync(gzBuf);
  await writeFile(outPath, raw);
  console.log(`  [done] ${lang}.traineddata (${(raw.length / 1024 / 1024).toFixed(1)} MB)`);
}

async function main() {
  console.log('[tessdata] Downloading language data...');
  await mkdir(DATA_DIR, { recursive: true });

  for (const lang of LANGS) {
    await download(lang);
  }
  console.log('[tessdata] All done. Files in:', DATA_DIR);
}

main().catch((err) => {
  console.error('[tessdata] FATAL:', err);
  process.exit(1);
});
