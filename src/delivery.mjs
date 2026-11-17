import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve, basename, relative, join, isAbsolute } from 'node:path';

const exec = promisify(execFile);
const mailScript = fileURLToPath(new URL('./mail.py', import.meta.url));

export async function sendEmail(files, { test = false } = {}) {
  const command = process.env.COURSE_DOCX_PYTHON || 'uv';
  const args = command === 'uv' ? ['run', '--locked', 'python', mailScript] : [mailScript];
  await exec(command, [...args, ...(test ? ['--test'] : files)], { maxBuffer: 2e6 });
}

export async function sendQQ(files, outputRoot) {
  if (!process.env.QQ_API_URL || !process.env.QQ_TARGET_USER_ID) throw new Error('QQ 发送需要 QQ_API_URL 和 QQ_TARGET_USER_ID。');
  const base = new URL(process.env.QQ_API_URL);
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('QQ_API_URL 协议无效。');
  const userId = Number(process.env.QQ_TARGET_USER_ID);
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('QQ_TARGET_USER_ID 需填写 QQ 号。');
  for (const path of files) {
    let file = resolve(path);
    if (process.env.QQ_FILE_ROOT) {
      const child = relative(resolve(outputRoot), file);
      if (child.startsWith('..') || isAbsolute(child)) throw new Error('QQ 附件不在输出目录内。');
      file = join(process.env.QQ_FILE_ROOT, child);
    }
    const response = await fetch(new URL('/upload_private_file', base), { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(process.env.QQ_API_TOKEN ? { Authorization: `Bearer ${process.env.QQ_API_TOKEN}` } : {}) },
      body: JSON.stringify({ user_id: userId, file, name: basename(path) }), signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`QQ 附件发送失败 HTTP ${response.status}`);
    const result = await response.json();
    if (result.status !== 'ok' || result.retcode !== 0) throw new Error('QQ 服务未确认文件发送成功。请检查 OneBot 文件路径和权限。');
  }
}
