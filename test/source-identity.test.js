import test from 'node:test';
import assert from 'node:assert/strict';
import { isUsableProductSource } from '../bom.js';
import { documentMatchesPosition } from '../provod.js';
import { reconcilePositions } from '../positions.js';
import { cleanComponentFacts } from '../component-knowledge.js';
import { renderPositionsMarkup } from '../report-view.js';
import { isKnownBlockedSource } from '../source-identity.js';

test('browser-confirmed blocked page is excluded without excluding the entire vendor', () => {
  const url = 'https://global.microless.com/product/wd-ultrastar-dc-hdd-server-7k6-internal-hard-drive-3-5-form-factor-4tb-capacity-256mb-cache-size-7200-rpm-disk-speed-sas-12gb-s-interface-512e-se-0b36048';
  assert.equal(isKnownBlockedSource(url + '?ref=search'),true);
  assert.equal(isUsableProductSource('HUS726T4TAL5204',{url,title:'HUS726T4TAL5204'}),false);
  assert.equal(isKnownBlockedSource('https://global.microless.com/product/another-product'),false);
});

test('quick report labels catalogue references without claiming documents were read', () => {
  const url = 'https://www.supermicro.com/en/aplus/system/4u/4124/as-4124gs-tnr.php';
  const html = renderPositionsMarkup({positions:[{id:'line-1',sku:'AS-4124GS-TNR',description:'AS-4124GS-TNR',kind:'platform',status:'unconfirmed',referenceSources:[{url,title:'Supermicro AS-4124GS-TNR'}]}]});
  assert.match(html,/Справочные ссылки \(документы ещё не прочитаны\)/);
  assert.ok(html.includes(url));
  assert.match(html,/Документальные подтверждения не получены/);
});

const disk = {id:'synthetic-disk',sku:'MZILG-SYNTHETIC',description:'Samsung SSD PM1653 1.92TB SAS 24Gb/s',kind:'storage',quantity:1,requiredChecks:['dimensions'],missing:[]};
const wrong = {url:'https://seller.example/wd-ss530',title:'SSD WD 1.92TB SAS Ultrastar SS530',text:'1.92TB SAS 2.5 inch',positionIds:[disk.id]};
const platform = {url:'https://manufacturer.example/server',title:'Exact server platform SAS bays',positionIds:[disk.id]};

test('matching capacity and interface cannot attach a competing manufacturer to a disk', () => {
  assert.equal(documentMatchesPosition(wrong,disk),false);
  assert.equal(isUsableProductSource(disk.sku,wrong),false);
  assert.equal(documentMatchesPosition({title:'Samsung PM1643 SSD'},disk),false);
  assert.equal(documentMatchesPosition({title:'Samsung PM1653 SSD specifications'},disk),true);
  assert.deepEqual(cleanComponentFacts(disk.sku,[{name:'Interface',value:'SAS 24Gb/s',sources:[wrong]}],isUsableProductSource),[]);
});

test('matching position IDs do not let a foreign disk prove specifications or fit', () => {
  const candidate = {id:disk.id,status:'compatible',reason:'Claim',missing:[],technicalSpecs:[{name:'Interface',value:'SAS 24Gb/s',sources:[{...wrong,scope:'component'}]}],checks:[{aspect:'dimensions',status:'compatible',reason:'Claim',sources:[{...wrong,scope:'component'},{...platform,scope:'platform'}]}]};
  const result = reconcilePositions([disk],[candidate],[wrong,platform])[0];
  assert.equal(result.technicalSpecs.length,0);
  assert.ok(!result.sources.some(source => source.url === wrong.url));
});

test('unfinished checks are labelled explicitly and styled as a warning', () => {
  const markup = renderPositionsMarkup({positions:[{...disk,status:'unconfirmed',missing:['Проверка посадки и подключения не завершена.']}]});
  assert.ok(markup.includes('verification-incomplete'));
  assert.ok(markup.includes('Не выполнено при проверке (1)'));
  assert.ok(markup.includes('Следующие проверки не были выполнены или завершены.'));
});
