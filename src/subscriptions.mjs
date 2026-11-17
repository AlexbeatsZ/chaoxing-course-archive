import { Buffer } from 'node:buffer';

const DATA_BRANCH = 'data';
const MANIFEST_PATH = 'data/subscriptions.json';

export function normalizeCourseIds(values) {
  if (!Array.isArray(values)) throw new Error('subscriptions.json: course_ids 必须是数组。');
  const result = [];
  for (const item of values) {
    const value = String(item).trim();
    if (!/^\d+$/.test(value)) throw new Error('课程 ID 必须是数字字符串。');
    if (!result.includes(value)) result.push(value);
  }
  return result;
}

export function parseCourseIds(value) {
  if (value == null || !String(value).trim()) return [];
  return normalizeCourseIds(String(value).split(',').map(item => item.trim()).filter(Boolean));
}

export function parseSubscriptionManifest(raw) {
  let data;
  try { data = JSON.parse(raw); }
  catch { throw new Error('data/subscriptions.json 不是有效 JSON。'); }
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.course_ids)) {
    throw new Error('data/subscriptions.json 必须包含 course_ids 数组。');
  }
  return normalizeCourseIds(data.course_ids);
}

export function serializeSubscriptionManifest(courseIds) {
  return JSON.stringify({ course_ids: normalizeCourseIds(courseIds) }, null, 2) + '\n';
}

function apiFor(repository, token) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '')) throw new Error('GITHUB_REPOSITORY 无效。');
  if (!token) throw new Error('缺少 GITHUB_TOKEN，无法读取个人订阅分支。');
  return async function api(path, options = {}) {
    const response = await fetch('https://api.github.com/repos/' + repository + (path ? '/' + path : ''), {
      ...options,
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...options.headers,
      },
      signal: AbortSignal.timeout(60000),
    });
    if (response.status === 404 && options.allowMissing) return null;
    if (!response.ok) {
      throw new Error('GitHub 订阅配置请求失败 HTTP ' + response.status + '。');
    }
    return response.status === 204 ? null : response.json();
  };
}

async function ensureDataBranch(api) {
  const current = await api('git/ref/heads/' + DATA_BRANCH, { allowMissing: true });
  if (current) return;

  const repository = await api('');
  const base = await api('git/ref/heads/' + encodeURIComponent(repository.default_branch));
  try {
    await api('git/refs', {
      method: 'POST',
      body: JSON.stringify({ ref: 'refs/heads/' + DATA_BRANCH, sha: base.object.sha }),
    });
  } catch (error) {
    // A simultaneous first run may have created the branch already.
    const raced = await api('git/ref/heads/' + DATA_BRANCH, { allowMissing: true });
    if (!raced) throw error;
  }
}

async function writeInitialManifest(api, courseIds) {
  const content = Buffer.from(serializeSubscriptionManifest(courseIds), 'utf8').toString('base64');
  try {
    await api('contents/' + MANIFEST_PATH, {
      method: 'PUT',
      body: JSON.stringify({
        message: 'chore(subscriptions): initialize course list',
        branch: DATA_BRANCH,
        content,
      }),
    });
  } catch (error) {
    // If two first runs race, accept the manifest written by the other run.
    if (!/HTTP 409|HTTP 422/.test(error.message)) throw error;
    const raced = await api('contents/' + MANIFEST_PATH + '?ref=' + DATA_BRANCH, { allowMissing: true });
    if (!raced) throw error;
    return parseSubscriptionManifest(Buffer.from(raced.content.replace(/\s/g, ''), 'base64').toString('utf8'));
  }
  return normalizeCourseIds(courseIds);
}

/**
 * Resolve persistent subscriptions from each user's own data branch.
 * Single-run selection is temporary once a manifest already exists.
 * On the first single run, supplied IDs bootstrap the manifest, matching
 * the established subscription workflow.
 */
export async function resolveCourseSelection({ mode = 'run', inputIds = '', env = process.env } = {}) {
  if (!['discover', 'run', 'single'].includes(mode)) throw new Error('未知课程选择模式：' + mode);
  const explicit = parseCourseIds(inputIds);

  if (env.GITHUB_REPOSITORY && env.GITHUB_TOKEN) {
    const api = apiFor(env.GITHUB_REPOSITORY, env.GITHUB_TOKEN);
    await ensureDataBranch(api);
    const manifest = await api('contents/' + MANIFEST_PATH + '?ref=' + DATA_BRANCH, { allowMissing: true });

    if (!manifest) {
      const initialIds = mode === 'single' ? explicit : [];
      const saved = await writeInitialManifest(api, initialIds);
      return { courseIds: saved, subscriptionIds: saved, initialized: true, oneOff: false, source: 'data branch' };
    }

    if (manifest.encoding !== 'base64' || typeof manifest.content !== 'string') {
      throw new Error('data/subscriptions.json 返回了不支持的 GitHub 内容格式。');
    }
    const saved = parseSubscriptionManifest(Buffer.from(manifest.content.replace(/\s/g, ''), 'base64').toString('utf8'));
    if (mode === 'single' && explicit.length) {
      return { courseIds: explicit, subscriptionIds: saved, initialized: false, oneOff: true, source: 'single run' };
    }
    return { courseIds: saved, subscriptionIds: saved, initialized: false, oneOff: false, source: 'data branch' };
  }

  // Local/ROG fallback. GitHub Actions always uses data/subscriptions.json.
  const saved = parseCourseIds(env.COURSE_IDS || '');
  if (mode === 'single' && explicit.length) {
    return { courseIds: explicit, subscriptionIds: saved, initialized: false, oneOff: true, source: 'local input' };
  }
  return { courseIds: saved, subscriptionIds: saved, initialized: false, oneOff: false, source: 'local COURSE_IDS' };
}
