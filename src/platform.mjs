import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, stat, rename, rm, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export function parseArgsDeclaration(html) {
  // Parse JSON only. Never evaluate scripts received from the platform.
  const match = /\b(?:window\.)?args\s*=\s*\{/.exec(html);
  if (!match) throw new Error('未找到回放元数据；请确认链接是已发布的回放，且登录/分享链接仍有效。');
  const begin = match.index + match[0].lastIndexOf('{');
  let depth = 0, quoted = false, escape = false;
  for (let i = begin; i < html.length; i++) {
    const c = html[i];
    if (quoted) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(html.slice(begin, i + 1));
  }
  throw new Error('回放元数据不完整。');
}

export function replayUrl(value) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || !/(^|\.)chaoxing\.com$/.test(u.hostname) || !/^\/vri-zelda\/index(?:-share)?$/.test(u.pathname)) {
    throw new Error('请提供智播课堂的「观看回放」链接（/vri-zelda/index），课程列表请先在浏览器中打开。');
  }
  return u;
}

export async function getText(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (CourseArchive/0.1)', Accept: 'text/html,application/json' },
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`平台请求失败：HTTP ${response.status} (${new URL(url).pathname})`);
  const text = await response.text();
  if (text.length > 8_000_000) throw new Error('平台响应异常过大。');
  return text;
}

async function getJson(url, getter = getText) {
  const text = await getter(url);
  try { return JSON.parse(text); }
  catch { throw new Error(`平台未返回 JSON，可能需要重新登录 (${new URL(url).pathname})`); }
}

export function normalizeTranscript(raw, args = {}) {
  if (!Array.isArray(raw)) throw new Error('字幕尚未生成或当前账号无权访问字幕。');
  const offset = args.edited ? 0 : Number(args.start || 0);
  if (!Number.isFinite(offset) || offset < 0) throw new Error('回放的时间偏移无效。');
  return raw.map((segment, index) => {
    const rawStart = Number(segment.start), rawEnd = Number(segment.end);
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || rawStart < 0 || rawEnd < rawStart || typeof segment.text !== 'string') {
      throw new Error(`第 ${index + 1} 段字幕格式无效。`);
    }
    return { id: index + 1, start: Math.max(0, rawStart - offset), end: Math.max(0, rawEnd - offset),
      rawStart, rawEnd, speaker: segment.speaker || '', text: segment.text };
  }).filter(s => s.rawEnd >= offset).sort((a, b) => a.start - b.start || a.id - b.id);
}

export function metadataFromArgs(args) {
  const speech = args.speech;
  if (!speech || !Array.isArray(speech.videos) || !speech.speechId) throw new Error('该链接未包含可用的回放。');
  const header = speech.settings || {};
  return { course: header.coursename || '未命名课程', date: header.skdate || '', lesson: String(header.lessons || ''),
    week: String(header.class_week || ''), teacher: header.teachername || '', speechId: speech.speechId,
    playbackOffset: args.edited ? 0 : Number(args.start || 0), edited: Boolean(args.edited),
    streams: speech.videos.map(v => ({ id: v.id, type: v.type, url: v.http || v.realHttp || v.download,
      objectId: v.objectId, label: v.type === 'ppt' ? '电脑录屏 / PPT' : v.type === 'main' ? '教师摄像头' : '其他摄像头' })) };
}

export async function inspectReplay(value, { get = getText } = {}) {
  const url = replayUrl(value), args = parseArgsDeclaration(await get(url));
  const metadata = metadataFromArgs(args);
  const apiBase = new URL('/vri-zelda/api/', url);
  const params = { speechid: String(metadata.speechId), enc: args.denc || args.speech.enc || '' };
  const transcriptUrl = new URL('get-transcript', apiBase);
  const main = args.speech.videos.find(v => v.type === (args.soundSource || 'main')) || args.speech.videos[0];
  transcriptUrl.search = new URLSearchParams({ ...params, objectid: String(main?.objectId ?? 'undefined'), type: '' });
  const ppt = args.speech.videos.find(v => v.type === 'ppt');
  const pptUrl = new URL('get-ppt', apiBase);
  pptUrl.search = new URLSearchParams({ ...params, ...(ppt?.objectId ? { objectid: ppt.objectId } : { url: ppt?.realHttp || ppt?.http || '' }) });
  const [rawTranscript, rawPpt] = await Promise.all([
    getJson(transcriptUrl, get), ppt ? getJson(pptUrl, get).catch(() => null) : null,
  ]);
  const transcript = normalizeTranscript(rawTranscript, args);
  const platformPpt = Array.isArray(rawPpt) ? rawPpt : [];
  return { schemaVersion: 1, source: url.href, metadata, transcript, rawTranscript, platformPpt,
    warnings: [...(!transcript.length ? ['平台当前返回空字幕；视频仍可处理。'] : []),
      ...(!ppt ? ['未提供 type=ppt 的电脑录屏，不能自动改用教师镜头。'] : []),
      ...(!platformPpt.length ? ['平台无现成课件图片，将从录屏提取。'] : [])] };
}

export async function saveJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  // Port of icourse/local_replay.py write_json: flush + fsync + atomic rename.
  const temporary = path + '.tmp';
  const file = await open(temporary, 'w', 0o600);
  try { await file.writeFile(JSON.stringify(data, null, 2) + '\n'); await file.sync(); }
  finally { await file.close(); }
  await rename(temporary, path);
}

export async function downloadVideo(url, target, { onProgress = () => {}, attempts = 3 } = {}) {
  const u = new URL(url);
  if (!['https:', 'http:'].includes(u.protocol)) throw new Error('不支持的视频协议。');
  await mkdir(dirname(target), { recursive: true });
  const part = target + '.part', metaPath = part + '.json';
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      let previous;
      try { previous = JSON.parse(await readFile(metaPath, 'utf8')); } catch {}
      let offset = previous?.url === url ? (await stat(part).catch(() => ({ size: 0 }))).size : 0;
      if (offset && !previous.etag && !previous.modified) offset = 0;
      const headers = { 'User-Agent': 'Mozilla/5.0 (CourseArchive/0.1)', 'Accept-Encoding': 'identity',
        Referer: 'https://psp-zelda.chaoxing.com/' };
      if (offset) {
        headers.Range = `bytes=${offset}-`;
        if (previous.etag || previous.modified) headers['If-Range'] = previous.etag || previous.modified;
      }
      const response = await fetch(u, { headers, signal: AbortSignal.timeout(6 * 60 * 60 * 1000) });
      if (!response.ok) throw new Error(`视频下载失败：HTTP ${response.status}；请重新打开回放刷新链接。`);
      const type = response.headers.get('content-type') || '';
      if (/html|json|text\//i.test(type)) { await response.body?.cancel(); throw new Error('下载响应不是视频，可能已退出登录或链接过期。'); }
      if (response.status === 206) {
        const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
        if (!range || Number(range[1]) !== offset || Number(range[2]) !== Number(range[3]) - 1) {
          await response.body?.cancel(); throw new Error('服务器返回了错误的续传范围，已停止以避免损坏视频。');
        }
      } else offset = 0;
      const length = Number(response.headers.get('content-length')) || 0;
      const rangeTotal = Number((response.headers.get('content-range') || '').split('/')[1]) || 0;
      const total = rangeTotal || (length ? length + offset : 0);
      if (offset && previous.total && previous.total !== total) {
        await response.body?.cancel(); await rm(metaPath, { force: true });
        throw new Error('远程视频大小已变化，下次重试将重新下载。');
      }
      if (offset && ((previous.etag && response.headers.get('etag') !== previous.etag) ||
        (!previous.etag && previous.modified && response.headers.get('last-modified') !== previous.modified))) {
        await response.body?.cancel(); await rm(metaPath, { force: true });
        throw new Error('远程视频版本已变化，下次重试将重新下载。');
      }
      await saveJson(metaPath, { url, total, etag: response.headers.get('etag'), modified: response.headers.get('last-modified') });
      let done = offset, last = 0;
      const meter = new Transform({ transform(chunk, _, callback) {
        done += chunk.length;
        if (Date.now() - last > 10_000) { last = Date.now(); onProgress({ done, total, attempt }); }
        callback(null, chunk);
      } });
      await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(part, { flags: offset ? 'a' : 'w', mode: 0o600 }));
      if (total && done !== total) throw new Error(`视频下载不完整 (${done}/${total})。`);
      if (!done) throw new Error('服务器返回了空视频。');
      await rename(part, target); await rm(metaPath, { force: true });
      await saveJson(target + '.json', { complete: true, source: u.origin + u.pathname, bytes: done });
      onProgress({ done, total: done, complete: true });
      return { bytes: done };
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw lastError;
}
