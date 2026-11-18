import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeConfig } from '../engine.js';
import { researchConfiguration } from '../research.js';
import { documentMatchesPosition, researchWithProvod } from '../provod.js';

test('document relevance requires the specific SKU or matching brand and model', () => {
  const platform = { sku: 'PLATFORM-TEST', description: 'Server platform PLATFORM-TEST' };
  for (const title of ['Altura 60-inch ceiling fan', 'Platform Lift A4 Maintenance', 'Vandor Corporation product catalog', 'Altura outdoor shower', 'Sensata P4000 pressure sensor']) {
    assert.equal(documentMatchesPosition({ title }, platform), false);
  }
  assert.equal(documentMatchesPosition({ title: 'VANDOR Altura technical manual' }, platform), true);
  assert.equal(documentMatchesPosition({ title: 'PLATFORM-TEST specifications' }, platform), true);
  const cpu = { sku: 'CPU-NEW', description: 'CPU Intel Xeon Gold 6526Y (16C)' };
  assert.equal(documentMatchesPosition({ title: 'Intel Xeon Gold 6526Y specifications' }, cpu), true);
  assert.equal(documentMatchesPosition({ title: 'Intel Xeon Gold 6530 specifications' }, cpu), false);
});

test('503 preserves public model error and affected SKU without retrying inference', async () => {
  const local = analyzeConfig({ bom: 'GPU-1\tGPU 24GB\t1' });
  let calls = 0;
  await assert.rejects(researchWithProvod(local.positions[0], local, {
    apiKey: 'secret-key', model: 'test',
    collectedDocuments: { documents: [{ url: 'https://manufacturer.example/gpu', title: 'GPU-1', text: 'GPU-1 documentation' }], research: {} },
    fetchImpl: async () => {
      calls++;
      return new Response(JSON.stringify({ error: { code: 'MODEL_NOT_AVAILABLE', message: 'Model temporarily unavailable secret-key' } }), { status: 503 });
    },
  }), error => {
    assert.match(error.message, /HTTP 503, MODEL_NOT_AVAILABLE/);
    assert.match(error.message, /GPU-1/);
    assert.match(error.message, /Model temporarily unavailable/);
    assert.ok(!error.message.includes('secret-key'));
    return true;
  });
  assert.equal(calls, 1);
});

test('context budget reserves room for other assembly components', async () => {
  const local = analyzeConfig({ bom: 'GPU-1\tGPU 24GB\t1\nRAM-1\tDDR5 RDIMM 16GB\t4' });
  const documents = Array.from({ length: 20 }, (_, index) => ({ url: `https://manufacturer.example/gpu-${index}`, title: 'GPU-1 specifications', positionIds: [local.positions[0].id], text: 'x'.repeat(18000) }));
  const memory = { url: 'https://manufacturer.example/memory', title: 'RAM-1 specifications', positionIds: [local.positions[1].id], text: 'RAM-1 specifications' };
  await researchWithProvod(local.positions[0], local, {
    apiKey: 'test', model: 'test', collectedDocuments: { documents, research: {} }, sharedDocuments: [memory],
    fetchImpl: async (_, request) => {
      const input = JSON.parse(JSON.parse(request.body).input);
      assert.ok(input.documents.some(document => document.url === memory.url));
      assert.ok(input.documents.reduce((sum, document) => sum + document.text.length, 0) <= 180000);
      return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"positions":[]}' }] }] }));
    },
  });
});

test('Provod 403 reports the public access code and distinguishes first top-up', async () => {
  const local = analyzeConfig({ bom: 'GPU-1\tGPU 24GB\t1' });
  for (const code of ['FIRST_TOP_UP_REQUIRED', 'FORBIDDEN', null]) {
    await assert.rejects(researchWithProvod(local.positions[0], local, {
      tavilyApiKey: 'test', apiKey: 'test', model: 'test',
      fetchImpl: async url => {
        if (url.endsWith('/search')) return new Response(JSON.stringify({ results: [{ url: 'https://manufacturer.example/manual' }] }));
        if (url.endsWith('/extract')) return new Response(JSON.stringify({ results: [{ url: 'https://manufacturer.example/manual', raw_content: 'GPU-1 SSD-1 manual' }] }));
        return new Response(JSON.stringify({ error: { code, message: 'Provider explanation with secret test' } }), { status: 403 });
      },
    }), error => {
      assert.match(error.message, /HTTP 403/);
      assert.ok(!error.message.includes('временно недоступен'));
      assert.equal(error.message.includes('первое реальное пополнение'), code === 'FIRST_TOP_UP_REQUIRED');
      if (code) assert.ok(error.message.includes(code));
      if (code !== 'FIRST_TOP_UP_REQUIRED') {
        assert.ok(error.message.includes('Provider explanation'));
        assert.ok(error.message.includes('[скрыто]'));
        assert.ok(!error.message.includes('secret test'));
      }
      return true;
    });
  }
});

test('Provod pipeline reads documents through Tavily before sending their text to the model', async () => {
  const local = analyzeConfig({ bom: 'GPU-1\tGPU 24GB\t1' });
  const requests = [];
  const url = 'https://manufacturer.example/support';
  const result = await researchConfiguration(local, {
    provider: 'provod', apiKey: 'provod-test', tavilyApiKey: 'search-test', model: 'openai/gpt-5.4', instructions: 'test',
    fetchImpl: async (endpoint, request) => {
      requests.push(endpoint);
      const body = JSON.parse(request.body);
      if (endpoint === 'https://api.tavily.com/search') {
        assert.equal(request.headers.Authorization, 'Bearer search-test');
        assert.ok(body.query.includes('GPU-1') || body.query.includes('GPU 24GB'));
        return new Response(JSON.stringify({ results: [{ url, title: 'Support matrix' }] }));
      }
      if (endpoint === 'https://api.tavily.com/extract') {
        assert.deepEqual(body.urls, [url]);
        return new Response(JSON.stringify({ results: [{ url, raw_content: 'Manufacturer support matrix: GPU-1 is supported.' }] }));
      }
      assert.equal(endpoint, 'https://api.provod.ai/v1/responses');
      assert.equal(request.headers.Authorization, 'Bearer provod-test');
      assert.equal(body.tools, undefined);
      assert.equal(body.include, undefined);
      assert.equal(body.text.format.schema.properties.positions.minItems, 1);
      assert.equal(body.text.format.schema.properties.positions.maxItems, 1);
      const input = JSON.parse(body.input);
      assert.match(input.documents[0].text, /Manufacturer support matrix/);
      const position = input.expectedPositions[0];
      return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ positions: [{
        id: position.id, status: 'compatible', reason: 'Supported by manufacturer.', missing: [], recommendation: '',
        checks: position.requiredChecks.map(aspect => ({ aspect, status: 'compatible', reason: 'Supported in matrix.', sources: [{ url, title: 'Support matrix', scope: 'joint' }] })),
      }] }) }] }] }));
    },
  });
  assert.equal(result.positions[0].status, 'compatible');
  assert.equal(result.positions[0].research.openedDocuments, 1);
  assert.equal(requests.at(-1), 'https://api.provod.ai/v1/responses');
});

test('ambiguous model positions remain unconfirmed while all assembly rows are researched', async () => {
  const local = analyzeConfig({ bom: 'GPU-1\tGPU 24GB\t1\nSSD-1\tSSD NVMe 960GB\t2' });
  for (const reply of [null, { positions: [] }, { positions: [{ id: 'wrong' }] }, { positions: [{ id: 'line-1' }, { id: 'line-2' }] }]) {
    let modelCalls = 0;
    const result = await researchConfiguration(local, {
      provider: 'provod', apiKey: 'test', tavilyApiKey: 'test', model: 'test',
      fetchImpl: async url => {
        if (url.endsWith('/search')) return new Response(JSON.stringify({ results: [{ url: 'https://manufacturer.example/manual' }] }));
        if (url.endsWith('/extract')) return new Response(JSON.stringify({ results: [{ url: 'https://manufacturer.example/manual', raw_content: 'GPU-1 SSD-1 manual' }] }));
        modelCalls++;
        return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(reply) }] }] }));
      },
    });
    assert.equal(modelCalls, 2);
    assert.equal(result.positions.length, 2);
    for (const position of result.positions) {
      assert.equal(position.status, 'unconfirmed');
      assert.equal(position.research.openedDocuments, 1);
      assert.match(position.reason, /ответ модели/);
      assert.deepEqual(position.checks, []);
    }
  }
});

test('failed extraction keeps a position unconfirmed and avoids an unsupported model conclusion', async () => {
  let modelCalled = false;
  const result = await researchConfiguration(analyzeConfig({ bom: 'SSD-1\tSSD NVMe 960GB\t2' }), {
    provider: 'provod', apiKey: 'provod-test', tavilyApiKey: 'search-test', model: 'openai/gpt-5.4', instructions: 'test',
    fetchImpl: async endpoint => {
      if (endpoint.endsWith('/search')) return new Response(JSON.stringify({ results: [{ url: 'https://manufacturer.example/manual', title: 'Manual' }] }));
      if (endpoint.endsWith('/extract')) return new Response(JSON.stringify({ results: [], failed_results: [{ url: 'https://manufacturer.example/manual' }] }));
      modelCalled = true;
      throw new Error('must not call');
    },
  });
  assert.equal(modelCalled, false);
  assert.equal(result.positions[0].status, 'unconfirmed');
  assert.equal(result.positions[0].research.openedDocuments, 0);
});

test('all component documents are collected before analysis and shared across positions', async () => {
  const local = analyzeConfig({ bom: 'CPU-1\tIntel Xeon CPU LGA4677\t2\nRAM-1\tDDR5 RDIMM 16GB\t4' });
  const extracted = new Set();
  let modelCalls = 0;
  const result = await researchConfiguration(local, {
    provider: 'provod', apiKey: 'test', tavilyApiKey: 'test', model: 'test',
    fetchImpl: async (url, request) => {
      const body = JSON.parse(request.body);
      if (url.endsWith('/search')) {
        const document = /CPU|Xeon/.test(body.query) ? 'cpu' : 'memory';
        return new Response(JSON.stringify({ results: [{ url: `https://manufacturer.example/${document}`, title: document }] }));
      }
      if (url.endsWith('/extract')) {
        for (const document of body.urls) extracted.add(document);
        return new Response(JSON.stringify({ results: body.urls.map(url => ({ url, raw_content: url.endsWith('/cpu') ? 'CPU-1 manufacturer specifications' : 'RAM-1 manufacturer specifications' })) }));
      }
      modelCalls++;
      assert.equal(extracted.size, 2);
      const input = JSON.parse(body.input);
      assert.equal(input.documents.length, 2);
      assert.ok(input.documents.some(document => document.url.endsWith('/cpu')));
      assert.ok(input.documents.some(document => document.url.endsWith('/memory')));
      assert.match(body.instructions, /Отсутствие PCIe 5.0/);
      return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ positions: [{
        id: input.expectedPositions[0].id, status: 'unconfirmed', reason: 'Platform documentation missing.', checks: [], missing: ['Platform documentation'], recommendation: '',
      }] }) }] }] }));
    },
  });
  assert.equal(modelCalls, 2);
  assert.ok(result.positions.every(position => position.research.sharedDocuments === 2 && position.readSources.length === 2));
});
