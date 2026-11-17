import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, pbkdf2Sync } from 'node:crypto';
import { publishedReplays, courseRecordParameters, selectCourses } from '../src/discover.mjs';
import { encryptLoginField, loginWithSecrets } from '../src/auth.mjs';
import { encryptState, decryptState, statePassword, mergeState } from '../src/state.mjs';
import { courseDiscoverySummary, deliveryChannels, pendingReplays } from '../src/run.mjs';
import { safeMessage } from '../src/logging.mjs';
import { readFile } from 'node:fs/promises';
import YAML from 'yaml';

test('discovery includes only playable published records', () => {
  const records = [
    { speechid: 1, status: 3, respublish: 1, pcplayerurl: 'https://example.test/one' },
    { speechid: 2, status: 3, respublish: 0, pcplayerurl: 'https://example.test/two' },
    { speechid: 3, status: 2, respublish: 1, pcplayerurl: 'https://example.test/three' },
    { speechid: 4, status: 3, respublish: 1, isopen: 1, pcplayerurl: 'https://example.test/four' },
  ];
  assert.deepEqual(publishedReplays(records, { id: 20, name: 'Course' }).map(r => r.speechId), [1]);
  const p = courseRecordParameters({ model: { jsgh: 'T', kcbh: 'C', fid: 30 } }, { id: 20, enc: 'signature' }, { xn: '2026', xq: '1' });
  assert.equal(p.jsgh, 'T'); assert.equal(p.fid, '30');
  assert.throws(() => courseRecordParameters({}, { id: 1 }, {}));
});

test('course selection uses platform course IDs, not course-name keywords', () => {
  const courses = [
    { id: 20, name: '物理化学' },
    { id: 30, name: '无机化学' },
  ];
  assert.deepEqual(selectCourses(courses, ['30']).map(c => c.id), [30]);
  assert.deepEqual(selectCourses(courses, []).map(c => c.id), [20, 30]);
  assert.throws(() => selectCourses(courses, ['999']), /不在当前账号可访问/);
});

test('login encryption roundtrips with the official AES parameters', () => {
  const key = Buffer.from('u2oh6Vu^HWe4_AES');
  const cipher = createDecipheriv('aes-128-cbc', key, key);
  const result = Buffer.concat([cipher.update(Buffer.from(encryptLoginField('sample-only'), 'base64')), cipher.final()]).toString();
  assert.equal(result, 'sample-only');
});

test('CAPTCHA/2FA login never becomes false success and credentials are never echoed', async () => {
  const context = { request: { get: async () => ({}), post: async () => ({ ok: () => true,
    json: async () => ({ status: true, containTwoFactorLogin: true }) }) } };
  await assert.rejects(loginWithSecrets(context, { account: 'test-account', password: 'test-password' }), /二次验证/);
});

test('encrypted delivery state uses icourse-compatible Salted__ envelope', () => {
  const value = { completed: { '1': { email: '2026-11-16' } } }, password = statePassword({ COURSE_ACCOUNT: 'test', COURSE_PASSWORD: 'pass' });
  const blob = encryptState(value, password);
  assert.equal(blob.subarray(0, 8).toString(), 'Salted__');
  assert.deepEqual(decryptState(blob, password), value);
  const keyiv = pbkdf2Sync(password, blob.subarray(8, 16), 100000, 48, 'sha256');
  const cipher = createDecipheriv('aes-256-cbc', keyiv.subarray(0, 32), keyiv.subarray(32));
  assert.deepEqual(JSON.parse(Buffer.concat([cipher.update(blob.subarray(16)), cipher.final()]).toString()), value);
  assert.throws(() => decryptState(blob, 'wrong'), /解密失败/);
  assert.deepEqual(mergeState(value, { completed: { '1': { qq: 'later' } } }).completed['1'], { email: '2026-11-16', qq: 'later' });
});

test('incremental delivery continues the unfinished channel and prioritizes recent lectures', () => {
  const replays = [{ speechId: 1, date: '2026-10-01' }, { speechId: 2, date: '2026-11-01' }];
  const state = { completed: { 2: { built: true, email: true } } };
  assert.deepEqual(pendingReplays(replays, state, ['email']).map(r => r.speechId), [1]);
  assert.deepEqual(pendingReplays(replays, state, ['email', 'qq']).map(r => r.speechId), [2, 1]);
  assert.deepEqual(deliveryChannels('both'), ['email', 'qq']);
  assert.throws(() => deliveryChannels('typo'));
});

test('Actions default to course discovery and keep video processing separate', async () => {
  const raw = await readFile(new URL('../.github/workflows/course.yml', import.meta.url), 'utf8');
  const workflow = YAML.parse(raw);
  assert.equal(workflow.on.workflow_dispatch.inputs.operation.default, 'discover');
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.operation.options, ['discover', 'mail-test', 'run']);
  assert.deepEqual(Object.keys(workflow.on.workflow_dispatch.inputs), ['operation', 'max_lectures']);
  assert.match(workflow.jobs.course.if, /vars\.RUN_SCHEDULED == 'true'/);
  const steps = workflow.jobs.course.steps;
  assert.equal(steps.find(s => s.run === 'node src/run.mjs --discover').if, "env.COURSE_OPERATION == 'discover'");
  assert.equal(steps.find(s => s.run === 'node src/run.mjs --mail-test').if, "env.COURSE_OPERATION == 'mail-test'");
  assert.equal(steps.find(s => s.run === 'node src/run.mjs').if, "env.COURSE_OPERATION == 'run'");
  assert.ok(!workflow.jobs.course.steps.some(s => s.uses?.startsWith('actions/upload-artifact')));
  for (const step of workflow.jobs.course.steps.filter(s => s.uses?.startsWith('actions/cache/'))) {
    assert.equal(step.with.path, 'local-data/state/delivery-state.enc');
  }
});

test('course discovery pairs each name with its ID and links to the current fork', () => {
  const summary = courseDiscoverySummary([
    { name: '文学 | 研读', id: '10001' }, { name: '数学\n进阶', id: '10002' },
  ], 'student/course-archive');
  assert.match(summary, /\| 文学 &#124; 研读 \| `10001` \|/);
  assert.match(summary, /\| 数学 进阶 \| `10002` \|/);
  assert.match(summary, /https:\/\/github\.com\/student\/course-archive\/edit\/data\/data\/subscriptions\.json/);
});

test('network logs hide signed URLs and Playwright request dumps', () => {
  const log = 'apiRequestContext.get: timeout for https://school.example/replay?enc=token\nCall log:\n  - cookie: session-secret';
  assert.equal(safeMessage(log), 'apiRequestContext.get: timeout for [链接已隐藏]');
});
