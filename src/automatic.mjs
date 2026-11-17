import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { imageDescriptor, isDuplicate } from './media.mjs';
import { alignTranscript } from './transcript.mjs';
import { saveJson } from './platform.mjs';

function median(values) { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; }
function broadRun(values, threshold, maxGap) {
  let best = null, start = null, last = null;
  for (let i = 0; i < values.length; i++) {
    if (values[i] > threshold) { if (start === null) start = i; last = i; }
    if (start !== null && (i - last > maxGap || i === values.length - 1)) {
      if (!best || last - start > best[1] - best[0]) best = [start, last + 1];
      start = null;
    }
  }
  return best;
}

// High-confidence bright slide/paper surrounded by dark margins. A mixed or
// dark layout falls back to the full image instead of risking lost content.
export async function contentCrop(path, width, height) {
  const w = 480, h = Math.round(height / width * w);
  const pixels = await sharp(path).resize(w, h).greyscale().raw().toBuffer();
  const cols = [];
  for (let x = 0; x < w; x++) {
    const ys = [];
    for (let y = Math.floor(h * 0.14); y < Math.ceil(h * 0.86); y++) ys.push(pixels[y * w + x]);
    cols.push(median(ys));
  }
  if (Math.max(...cols) < 175 || Math.min(...cols) > 125) return null;
  const colRun = broadRun(cols, 165, 5);
  if (!colRun || colRun[1] - colRun[0] < w * 0.35) return null;
  const rows = [];
  for (let y = 0; y < h; y++) {
    const xs = [];
    for (let x = colRun[0]; x < colRun[1]; x++) xs.push(pixels[y * w + x]);
    rows.push(median(xs));
  }
  const rowRun = broadRun(rows, 165, 3);
  if (!rowRun || rowRun[1] - rowRun[0] < h * 0.35) return null;
  const left = Math.max(0, Math.floor(colRun[0] / w * width) - 2);
  const top = Math.max(0, Math.floor(rowRun[0] / h * height) - 2);
  const right = Math.min(width, Math.ceil(colRun[1] / w * width) + 2);
  const bottom = Math.min(height, Math.ceil(rowRun[1] / h * height) + 2);
  if ((right - left) * (bottom - top) > width * height * 0.96) return null;
  // A bright text column beside a photograph is not the whole slide. Only
  // accept familiar rectangular canvas ratios; uncertain regions stay intact.
  const aspect = (right - left) / (bottom - top);
  if (![4 / 3, 16 / 9, 16 / 10, Math.SQRT2, 1 / Math.SQRT2].some(r => Math.abs(aspect / r - 1) < 0.035)) return null;
  return { left, top, width: right - left, height: bottom - top };
}

export async function prepareAutomatically(directory) {
  const timeline = JSON.parse(await readFile(join(directory, 'timeline.json'), 'utf8'));
  const { segments: transcript } = JSON.parse(await readFile(join(directory, 'transcript.json'), 'utf8'));
  await mkdir(join(directory, 'processed'), { recursive: true });
  const pages = [], descriptors = [], decisions = [], mapping = new Map();
  for (const source of timeline.slides) {
    const path = join(directory, source.image);
    const crop = await contentCrop(path, source.width, source.height);
    let image = sharp(path);
    if (crop) image = image.extract(crop);
    const png = await image.png().toBuffer(), stats = await sharp(png).stats();
    // A real slide containing a few words must survive; only near-uniform
    // frames with essentially no visual information count as blank.
    if (stats.entropy < 0.08 && stats.channels.every(c => c.stdev < 2)) {
      decisions.push({ candidate: source.id, action: 'blank' }); continue;
    }
    const descriptor = await imageDescriptor(png);
    let index = descriptors.findIndex(d => isDuplicate(d, descriptor));
    if (index < 0) {
      index = pages.length;
      const filename = `processed/page-${String(index + 1).padStart(3, '0')}.jpg`;
      const info = await sharp(png).resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
        .withMetadata({ density: 96 }).jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toFile(join(directory, filename));
      pages.push({ id: index + 1, image: filename, width: info.width, height: info.height,
        title: `课件第 ${index + 1} 页`, candidate: source.id, crop });
      descriptors.push(descriptor);
      decisions.push({ candidate: source.id, action: 'keep', pageId: index + 1, crop });
    } else decisions.push({ candidate: source.id, action: 'duplicate', pageId: index + 1, crop });
    mapping.set(source.id, index + 1);
  }
  if (!pages.length) throw new Error('所有候选画面都为空白，无法生成课件。');
  const occurrences = [];
  for (const o of timeline.occurrences) {
    const slideId = mapping.get(o.slideId);
    if (!slideId) continue;
    if (occurrences.at(-1)?.slideId === slideId && occurrences.at(-1).end === o.start) occurrences.at(-1).end = o.end;
    else occurrences.push({ id: occurrences.length + 1, slideId, start: o.start, end: o.end });
  }
  const lesson = { schemaVersion: 1, metadata: timeline.metadata, duration: timeline.duration, automatic: true,
    pages, occurrences: alignTranscript(occurrences, transcript), transcript, decisions,
    note: '平台语音字幕原文。跨换页的字幕段按主要重叠时段归属，每段只保留一次。难以判断的画面保留。' };
  const assigned = lesson.occurrences.flatMap(o => o.transcriptIds);
  if (assigned.length !== transcript.length || new Set(assigned).size !== transcript.length) throw new Error('字幕完整性检查失败。');
  await saveJson(join(directory, 'lesson.json'), lesson);
  return lesson;
}
