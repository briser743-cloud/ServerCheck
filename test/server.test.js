import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp } from '../server.js';

async function withServer(options,run) {
  const server = createApp(options);
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await run(base); } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
const post = (base,body,headers = {}) => fetch(`${base}/api/analyze`,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});

test('blocked links are removed and temporarily unreachable links are not saved', async t => {
  const dir = await mkdtemp(join(tmpdir(),'servercheck-links-'));
  t.after(() => rm(dir,{recursive:true,force:true}));
  const sourceCatalogPath = pathToFileURL(join(dir,'component-sources.json'));
  let states = {'https://vendor.example/good':'ok','https://vendor.example/blocked':'ok','https://vendor.example/timeout':'unknown'};
  const sku = 'TEST-1234';
  const links = Object.keys(states).map(url => ({url,title:'TEST-1234'}));
  await withServer({sourceCatalogPath,linkChecker:async url => states[url]},async base => {
    const save = async () => (await fetch(`${base}/api/component-sources`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({entries:[{sku,links}]})})).json();
    await save();
    states['https://vendor.example/blocked'] = 'blocked';
    const result = await save();
    assert.deepEqual(result.blocked,['https://vendor.example/blocked']);
    assert.equal(result.unchecked,1);
    const catalog = await (await fetch(`${base}/api/component-sources`)).json();
    assert.deepEqual(catalog.components[sku].links.map(link => link.url),['https://vendor.example/good']);
  });
});

test('catalog editor replaces links, preserves supported facts and rejects stale or blocked edits', async t => {
  const dir = await mkdtemp(join(tmpdir(),'servercheck-editor-'));
  t.after(() => rm(dir,{recursive:true,force:true}));
  const sourceCatalogPath = pathToFileURL(join(dir,'component-sources.json'));
  const sku = 'TEST-1234';
  const first = {url:'https://vendor.example/a',title:'A'}, second = {url:'https://vendor.example/b',title:'B'};
  await withServer({sourceCatalogPath,linkChecker:async url => url.includes('/blocked') ? 'blocked' : 'ok'},async base => {
    await fetch(`${base}/api/component-sources`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({entries:[{sku,links:[first,second],technicalSpecs:[{name:'Socket',value:'SP5',sources:[first,second]}]}]})});
    const catalog = () => fetch(`${base}/api/component-sources`).then(response => response.json());
    const before = (await catalog()).components[sku];
    const edit = body => fetch(`${base}/api/component-sources/edit`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const blocked = await edit({sku,updatedAt:before.updatedAt,links:[first,{url:'https://vendor.example/blocked',title:'Blocked'}]});
    assert.equal(blocked.status,422);
    assert.equal((await catalog()).components[sku].links.length,2);
    const saved = await edit({sku,updatedAt:before.updatedAt,links:[{...first,title:'Corrected'}]});
    assert.equal(saved.status,200);
    const after = (await saved.json()).entry;
    assert.deepEqual(after.links.map(link => link.url),[first.url]);
    assert.deepEqual(after.technicalSpecs[0].sources.map(link => link.url),[first.url]);
    assert.equal(after.technicalSpecs[0].sources[0].title,'Corrected');
    assert.equal((await edit({sku,updatedAt:'stale',links:[]})).status,409);
    assert.deepEqual((await catalog()).components[sku].links.map(link => link.url),[first.url]);
  });
});

test('built-in component links can be edited and do not return after restart', async t => {
  const dir = await mkdtemp(join(tmpdir(),'servercheck-builtins-'));
  t.after(() => rm(dir,{recursive:true,force:true}));
  const sourceCatalogPath = pathToFileURL(join(dir,'component-sources.json'));
  const sku = '05-60004-00';
  await withServer({sourceCatalogPath,linkChecker:async () => 'ok'},async base => {
    const before = (await (await fetch(`${base}/api/component-sources`)).json()).components[sku];
    assert.ok(before.links.length);
    const result = await fetch(`${base}/api/component-sources/edit`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({sku,links:[],updatedAt:before.updatedAt})});
    assert.equal(result.status,200);
  });
  await withServer({sourceCatalogPath},async base => {
    const entry = (await (await fetch(`${base}/api/component-sources`)).json()).components[sku];
    assert.equal(entry.sourcesEdited,true);
    assert.deepEqual(entry.links,[]);
  });
});

test('sourced component facts survive restart and a later links-only save', async t => {
  const dir = await mkdtemp(join(tmpdir(),'servercheck-facts-'));
  t.after(() => rm(dir,{recursive:true,force:true}));
  const sourceCatalogPath = pathToFileURL(join(dir,'component-sources.json'));
  const sku = 'SYNTHETIC-CPU-123';
  const fact = {name:'Socket',value:'LGA test',sources:[{url:'https://manufacturer.example/spec',title:'CPU datasheet'}]};
  const options = {apiKey:'',sourceCatalogPath,linkChecker:async () => 'ok',fetchImpl:async () => assert.fail('Preview must not call an external API')};
  await withServer(options,async base => {
    const response = await fetch(`${base}/api/component-sources`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({entries:[{sku,links:[],technicalSpecs:[fact,{name:'Unsupported',value:'No source',sources:[]}],quantity:4,verdict:'compatible',config:'private BOM'}]})});
    assert.equal(response.status,200);
    assert.equal((await response.json()).saved,1);
  });
  await withServer(options,async base => {
    await fetch(`${base}/api/component-sources`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({entries:[{sku,links:[{url:'https://seller.example/spec',title:'Seller data'}]}]})});
    const data = await (await fetch(`${base}/api/component-sources`)).json();
    const component = data.components[sku];
    assert.equal(component.technicalSpecs.length,1);
    assert.equal(component.technicalSpecs[0].value,'LGA test');
    assert.equal(component.technicalSpecs[0].sources[0].url,fact.sources[0].url);
    assert.ok(!Object.hasOwn(component,'quantity'));
    assert.ok(!Object.hasOwn(component,'verdict'));
    assert.ok(!Object.hasOwn(component,'config'));
  });
});

test('priority resources persist in project order and empty deletion survives restart', async t => {
  const dir = await mkdtemp(join(tmpdir(),'servercheck-priority-'));
  t.after(() => rm(dir,{recursive:true,force:true}));
  const prioritySettingsPath = pathToFileURL(join(dir,'priority-resources.json'));
  const resources = [{manufacturer:'Example',url:'https://example.com'},{manufacturer:'Other',url:'https://other.example'}];
  await withServer({apiKey:'',prioritySettingsPath},async base => {
    assert.equal((await (await fetch(`${base}/api/priority-resources`)).json()).initialized,false);
    const response = await fetch(`${base}/api/priority-resources`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({resources})});
    assert.equal(response.status,200);
  });
  await withServer({apiKey:'',prioritySettingsPath},async base => {
    const settings = await (await fetch(`${base}/api/priority-resources`)).json();
    assert.deepEqual(settings.resources,resources);
    const response = await fetch(`${base}/api/priority-resources`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({resources:[]})});
    assert.equal(response.status,200);
  });
  await withServer({apiKey:'',prioritySettingsPath},async base => {
    const settings = await (await fetch(`${base}/api/priority-resources`)).json();
    assert.equal(settings.initialized,true);
    assert.deepEqual(settings.resources,[]);
  });
});

test('component links persist across server restarts without saving configuration or secrets', async t => {
  const dir = await mkdtemp(join(tmpdir(),'servercheck-sources-'));
  t.after(() => rm(dir,{recursive:true,force:true}));
  const sourceCatalogPath = pathToFileURL(join(dir,'component-sources.json'));
  const entries = [{sku:'TEST-1234',links:[{url:'https://manufacturer.example/manual',title:'Model TEST-1234',modelOnly:false}],privateInput:'must-not-save'}, {sku:'TEST-5678',links:[{url:'https://example.com/?api_key=secret',title:'bad'}]}, {sku:'MODEL:ASUS RS700-E12-RS12U',links:[{url:'https://manufacturer.example/rs700',title:'ASUS RS700-E12-RS12U',modelOnly:false}]}];
  await withServer({apiKey:'',sourceCatalogPath,linkChecker:async () => 'ok'},async base => {
    const response = await fetch(`${base}/api/component-sources`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({entries})});
    assert.equal(response.status,200);
    assert.equal((await response.json()).saved,2);
  });
  await withServer({apiKey:'',sourceCatalogPath},async base => {
    const data = await (await fetch(`${base}/api/component-sources`)).json();
    assert.equal(data.components['TEST-1234'].links[0].url,'https://manufacturer.example/manual');
    assert.equal(data.components['TEST-5678'],undefined);
    assert.equal(data.components['MODEL:ASUS RS700-E12-RS12U'].links[0].modelOnly,true);
  });
  const saved = await readFile(sourceCatalogPath,'utf8');
  assert.doesNotMatch(saved,/must-not-save|secret/);
});

test('chat forwards an attached image to the model', async () => {
  let sent;
  await withServer({provider:'openai',apiKey:'test',tavilyApiKey:'',fetchImpl:async (_url,request) => {
    sent = JSON.parse(request.body);
    return new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Проверено.'}]}]}));
  }}, async base => {
    const response = await fetch(`${base}/api/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'Что на схеме?'}],image:'data:image/png;base64,YWJj'})});
    assert.equal(response.status,200);
    assert.equal(sent.input[0].content[1].type,'input_image');
    assert.equal(sent.input[0].content[1].image_url,'data:image/png;base64,YWJj');
  });
});

test('serves app assets but not environment, source server or git files',async () => {
  await withServer({apiKey:''},async base => {
    const page = await fetch(base);
    assert.equal(page.status,200);
    assert.match(await page.text(),/ServerCheck/);
    assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
    for (const file of ['styles.css','app.js','schema.js','engine.js','bom.js','preflight.js','draft.js','positions.js','report-view.js']) assert.equal((await fetch(`${base}/${file}`)).status,200,file);
    for (const file of ['.env','.git/config','server.js','test/server.test.js','%2e%2e/.env']) assert.equal((await fetch(`${base}/${file}`)).status,404,file);
    const status = await (await fetch(`${base}/api/status`)).json();
    assert.equal(status.aiConfigured, false);
    assert.equal(status.provider, 'openai');
    assert.equal(status.researchReady, false);
    assert.equal((await post(base,{config:{bom:'test'}})).status,503);
  });
});

test('rejects malformed, oversized, empty and cross-origin requests before API call',async () => {
  await withServer({apiKey:'test-only',fetchImpl:() => {throw new Error('must not call');}},async base => {
    assert.equal((await post(base,{config:{cpuCount:-1}})).status,400);
    assert.equal((await post(base,{config:{}})).status,400);
    assert.equal((await post(base,{config:{bom:'test'}},{Origin:'https://other.example'})).status,403);
    assert.equal((await fetch(`${base}/api/analyze`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{bad json'})).status,400);
    assert.equal((await post(base,{config:{bom:'x'.repeat(65000)}})).status,413);
  });
});

test('AI request requires search, keeps key on server and returns citations',async () => {
  let called = false;
  await withServer({apiKey:'test-secret',fetchImpl:async (url,options) => {
    called = true;
    assert.equal(url,'https://api.openai.com/v1/responses');
    assert.equal(options.headers.Authorization,'Bearer test-secret');
    const body = JSON.parse(options.body);
    assert.equal(body.store,false);
    assert.equal(body.tool_choice,'required');
    assert.equal(body.tools[0].type,'web_search');
    assert.equal(body.text.format.type,'json_schema');
    assert.ok(JSON.parse(body.input).configuration.bom);
    assert.equal(JSON.parse(body.input).configuration.boardDdr,'');
    const expected = JSON.parse(body.input).expectedPositions;
    return new Response(JSON.stringify({status:'completed',output:[{type:'web_search_call',status:'completed',action:{type:'search',sources:[{url:'https://www.intel.com/',title:'Intel'}]}},{type:'message',content:[{type:'output_text',text:JSON.stringify({positions:expected.map(item => ({id:item.id,status:'unconfirmed',reason:'Не найден документ точной платформы.',missing:['Нужна ревизия платы и список поддерживаемых CPU.'],checks:[]}))}),annotations:[]}]}]}),{status:200});
  }},async base => {
    const response = await post(base,{config:{bom:'Плата и CPU',boardDdr:'DDR4'}});
    assert.equal(response.status,200);
    const data = await response.json();
    assert.equal(data.mode,'ai');
    assert.equal(data.positions.length,1);
    assert.equal(data.positions[0].status,'unconfirmed');
    assert.equal(data.positionCounts.unconfirmed,1);
    assert.ok(!JSON.stringify(data).includes('test-secret'));
  });
  assert.ok(called);
});

test('provider errors are actionable and do not expose provider response',async () => {
  await withServer({apiKey:'test-only',fetchImpl:async () => new Response('sensitive-provider-details',{status:401})},async base => {
    const response = await post(base,{config:{bom:'Плата'}});
    assert.equal(response.status,502);
    const data = await response.json();
    assert.match(data.error,/Ключ API/);
    assert.ok(!JSON.stringify(data).includes('sensitive'));
  });
});

test('does not label incomplete or unresearched AI output as completed analysis',async () => {
  for (const output of [{status:'incomplete',output:[]},{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Без поиска',annotations:[]}]}]}]) {
    await withServer({apiKey:'test-only',fetchImpl:async () => new Response(JSON.stringify(output))},async base => {
      assert.equal((await post(base,{config:{bom:'Плата'}})).status,502);
    });
  }
});

test('unstructured claims are rejected instead of presented as a verified per-position report',async () => {
  await withServer({apiKey:'test-only',fetchImpl:async () => new Response(JSON.stringify({status:'completed',output:[{type:'web_search_call',status:'completed',action:{type:'search',sources:[]}},{type:'message',content:[{type:'output_text',text:'Всё совместимо',annotations:[]}]}]}))},async base => {
    const response = await post(base,{config:{bom:'Плата'}});
    assert.equal(response.status,502);
    assert.match((await response.json()).error,/структурированный/);
  });
});

test('streams progress and emits final results only after every row has been researched', async () => {
  const checkedIds = [];
  await withServer({ apiKey: 'test-only', fetchImpl: async (_url, request) => {
    const position = JSON.parse(JSON.parse(request.body).input).expectedPositions[0];
    checkedIds.push(position.id);
    return new Response(JSON.stringify({ status: 'completed', output: [
      { type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [] } },
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ positions: [{ id: position.id, status: 'unconfirmed', reason: 'Документ не найден после поиска.', missing: ['Нужно руководство платформы.'], checks: [] }] }) }] },
    ] }));
  } }, async base => {
    const response = await post(base, { config: { bom: 'CPU-1\tCPU LGA4677\t2\nRAM-1\t16GB DDR5 RDIMM\t4' } }, { Accept: 'application/x-ndjson' });
    assert.match(response.headers.get('content-type'), /application\/x-ndjson/);
    const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(events[0].type, 'progress');
    assert.equal(events.filter(event => event.phase === 'reviewed').length, 2);
    assert.equal(events.at(-1).type, 'complete');
    assert.equal(events.at(-1).report.research.length, 2);
    assert.deepEqual(checkedIds, ['line-1', 'line-2']);
    assert.ok(events.at(-1).report.positions.every(position => position.research.searches === 1));
  });
});

test('streaming API failure returns an error event with no completed report', async () => {
  await withServer({ apiKey: 'test-only', fetchImpl: async () => new Response('sensitive details', { status: 401 }) }, async base => {
    const response = await post(base, { config: { bom: 'CPU-1\tCPU LGA4677\t2' } }, { Accept: 'application/x-ndjson' });
    const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(events.at(-1).type, 'error');
    assert.ok(events.every(event => event.type !== 'complete'));
    assert.match(events.at(-1).error, /Ключ API/);
  });
});

test('Provod without a search key explains missing configuration before any model request', async () => {
  await withServer({ apiKey: 'provod-test', provider: 'provod', tavilyApiKey: '', fetchImpl: async () => { throw new Error('must not call'); } }, async base => {
    const status = await (await fetch(`${base}/api/status`)).json();
    assert.equal(status.aiConfigured, true);
    assert.equal(status.provider, 'provod');
    assert.equal(status.researchReady, false);
    assert.match(status.setupMessage, /TAVILY_API_KEY/);
    assert.equal((await post(base, { config: { bom: 'CPU-1\tCPU Xeon\t2' } })).status, 503);
    assert.ok(!JSON.stringify(status).includes('provod-test'));
  });
});

test('connection check validates Provod key, model and returns only RUB billing metadata', async () => {
  const requests = [];
  let configuredModel;
  await withServer({ apiKey: 'provod-test', provider: 'provod', tavilyApiKey: '', fetchImpl: async (url, request) => {
    requests.push(url);
    assert.equal(request.headers.Authorization, 'Bearer provod-test');
    if (url.endsWith('/key')) return new Response(JSON.stringify({ data: { currency: 'RUB', usage: 12.3456, workspace_id: 'private-workspace' } }));
    return new Response(JSON.stringify({ data: [{ id: configuredModel, available: true }] }));
  } }, async base => {
    configuredModel = (await (await fetch(`${base}/api/status`)).json()).model;
    const response = await fetch(`${base}/api/connection`);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.connected, true);
    assert.equal(data.usageRub, 12.3456);
    assert.equal(data.researchReady, false);
    assert.ok(!JSON.stringify(data).includes('private-workspace'));
    assert.ok(!JSON.stringify(data).includes('provod-test'));
  });
  assert.ok(requests.every(url => url.startsWith('https://api.provod.ai/v1/')));
  assert.ok(requests.every(url => !url.includes('/responses')));
});

test('deleted preview source stays excluded across subsequent saves and can be restored deliberately', async t => {
  const dir = await mkdtemp(join(tmpdir(),'servercheck-delete-source-'));
  t.after(() => rm(dir,{recursive:true,force:true}));
  const sourceCatalogPath = pathToFileURL(join(dir,'component-sources.json'));
  const sku = 'TEST-9876', first = {url:'https://vendor.example/a',title:'A'}, second = {url:'https://vendor.example/b',title:'B'};
  await withServer({sourceCatalogPath,linkChecker:async () => 'ok'},async base => {
    const postSources = () => fetch(`${base}/api/component-sources`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({entries:[{sku,links:[first,second],technicalSpecs:[{name:'A fact',value:'x',sources:[first]},{name:'B fact',value:'y',sources:[second]}]}]})});
    const get = async () => (await (await fetch(`${base}/api/component-sources`)).json()).components[sku];
    const edit = body => fetch(`${base}/api/component-sources/edit`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    await postSources(); let entry = await get();
    assert.equal((await edit({sku,links:[second],updatedAt:entry.updatedAt,removedUrl:first.url})).status,200);
    await postSources(); entry = await get();
    assert.deepEqual(entry.links.map(link => link.url),[second.url]);
    assert.deepEqual(entry.technicalSpecs.map(fact => fact.name),['B fact']);
    assert.ok(entry.excludedUrls.includes(first.url));
    assert.equal((await edit({sku,links:[first,second],updatedAt:entry.updatedAt})).status,200);
    entry = await get(); assert.ok(entry.links.some(link => link.url === first.url));
    assert.ok(!entry.excludedUrls.includes(first.url));
  });
});
