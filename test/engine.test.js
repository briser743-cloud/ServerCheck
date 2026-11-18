import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeConfig } from '../engine.js';
import { validateConfig } from '../schema.js';

const finding = (report,id) => report.findings.find(item => item.id === id);

test('empty and model-only configurations never invent specification matches',() => {
  for (const config of [{},{cpuModel:'EPYC 0000',boardModel:'Some motherboard'}]) {
    const report = analyzeConfig(config);
    assert.equal(report.counts.pass,0);
    assert.equal(report.counts.bad,0);
    assert.ok(report.counts.unknown > 20);
    assert.ok(report.positions.every(position => position.status === 'unconfirmed'));
  }
});

test('detects contradictions in declared RAM, storage, dimensions and failover numbers',() => {
  const report = analyzeConfig({boardDdr:'DDR4',ramDdr:'DDR5',driveCount:4,driveProtocol:'SAS',storagePath:'sata',cardCount:1,cardLength:310,caseCardMax:280,cardProfile:'full',caseCardProfile:'low',cpuSocket:'SP3',boardSocket:'SP3',cpuCount:2,cpuTdp:240,cardWatts:300,otherWatts:120,psuCount:2,psuWatts:800,psuRedundancy:'nplus1'});
  for (const id of ['ddr','storage-protocol','card-length','card-profile','power-budget']) assert.equal(finding(report,id).status,'bad',id);
  assert.deepEqual(report.power,{load:900,available:800,target:1125,redundancy:'nplus1'});
  assert.equal(finding(report,'socket').status,'pass');
  assert.equal(finding(report,'cpu-support').status,'unknown');
});

test('matching socket is not CPU support or BIOS validation',() => {
  const report = analyzeConfig({cpuSocket:'sp3',boardSocket:'SP3'});
  assert.equal(finding(report,'socket').status,'pass');
  assert.equal(finding(report,'bios').status,'unknown');
  assert.equal(finding(report,'cpu-support').status,'unknown');
});

test('RAM generation, exact module type, available slots and capacity are separate checks',() => {
  const report = analyzeConfig({boardDdr:'DDR4',ramDdr:'DDR5',boardRamTypes:'LRDIMM, ECC UDIMM',ramType:'RDIMM',ramCount:10,ramSize:64,boardDimmSlots:8,boardMaxRam:512});
  for (const id of ['ddr','dimm-type','dimm-slots','ram-capacity']) assert.equal(finding(report,id).status,'bad',id);
});

test('zero cards/disks means no installation checks and zero card power',() => {
  const report = analyzeConfig({cardCount:0,driveCount:0,cpuCount:1,cpuTdp:120,psuCount:1,psuWatts:500,psuRedundancy:'none',otherWatts:80});
  assert.equal(finding(report,'card-length'),undefined);
  assert.equal(finding(report,'drive-bays'),undefined);
  assert.equal(report.power.load,200);
  assert.equal(finding(report,'power-budget').status,'pass');
});

test('blank is unknown, zero is known, negative and fractional counts are invalid',() => {
  const unknown = analyzeConfig({cpuCount:1,cpuTdp:100,cardCount:0,psuWatts:500,psuCount:1,psuRedundancy:'none',otherWatts:''});
  assert.equal(finding(unknown,'power-budget').status,'unknown');
  assert.equal(analyzeConfig({...unknown.config,otherWatts:0}).power.load,100);
  for (const input of [{cpuCount:-1},{cpuCount:1.5},{psuWatts:'Infinity'},{ramCount:[]},{ramDdr:'DDR9'},{otherWatts:'NaN'}]) assert.throws(() => validateConfig(input));
});

test('N+1 never counts reserved supply as available and needs a spare',() => {
  const base = {cpuCount:1,cpuTdp:100,cardCount:0,psuWatts:500,psuCount:1,psuRedundancy:'nplus1',otherWatts:0};
  assert.equal(analyzeConfig(base).power.available,0);
  assert.equal(finding(analyzeConfig(base),'power-budget').status,'bad');
  assert.equal(analyzeConfig({...base,psuCount:3}).power.available,1000);
});

test('nominal fit does not confirm proprietary board mounting or physical layout',() => {
  const report = analyzeConfig({boardFormat:'Proprietary',caseFormats:'Proprietary',cardCount:2,cardWidth:2,caseExpansionSlots:4,boardPcieSlots:2});
  assert.equal(finding(report,'board-fit').status,'unknown');
  assert.equal(finding(report,'card-width').status,'pass');
  assert.equal(finding(report,'pcie-layout').status,'unknown');
});

test('power with less than 25% headroom warns and unknown card count is not zero',() => {
  const base = {cpuCount:1,cpuTdp:400,psuCount:1,psuWatts:450,psuRedundancy:'none',otherWatts:0};
  assert.equal(finding(analyzeConfig({...base,cardCount:0}),'power-budget').status,'warn');
  assert.equal(finding(analyzeConfig(base),'power-budget').status,'unknown');
});

test('SAS cannot connect through SATA-only path; NVMe needs NVMe-capable path',() => {
  for (const [protocol,path,expected] of [['SAS','sata','bad'],['SATA','sas-sata','pass'],['NVMe','sas-sata','bad'],['NVMe','trimode','pass']]) {
    assert.equal(finding(analyzeConfig({driveCount:1,driveProtocol:protocol,storagePath:path}),'storage-protocol').status,expected);
  }
});
