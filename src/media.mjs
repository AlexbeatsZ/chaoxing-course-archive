import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { analyzeSamples, createSlideDetector, frameDiff } from 'video-slide-extractor';

const exec = promisify(execFile);
export async function probeVideo(file) {
  let stdout;
  try { ({ stdout } = await exec('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { maxBuffer: 4e6 })); }
  catch (e) { throw new Error(e.code === 'ENOENT' ? '需要已安装的 ffprobe 和 ffmpeg。' : '视频探测失败，请检查下载是否完整。'); }
  const result = JSON.parse(stdout), video = result.streams.find(s => s.codec_type === 'video');
  const duration = Number(result.format.duration || video?.duration);
  if (!video || !Number.isFinite(duration) || duration <= 0) throw new Error('未发现可读取的视频轨道。');
  return { width: video.width, height: video.height, duration, hasAudio: result.streams.some(s => s.codec_type === 'audio') };
}

export function cropFilter(crop, geometry) {
  if (!crop) return '';
  const [x, y, w, h] = Array.isArray(crop) ? crop : String(crop).split(',').map(Number);
  if (![x, y, w, h].every(Number.isInteger) || x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > geometry.width || y + h > geometry.height) {
    throw new Error('--crop 必须是位于原视频范围内的 x,y,width,height 像素。');
  }
  return `crop=${w}:${h}:${x}:${y}`;
}

export async function* rawFrames(file, { fps, width, height, crop = '', duration }) {
  const filters = [crop, `fps=${fps}`, `scale=${width}:${height}`].filter(Boolean).join(',');
  const child = spawn('ffmpeg', ['-v', 'error', '-threads', '2', '-i', file, ...(duration ? ['-t', String(duration)] : []),
    '-an', '-vf', filters, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '', failure;
  child.on('error', e => { failure = e; });
  child.stderr.on('data', d => { stderr = (stderr + d).slice(-3000); });
  const closed = new Promise(resolve => child.on('close', resolve));
  const frameSize = width * height * 4;
  let acc = Buffer.alloc(0), finished = false;
  try {
    for await (const chunk of child.stdout) {
      acc = acc.length ? Buffer.concat([acc, chunk]) : chunk;
      let offset = 0;
      while (acc.length - offset >= frameSize) {
        yield acc.subarray(offset, offset + frameSize);
        offset += frameSize;
      }
      acc = acc.subarray(offset);
    }
    const code = await closed;
    if (failure) throw failure;
    if (code !== 0) throw new Error(`FFmpeg 分析失败：${stderr}`);
    if (acc.length) throw new Error('FFmpeg 返回了不完整的图像帧。');
    finished = true;
  } finally {
    if (!finished && child.exitCode === null) child.kill('SIGKILL');
  }
}

export function stableSegments(boundaries, duration, minStable) {
  const accepted = [], skipped = [];
  let pendingStart = null;
  for (let i = 0; i < boundaries.length; i++) {
    const current = boundaries[i], end = boundaries[i + 1]?.seconds ?? duration;
    if (end - current.seconds < minStable) {
      if (pendingStart === null) pendingStart = current.seconds;
      skipped.push({ start: current.seconds, end });
      continue;
    }
    accepted.push({ start: pendingStart ?? current.seconds, stableStart: current.seconds, end,
      capture: current.seconds + (end - current.seconds) / 2 });
    pendingStart = null;
  }
  // Preserve the trailing interval even if the last transition was short.
  if (pendingStart !== null && accepted.length) accepted.at(-1).end = duration;
  return { accepted, skipped };
}

async function grabRaw(file, seconds, width, height, crop) {
  const args = ['-v', 'error', '-threads', '2', '-ss', String(seconds), '-i', file, '-an',
    ...(crop ? ['-vf', crop] : []), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'];
  const { stdout } = await exec('ffmpeg', args, { encoding: 'buffer', maxBuffer: width * height * 3 + 1e6 });
  if (stdout.length !== width * height * 3) throw new Error(`无法完整读取 ${seconds.toFixed(2)} 秒的画面。`);
  return stdout;
}

export function median3(a, b, c) {
  if (a.length !== b.length || a.length !== c.length) throw new Error('帧尺寸不同。');
  const result = Buffer.allocUnsafe(a.length);
  for (let i = 0; i < result.length; i++) result[i] = a[i] + b[i] + c[i] - Math.min(a[i], b[i], c[i]) - Math.max(a[i], b[i], c[i]);
  return result;
}

export async function imageDescriptor(png) {
  const small = await sharp(png).resize(320, 180, { fit: 'fill' }).removeAlpha().ensureAlpha().raw().toBuffer();
  const grey = await sharp(png).resize(320, 180, { fit: 'fill' }).greyscale().raw().toBuffer();
  const hashPixels = await sharp(png).resize(9, 8, { fit: 'fill' }).greyscale().raw().toBuffer();
  let hash = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) hash = (hash << 1n) | BigInt(hashPixels[y * 9 + x] > hashPixels[y * 9 + x + 1]);
  return { small, grey, hash };
}

export function isDuplicate(a, b) {
  let value = a.hash ^ b.hash, hamming = 0;
  while (value) { value &= value - 1n; hamming++; }
  if (hamming > 3 || a.grey.length !== b.grey.length) return false;
  let sum = 0, changed = 0;
  for (let i = 0; i < a.grey.length; i++) {
    const delta = Math.abs(a.grey[i] - b.grey[i]); sum += delta; if (delta > 16) changed++;
  }
  return sum / a.grey.length <= 1.1 && changed / a.grey.length <= 0.003;
}

export async function extractSlides(file, directory, options = {}) {
  const info = await probeVideo(file);
  const fps = Number(options.fps ?? 1), minStable = Number(options.minStable ?? 2);
  if (!Number.isFinite(fps) || fps <= 0 || fps > 10 || !Number.isFinite(minStable) || minStable < 0.5) throw new Error('抽样频率或稳定时间无效。');
  const crop = cropFilter(options.crop, info);
  const [cropWidth, cropHeight] = crop ? crop.split(':').slice(0, 2).map(s => Number(s.replace('crop=', ''))) : [info.width, info.height];
  const width = 320, height = Math.max(8, Math.round(cropHeight / cropWidth * width));
  const duration = options.duration ? Math.min(Number(options.duration), info.duration) : info.duration;
  if (!(duration > 0)) throw new Error('处理时长无效。');
  const geometry = { fps, width, height, crop, duration };
  options.onProgress?.('校准换页阈值');
  const samples = [], stride = Math.max(1, Math.ceil(duration * fps / 96));
  let scanned = 0;
  for await (const frame of rawFrames(file, geometry)) { if (scanned++ % stride === 0 && samples.length < 96) samples.push(Buffer.from(frame)); }
  const { mask, choice } = analyzeSamples(samples, width, height);
  // Avoid a coarse calibration hiding a small but meaningful text update.
  const threshold = options.threshold === undefined ? Math.min(0.02, choice.changedRatio) : Number(options.threshold);
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold >= 1) throw new Error('阈值必须位于 0 与 1 之间。');
  const detector = createSlideDetector(width, height, { mask, changedRatio: threshold });
  const boundaries = [];
  scanned = 0;
  for await (const frame of rawFrames(file, geometry)) {
    const { keep, ratio } = detector(frame);
    if (keep) boundaries.push({ seconds: scanned / fps, ratio });
    scanned++;
    if (scanned % Math.ceil(300 * fps) === 0) options.onProgress?.(`已分析 ${Math.round(scanned / fps)} 秒，${boundaries.length} 个候选状态`);
  }
  if (!scanned) throw new Error('视频没有可读取的帧。');
  const segments = stableSegments(boundaries, duration, minStable);
  if (!segments.accepted.length) throw new Error('没有持续足够长的稳定页面，请降低 --min-stable 或检查是否选中了录屏。');
  await mkdir(join(directory, 'slides'), { recursive: true });
  const slides = [], occurrences = [], descriptors = [], warnings = [];
  for (let i = 0; i < segments.accepted.length; i++) {
    const s = segments.accepted[i], spread = Math.min(0.7, (s.end - s.stableStart) / 5);
    const frames = [];
    for (const at of [s.capture - spread, s.capture, s.capture + spread]) frames.push(await grabRaw(file, at, cropWidth, cropHeight, crop));
    const small = await Promise.all(frames.map(frame => sharp(frame, { raw: { width: cropWidth, height: cropHeight, channels: 3 } }).resize(width, height).ensureAlpha().raw().toBuffer()));
    const changing = frameDiff(small[0], small[2], width, height).ratio > 0.04;
    const cleaned = changing ? frames[1] : median3(...frames);
    const png = await sharp(cleaned, { raw: { width: cropWidth, height: cropHeight, channels: 3 } }).png().toBuffer();
    const descriptor = await imageDescriptor(png);
    let slideIndex = descriptors.findIndex(d => isDuplicate(d, descriptor));
    if (slideIndex < 0) {
      slideIndex = slides.length;
      const filename = `slides/slide-${String(slideIndex + 1).padStart(3, '0')}.png`;
      await writeFile(join(directory, filename), png);
      slides.push({ id: slideIndex + 1, image: filename, width: cropWidth, height: cropHeight, firstSeen: s.start,
        cursorTreatment: changing ? 'single-frame' : 'temporal-median', review: changing });
      descriptors.push(descriptor);
    }
    const previous = occurrences.at(-1);
    if (previous?.slideId === slideIndex + 1) previous.end = s.end;
    else occurrences.push({ id: occurrences.length + 1, slideId: slideIndex + 1, start: s.start, end: s.end, capture: s.capture });
    if (changing) warnings.push(`第 ${i + 1} 个区间仍有明显动态画面，使用单帧并标记为待检查。`);
    if ((i + 1) % 20 === 0) options.onProgress?.(`已导出 ${i + 1}/${segments.accepted.length} 个稳定区间`);
  }
  return { info, duration, settings: { fps, minStable, threshold, calibrationMode: choice.mode,
    maskedBlocks: mask ? [...mask].filter(Boolean).length : 0, crop: options.crop || null },
    scannedFrames: scanned, rawBoundaries: boundaries.length, skippedTransitions: segments.skipped, slides, occurrences, warnings };
}
