import test from 'node:test';
import assert from 'node:assert/strict';
import { isUsableProductSource } from '../bom.js';
import { documentMatchesPosition } from '../provod.js';
import { reconcilePositions } from '../positions.js';
import { cleanComponentFacts } from '../component-knowledge.js';
import { renderPositionsMarkup } from '../report-view.js';

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
