import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { extractSlides } from '../src/media.mjs';
import { saveJson } from '../src/platform.mjs';
import { writeTranscript } from '../src/transcript.mjs';
import { prepareAutomatically } from '../src/automatic.mjs';
import { exportFiles } from '../src/export.mjs';

const exec = promisify(execFile);
const tempRoot = process.platform === 'win32' ? join(process.env.LOCALAPPDATA, 'Temp', '.agents') : '/tmp/.agents';
await mkdir(tempRoot, { recursive: true });
const directory = await mkdtemp(join(tempRoot, 'course-smoke-'));
try {
  const width = 640, height = 360;
  const a = await sharp(Buffer.from('<svg width="640" height="360"><rect width="640" height="360" fill="#fafafa"/><text x="60" y="100" font-size="44" fill="#263d63">Slide A</text><rect x="80" y="140" width="340" height="100" fill="#416aa0"/></svg>')).removeAlpha().raw().toBuffer();
  const b = await sharp(Buffer.from('<svg width="640" height="360"><rect width="640" height="360" fill="#fafafa"/><text x="60" y="100" font-size="44" fill="#682626">Slide B</text><rect x="180" y="150" width="300" height="140" fill="#a04343"/></svg>')).removeAlpha().raw().toBuffer();
  const frames = [];
  for (let i = 0; i < 15; i++) {
    const f = Buffer.from(i >= 5 && i < 10 ? b : a);
    const x = 40 + i * 27, y = 300;
    for (let yy = y; yy < y + 6; yy++) for (let xx = x; xx < x + 6; xx++) f.fill(0, (yy * width + xx) * 3, (yy * width + xx) * 3 + 3);
    frames.push(f);
  }
  await writeFile(join(directory, 'frames.rgb'), Buffer.concat(frames));
  await exec('ffmpeg', ['-v', 'error', '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', `${width}x${height}`,
    '-framerate', '1', '-i', join(directory, 'frames.rgb'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(directory, 'recording.mp4')]);
  const result = await extractSlides(join(directory, 'recording.mp4'), directory, { threshold: 0.02 });
  result.metadata = { course: '自动化测试', date: '2026-11-16', lesson: '1', teacher: '测试' };
  await saveJson(join(directory, 'timeline.json'), result);
  const segments = [{ id: 1, start: 1.1, end: 4.2, text: '第一张课件的讲解。' },
    { id: 2, start: 6.1, end: 9.2, text: '第二张课件的讲解。' }, { id: 3, start: 11.1, end: 14.2, text: '再次讲解第一张课件。' }];
  await writeTranscript(directory, segments, result.metadata);
  const lesson = await prepareAutomatically(directory);
  assert.equal(lesson.pages.length, 2, 'moving cursors must not create extra pages');
  assert.deepEqual(lesson.occurrences.map(o => o.slideId), [1, 2, 1], 'A-B-A revisits must survive deduplication');
  const files = await exportFiles(directory, lesson, join(directory, 'final'));
  const check = `import sys,zipfile,xml.etree.ElementTree as E\nfrom docx import Document\npptx,docx=sys.argv[1:]\nz=zipfile.ZipFile(pptx)\nassert len([n for n in z.namelist() if n.startswith('ppt/slides/slide') and n.endswith('.xml')])==2\nd=Document(docx)\nt=''.join(p.text for p in d.paragraphs)\nassert all(t.count(x)==1 for x in ['第一张课件的讲解。','第二张课件的讲解。','再次讲解第一张课件。'])\nassert len(d.inline_shapes)==2\nassert len(list(z.namelist()))>0\nprint('Portable PPTX + DOCX smoke passed')`;
  const python = process.env.COURSE_DOCX_PYTHON;
  const args = python ? ['-c', check, files.pptx, files.docx] : ['run', '--locked', 'python', '-c', check, files.pptx, files.docx];
  const { stdout } = await exec(python || 'uv', args);
  console.log(stdout.trim());
} finally { await rm(directory, { recursive: true, force: true }); }
