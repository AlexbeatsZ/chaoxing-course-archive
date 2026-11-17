#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectReplay, saveJson, downloadVideo } from './platform.mjs';
import { probeVideo, extractSlides } from './media.mjs';
import { writeTranscript, alignTranscript } from './transcript.mjs';
import { prepareAutomatically } from './automatic.mjs';
import { exportFiles } from './export.mjs';
import { inspectWithLogin } from './auth.mjs';
import { safeMessage } from './logging.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  out: { type: 'string' }, work: { type: 'string' }, fps: { type: 'string' }, 'min-stable': { type: 'string' },
  threshold: { type: 'string' }, crop: { type: 'string' }, duration: { type: 'string' }, help: { type: 'boolean' },
  'course-ids': { type: 'string' }, 'list-only': { type: 'boolean' }, headless: { type: 'boolean' }, profile: { type: 'string' },
} });
const [command, source] = positionals;
const log = message => console.error(safeMessage(message));
const extractionOptions = () => ({ fps: values.fps, minStable: values['min-stable'],
  ...(values.threshold === undefined ? {} : { threshold: values.threshold }), crop: values.crop, duration: values.duration, onProgress: log });

async function capture(url, output, workOverride) {
  log('获取平台字幕和录屏信息（不使用语音模型）');
  const result = await inspectWithLogin(url);
  const dir = resolve(workOverride || values.work || join(root, 'local-data', 'jobs', String(result.metadata.speechId)));
  await mkdir(dir, { recursive: true });
  await saveJson(join(dir, 'source.private.json'), result);
  await writeTranscript(dir, result.transcript, result.metadata);
  const ppt = result.metadata.streams.find(v => v.type === 'ppt');
  if (!ppt?.url) throw new Error('该回放没有电脑录屏，已停止。');
  const video = join(dir, 'recording.mp4');
  const existing = await stat(video).catch(() => null);
  if (existing?.size) {
    let record;
    try { record = JSON.parse(await readFile(video + '.json', 'utf8')); } catch {}
    const source = new URL(ppt.url);
    if (!record?.complete || record.bytes !== existing.size || record.source !== source.origin + source.pathname) {
      throw new Error('已有录屏缺少匹配的完成记录，已保留文件并停止。请检查 local-data 对应课节目录。');
    }
    await probeVideo(video); log('复用已完整下载的本地录屏');
  }
  else await downloadVideo(ppt.url, video, { onProgress: p => log(`下载 ${Math.round(p.done / 1048576)} MiB${p.total ? ` / ${Math.round(p.total / 1048576)} MiB` : ''}`) });
  const extracted = await extractSlides(video, dir, extractionOptions());
  extracted.metadata = { course: result.metadata.course, date: result.metadata.date, lesson: result.metadata.lesson, teacher: result.metadata.teacher };
  extracted.occurrences = alignTranscript(extracted.occurrences, result.transcript);
  await saveJson(join(dir, 'timeline.json'), extracted);
  const lesson = await prepareAutomatically(dir);
  log(`自动整理完成：${lesson.pages.length} 页课件，${lesson.transcript.length} 段讲解`);
  const files = await exportFiles(dir, lesson, output);
  console.log(JSON.stringify({ ...files, pages: lesson.pages.length, segments: lesson.transcript.length }, null, 2));
}

async function main() {
  if (values.help || !command) return console.log(`课程归档工具

node src/cli.mjs capture <回放链接> --out <两个最终文件的目录>
node src/cli.mjs discover <平台课程列表链接> [--course-ids id1,id2] [--list-only] --out <清单.json>
node src/cli.mjs batch <清单.json> --out <最终资料目录>
node src/cli.mjs inspect <回放链接>
node src/cli.mjs extract <本地视频> --work <已有字幕目录> --out <最终资料目录>
node src/cli.mjs build <已提取目录> --out <最终资料目录>

首次 discover 在浏览器中正常登录。后续可加 --headless 复用项目独立登录环境。
每节课只输出 PPTX 和 DOCX；缓存、视频、字幕等留在忽略的 local-data/。
处理参数：--fps 1 --min-stable 2 --threshold 0.02 --crop x,y,width,height
默认自动裁切、保守去重、保留难以判断的画面，不调用语音模型或云端 AI。
`);
  if (!source) throw new Error('缺少输入链接或路径。使用 --help 查看用法。');
  const output = resolve(values.out || join(root, 'local-data', 'final'));
  if (command === 'inspect') {
    const result = await inspectWithLogin(source);
    console.log(JSON.stringify({ metadata: { ...result.metadata, streams: result.metadata.streams.map(({ url, objectId, ...s }) => s) },
      segments: result.transcript.length, platformPptImages: result.platformPpt.length, warnings: result.warnings }, null, 2));
  } else if (command === 'capture') await capture(source, output);
  else if (command === 'build') {
    const dir = resolve(source), lesson = await prepareAutomatically(dir);
    console.log(JSON.stringify(await exportFiles(dir, lesson, output), null, 2));
  } else if (command === 'extract') {
    const dir = resolve(values.work || join(root, 'local-data', 'imported'));
    const { metadata, segments } = JSON.parse(await readFile(join(dir, 'transcript.json'), 'utf8'));
    const result = await extractSlides(resolve(source), dir, extractionOptions());
    result.metadata = { course: metadata.course, date: metadata.date, lesson: metadata.lesson, teacher: metadata.teacher };
    result.occurrences = alignTranscript(result.occurrences, segments);
    await saveJson(join(dir, 'timeline.json'), result);
    const lesson = await prepareAutomatically(dir);
    console.log(JSON.stringify(await exportFiles(dir, lesson, output), null, 2));
  } else if (command === 'discover') {
    const { discover } = await import('./discover.mjs');
    const manifest = await discover(source, {
      courseIds: values['course-ids'] ? values['course-ids'].split(',').map(value => value.trim()).filter(Boolean) : [],
      includeReplays: !values['list-only'],
      headless: values.headless,
      profile: values.profile || join(root, 'local-data', 'browser-profile'),
      onProgress: log,
    });
    const target = resolve(values.out || join(root, 'local-data', 'catalog.private.json'));
    await saveJson(target, manifest);
    console.log(JSON.stringify({ file: target, courses: manifest.courses, replays: manifest.replays.length }, null, 2));
  } else if (command === 'batch') {
    const manifest = JSON.parse(await readFile(resolve(source), 'utf8'));
    if (!Array.isArray(manifest.replays)) throw new Error('清单中没有 replays 数组。');
    const failures = [];
    for (const replay of manifest.replays) {
      try { await capture(replay.url, join(output, String(replay.speechId || 'course'))); }
      catch (e) { failures.push({ speechId: replay.speechId, message: e.message }); log(`本节处理失败：${e.message}`); }
    }
    if (failures.length) { await saveJson(join(root, 'local-data', 'batch-errors.json'), failures); throw new Error(`${failures.length} 节课处理失败，已保存失败清单以便续跑。`); }
  } else throw new Error(`未知命令 ${command}`);
}

main().catch(error => { log(error.stderr?.trim().split('\n').at(-1) || error.message); process.exitCode = 1; });
