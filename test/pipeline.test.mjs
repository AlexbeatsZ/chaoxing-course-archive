import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { parseArgsDeclaration, normalizeTranscript, replayUrl, downloadVideo, metadataFromArgs } from '../src/platform.mjs';
import { alignTranscript, timecode, subtitleText } from '../src/transcript.mjs';
import { median3, stableSegments, isDuplicate, cropFilter } from '../src/media.mjs';

const tempRoot = process.platform === 'win32' ? join(process.env.LOCALAPPDATA, 'Temp', '.agents') : '/tmp/.agents';
await mkdir(tempRoot, { recursive: true });

test('parses JSON args with braces in strings without executing script', () => {
  const value = parseArgsDeclaration('<script>args={"title":"} \\\" {","speech":{"speechId":1}}</script><script>throw Error()</script>');
  assert.equal(value.speech.speechId, 1);
  assert.throws(() => parseArgsDeclaration('<html>login</html>'), /元数据/);
});

test('requires a real replay URL rather than the list page', () => {
  assert.equal(replayUrl('https://psp-zelda.chaoxing.com/vri-zelda/index?speechid=1').hostname, 'psp-zelda.chaoxing.com');
  for (const s of ['https://example.com/vri-zelda/index', 'https://fanyalubodata.fanya.chaoxing.com/starcloud/list']) assert.throws(() => replayUrl(s));
});

test('selects streams by type rather than index', () => {
  const data = metadataFromArgs({ speech: { speechId: 1, videos: [{ id: 10, type: 'other' }, { id: 2, type: 'ppt' }], settings: {} } });
  assert.equal(data.streams.find(v => v.type === 'ppt').id, 2);
});

test('preserves precise source times, handles offsets and edited media', () => {
  const raw = [{ start: 105.41, end: 107.43, text: '原文', speaker: 'teacher' }];
  const [s] = normalizeTranscript(raw, { start: 100, edited: false });
  assert.ok(Math.abs(s.start - 5.41) < 1e-8);
  assert.equal(s.rawStart, 105.41);
  assert.equal(normalizeTranscript(raw, { start: 100, edited: true })[0].start, 105.41);
  assert.throws(() => normalizeTranscript([{ start: 5, end: 3, text: 'bad' }]));
  assert.equal(timecode(59.9998), '00:01:00.000');
  assert.match(subtitleText([s], 'srt'), /00:00:05,410 --> 00:00:07,430/);
});

test('cross-boundary speech is assigned exactly once, including gaps and revisits', () => {
  const occurrences = [{ slideId: 1, start: 0, end: 10 }, { slideId: 2, start: 10, end: 20 }, { slideId: 1, start: 25, end: 40 }];
  const transcript = [{ id: 1, start: 8, end: 15 }, { id: 2, start: 22, end: 24 }, { id: 3, start: 30, end: 32 }];
  const aligned = alignTranscript(occurrences, transcript);
  assert.deepEqual(aligned.map(o => o.transcriptIds), [[], [1], [2, 3]]);
  assert.deepEqual(aligned.map(o => o.slideId), [1, 2, 1]);
});

test('ignores short transition frames while keeping a stable page and trailing speech interval', () => {
  const result = stableSegments([{ seconds: 0 }, { seconds: 10 }, { seconds: 11 }, { seconds: 30 }], 31, 2);
  assert.deepEqual(result.accepted.map(s => [s.start, s.end]), [[0, 10], [10, 31]]);
  assert.equal(result.accepted[1].stableStart, 11);
});

test('temporal median removes a cursor seen at one position in only one capture', () => {
  assert.deepEqual([...median3(Buffer.from([0, 240, 240]), Buffer.from([240, 0, 240]), Buffer.from([240, 240, 0]))], [240, 240, 240]);
});

test('small cursor changes deduplicate, a changed text region survives', () => {
  const reference = { hash: 0n, grey: Buffer.alloc(57600, 240) };
  const cursor = { hash: 0n, grey: Buffer.from(reference.grey) }; cursor.grey.fill(0, 0, 50);
  const text = { hash: 0n, grey: Buffer.from(reference.grey) }; text.grey.fill(0, 0, 600);
  assert.ok(isDuplicate(reference, cursor));
  assert.ok(!isDuplicate(reference, text));
  assert.throws(() => cropFilter('100,100,1000,1000', { width: 640, height: 480 }));
});

test('HTTP download resumes with a checked byte range', async () => {
  const payload = Buffer.from('0123456789'.repeat(2000)), ranges = [];
  const server = createServer((req, res) => {
    const offset = Number((req.headers.range || '').match(/bytes=(\d+)-/)?.[1] || 0); ranges.push(offset);
    res.writeHead(offset ? 206 : 200, { 'Content-Type': 'video/mp4', 'Content-Length': payload.length - offset, ETag: '"test-v1"',
      ...(offset ? { 'Content-Range': `bytes ${offset}-${payload.length - 1}/${payload.length}` } : {}) });
    res.end(payload.subarray(offset));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const dir = await mkdtemp(join(tempRoot, 'course-archive-test-'));
  try {
    const url = `http://127.0.0.1:${server.address().port}/recording`, target = join(dir, 'recording.mp4');
    await writeFile(target + '.part', payload.subarray(0, 500));
    await writeFile(target + '.part.json', JSON.stringify({ url, total: payload.length, etag: '"test-v1"' }));
    await downloadVideo(url, target);
    assert.deepEqual(await readFile(target), payload);
    assert.deepEqual(ranges, [500]);
  } finally { await new Promise(r => server.close(r)); await rm(dir, { recursive: true, force: true }); }
});

test('HTML masquerading as a download fails without a completed video', async () => {
  const server = createServer((_, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>login</html>'); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const dir = await mkdtemp(join(tempRoot, 'course-archive-test-'));
  try { await assert.rejects(downloadVideo(`http://127.0.0.1:${server.address().port}/video`, join(dir, 'video.mp4'), { attempts: 1 }), /不是视频/); }
  finally { await new Promise(r => server.close(r)); await rm(dir, { recursive: true, force: true }); }
});
