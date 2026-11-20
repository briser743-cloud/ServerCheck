import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { renderPositionsMarkup } from '../report-view.js';

// Execute the actual UI submit handler with mocked DOM/network dependencies.
// No provider calls are made, and both paid-request paths are counted.
const app = await readFile(new URL('../app.js',import.meta.url),'utf8');
const begin = app.indexOf("$('#report-content').addEventListener('submit',async event => {");
const end = app.indexOf('\nrenderFields();',begin);
assert.ok(begin >= 0 && end > begin);
const handlerSource = app.slice(begin,end);

for (const recheck of [false,true]) {
  test(`chat sends ${recheck ? 'two requests when verdict recheck is selected' : 'only one request for an ordinary question'}`, async () => {
    const position = {id:'line-1',sku:'SYNTHETIC-CPU',description:'Synthetic CPU',quantity:1,kind:'cpu',status:'unconfirmed',reason:'Original verdict'};
    const calls = [];
    let submit;
    const context = {
      currentReport:{config:{bom:'synthetic fixture'},positions:[position]},
      selectedModel:'unchanged-model',AbortSignal,
      FormData:class { get(key) { return key === 'question' ? 'Explain the result' : recheck ? 'on' : null; } },
      $:() => ({value:'unchanged-model',addEventListener:(_event,handler) => { submit = handler; }}),
      buildAssistantContext:() => 'Full assembly context',renderPositionChat:() => {},
      renderPositionReport:() => {},rememberProductLinks:() => {},isStale:() => false,readPriorityResources:() => [],
      fetch:async (url,options) => {
        calls.push({url,body:JSON.parse(options.body)});
        return {ok:true,json:async () => url === '/api/chat'
          ? {answer:'Source-backed explanation',costRub:0.01,sources:[]}
          : {positions:[{...position,status:'compatible',reason:'Verified revised verdict'}]}};
      },
    };
    vm.runInNewContext(handlerSource,context);
    await submit({preventDefault:() => {},target:{closest:() => ({dataset:{positionId:position.id}})}});
    assert.equal(calls.length,recheck ? 2 : 1);
    assert.equal(calls[0].url,'/api/chat');
    assert.equal(context.currentReport.positions[0].chatMessages[1].content,'Source-backed explanation');
    assert.equal(position.chatPending,false);
    if (recheck) {
      assert.equal(calls[1].url,'/api/analyze');
      assert.equal(calls[1].body.targetPositionId,position.id);
      assert.equal(calls[1].body.config.bom,'synthetic fixture');
      assert.equal(context.currentReport.positions[0].reason,'Verified revised verdict');
    } else assert.equal(context.currentReport.positions[0].reason,'Original verdict');
  });
}

test('card details omit chat, acknowledgement controls and service statistics', () => {
  const markup = renderPositionsMarkup({positions:[{id:'line-1',kind:'cpu',chatOpen:true,chatComposeOpen:true}]});
  assert.ok(markup.includes('<summary>Подробнее '));
  assert.ok(!markup.includes('data-chat'));
  assert.ok(!markup.includes('data-clarify'));
  assert.ok(!markup.includes('acknowledgements'));
  assert.ok(!markup.includes('research-audit'));
});
