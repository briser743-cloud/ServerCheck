import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { analyzeConfig } from '../engine.js';
import { parseBom } from '../bom.js';

test('preview numbers recognized positions from one and retains original lines for deletion', async () => {
  const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
  const start=app.indexOf('function inventoryHtml(parsed,title,open = false) {');
  const end=app.indexOf('\nfunction reportHeader(',start);
  assert.ok(start >= 0 && end > start);
  const context={escapeHtml:value=>String(value),previewKind:item=>item.kind,savedComponentSummary:()=>'',readSourceOverrides:()=>({}),modelSourceKey:()=>'',lookupKnownComponent:()=>null,describeFacts:()=>'',productSourceMarkup:()=>'',previewResearchFacts:()=>''};
  vm.createContext(context);vm.runInContext(app.slice(start,end),context);
  const bom='Артикул\tОписание\tКоличество\nCPU-111\tCPU Xeon\t1\n\nMYSTERY-1\tUnknown component\t1';
  const parsed=parseBom(bom);
  const markup=context.inventoryHtml(parsed,'Распознано',true);
  assert.deepEqual(parsed.items.map(item=>item.line),[1,2]);
  assert.deepEqual(parsed.items.map(item=>item.sourceLine),[2,4]);
  assert.match(markup,/aria-label="Строка 1">1/);
  assert.match(markup,/aria-label="Строка 2">2/);
  assert.match(markup,/data-remove-line="2"/);
  assert.match(markup,/data-remove-line="4"/);
  const findings=analyzeConfig({bom}).findings;
  assert.ok(findings.some(item=>item.title==='Проверьте строку 2'));
  const withoutFirst=parseBom('Артикул\tОписание\tКоличество\n\nMYSTERY-1\tUnknown component\t1');
  assert.equal(withoutFirst.items[0].line,1);
  assert.equal(withoutFirst.items[0].sourceLine,3);
  assert.match(context.inventoryHtml(withoutFirst,'Распознано',true),/aria-label="Строка 1">1/);
  assert.match(context.inventoryHtml(withoutFirst,'Распознано',true),/data-remove-line="3"/);
});

test('leaving the specification does not replace preview before the first click', async () => {
  const app = await readFile(new URL('../app.js',import.meta.url),'utf8');
  const start = app.indexOf('function handleFormChange(event) {');
  const end = app.indexOf("\nform.addEventListener('input'",start);
  assert.ok(start >= 0 && end > start);
  let renders = 0;
  const context = {changed:() => renders++,$:() => ({checked:false}),productLookup:new Map()};
  vm.createContext(context);
  vm.runInContext(app.slice(start,end),context);
  const target = {id:'bom',closest:() => null};
  context.handleFormChange({type:'input',target});
  context.handleFormChange({type:'change',target});
  assert.equal(renders,1);
});

test('source search progress starts saving each source before the final report and avoids repeats', async () => {
  const app = await readFile(new URL('../app.js',import.meta.url),'utf8');
  const start = app.indexOf('function updateResearchProgress(progress) {');
  const end = app.indexOf('\nasync function readResearchResponse(',start);
  assert.ok(start >= 0 && end > start);
  const position = {id:'line-1',sku:'SYN-1234',description:'Synthetic component'};
  const saves = [], preview = {innerHTML:''};
  const context = {
    currentReport:{preliminary:true,positions:[position]},isStale:() => false,
    pendingPreviewSources:new Map(),attemptedPreviewSources:new Set(),
    safeUrl:value => value,isUsableProductSource:() => true,modelSourceKey:() => '',
    $:selector => selector === '#bom' ? {value:'SYN-1234'} : selector === '#bom-preview' ? preview : null,
    parseBom:() => ({items:[position]}),inventoryHtml:() => 'rendered',
    rememberProductLinks:report => saves.push(report),
  };
  vm.createContext(context);
  vm.runInContext(app.slice(start,end),context);
  const event = {phase:'sources',positionId:position.id,sources:[{url:'https://vendor.example/SYN-1234',title:'SYN-1234'}]};
  context.updateResearchProgress(event); context.updateResearchProgress(event);
  assert.equal(saves.length,1);
  assert.equal(saves[0].positions[0].sources[0].url,event.sources[0].url);
  assert.equal(preview.innerHTML,'rendered');
});

test('report sources with a generic title are saved when the read document names the exact platform model', async () => {
  const app = await readFile(new URL('../app.js',import.meta.url),'utf8');
  const start = app.indexOf('function sourceMatchesModel(position, source) {');
  const end = app.indexOf('\nfunction productSourceMarkup(',start);
  assert.ok(start >= 0 && end > start);
  const writes = [], cache = {}, facts = {};
  const context = {modelSourceKey:()=>'',loadProductLinkCache:()=>cache,loadProductFactsCache:()=>facts,
    sortSourcesByPriority:x=>x,sortSourcesForPosition:x=>x,isUsableProductSource:()=>true,safeUrl:x=>x,cleanComponentFacts:()=>[],
    omitRepeatedReferences:x=>x,localStorage:{setItem:()=>{}},productLinkCacheKey:'links',productFactsCacheKey:'facts',
    saveProjectSources:entries=>writes.push(entries)};
  vm.createContext(context); vm.runInContext(app.slice(start,end),context);
  const position={sku:'0.96.002.1050',description:'Gooxi SR201-D12RE-G2 2U platform',readSources:[{url:'https://www.gooxi.us/product/1217',title:'Gooxi',exactModelMentioned:true}]};
  context.rememberProductLinks({positions:[position]});
  assert.equal(writes.length,1);
  assert.equal(writes[0][0].links[0].modelOnly,true);
  assert.match(writes[0][0].links[0].title,/SR201-D12RE-G2/);
});

test('preliminary summary switches colour when input warnings change', async () => {
  const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
  const start=app.indexOf('function basicReportHeader(report) {');
  const end=app.indexOf('\nfunction renderPositionReport(',start);
  const context={escapeHtml:value=>String(value)};
  vm.createContext(context); vm.runInContext(app.slice(start,end),context);
  const report={preliminary:true,positions:[{}],findings:[{status:'warn',title:'Количество',detail:'Не указано'}]};
  assert.match(context.basicReportHeader(report),/preliminary-warning/);
  report.findings=[]; report.preliminaryEdited=true;
  const html=context.basicReportHeader(report);
  assert.match(html,/preliminary-clear/);
  assert.match(html,/Данные изменились/);
  assert.match(html,/не подтверждение совместимости/);
});

test('editing during a check recomputes the preview without treating the old report as current', async () => {
  const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
  const start=app.indexOf('function refreshPreliminaryForCurrentInput() {');
  const end=app.indexOf('\nfunction showError(',start);
  const elements=new Map();
  const $=selector=>{if(!elements.has(selector))elements.set(selector,{disabled:false,textContent:'',append:()=>{}});return elements.get(selector)};
  let config={bom:'NEW'},displayed;
  const context={currentReport:{preliminary:true,config:{bom:'OLD'}},showingLivePreliminary:false,busy:true,
    readConfig:()=>config,signature:JSON.stringify,analyzeConfig:value=>({positions:[{sku:value.bom}],findings:[]}),
    renderPositionReport:value=>{displayed=value},document:{querySelector:()=>null},$};
  vm.createContext(context);vm.runInContext(app.slice(start,end),context);
  context.refreshPreliminaryForCurrentInput();
  assert.equal(displayed.positions[0].sku,'NEW');
  assert.equal(displayed.preliminaryEdited,true);
  assert.equal(context.currentReport.config.bom,'OLD');
  assert.equal(elements.get('#export-report').disabled,true);
  config={bom:'OLD'};context.refreshPreliminaryForCurrentInput();
  assert.equal(displayed,context.currentReport);
  assert.equal(elements.get('#export-report').disabled,false);
});
import { validateConfig } from '../schema.js';
import { previewSourceLinks, setSourcePriorities, sortSourcesByPriority, sortSourcesForPosition, omitRepeatedReferences, safeUrl, canonicalReferenceUrl, numberedSourceLinks } from '../report-view.js';
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
    sourceMatchesModel:() => false,sortSourcesByPriority,sortSourcesForPosition,omitRepeatedReferences,safeUrl,previewSourceLinks,canonicalReferenceUrl,numberedSourceLinks,
    escapeHtml:value => String(value),fetch:() => assert.fail('No network calls while rendering saved facts'),
  };
  vm.createContext(context);
  const helpers = app.slice(app.indexOf("const productFactsCacheKey ="),app.indexOf('function loadProductLinkCache()'));
  const product = app.slice(app.indexOf('function previewProductSources('),app.indexOf('\nfunction previewKind('));
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
  assert.equal((markup.match(/>Ссылка(?: \d+)?<\/a>/g) || []).length,3);
  assert.ok(!markup.includes('>Alternative &lt;spec&gt;</a>'));
  assert.ok(!markup.includes('javascript:'));
  assert.ok(!previewSourceLinks([{url:'https://example.com',title:'Only source'}]).includes('<details'));
});

test('a source from collapsed facts becomes visible even when its title omits the ordering SKU', async t => {
  setSourcePriorities([{manufacturer:'Synthetic',url:'https://priority.example'}]);
  t.after(() => setSourcePriorities([]));
  const app = await readFile(new URL('../app.js',import.meta.url),'utf8');
  const start = app.indexOf('function previewProductSources(item) {');
  const end = app.indexOf('\nfunction previewKind(',start);
  assert.ok(start >= 0 && end > start);
  const item = {line:1,sku:'SYN-ORDER-98765',description:'Synthetic CPU model 123'};
  const sources = [
    {url:'https://other.example/datasheet',title:'Processor specifications'},
    {url:'https://docs.priority.example/model',title:'Manufacturer CPU documentation'},
  ];
  const context = {
    lookupKnownComponent:() => null,loadProductLinkCache:() => ({}),readSourceOverrides:() => ({}),sourceExcluded:() => false,modelSourceKey:() => '',
    currentReport:{positions:[{...item,technicalSpecs:[{name:'Socket',value:'LGA test',sources}]}]},pendingPreviewSources:new Map(),
    isStale:() => false,sourceMatchesModel:() => false,
    isUsableProductSource,sortSourcesByPriority,sortSourcesForPosition,omitRepeatedReferences,safeUrl,previewSourceLinks,
  };
  vm.createContext(context);
  vm.runInContext(app.slice(start,end),context);
  const markup = context.productSourceMarkup(item);
  const visible = markup.split('<details')[0];
  assert.ok(visible.includes('https://docs.priority.example/model'));
  assert.match(visible,/>Ссылка(?: \d+)?<\/a>/);
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

 test('GPU model mismatch cannot use H100 documentation for H200', () => {
   const h200 = {sku:'900-21010-0040-000',description:'NVIDIA H200 NVL'};
   const bad = {url:'https://www.nvidia.com/data-center/h100/PB-11773-001.pdf',title:'H100 NVL'};
   const good = {url:'https://www.nvidia.com/en-us/data-center/h200/',title:'NVIDIA H200 NVL',text:'Comparison with H100'};
   assert.equal(isUsableProductSource(h200.sku,bad),false);
   assert.equal(isUsableProductSource(h200.sku,good),true);
 });

test('repeated source is rendered once in a component report with numbered fact references', async () => {
  const {renderPositionsMarkup} = await import('../report-view.js');
  const source = {url:'https://vendor.example/spec',title:'Документ'};
  const html = renderPositionsMarkup({positions:[{id:'1',line:1,sku:'TEST-CPU',kind:'cpu',status:'unconfirmed',description:'CPU',sources:[source,source],technicalSpecs:[{name:'Сокет',value:'SP5',sources:[source]},{name:'Частота',value:'2 ГГц',sources:[source]}],checks:[{aspect:'socket',status:'unconfirmed',reason:'Проверить',sources:[source]}]}]});
  assert.equal((html.match(/class="source-number" href="https:\/\/vendor\.example\/spec"/g) || []).length,3);
  assert.match(html,/SP5 <a class="source-number"[^>]*>\[1\]<\/a>/);
  assert.match(html,/2 ГГц <a class="source-number"[^>]*>\[1\]<\/a>/);
});
