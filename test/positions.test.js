import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareConfig } from '../bom.js';
import { analyzeConfig } from '../engine.js';
import { createPositions, reconcilePositions, countVerdicts } from '../positions.js';
import { renderPositionsMarkup } from '../report-view.js';

const sources = [{url:'https://manufacturer.example/support-matrix',title:'Матрица поддержки'}];
const baseline = () => createPositions(prepareConfig({bom:'GPU-1\tGPU 24GB\t2'}));
const proven = position => ({id:position.id,status:'compatible',reason:'Указанное количество карт поддерживается платформой.',missing:[],checks:position.requiredChecks.map(aspect => ({aspect,status:'compatible',reason:'Комбинация указана в матрице поддержки.',sources:[{...sources[0],scope:'joint'}]}))});

test('one yellow result per input row, quantities and duplicate SKUs preserved',() => {
  const report = analyzeConfig({bom:'R-1\t16GB DDR5 RDIMM\t4\nR-1\t16GB DDR5 RDIMM\t2\nD-2\tSSD 960GB U.2 NVMe\t0'});
  assert.equal(report.positions.length,3);
  assert.deepEqual(report.positions.map(row => row.quantity),[4,2,0]);
  assert.equal(new Set(report.positions.map(row => row.id)).size,3);
  assert.deepEqual(report.positionCounts,{compatible:0,incompatible:0,unconfirmed:3});
  assert.ok(report.positions.every(row => row.reason.length > 20));
});

test('positive result requires every necessary check and applicable source evidence',() => {
  const base = baseline();
  assert.equal(reconcilePositions(base,[proven(base[0])],sources)[0].status,'compatible');
  const incomplete = proven(base[0]);
  incomplete.checks.pop();
  const row = reconcilePositions(base,[incomplete],sources)[0];
  assert.equal(row.status,'unconfirmed');
  assert.ok(row.missing.some(text => text.includes('совместная установка')));
});

test('alternative technical sources can confirm checks and retain their provenance', () => {
  const base = baseline();
  const candidate = proven(base[0]);
  for (const check of candidate.checks) check.sources[0].sourceType = 'distributor';
  const row = reconcilePositions(base, [candidate], sources)[0];
  assert.equal(row.status, 'compatible');
  assert.equal(row.sources[0].sourceType, 'distributor');
  assert.match(renderPositionsMarkup({ positions: [row] }), /дистрибьютор/);
  candidate.checks[0].sources = [];
  assert.equal(reconcilePositions(base, [candidate], sources)[0].status, 'unconfirmed');
});

test('no source, unknown URL or component-only datasheet never produces green/red',() => {
  const base = baseline();
  for (const scope of ['component','joint']) {
    const candidate = proven(base[0]);
    candidate.checks.forEach(check => {check.sources[0].scope = scope;});
    assert.equal(reconcilePositions(base,[candidate],scope === 'joint' ? [] : sources)[0].status,'unconfirmed');
    candidate.status = 'incompatible';
    candidate.checks[0].status = 'incompatible';
    assert.equal(reconcilePositions(base,[candidate],scope === 'joint' ? [] : sources)[0].status,'unconfirmed');
  }
});

test('negative result explains incompatibility and retains the cited evidence',() => {
  const base = baseline();
  const candidate = proven(base[0]);
  candidate.status = 'incompatible';
  candidate.checks[0] = {...candidate.checks[0],status:'incompatible',reason:'Райзер платформы не поддерживает установку двух карт этой модели.'};
  const row = reconcilePositions(base,[candidate],sources)[0];
  assert.equal(row.status,'incompatible');
  assert.match(row.reason,/двух карт/);
  assert.equal(row.sources[0].url,sources[0].url);
});

test('applicable platform support and BIOS documents can prove platform-specific checks', () => {
  const base = createPositions(prepareConfig({ bom: 'CPU-1\tIntel Xeon CPU LGA4677\t2' }));
  const candidate = proven(base[0]);
  for (const check of candidate.checks) {
    if (['platform_support', 'bios', 'quantity'].includes(check.aspect)) check.sources[0].scope = 'platform';
  }
  assert.equal(reconcilePositions(base, [candidate], sources)[0].status, 'compatible');
  candidate.checks.find(check => check.aspect === 'bios').status = 'incompatible';
  assert.equal(reconcilePositions(base, [candidate], sources)[0].status, 'incompatible');
});

test('unknown optional check does not invalidate proven required checks', () => {
  const base = baseline();
  const candidate = proven(base[0]);
  candidate.checks.push({ aspect: 'bios', status: 'unconfirmed', reason: 'Optional information missing.', sources: [] });
  assert.equal(reconcilePositions(base, [candidate], sources)[0].status, 'compatible');
  candidate.status = 'unconfirmed';
  candidate.reason = 'Unknown optional BIOS.';
  const row = reconcilePositions(base, [candidate], sources)[0];
  assert.equal(row.status, 'compatible');
  assert.ok(!row.reason.includes('Unknown optional BIOS'));
});

test('rejected evidence explains the downgrade and incomplete required checks still block green', () => {
  const base = baseline();
  const candidate = proven(base[0]);
  candidate.checks[0].sources = [];
  const row = reconcilePositions(base, [candidate], sources)[0];
  assert.equal(row.status, 'unconfirmed');
  assert.match(row.checks[0].reason, /прочитанные документы/);
});

test('missing, duplicate or incorrect item IDs never attach another row verdict',() => {
  const base = baseline();
  assert.equal(reconcilePositions(base,[],sources)[0].status,'unconfirmed');
  const candidate = proven(base[0]);
  assert.equal(reconcilePositions(base,[candidate,candidate],sources)[0].status,'unconfirmed');
  assert.equal(reconcilePositions(base,[{...candidate,id:'other-line'}],sources)[0].status,'unconfirmed');
});

test('overall platform cannot be green while another position is unconfirmed',() => {
  const base = createPositions(prepareConfig({bom:'P-1\tServer platform 2U/2x LGA4677\t1\nGPU-1\tGPU 24GB\t1'}));
  const result = reconcilePositions(base,[proven(base[0])],sources);
  assert.ok(result.every(row => row.status === 'unconfirmed'));
});

test('markup exposes exactly the three requested labels, reasons, quantities and sources safely',() => {
  const positions = ['compatible','incompatible','unconfirmed'].map((status,index) => ({...baseline()[0],id:`row-${index}`,status,reason:'<img src=x onerror=alert(1)>',missing:[],sources:status === 'unconfirmed' ? [] : [{url:sources[0].url,title:'Документ'}],checks:[]}));
  const html = renderPositionsMarkup({positions});
  assert.match(html,/verdict-compatible/);
  assert.match(html,/verdict-incompatible/);
  assert.match(html,/verdict-unconfirmed/);
  assert.match(html,/Причина несовместимости/);
  assert.match(html,/Почему не подтверждено/);
  assert.match(html,/&lt;img/);
  assert.ok(!html.includes('<img'));
  assert.deepEqual(countVerdicts(positions),{compatible:1,incompatible:1,unconfirmed:1});
  assert.equal((renderPositionsMarkup({positions},'incompatible').match(/<article/g) || []).length,1);
});
