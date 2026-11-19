import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCachedProvodFetch } from '../provod-cache.js';

test('successful identical search is reused after a day', async t => {
  const root = resolve('.tmp');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(resolve(root, 'search-cache-test-'));
  t.after(() => rm(directory, { recursive:true, force:true }));
  let clock = 1000;
  let calls = 0;
  const cached = createCachedProvodFetch(async () => { calls++; return new Response(JSON.stringify({results:[{url:'https://example.com/model'}]})); }, pathToFileURL(directory + sep), () => clock);
  const request = {method:'POST',headers:{Authorization:'Bearer test'},body:'{"query":"example model"}'};
  await cached('https://api.tavily.com/search',request);
  clock += 86400001;
  assert.equal((await cached('https://api.tavily.com/search',request)).headers.get('x-servercheck-cache'),'hit');
  assert.equal(calls,1);
});

test('Provod cache reuses exact successful requests, expires and isolates credentials and payloads', async t => {
  const root = resolve('.tmp');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(resolve(root, 'provod-cache-test-'));
  assert.ok(directory.startsWith(root + sep));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let calls = 0;
  let clock = 1000;
  let status = 200;
  let valid = true;
  const fetch = createCachedProvodFetch(async () => {
    calls++;
    return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ positions: [{ id: valid ? 'line-1' : 'wrong' }] }) }] }] }), { status });
  }, pathToFileURL(directory + sep), () => clock);
  const request = { method: 'POST', headers: { Authorization: 'Bearer private-key' }, body: JSON.stringify({ input: JSON.stringify({ expectedPositions: [{ id: 'line-1' }] }) }) };
  const url = 'https://api.provod.ai/v1/responses';
  await fetch(url, request);
  assert.equal((await fetch(url, request)).headers.get('x-servercheck-cache'), 'hit');
  assert.equal(calls, 1);
  clock += 86400001;
  await fetch(url, request);
  assert.equal(calls, 2);
  await fetch(url, { ...request, headers: { Authorization: 'Bearer second-key' } });
  assert.equal(calls, 3);
  await fetch(url, { ...request, body: request.body + ' ' });
  assert.equal(calls, 4);
  status = 503;
  const failed = { ...request, body: request.body + '  ' };
  await fetch(url, failed);
  await fetch(url, failed);
  assert.equal(calls, 6);
  status = 200;
  valid = false;
  const malformed = { ...request, body: request.body + '   ' };
  await fetch(url, malformed);
  await fetch(url, malformed);
  assert.equal(calls, 8);
  status = 200;
  const searchFetch = createCachedProvodFetch(async () => {
    calls++;
    return new Response(JSON.stringify({ results: [{ url: 'https://manufacturer.example/manual', raw_content: 'Specifications' }] }));
  }, pathToFileURL(directory + sep), () => clock);
  for (const endpoint of ['search', 'extract']) {
    const url = `https://api.tavily.com/${endpoint}`;
    await searchFetch(url, request);
    assert.equal((await searchFetch(url, request)).headers.get('x-servercheck-cache'), 'hit');
  }
  assert.equal(calls, 10);
  for (const file of await readdir(directory)) {
    assert.ok(!(await readFile(resolve(directory, file), 'utf8')).includes('private-key'));
  }
});
