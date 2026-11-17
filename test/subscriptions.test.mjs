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

test('local archive uses the saved subscriptions and discovery can list before setup', async () => {
  const env = { COURSE_IDS: '100,200' };
  assert.deepEqual(await resolveCourseSelection({ env }), ['100', '200']);
  assert.deepEqual(await resolveCourseSelection({ initialize: true, env: {} }), []);
});

test('course discovery initializes an empty manifest once and hosted archive only reads it', async t => {
  const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'student/archive', GITHUB_TOKEN: 'fixture', COURSE_IDS: '999' };
  let branch = false, manifest, manifestWrites = 0;
  t.mock.method(globalThis, 'fetch', async (url, { method = 'GET', body }) => {
    const { pathname, searchParams } = new URL(url);
    const reply = (value, status = 200) => Response.json(value, { status });
    if (pathname === '/repos/student/archive') return reply({ default_branch: 'main' });
    if (pathname.endsWith('/git/ref/heads/main')) return reply({ object: { sha: 'fixture-base' } });
    if (pathname.endsWith('/git/ref/heads/data')) return branch ? reply({}) : reply({}, 404);
    if (pathname.endsWith('/git/refs') && method === 'POST') {
      assert.equal(JSON.parse(body).ref, 'refs/heads/data');
      branch = true;
      return reply({}, 201);
    }
    assert.equal(pathname, '/repos/student/archive/contents/data/subscriptions.json');
    if (method === 'PUT') {
      const request = JSON.parse(body);
      assert.equal(request.branch, 'data');
      assert.deepEqual(parseSubscriptionManifest(Buffer.from(request.content, 'base64').toString()), []);
      manifest = request.content;
      manifestWrites++;
      return reply({}, 201);
    }
    assert.equal(searchParams.get('ref'), 'data');
    return manifest ? reply({ encoding: 'base64', content: manifest }) : reply({}, 404);
  });

  await assert.rejects(resolveCourseSelection({ env }), /先运行 discover/);
  assert.equal(branch, false);
  assert.deepEqual(await resolveCourseSelection({ initialize: true, env }), []);
  manifest = Buffer.from('{"course_ids":["10001"]}').toString('base64');
  assert.deepEqual(await resolveCourseSelection({ initialize: true, env }), ['10001']);
  assert.deepEqual(await resolveCourseSelection({ env }), ['10001']);
  assert.equal(manifestWrites, 1);
});
