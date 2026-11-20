import test from 'node:test';
import assert from 'node:assert/strict';
import { compactEvidenceFormat, expandEvidenceReferences, provodBilling } from '../provod-evidence.js';
import { positionReportFormat } from '../positions.js';
import { researchAssemblyWithProvod } from '../provod.js';
import { renderPositionsMarkup } from '../report-view.js';

const documents = [
  {ref:'D1',url:'https://manufacturer.example/platform/manual',title:'Exact platform manual'},
  {ref:'D2',url:'https://manufacturer.example/component/specifications',title:'Exact component specifications'},
];
const source = {ref:'D1',scope:'platform',sourceType:'manufacturer'};
const expanded = {url:documents[0].url,title:documents[0].title,scope:'platform',sourceType:'manufacturer'};

test('compact schema replaces only repeated citation metadata and leaves all report requirements intact', () => {
  const original = structuredClone(positionReportFormat);
  const compact = compactEvidenceFormat(positionReportFormat,documents);
  let citationSchemas = 0;
  function restore(node) {
    if (!node || typeof node !== 'object') return;
    if (node.properties?.ref && node.properties?.scope) {
      citationSchemas++;
      assert.deepEqual(node.properties.ref.enum,['D1','D2']);
      assert.deepEqual(node.required,['ref','scope','sourceType']);
      delete node.properties.ref;
      node.properties.url = {type:'string'};
      node.properties.title = {type:'string',maxLength:180};
      node.required = ['url','title','scope','sourceType'];
    }
    Object.values(node).forEach(restore);
  }
  restore(compact.schema);
  assert.equal(citationSchemas,4);
  assert.deepEqual(compact,original);
  assert.deepEqual(positionReportFormat,original);
});

test('all checks, specifications, node groups and purchase notes recover the same full citation', () => {
  const report = {positions:[{id:'line-1',reason:'Same conclusion',checks:[{sources:[source]}],technicalSpecs:[{name:'Socket',value:'LGA test',sources:[source]}]}],assemblyAnalysis:{groups:[{sources:[source]}],purchaseNotes:[{sources:[source]}]}};
  const result = expandEvidenceReferences(report,documents);
  assert.deepEqual(result.positions[0].checks[0].sources,[expanded]);
  assert.deepEqual(result.positions[0].technicalSpecs[0].sources,[expanded]);
  assert.deepEqual(result.assemblyAnalysis.groups[0].sources,[expanded]);
  assert.deepEqual(result.assemblyAnalysis.purchaseNotes[0].sources,[expanded]);
  assert.equal(result.positions[0].reason,report.positions[0].reason);
  assert.deepEqual(report.positions[0].checks[0].sources,[source]);
  assert.deepEqual(expandEvidenceReferences({sources:[{...source,ref:'D999'}]},documents),{sources:[]});
});

test('actual assembly pipeline expands references before reconciliation and reports billing once', async () => {
  const positions = ['CPU-1234','CPU-5678'].map((sku,index) => ({id:`line-${index}`,sku,description:sku,kind:'cpu',quantity:1,requiredChecks:['platform_support']}));
  const collected = new Map(positions.map(position => [position.id,{documents:[{...documents[0],text:'Complete unchanged evidence',positionIds:positions.map(item => item.id)}]}]));
  let sent;
  const result = await researchAssemblyWithProvod({positions},positions,{apiKey:'synthetic',model:'unchanged-model',instructions:'Original rules',fetchImpl:async (_url,request) => {
    sent = JSON.parse(request.body);
    const input = JSON.parse(sent.messages.at(-1).content);
    assert.equal(input.documents[0].text,'Complete unchanged evidence');
    assert.equal(input.documents[0].ref,'D1');
    assert.deepEqual(input.searchSummaries[0].sourceRefs,['D1']);
    return new Response(JSON.stringify({usage:{currency:'RUB',cost:1.5,prompt_tokens:300,completion_tokens:100,completion_tokens_details:{reasoning_tokens:10}},choices:[{finish_reason:'stop',message:{content:JSON.stringify({positions:positions.map(position => ({id:position.id,status:'compatible',reason:'Source-backed unchanged conclusion',checks:[{aspect:'platform_support',status:'compatible',reason:'Exact support',sources:[source]}],technicalSpecs:[{name:'Socket',value:'LGA test',sources:[source]}],missing:[],recommendation:''})),assemblyAnalysis:{groups:[{title:'CPU',positionIds:positions.map(p=>p.id),summary:'Exact support',recommendation:'',sources:[source]}],purchaseNotes:[]}})}}]}));
  }},collected);
  assert.equal(sent.model,'unchanged-model');
  assert.deepEqual(result.results[0].candidate.checks[0].sources,[expanded]);
  assert.deepEqual(result.results[0].candidate.technicalSpecs[0].sources,[expanded]);
  assert.equal(result.assemblyAnalysis.groups[0].sources[0].url,documents[0].url);
  assert.equal(result.results[0].research.billing.costRub,1.5);
  assert.equal(result.results[1].research.billing,undefined);
});

test('billing distinguishes unknown amounts, cache reuse and original token counts', () => {
  assert.equal(provodBilling({},new Response()).costRub,undefined);
  assert.equal(provodBilling({usage:{currency:'USD',cost:1}},new Response()).costRub,undefined);
  assert.equal(provodBilling({usage:{currency:'RUB',cost:NaN}},new Response()).costRub,undefined);
  const billing = provodBilling({usage:{currency:'RUB',cost:5,prompt_tokens:200,completion_tokens:50}},new Response('',{headers:{'X-ServerCheck-Cache':'hit'}}));
  assert.equal(billing.costRub,0);
  assert.equal(billing.completionTokens,50);
  assert.equal(billing.reasoningTokens,undefined);
  const markup = renderPositionsMarkup({positions:[{id:'line-1',kind:'cpu',quantity:1,status:'unconfirmed',research:{billing,checkedAt:'2026-11-20T00:00:00Z'}}]});
  assert.ok(!markup.includes('Расход Provod'));
  assert.ok(!markup.includes('Токены исходного ответа'));
  assert.ok(!markup.includes('рассуждения: 0'));
});
