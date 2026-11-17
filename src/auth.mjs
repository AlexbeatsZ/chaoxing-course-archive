import { createCipheriv } from 'node:crypto';
import { request } from 'playwright-core';

export function encryptLoginField(value) {
  // Matches the current official passport2 login.js encryptByAES function.
  const key = Buffer.from('u2oh6Vu^HWe4_AES', 'utf8');
  const cipher = createCipheriv('aes-128-cbc', key, key);
  return Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]).toString('base64');
}

export async function inspectWithLogin(url) {
  const { inspectReplay } = await import('./platform.mjs');
  if (!process.env.COURSE_ACCOUNT && !process.env.COURSE_PASSWORD) return inspectReplay(url);
  const client = await request.newContext({ userAgent: 'Mozilla/5.0', timeout: 60000 });
  try {
    await loginWithSecrets({ request: client }, { account: process.env.COURSE_ACCOUNT, password: process.env.COURSE_PASSWORD,
      fid: process.env.COURSE_FID || '-1' });
    return await inspectReplay(url, { get: async u => {
      const response = await client.get(String(u));
      if (!response.ok()) throw new Error(`平台请求失败 HTTP ${response.status()}`);
      return response.text();
    } });
  } finally { await client.dispose(); }
}

export async function loginWithSecrets(context, { account, password, fid = '-1' }) {
  if (!account || !password) throw new Error('需要设置 COURSE_ACCOUNT 和 COURSE_PASSWORD。');
  const entry = new URL('https://passport2.chaoxing.com/login');
  entry.search = new URLSearchParams({ fid, newversion: 'true', refer: 'https://i.chaoxing.com' });
  await context.request.get(entry.href);
  const response = await context.request.post('https://passport2.chaoxing.com/fanyalogin', { form: {
    fid, uname: encryptLoginField(account), password: encryptLoginField(password),
    refer: 'https://i.chaoxing.com', t: 'true', forbidotherlogin: '0', validate: '',
    doubleFactorLogin: '0', independentId: '0', independentNameId: '',
  } });
  if (!response.ok()) throw new Error(`超星登录请求失败 HTTP ${response.status()}`);
  let result;
  try { result = await response.json(); } catch { throw new Error('超星登录未返回有效响应。'); }
  if (result.containTwoFactorLogin || result.needVcode || result.needCaptcha) throw new Error('超星要求验证码或二次验证，云端无法无人值守登录。请在 ROG 本地完成一次浏览器登录。');
  if (!result.status) throw new Error('超星登录失败：请检查手机号、密码和机构编号，或在浏览器中确认是否需要验证码。');
  if (result.url) {
    let url = result.url;
    try { url = decodeURIComponent(url); } catch {}
    const destination = new URL(url, entry);
    if (destination.protocol !== 'https:' || !/(^|\.)chaoxing\.com$/.test(destination.hostname)) throw new Error('登录回跳地址异常，已停止。');
    await context.request.get(destination.href);
  }
}
