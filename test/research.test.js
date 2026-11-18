import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeConfig } from '../engine.js';
import { researchConfiguration, extractReport } from '../research.js';

const document = { url: 'https://manufacturer.example/manual', title: 'Руководство платформы', scope: 'joint' };
const config = { bom: 'CPU-1\tCPU LGA4677 195W\t2\nGPU-2\tGPU 24GB\t1\nSSD-3\tSSD 960GB U.2 NVMe\t2' };
const options = { apiKey: 'test-only', model: 'test-model', instructions: 'test', signal: new AbortController().signal };

function answer(position, { open = true, search = true } = {}) {
  const output = [];
  if (search) output.push({ type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [document] } });
  if (open) output.push({ type: 'web_search_call', status: 'completed', action: { type: 'open_page', url: document.url } });
  output.push({ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ positions: [{
    id: position.id, status: 'compatible', reason: 'Комбинация подтверждена прочитанной матрицей.', missing: [], recommendation: '',
    checks: position.requiredChecks.map(aspect => ({ aspect, status: 'compatible', reason: 'Установка указанного количества разрешена документом.', sources: [document] })),
  }] }) }] });
  return new Response(JSON.stringify({ status: 'completed', output }));
}

test('performs a separate targeted document search for every equipment row', async () => {
  const local = analyzeConfig(config);
  const ids = [];
  const progress = [];
  const result = await researchConfiguration(local, {
    ...options,
    onProgress: event => progress.push(event),
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body);
      const input = JSON.parse(body.input);
      assert.equal(input.expectedPositions.length, 1);
      assert.equal(input.assemblyPositions.length, 3);
      assert.match(body.instructions, /open_page/);
      ids.push(input.expectedPositions[0].id);
      return answer(input.expectedPositions[0]);
    },
  });
  assert.deepEqual(ids, local.positions.map(position => position.id));
  assert.equal(result.research.length, 3);
  assert.ok(result.positions.every(position => position.status === 'compatible'));
  assert.ok(result.research.every(item => item.searches === 1 && item.openedDocuments === 1));
  assert.equal(progress.filter(event => event.phase === 'reviewed').length, 3);
});

test('search snippets cannot confirm compatibility until the cited document has been opened', async () => {
  const result = await researchConfiguration(analyzeConfig(config), {
    ...options,
    fetchImpl: async (_url, request) => answer(JSON.parse(JSON.parse(request.body).input).expectedPositions[0], { open: false }),
  });
  assert.ok(result.positions.every(position => position.status === 'unconfirmed'));
  assert.ok(result.positions.every(position => position.reason.includes('Поиск по этой позиции выполнен')));
  assert.ok(result.positions.every(position => !position.missing.includes('Не выполнена проверка применимых первичных документов.')));
});

test('does not return the final report before the last row finishes document review', async () => {
  let releaseLast;
  let signalLastStarted;
  const gate = new Promise(resolve => { releaseLast = resolve; });
  const lastStarted = new Promise(resolve => { signalLastStarted = resolve; });
  let complete = false;
  const promise = researchConfiguration(analyzeConfig(config), {
    ...options,
    fetchImpl: async (_url, request) => {
      const position = JSON.parse(JSON.parse(request.body).input).expectedPositions[0];
      if (position.id === 'line-3') {
        signalLastStarted();
        await gate;
      }
      return answer(position);
    },
  }).then(result => { complete = true; return result; });
  await lastStarted;
  assert.equal(complete, false);
  releaseLast();
  assert.equal((await promise).research.length, 3);
});

test('missing search or an API failure prevents publication of a final report', async () => {
  await assert.rejects(researchConfiguration(analyzeConfig(config), {
    ...options,
    fetchImpl: async (_url, request) => answer(JSON.parse(JSON.parse(request.body).input).expectedPositions[0], { search: false }),
  }), /Не выполнен поиск/);
  await assert.rejects(researchConfiguration(analyzeConfig(config), {
    ...options,
    fetchImpl: async () => new Response('private provider response', { status: 401 }),
  }), /Ключ API отклонён/);
});

test('read-source evidence excludes failed page opens and mere search results', () => {
  const result = extractReport({ output: [
    { type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [document] } },
    { type: 'web_search_call', status: 'failed', action: { type: 'open_page', url: document.url } },
  ] });
  assert.equal(result.searched, true);
  assert.equal(result.readSources.length, 0);
});
