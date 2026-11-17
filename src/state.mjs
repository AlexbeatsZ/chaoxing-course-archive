import { createHash, createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { saveJson } from './platform.mjs';

// Compatible port of icourse/src/data/crypto_box.py's ICSv2 envelope. This lets
// the same account/password key convention protect durable delivery receipts.
export function statePassword(env = process.env) {
  if (env.STATE_KEY) return env.STATE_KEY;
  if (!env.COURSE_ACCOUNT || !env.COURSE_PASSWORD) throw new Error('持久发送记录需要 COURSE_ACCOUNT / COURSE_PASSWORD 或独立 STATE_KEY。');
  return createHash('sha256').update(`ICSv2:${env.COURSE_ACCOUNT}:${env.COURSE_PASSWORD}`).digest('hex');
}
export function encryptState(state, password) {
  const salt = randomBytes(8), keyiv = pbkdf2Sync(password, salt, 100000, 48, 'sha256');
  const cipher = createCipheriv('aes-256-cbc', keyiv.subarray(0, 32), keyiv.subarray(32));
  return Buffer.concat([Buffer.from('Salted__'), salt, cipher.update(JSON.stringify(state), 'utf8'), cipher.final()]);
}
export function decryptState(blob, password) {
  if (blob.length < 32 || blob.subarray(0, 8).toString() !== 'Salted__') throw new Error('发送记录加密格式无效。');
  const keyiv = pbkdf2Sync(password, blob.subarray(8, 16), 100000, 48, 'sha256');
  try {
    const cipher = createDecipheriv('aes-256-cbc', keyiv.subarray(0, 32), keyiv.subarray(32));
    const state = JSON.parse(Buffer.concat([cipher.update(blob.subarray(16)), cipher.final()]).toString('utf8'));
    if (!state.completed || Array.isArray(state.completed) || typeof state.completed !== 'object') throw new Error();
    return state;
  } catch { throw new Error('发送记录解密失败。若账号密码已修改，请使用原 STATE_KEY；不要删除状态后直接重跑。'); }
}
export function mergeState(remote, local) {
  const completed = { ...remote.completed };
  for (const [id, entry] of Object.entries(local.completed || {})) completed[id] = { ...completed[id], ...entry };
  return { completed };
}

async function api(path, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/${path}`, {
    ...options, headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json', ...options.headers }, signal: AbortSignal.timeout(60000) });
  if (response.status === 404 && options.allowMissing) return null;
  if (!response.ok) throw new Error(`GitHub 发送记录请求失败 HTTP ${response.status}；未把错误当成首次运行。`);
  return response.status === 204 ? null : response.json();
}
export async function loadRemoteState(path) {
  if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPOSITORY) return;
  const remote = await api('contents/delivery-state.enc?ref=archive-state', { allowMissing: true });
  if (!remote) return;
  const state = decryptState(Buffer.from(remote.content.replace(/\s/g, ''), 'base64'), statePassword());
  let local = { completed: {} };
  try { local = JSON.parse(await readFile(path, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  await saveJson(path, mergeState(state, local));
}
export async function saveRemoteState(path) {
  if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPOSITORY) return;
  const local = JSON.parse(await readFile(path, 'utf8'));
  let branch = await api('git/ref/heads/archive-state', { allowMissing: true });
  if (!branch) {
    const info = await api('');
    const head = await api(`git/ref/heads/${encodeURIComponent(info.default_branch)}`);
    branch = await api('git/refs', { method: 'POST', body: JSON.stringify({ ref: 'refs/heads/archive-state', sha: head.object.sha }) });
  }
  for (let n = 0; n < 3; n++) {
    const remote = await api('contents/delivery-state.enc?ref=archive-state', { allowMissing: true });
    const state = remote ? mergeState(decryptState(Buffer.from(remote.content.replace(/\s/g, ''), 'base64'), statePassword()), local) : local;
    const payload = { message: 'chore(state): update encrypted delivery receipts', branch: 'archive-state',
      content: encryptState(state, statePassword()).toString('base64'), ...(remote ? { sha: remote.sha } : {}) };
    try { await api('contents/delivery-state.enc', { method: 'PUT', body: JSON.stringify(payload) }); return; }
    catch (e) { if (n === 2 || !/HTTP 409/.test(e.message)) throw e; }
  }
}
