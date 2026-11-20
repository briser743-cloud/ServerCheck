import test from 'node:test';
import assert from 'node:assert/strict';
import { collectProvodAssemblyDocuments, collectProvodDocuments } from '../provod.js';

test('duplicate rows reuse a single saved manufacturer extraction and skip redundant searches', async () => {
  const positions = ['one','two'].map(id => ({id,sku:'ACME-12345',description:'Acme ACME-12345 CPU',kind:'cpu',quantity:1}));
  const url='https://acme.example/ACME-12345'; const calls=[];
  const result=await collectProvodAssemblyDocuments(positions,{positions},{tavilyApiKey:'test',priorityResources:[{manufacturer:'Acme',domain:'acme.example'}],sourceCatalog:{'ACME-12345':{links:[{url,title:'ACME-12345'}]}},fetchImpl:async endpoint => {calls.push(endpoint); return new Response(JSON.stringify({results:[{url,raw_content:'ACME-12345 CPU specifications'}]}));}});
  assert.deepEqual(calls,['https://api.tavily.com/extract']);
  for (const position of positions) assert.equal(result.get(position.id).documents[0].url,url);
});

test('manufacturer page with exact product text avoids an additional general search', async () => {
  const position={id:'one',sku:'ACME-12345',description:'Acme ACME-12345 CPU',kind:'cpu',quantity:1}; const calls=[];
  const result=await collectProvodDocuments(position,{positions:[position]},{tavilyApiKey:'test',priorityResources:[{manufacturer:'Acme',domain:'acme.example'}],fetchImpl:async(endpoint,request)=>{calls.push(JSON.parse(request.body));return new Response(JSON.stringify({results:[{url:'https://acme.example/ACME-12345',title:'ACME-12345',raw_content:'ACME-12345 CPU specifications',content:'ACME-12345 CPU'}]}));}});
  assert.equal(calls.length,1); assert.deepEqual(calls[0].include_domains,['acme.example']); assert.ok(result.documents.length);
});

test('incomplete manufacturer evidence falls back to a general search', async () => {
  const position={id:'one',sku:'ACME-12345',description:'Acme ACME-12345 CPU',kind:'cpu',quantity:1}; const calls=[];
  await collectProvodDocuments(position,{positions:[position]},{tavilyApiKey:'test',priorityResources:[{manufacturer:'Acme',domain:'acme.example'}],fetchImpl:async(endpoint,request)=>{const payload=JSON.parse(request.body);calls.push(payload);return new Response(JSON.stringify({results:[{url:'https://acme.example/ACME-12345',title:'ACME-12345',content:'ACME-12345 CPU'}]}));}});
  assert.ok(calls.some(call=>!call.include_domains));
});

test('available search slot starts next row without waiting for a slow row', async () => {
  const positions = Array.from({length:5},(_,i)=>({id:`id${i}`,sku:`ACME-1000${i}`,description:`ACME-1000${i} CPU`,kind:'cpu',quantity:1}));
  let release; const slow=new Promise(resolve=>{release=resolve}); let fifthStarted=false;
  const running=collectProvodAssemblyDocuments(positions,{positions},{tavilyApiKey:'test',fetchImpl:async(endpoint,request)=>{const query=JSON.parse(request.body).query; if(query.includes('ACME-10000')) await slow; if(query.includes('ACME-10004')) {fifthStarted=true;release();} return new Response(JSON.stringify({results:[{url:'https://vendor.example/'+encodeURIComponent(query),title:query,content:query}]}));}});
  const timeout=setTimeout(()=>release(),1000);try {await running;} finally {clearTimeout(timeout);}
  assert.equal(fifthStarted,true);
});
