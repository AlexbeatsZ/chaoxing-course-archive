#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdir, open, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discover } from './discover.mjs';
import { inspectWithLogin } from './auth.mjs';
import { saveJson } from './platform.mjs';
import { sendEmail, sendQQ } from './delivery.mjs';
import { loadRemoteState, saveRemoteState, statePassword } from './state.mjs';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
try { process.loadEnvFile(join(root, '.env')); } catch (e) { if (e.code !== 'ENOENT') throw e; }

export function deliveryChannels(value) {
  const mode = value || 'none';
  if (!['none', 'email', 'qq', 'both'].includes(mode)) throw new Error('DELIVERY 需为 none、email、qq 或 both。');
  return mode === 'both' ? ['email', 'qq'] : mode === 'none' ? [] : [mode];
}

export function pendingReplays(replays, state, channels) {
  return replays.filter(r => {
    const done = state.completed?.[String(r.speechId)];
    return !done || (channels.length ? channels.some(c => !done[c]) : !done.built);
  }).sort((a, b) => (String(b.date || '').localeCompare(String(a.date || ''))) || Number(b.speechId) - Number(a.speechId));
}

async function run() {
  if (process.argv.includes('--mail-test')) { await sendEmail([], { test: true }); console.log('测试邮件已交给 SMTP 服务器。'); return; }
  const channels = deliveryChannels(process.env.DELIVERY);
  if (process.env.GITHUB_ACTIONS === 'true' && !channels.length) throw new Error('Actions 请配置 DELIVERY=email；云端不会公开上传课程附件。');
  if (process.env.GITHUB_TOKEN && process.env.GITHUB_REPOSITORY) statePassword();
  if (channels.includes('email') && (!(process.env.SMTP_USERNAME || process.env.SMTP_EMAIL) || !process.env.SMTP_PASSWORD || !(process.env.MAIL_TO || process.env.RECEIVER_EMAIL))) {
    throw new Error('邮箱配置不完整，请先设置 SMTP_EMAIL、SMTP_PASSWORD、RECEIVER_EMAIL 并运行 mail-test。');
  }
  const max = Number(process.env.MAX_LECTURES || 3);
  if (!Number.isInteger(max) || max < 1 || max > 100) throw new Error('MAX_LECTURES 需为 1 到 100 的整数。');
  const work = resolve(root, process.env.COURSE_WORK || 'local-data/jobs');
  const output = resolve(root, process.env.COURSE_OUTPUT || 'local-data/final');
  const ledger = join(root, 'local-data/state/delivery.json'), lock = join(root, 'local-data/run.lock');
  await mkdir(join(root, 'local-data/state'), { recursive: true });
  let handle;
  try { handle = await open(lock, 'wx', 0o600); }
  catch (e) { if (e.code === 'EEXIST') throw new Error('另一轮抓取仍在运行，或上次异常退出留下 local-data/run.lock；确认无运行任务后删除该文件再试。'); throw e; }
  try {
    await handle.writeFile(String(process.pid));
    await loadRemoteState(ledger);
    let state = { completed: {} };
    try { state = JSON.parse(await readFile(ledger, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw new Error('发送状态文件损坏，已停止以避免重复发送。'); }
    let manifest;
    if (process.env.COURSE_REPLAY_URL) {
      const info = await inspectWithLogin(process.env.COURSE_REPLAY_URL);
      manifest = { replays: [{ url: process.env.COURSE_REPLAY_URL, speechId: info.metadata.speechId, date: info.metadata.date }] };
    } else {
      if (!process.env.COURSE_ENTRY_URL) throw new Error('请设置 COURSE_ENTRY_URL 或 COURSE_REPLAY_URL。');
      manifest = await discover(process.env.COURSE_ENTRY_URL, { query: process.env.COURSE_QUERY || '',
        headless: process.env.COURSE_HEADLESS !== 'false', profile: join(root, 'local-data/browser-profile'), onProgress: console.log });
    }
    await saveJson(join(root, 'local-data/catalog.private.json'), manifest);
    const pending = pendingReplays(manifest.replays, state, channels).slice(0, max);
    console.log(`发现 ${manifest.replays.length} 节已发布回放，本轮处理 ${pending.length} 节。`);
    let failures = 0;
    for (const [index, replay] of pending.entries()) {
      const id = String(replay.speechId);
      if (!/^\d+$/.test(id)) throw new Error('回放编号无效。');
      console.log(`开始第 ${index + 1}/${pending.length} 节。`);
      try {
        const dir = join(work, id), out = join(output, id);
        const child = exec(process.execPath, [join(root, 'src/cli.mjs'), 'capture', replay.url, '--work', dir, '--out', out],
          { cwd: root, maxBuffer: 8e6, timeout: 5 * 60 * 60 * 1000, env: process.env });
        child.child.stderr.on('data', chunk => process.stderr.write(chunk));
        const { stdout } = await child;
        const files = JSON.parse(stdout);
        const attachments = [files.pptx, files.docx];
        const done = state.completed[id] ||= {};
        done.built = new Date().toISOString(); await saveJson(ledger, state);
        for (const channel of channels) {
          if (done[channel]) continue;
          if (channel === 'email') await sendEmail(attachments);
          else await sendQQ(attachments, output);
          done[channel] = new Date().toISOString(); await saveJson(ledger, state);
          await saveRemoteState(ledger);
        }
        console.log(`第 ${index + 1} 节完成：${files.pages} 页课件，${files.segments} 段讲解。`);
      } catch (e) {
        failures++;
        // Avoid echoing subprocess command strings containing signed URLs.
        const message = e.stderr ? String(e.stderr).trim().split('\n').at(-1) : e.message;
        console.error(`第 ${index + 1} 节失败：${message}`);
      }
    }
    if (failures) throw new Error(`${failures} 节处理或发送失败，成功记录已保存；重跑会继续未完成项。`);
    console.log('本轮完成。');
  } finally { await handle.close(); await rm(lock, { force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(e => { console.error(e.message); process.exitCode = 1; });
}
