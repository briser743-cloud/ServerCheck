import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseBom, prepareConfig, removePackagingRows, lookupKnownComponent, modelSourceKey, isUsableProductSource } from '../bom.js';
import { analyzeConfig } from '../engine.js';
import { cleanLegacyDraft } from '../draft.js';

const sample = await readFile(new URL('./fixtures/quote.tsv',import.meta.url),'utf8');

test('ignores a separate leading ten digit number before parsing the position', () => {
  for (const separator of ['\t', ' ', ';', '|']) {
    const input = `CPU-123\tAMD EPYC processor\t2\t$395.00`;
    assert.deepEqual(parseBom(`3000047875${separator}${input}`).items[0], parseBom(input).items[0]);
  }
  assert.equal(parseBom('30000478750 CPU-123 AMD EPYC processor').items[0].sku, '30000478750');
  assert.equal(parseBom('3000047875-CPU AMD EPYC processor').items[0].sku, '3000047875-CPU');
});

test('platform and RAID controller remain their own categories when NVMe is mentioned', () => {
  const rows = parseBom('TEST-PLATFORM\tExample SL201-D12R-G4 2U 2xLGA4677 32x DDR5 2x M.2 NVMe\t1\nTEST-RAID\tMegaRAID 9560-8i SAS/SATA/PCIe (NVMe)\t1').items;
  assert.deepEqual(rows.map(row => row.kind),['platform','controller']);
  assert.equal(rows[1].facts.capacityGB,undefined);
});

test('Gooxi model with DDR4 and bays is recognized as platform, not memory or disk', () => {
  for (const sku of ['0.95.004.1023','SYN-001']) {
    const item = parseBom(`${sku}\tGooxi AS4105G-D12R-G3 4U-5GPU,16*DDR4,2*2200W,12disks\t1`).items[0];
    assert.equal(item.kind,'platform');
  }
  assert.equal(lookupKnownComponent({sku:'0.95.004.1023'}).modelOnly,true);
});

test('standalone Supermicro part number resolves to its manufacturer platform', () => {
  const item = parseBom('AS-4124GS-TNR').items[0];
  assert.equal(item.kind,'platform');
  assert.match(lookupKnownComponent(item).url,/supermicro\.com/);
  assert.equal(item.quantity,null);
});

test('unrelated or explicitly nonmatching sources are not stored as product references', () => {
  assert.equal(isUsableProductSource('QLE2772-SR-SP',{title:'Marvell QLE2770-SR-SP HBA'}),false);
  assert.equal(isUsableProductSource('0.95.002.1070',{title:'Другая платформа G3; нельзя переносить на G4'}),false);
  assert.equal(isUsableProductSource('05-60004-00',{title:'Cable 8654 to 8643'}),false);
  assert.equal(isUsableProductSource('QLE2772-SR-SP',{title:'Marvell QLE2772-SR-SP'}),true);
});

test('model keys identify components without copying the specification or inventing a SKU', () => {
  assert.equal(modelSourceKey('ASUS RS700-E12-RS12U, 1U, 2 CPUs'), 'MODEL:ASUS RS700-E12-RS12U');
  assert.equal(modelSourceKey('CPU LGA4710 Intel Xeon 6511P 16C/32T'), 'MODEL:INTEL XEON 6511P');
  assert.equal(modelSourceKey('Solidigm SSD D7-P5620 Series, 3200GB'), 'MODEL:SOLIDIGM D7-P5620');
  assert.equal(modelSourceKey('Samsung DDR5 64GB RDIMM 5600'), 'MODEL:SAMSUNG DDR5 64GB RDIMM 5600');
  assert.equal(modelSourceKey('Samsung DDR5 32GB RDIMM 5600'), '');
  assert.equal(modelSourceKey('ConnectX-4 Lx EN network card'), 'MODEL:CONNECTX-4 LX');
});

test('known graphics card can be identified by SKU alone or model description', () => {
  const skuOnly = parseBom('900-5G192-2240-000').items[0];
  assert.equal(skuOnly.sku, '900-5G192-2240-000');
  assert.equal(skuOnly.kind, 'gpu');
  assert.equal(skuOnly.quantity, null);
  assert.ok(lookupKnownComponent(skuOnly)?.url);
  const descriptionOnly = parseBom('NVIDIA RTX 2000 Ada PCIe 16GB GDDR6, BLK').items[0];
  assert.equal(descriptionOnly.sku, '');
  assert.equal(descriptionOnly.kind, 'gpu');
  assert.equal(descriptionOnly.quantity, null);
  assert.match(lookupKnownComponent(descriptionOnly).source, /артикул не подтверждён/);
});

test('known processor description identifies its model without assuming an exact SKU', () => {
  const row = parseBom('CPU SP5 AMD EPYC 9115 (16C/32T, 2.6/4.1GHz, 64MB, 125W) OEM (Clean Pulled)').items[0];
  assert.equal(row.sku, '');
  assert.equal(row.kind, 'cpu');
  assert.match(lookupKnownComponent(row).url, /amd-epyc-9115/);
  assert.match(lookupKnownComponent(row).source, /артикул не подтверждён/);
  assert.equal(lookupKnownComponent({sku:'',description:'AMD EPYC 9115P'}), null);
  assert.equal(lookupKnownComponent({sku:'',description:'NVIDIA RTX 2000E Ada'}), null);
});

test('packaging rows are removed without removing hardware mentioning packaging', () => {
  const original = 'BOX_TEST\tГофрокороб для платформы\t1\nSERVER-1\tСервер в гофрокоробе\t1';
  const cleaned = removePackagingRows(original);
  assert.equal(cleaned.removed, 1);
  assert.equal(parseBom(original).items.length, 1);
  assert.match(cleaned.text, /SERVER-1/);
});

test('Russian part-number column headers are ignored', () => {
  for (const header of ['партномер\tОписание\tКол', 'Парт номер  Описание  Кол', 'DAXId\tP/N\tDescription\tQty']) {
    const rows = parseBom(`${header}\nTEST-100\tExample server platform\t1`).items;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sku, 'TEST-100');
  }
});

test('quantity before a separate price column is parsed independently of price', () => {
  const row = parseBom('DISK-TEST\tSSD 2.5 inch 960GB\t2\t$395.00').items[0];
  assert.equal(row.quantity, 2);
  assert.equal(row.description, 'SSD 2.5 inch 960GB');
});

test('server with drive interfaces is a platform, while SSD remains storage', () => {
  const rows = parseBom('TEST-PLAT\tExample 1U server 10bay NVMe M.2\t1\nTEST-SSD\tSSD M.2 NVMe 1TB\t2').items;
  assert.deepEqual(rows.map(row => row.kind), ['platform', 'storage']);
  assert.equal(rows[0].facts.form, undefined);
});

test('tab-separated synthetic fixture: final column is quantity, not the last digit of a specification',() => {
  const result = parseBom(sample);
  assert.deepEqual(result.items.map(row => row.quantity),[1,2,1,8,1,2]);
  assert.deepEqual(result.items.map(row => row.kind),['platform','cpu','storage','memory','gpu','storage']);
  assert.equal(result.items[0].facts.socketCount,2);
  assert.equal(result.items[0].facts.dimmSlots,16);
  assert.equal(result.items[0].facts.psuCount,2);
  assert.equal(result.items[0].facts.psuWatts,1600);
  assert.equal(result.items[0].facts.bays[0].count,8);
  assert.equal(result.items[2].facts.m2Size,'2280');
  assert.equal(result.totals.units,15);
  assert.equal(result.totals.cpuCount,2);
  assert.equal(result.totals.cpuCores,16);
  assert.equal(result.totals.cpuThreads,32);
  assert.equal(result.totals.memoryGB,256);
  assert.equal(result.totals.storageGB,5000);
  assert.equal(result.totals.storageCount,3);
  assert.equal(result.totals.gpuCount,1);
});

test('different quantities and entirely different models work without catalog lookups',() => {
  const result = parseBom('ARBITRARY-R9\t64GB DDR4 RDIMM 3200MT/s\t12\nDISK-Z0\tSSD 2TB SATA 2.5"\t24\nVIDEO-Q5\tGPU 80GB 350W\t3');
  assert.equal(result.totals.memoryGB,768);
  assert.equal(result.totals.memoryCount,12);
  assert.equal(result.totals.storageGB,48000);
  assert.equal(result.totals.gpuCount,3);
  assert.deepEqual(result.items.map(row => row.quantity),[12,24,3]);
});

test('accepts semicolon, pipe, multiple spaces and plain-text trailing quantities',() => {
  for (const text of ['RAM-9;32GB DDR5 RDIMM;8','RAM-9 | 32GB DDR5 RDIMM | 8','RAM-9    32GB DDR5 RDIMM    8','RAM-9 32GB DDR5 RDIMM 8']) {
    const result = parseBom(text);
    assert.equal(result.items[0].quantity,8,text);
    assert.equal(result.totals.memoryGB,256,text);
  }
});

test('missing quantities, invalid quantities and zero lines are not silently treated as one',() => {
  const missing = parseBom('CPU LGA4677 Xeon 195W');
  assert.equal(missing.items[0].quantity,null);
  assert.equal(missing.totals.cpuCount,null);
  const invalid = parseBom('CPU-1\tCPU Xeon 195W\t1.5');
  assert.ok(invalid.items[0].issue);
  assert.equal(invalid.totals.cpuCount,null);
  const zero = parseBom('CPU-1\tCPU Xeon 195W\t0');
  assert.equal(zero.items[0].quantity,0);
  assert.equal(zero.active.length,0);
});

test('mixed drives preserve model, quantity, protocol and form factor per row',() => {
  const p = prepareConfig({bom:sample});
  assert.equal(p.effective.driveCount,'');
  assert.equal(p.effective.driveProtocol,'');
  assert.deepEqual(p.parsed.items.filter(row => row.kind === 'storage').map(row => [row.facts.form,row.quantity]),[['M.2',1],['U.2',2]]);
  assert.equal(p.effective.ramCount,8);
  assert.equal(p.effective.ramSize,32);
  assert.equal(p.effective.cardWatts,''); // 24GB VRAM does not mean 24 watts.
  assert.equal(p.effective.psuCount,2); // integrated supplies are not extra server platforms.
  assert.equal(p.effective.psuRedundancy,''); // two PSUs alone do not specify the mode.
});

test('explicit conflicting manual data is excluded, not used as a hardware verdict',() => {
  const report = analyzeConfig({bom:sample,ramCount:8,manualMode:'include'});
  assert.equal(report.config.ramSize,'');
  assert.equal(report.effectiveConfig.ramSize,16);
  assert.equal(report.effectiveConfig.ramCount,'');
  assert.ok(report.findings.some(item => item.id === 'bom-manual-ramCount' && item.status === 'warn'));
});

test('initial report provides quantities and real installation questions, not dozens of empty comparisons',() => {
  const report = analyzeConfig({bom:sample});
  assert.equal(report.counts.bad,0);
  assert.ok(report.findings.some(item => item.id === 'bom-memory-total' && /256 ГБ/.test(item.detail)));
  assert.ok(report.findings.some(item => item.id === 'bom-m2-3' && item.status === 'unknown'));
  assert.ok(report.findings.some(item => item.id === 'bom-bays-2.5:NVME' && item.status === 'pass'));
  assert.ok(report.findings.some(item => item.id === 'bom-integrated-psu' && /1600 Вт/.test(item.detail)));
  assert.equal(report.power,null); // Unknown total load must not become 0.
  assert.ok(report.counts.unknown < 8);
});

test('stale DDR4 and every other old manual field cannot contaminate a new DDR5 specification',() => {
  const report = analyzeConfig({bom:sample,boardDdr:'DDR4',boardSocket:'SP3',cpuSocket:'SP3',psuWatts:800,cardLength:310,caseCardMax:280});
  assert.equal(report.effectiveConfig.boardDdr,'DDR5');
  assert.equal(report.effectiveConfig.boardSocket,'LGA4677');
  assert.equal(report.effectiveConfig.psuWatts,1600);
  assert.equal(report.effectiveConfig.cardLength,'');
  assert.equal(report.findings.find(item => item.id === 'ddr').status,'pass');
  assert.equal(report.counts.bad,0);
  assert.ok(!JSON.stringify(report.findings).includes('Плата: DDR4'));
});

test('explicit DDR4/DDR5 disagreement between sources is not a DDR incompatibility verdict',() => {
  const report = analyzeConfig({bom:sample,boardDdr:'DDR4',manualMode:'include'});
  assert.equal(report.effectiveConfig.boardDdr,'');
  assert.ok(report.findings.some(item => item.id === 'bom-manual-boardDdr' && item.status === 'warn'));
  assert.ok(!report.findings.some(item => item.id === 'ddr' && item.status === 'bad'));
});

test('legacy educational draft is removed while real customer list is preserved',() => {
  const result = cleanLegacyDraft({projectName:'Учебная сборка',boardDdr:'DDR4',boardModel:'Условная плата',cpuCount:2,bom:sample});
  assert.equal(result.boardDdr,undefined);
  assert.equal(result.cpuCount,undefined);
  assert.equal(result.projectName,'');
  assert.equal(result.bom,sample);
  assert.equal(cleanLegacyDraft({bom:'ДЕМОНСТРАЦИЯ, не реальные модели',boardModel:'Условная плата'}).bom,'');
  assert.deepEqual(cleanLegacyDraft({projectName:'Рабочая сборка',boardDdr:'DDR5'}),{projectName:'Рабочая сборка',boardDdr:'DDR5'});
});

test('shared multi-protocol drive bays cannot be allocated once per group',() => {
  const report = analyzeConfig({bom:'CASE-X\tServer platform 2U/2x LGA4677/8x 2.5" SATA/SAS\t1\nD-1\tSSD 960GB 2.5" SATA\t6\nD-2\tHDD 2TB 2.5" SAS\t6'});
  assert.ok(report.findings.some(item => item.id === 'bom-shared-bays-2.5' && item.status === 'bad'));
});

test('headers ignored, duplicate part lines kept, GPU memory never added to system RAM',() => {
  const parsed = parseBom('Артикул\tОписание\tКоличество\nR-1\t16GB DDR5 RDIMM\t4\nR-1\t16GB DDR5 RDIMM\t4\nG-1\tGPU 24GB\t2');
  assert.equal(parsed.items.length,3);
  assert.equal(parsed.totals.memoryGB,128);
  assert.equal(parsed.totals.gpuCount,2);
});
