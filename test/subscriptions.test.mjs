import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCourseIds,
  parseCourseIds,
  parseSubscriptionManifest,
  serializeSubscriptionManifest,
  resolveCourseSelection,
} from '../src/subscriptions.mjs';

test('course IDs are numeric strings, deduplicated, and stable in user order', () => {
  assert.deepEqual(normalizeCourseIds(['40243', 38135, '40243']), ['40243', '38135']);
  assert.deepEqual(parseCourseIds('40243, 38135,40243'), ['40243', '38135']);
  assert.deepEqual(parseCourseIds(''), []);
  assert.throws(() => normalizeCourseIds(['course-1']), /数字字符串/);
  assert.throws(() => normalizeCourseIds('40243'), /数组/);
});

test('subscription manifest has a single course_ids source of truth', () => {
  const raw = serializeSubscriptionManifest(['40243', '38135']);
  assert.deepEqual(JSON.parse(raw), { course_ids: ['40243', '38135'] });
  assert.deepEqual(parseSubscriptionManifest(raw), ['40243', '38135']);
  assert.throws(() => parseSubscriptionManifest('{"ids":[]}'), /course_ids/);
  assert.throws(() => parseSubscriptionManifest('{'), /有效 JSON/);
});

test('local persistent selection and one-off selection remain separate', async () => {
  const env = { COURSE_IDS: '100,200' };
  const persistent = await resolveCourseSelection({ mode: 'run', env });
  assert.deepEqual(persistent.courseIds, ['100', '200']);
  assert.equal(persistent.oneOff, false);

  const single = await resolveCourseSelection({
    mode: 'single',
    inputIds: '300,400',
    env,
  });
  assert.deepEqual(single.courseIds, ['300', '400']);
  assert.deepEqual(single.subscriptionIds, ['100', '200']);
  assert.equal(single.oneOff, true);
});
