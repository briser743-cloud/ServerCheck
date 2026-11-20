import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { analyzeConfig } from '../engine.js';
import { validateConfig } from '../schema.js';
import { previewSourceLinks, setSourcePriorities, sortSourcesByPriority, omitRepeatedReferences, safeUrl } from '../report-view.js';
import { isUsableProductSource } from '../bom.js';
import { cleanComponentFacts } from '../component-knowledge.js';

test('saved product facts and their sources render before any report or button press', async () => {
  const app = await readFile(new URL('../app.js',import.meta.url),'utf8');
  const fact = {name:'Socket',value:'LGA test',sources:[{url:'https://manufacturer.example/spec',title:'CPU datasheet'}]};
  const item = {line:1,sku:'SYNTHETIC-CPU-123',description:'Synthetic processor'};
  const context = {
    localStorage:{getItem:key => key === 'servercheck.productFacts.v1' ? JSON.stringify({[item.sku]:[fact]}) : null},
    cleanComponentFacts,isUsableProductSource,modelSourceKey:() => '',
    currentReport:null,isStale:() => false,lookupKnownComponent:() => null,loadProductLinkCache:() => ({}),
    sourceMatchesModel:() => false,sortSourcesByPriority,omitRepeatedReferences,safeUrl,previewSourceLinks,
    escapeHtml:value => String(value),fetch:() => assert.fail('No network calls while rendering saved facts'),
  };
  vm.createContext(context);
  const helpers = app.slice(app.indexOf("const productFactsCacheKey ="),app.indexOf('function loadProductLinkCache()'));
  const product = app.slice(app.indexOf('function productSourceMarkup('),app.indexOf('\nfunction previewKind('));
  const facts = app.slice(app.indexOf('function previewResearchFacts('),app.indexOf('\nfunction inventoryHtml('));
  vm.runInContext(helpers + '\n' + product + '\n' + facts,context);
  assert.ok(context.savedComponentSummary(item).includes('Socket: LGA test'));
  assert.ok(context.productSourceMarkup(item).includes('https://manufacturer.example/spec'));
  assert.ok(context.previewResearchFacts(item).includes('LGA test'));
  assert.equal(context.savedComponentSummary({...item,sku:'OTHER-CPU'}),'');
});

test('preview exposes one source and preserves every other source in a closed disclosure', () => {
  const markup = previewSourceLinks([
    {url:'https://manufacturer.example/manual',title:'Priority manual'},
    {url:'https://distributor.example/spec',title:'Alternative <spec>'},
    {url:'https://retailer.example/item',title:'Catalog'},
    {url:'https://manufacturer.example/manual#section',title:'Duplicate'},
    {url:'javascript:alert(1)',title:'Unsafe'},
  ]);
  assert.equal((markup.split('<details')[0].match(/href=/g) || []).length,1);
  assert.equal((markup.match(/href=/g) || []).length,3);
  assert.match(markup,/Другие источники \(2\)/);
  assert.ok(!/<details[^>]*\sopen(?:\s|>)/.test(markup));
  assert.ok(markup.includes('Alternative &lt;spec&gt;'));
  assert.ok(!markup.includes('javascript:'));
  assert.ok(!previewSourceLinks([{url:'https://example.com',title:'Only source'}]).includes('<details'));
});

test('a source from collapsed facts becomes visible even when its title omits the ordering SKU', async t => {
  setSourcePriorities([{manufacturer:'Synthetic',url:'https://priority.example'}]);
  t.after(() => setSourcePriorities([]));
  const app = await readFile(new URL('../app.js',import.meta.url),'utf8');
  const start = app.indexOf('function productSourceMarkup(item) {');
  const end = app.indexOf('\nfunction previewKind(',start);
  assert.ok(start >= 0 && end > start);
  const item = {line:1,sku:'SYN-ORDER-98765',description:'Synthetic CPU model 123'};
  const sources = [
    {url:'https://other.example/datasheet',title:'Processor specifications'},
    {url:'https://docs.priority.example/model',title:'Manufacturer CPU documentation'},
  ];
  const context = {
    lookupKnownComponent:() => null,loadProductLinkCache:() => ({}),modelSourceKey:() => '',
    currentReport:{positions:[{...item,technicalSpecs:[{name:'Socket',value:'LGA test',sources}]}]},
    isStale:() => false,sourceMatchesModel:() => false,
    isUsableProductSource,sortSourcesByPriority,omitRepeatedReferences,safeUrl,previewSourceLinks,
  };
  vm.createContext(context);
  vm.runInContext(app.slice(start,end),context);
  const markup = context.productSourceMarkup(item);
  const visible = markup.split('<details')[0];
  assert.ok(visible.includes('https://docs.priority.example/model'));
  assert.ok(visible.includes('источник характеристики'));
  assert.equal((visible.match(/href=/g) || []).length,1);
  assert.ok(markup.includes('https://other.example/datasheet'));
  assert.ok(markup.includes('Другие источники (1)'));
});

test('button renders a preliminary result before any network wait and later replaces it with the verified report', async () => {
  const app = await readFile(new URL('../app.js',import.meta.url),'utf8');
  const start = app.indexOf('async function runAnalysis(event) {');
  const end = app.indexOf('\nfunction exportReport()',start);
  assert.ok(start >= 0 && end > start);
  const config = validateConfig({bom:'SYN-PLATFORM\tServer platform LGA4677\t1\nSYN-CPU\tCPU LGA4677\t1'});
  const elements = new Map();
  const $ = selector => {
    if (!elements.has(selector)) elements.set(selector,{textContent:'',innerHTML:'',disabled:false,hidden:false,scrollIntoView:() => {}});
    return elements.get(selector);
  };
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const renders = [];
  let requests = 0;
  const context = {
    $,busy:false,form:{reportValidity:() => true},readConfig:() => config,hasHardware:() => true,
    currentReport:null,selectedFilter:'all',selectedModel:'unchanged-model',analyzeConfig,
    renderPositionReport:report => renders.push(report),matchMedia:() => ({matches:true}),
    priorityLoadPromise:wait,priorityWrites:Promise.resolve(),readPriorityResources:() => [],AbortSignal,
    showResearchProgress:() => {},showError:message => assert.fail(message),rememberProductLinks:() => {},
    fetch:async () => { requests++; return {}; },
    readResearchResponse:async () => ({mode:'ai',positions:[{id:'line-1',status:'compatible'}]}),
  };
  vm.createContext(context);
  vm.runInContext(app.slice(start,end),context);
  const began = performance.now();
  const pending = context.runAnalysis({preventDefault:() => {}});
  assert.equal(renders.length,1);
  assert.ok(performance.now() - began < 9000,'Local result must appear in less than 10 seconds');
  assert.equal(requests,0);
  assert.equal(renders[0].preliminary,true);
  assert.ok(renders[0].positions.every(position => position.status === 'unconfirmed'));
  release();
  await pending;
  assert.equal(requests,1);
  assert.equal(renders.length,2);
  assert.equal(context.currentReport.preliminary,undefined);
  assert.equal(context.currentReport.positions[0].status,'compatible');
  assert.equal(context.busy,false);
});
