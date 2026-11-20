import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCachedProvodFetch } from '../provod-cache.js';
import { researchAssemblyWithProvod } from '../provod.js';

const url = 'https://api.provod.ai/v1/responses';
const request = {method:'POST',headers:{Authorization:'Bearer synthetic'},body:JSON.stringify({store:false,model:'unchanged-model',input:'synthetic question'})};
const answer = () => new Response(JSON.stringify({status:'completed',usage:{currency:'RUB',cost:7},output:[{type:'message',content:[{type:'output_text',text:'Complete answer with sources'}]}]}));
async function directory(t) {
  await mkdir(resolve('.tmp'),{recursive:true});
  const path = await mkdtemp(resolve('.tmp','cost-test-'));
  t.after(() => rm(path,{recursive:true,force:true}));
  return pathToFileURL(path + sep);
}

test('ten simultaneous identical requests make one paid call; each body is independently readable', async t => {
  let calls = 0;
  const fetch = createCachedProvodFetch(async () => { calls++; return answer(); },await directory(t));
  const responses = await Promise.all(Array.from({length:10},() => fetch(url,request)));
  const bodies = await Promise.all(responses.map(response => response.json()));
  assert.equal(calls,1);
  assert.ok(bodies.every(body => body.output[0].content[0].text === 'Complete answer with sources'));
  assert.equal(responses.filter(response => response.headers.get('x-servercheck-coalesced')).length,9);
  assert.equal((await fetch(url,request)).headers.get('x-servercheck-cache'),'hit');
  assert.equal(calls,1);
});

test('chat cache expires after one hour and changed context or model requires a new call', async t => {
  let clock = 1000, calls = 0;
  const fetch = createCachedProvodFetch(async () => { calls++; return answer(); },await directory(t),() => clock);
  await fetch(url,request);
  clock += 3599999;
  assert.equal((await fetch(url,request)).headers.get('x-servercheck-cache'),'hit');
  clock++;
  await fetch(url,request);
  for (const change of [{input:'new evidence'},{model:'different-model'}]) {
    await fetch(url,{...request,body:JSON.stringify({...JSON.parse(request.body),...change})});
  }
  assert.equal(calls,4);
});

test('one cancelled consumer does not cancel another consumer of the same paid request', async t => {
  let entered, finish, calls = 0;
  const started = new Promise(resolve => { entered = resolve; });
  const fetch = createCachedProvodFetch(async (_url,options) => {
    calls++; entered();
    await new Promise((resolve,reject) => {
      finish = resolve;
      options.signal.addEventListener('abort',() => reject(options.signal.reason),{once:true});
    });
    return answer();
  },await directory(t));
  const controller = new AbortController();
  const first = fetch(url,{...request,signal:controller.signal});
  const rejection = assert.rejects(first,{name:'AbortError'});
  const second = fetch(url,request);
  await started;
  controller.abort();
  await rejection;
  finish();
  assert.equal((await (await second).json()).status,'completed');
  assert.equal(calls,1);
});

test('incomplete, failed and stateful chats are never persisted or automatically retried', async t => {
  for (const state of ['incomplete','failed','stateful']) {
    let calls = 0;
    const fetch = createCachedProvodFetch(async () => {
      calls++;
      return state === 'stateful' ? answer() : new Response(JSON.stringify({status:state,output:[]}));
    },await directory(t));
    const input = state === 'stateful' ? {...request,body:JSON.stringify({store:true,input:'question'})} : request;
    await fetch(url,input);
    assert.equal(calls,1);
    await fetch(url,input);
    assert.equal(calls,2);
  }
});

test('cancelling every consumer aborts the upstream request and allows a fresh explicit request', async t => {
  let entered, calls = 0;
  const started = new Promise(resolve => { entered = resolve; });
  const fetch = createCachedProvodFetch(async (_url,options) => {
    calls++;
    if (calls > 1) return answer();
    entered();
    return new Promise((_,reject) => options.signal.addEventListener('abort',() => reject(options.signal.reason),{once:true}));
  },await directory(t));
  const controller = new AbortController();
  const first = fetch(url,{...request,signal:controller.signal});
  const rejection = assert.rejects(first,{name:'AbortError'});
  await started;
  controller.abort();
  await rejection;
  assert.equal((await (await fetch(url,request)).json()).status,'completed');
  assert.equal(calls,2);
});

test('report cache accepts reordered complete rows, rejects duplicate IDs and truncated output', async t => {
  const reportUrl = 'https://api.provod.ai/v1/chat/completions';
  const input = {...request,body:JSON.stringify({messages:[{role:'user',content:JSON.stringify({expectedPositions:[{id:'a'},{id:'b'}]})}]})};
  for (const [ids,finishReason,reusable] of [[['b','a'],'stop',true],[['a','a'],'stop',false],[['a','b'],'length',false]]) {
    let calls = 0;
    const fetch = createCachedProvodFetch(async () => {
      calls++;
      return new Response(JSON.stringify({choices:[{finish_reason:finishReason,message:{content:JSON.stringify({positions:ids.map(id => ({id}))})}}]}));
    },await directory(t));
    await fetch(reportUrl,input);
    await fetch(reportUrl,input);
    assert.equal(calls,reusable ? 1 : 2);
  }
});

test('assembly request is stable across collection order and retains every row and full evidence', async () => {
  const positions = ['A','B'].map((sku,index) => ({id:`line-${index}`,sku,description:`Synthetic component ${sku}`,quantity:index+1,kind:'cpu',requiredChecks:['socket']}));
  const entries = positions.map(position => [position.id,{documents:[{url:`https://manufacturer.example/${position.sku}`,title:position.sku,text:`Full evidence for ${position.sku}`,positionIds:[position.id]}]}]);
  const bodies = [];
  const options = {apiKey:'synthetic',model:'unchanged-model',instructions:'All original checks',fetchImpl:async (_url,request) => {
    bodies.push(JSON.parse(request.body));
    return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({positions:[],assemblyAnalysis:{groups:[],purchaseNotes:[]}})}}]}));
  }};
  for (const entriesInOrder of [entries,[...entries].reverse()]) {
    await researchAssemblyWithProvod({positions},positions,options,new Map(entriesInOrder));
  }
  assert.deepEqual(bodies[0],bodies[1]);
  const input = JSON.parse(bodies[0].messages.at(-1).content);
  assert.deepEqual(input.expectedPositions,positions);
  assert.deepEqual(input.assemblyPositions,[]);
  for (const position of positions) assert.ok(input.documents.some(doc => doc.text === `Full evidence for ${position.sku}`));
  bodies.length = 0;
  await researchAssemblyWithProvod({positions},[positions[0]],options,new Map(entries));
  const partial = JSON.parse(bodies[0].messages.at(-1).content);
  const {requiredChecks,...otherRow} = positions[1];
  assert.deepEqual(partial.assemblyPositions,[otherRow]);
});
