// Универсальный разбор спецификации. Последняя колонка — число изделий в строке.
// Числа внутри описания (DIMM-слоты, отсеки, БП, VRAM) не заменяют количество строки.
import { validateConfig, fields } from './schema.js';

export const kindLabels = { platform:'Платформа / корпус', board:'Материнская плата', cpu:'Процессор', memory:'Оперативная память', storage:'Накопитель', gpu:'GPU', controller:'Контроллер / HBA', network:'Сетевая карта', psu:'Блок питания', cooler:'Охлаждение', unknown:'Не распознано' };
const norm = value => String(value).toUpperCase().replace(/[\s_-]/g,'');
const valueOf = value => Number(String(value).replace(',','.'));
const matchNumber = (text,regex) => { const match = text.match(regex); return match ? valueOf(match[1]) : null; };
const unique = values => [...new Set(values.filter(value => value != null && value !== ''))];
const storageSize = text => {
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(TB|ТБ|GB|ГБ)(?=$|[\s,/)])/i);
  return match ? valueOf(match[1]) * (/TB|ТБ/i.test(match[2]) ? 1000 : 1) : null;
};

function classify(text) {
  if (/\b(?:platform|barebone|chassis)\b|платформ|корпус|\d\s*U\s*[/,].*(?:DIMM|LGA|SP[345])/i.test(text)) return 'platform';
  if (/\b(?:SSD|HDD|NVMe)\b|накопител|ж[её]стк.*диск/i.test(text) && !/\b(?:HBA|RAID|controller)\b|контроллер/i.test(text)) return 'storage';
  if (/\b(?:RDIMM|LRDIMM|UDIMM|DIMM|Kingston|KSM\w*|DDR[345])\b|оперативн.*памят/i.test(text) && !/плат[аы]|motherboard|mainboard|\bCPU\b|Xeon|EPYC/i.test(text)) return 'memory';
  if (/\b(?:motherboard|mainboard)\b|материнск|^плата\s*[:—-]/i.test(text)) return 'board';
  if (/\b(?:GPU|NVIDIA|GeForce|Quadro|Radeon|Tesla)\b|видеокарт|графическ.*карт/i.test(text)) return 'gpu';
  if (/\b(?:HBA|RAID|controller)\b|контроллер/i.test(text)) return 'controller';
  if (/\b(?:NIC|ConnectX|Ethernet|network card|X710|E810)\b|сетев.*(?:карт|адаптер)/i.test(text)) return 'network';
  if (/\b(?:PSU|power supply|CRPS)\b|блок.*питания|^БП\b/i.test(text)) return 'psu';
  if (/\b(?:cooler|heatsink)\b|кулер|радиатор/i.test(text)) return 'cooler';
  if (/\b(?:CPU|Xeon|EPYC|Ryzen|Core\s+i[3579])\b|процессор/i.test(text)) return 'cpu';
  return 'unknown';
}

function parseRow(raw,line) {
  const cleaned = raw.trim().replace(/^\|\s*|\s*\|$/g,'');
  if (!cleaned || /^[-:|\s]+$/.test(cleaned) || /^(?:артикул|part\s*(?:number|no)|sku)[\s\t;|]/i.test(cleaned)) return null;
  let cells = cleaned.includes('\t') ? cleaned.split(/\t+/) : cleaned.includes('|') ? cleaned.split('|') : cleaned.includes(';') ? cleaned.split(';') : cleaned.split(/\s{2,}/);
  cells = cells.map(value => value.trim()).filter(Boolean);
  let quantity = null;
  let description = cleaned;
  let sku = '';
  let format = 'text';
  let issue = '';
  if (cells.length >= 2 && /^\d+(?:[.,]\d+)?(?:\s*(?:шт\.?|pcs))?$/i.test(cells.at(-1))) {
    quantity = valueOf(cells.pop().replace(/\s*(?:шт\.?|pcs)$/i,''));
    if (cells.length >= 2) { sku = cells.shift(); description = cells.join(' '); } else description = cells[0];
    format = 'table';
  } else {
    // В одно-пробельной строке количество принимается только отдельным последним числом.
    const trailing = cleaned.match(/^(.*?)\s+(\d+)\s*(?:шт\.?|pcs)?$/i);
    if (trailing) { description = trailing[1]; quantity = Number(trailing[2]); }
    const leadingSku = description.match(/^([A-Z0-9][A-Z0-9._-]*\d[A-Z0-9._-]*)\s+(.+)$/i);
    if (leadingSku) { sku = leadingSku[1]; description = leadingSku[2]; }
    if (cells.length >= 3 && /^(?:-\d+|\d+[.,]\d+)\s*(?:шт\.?)?$/i.test(cells.at(-1))) {
      issue = 'Количество должно быть целым неотрицательным числом.';
      quantity = null;
    }
  }
  if (quantity !== null && (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 100000)) { issue = 'Количество вне допустимого диапазона 0–100000.'; quantity = null; }
  if (description.length > 4000) issue = 'Слишком длинное описание позиции; сократите его до 4000 символов.';
  const kind = classify(description);
  const facts = {};
  const socket = description.match(/\b(?:FC)?LGA\s*(\d{3,5})\b|\bSP[3456]\b|\bAM[45]\b/i);
  if (socket) facts.socket = socket[1] ? `LGA${socket[1]}` : socket[0].toUpperCase();
  if (kind === 'platform' || kind === 'board') {
    facts.socketCount = matchNumber(description,/(\d+)\s*[xх×]\s*(?:FC)?(?:LGA\s*\d+|SP[3456])/i);
    facts.cpuTdpLimit = matchNumber(description,/(\d+)\s*(?:Вт|W)\s*TDP/i);
    facts.dimmSlots = matchNumber(description,/(\d+)\s*[xх×]\s*DDR[345]\s*DIMM/i);
    facts.ddr = description.match(/\bDDR[345]\b/i)?.[0].toUpperCase();
    facts.rackUnits = matchNumber(description,/(?:^|\s|[-/])(\d+)\s*U\b/i);
    facts.psuCount = matchNumber(description,/(?:CRPS|PSU|БП)\s*(\d+)\s*[xх×]\s*\d+\s*(?:W|Вт)/i);
    facts.psuWatts = matchNumber(description,/(?:CRPS|PSU|БП)\s*\d+\s*[xх×]\s*(\d+)\s*(?:W|Вт)/i);
    facts.bays = [...description.matchAll(/(\d+)\s*[xх×]\s*(2[.,]5|3[.,]5)\s*["”″]?\s*(rear\s*)?((?:SATA|SAS|NVMe)(?:\s*[/+]\s*(?:SATA|SAS|NVMe))*)/gi)].map(match => ({count:Number(match[1]),form:match[2].replace(',','.'),rear:Boolean(match[3]),protocols:match[4].toUpperCase().split(/\s*[/+]\s*/)}));
  } else if (kind === 'cpu') {
    facts.tdp = matchNumber(description,/(\d+)\s*(?:W|Вт)\b/i);
    const cores = description.match(/(\d+)\s*C\s*\/\s*(\d+)\s*T\b/i);
    if (cores) { facts.cores = Number(cores[1]); facts.threads = Number(cores[2]); }
  } else if (kind === 'memory') {
    facts.capacityGB = storageSize(description);
    facts.ddr = description.match(/\bDDR[345]\b/i)?.[0].toUpperCase();
    facts.type = /\bLRDIMM\b/i.test(description) ? 'LRDIMM' : /\b(?:RDIMM|Registered|Reg)\b/i.test(description) ? 'RDIMM' : /\bUDIMM\b/i.test(description) ? /\bECC\b/i.test(description) ? 'ECC UDIMM' : 'UDIMM' : undefined;
    facts.speed = matchNumber(description,/(\d+)\s*(?:MT\/s|MT\/с|МТ\/с)/i);
  } else if (kind === 'storage') {
    facts.capacityGB = storageSize(description);
    facts.protocol = /\bNVMe\b/i.test(description) ? 'NVMe' : /\bSAS\b/i.test(description) ? 'SAS' : /\bSATA\b/i.test(description) ? 'SATA' : undefined;
    facts.form = /\bM\.2\b/i.test(description) ? 'M.2' : /\bU\.2\b/i.test(description) ? 'U.2' : /\bU\.3\b/i.test(description) ? 'U.3' : /2[.,]5\s*["”″]/.test(description) ? '2.5' : /3[.,]5\s*["”″]/.test(description) ? '3.5' : undefined;
    const dimensions = description.match(/\bM\.2\s*\(\s*(\d+)\s*[xх×]\s*(\d+)\s*mm/i);
    if (dimensions) facts.m2Size = `${dimensions[1]}${dimensions[2]}`;
    facts.pcieGeneration = matchNumber(description,/\bPCIe\s*(\d+)(?:\.\d+)?/i);
    facts.pcieLanes = matchNumber(description,/\bPCIe\s*\d+(?:\.\d+)?\s*[xх×]\s*(\d+)/i);
  } else if (['gpu','controller','network'].includes(kind)) {
    if (kind === 'gpu') facts.vramGB = storageSize(description);
    facts.watts = matchNumber(description,/(\d+)\s*(?:W|Вт)\b/i);
    facts.profile = /\b(?:low[- ]profile|LP|HHHL)\b/i.test(description) ? 'low' : undefined;
    facts.width = /\bsingle[- ]slot\b/i.test(description) ? 1 : /\bdual[- ]slot\b/i.test(description) ? 2 : undefined;
  } else if (kind === 'psu') facts.watts = matchNumber(description,/(\d+)\s*(?:W|Вт)\b/i);
  return {line,sku,description,quantity,kind,format,issue,facts:Object.fromEntries(Object.entries(facts).filter(([,value]) => value != null && (!Array.isArray(value) || value.length)))};
}

export function parseBom(text = '') {
  const lines = text.replace(/\r\n?/g,'\n').split('\n');
  const items = lines.map((raw,index) => parseRow(raw,index+1)).filter(Boolean);
  const active = items.filter(item => item.quantity !== 0 && !item.issue);
  const totalsFor = (kind,key) => {
    const rows = active.filter(item => item.kind === kind);
    return rows.length && rows.every(item => item.quantity !== null && (key == null || item.facts[key] != null)) ? rows.reduce((sum,item) => sum + item.quantity * (key == null ? 1 : item.facts[key]),0) : null;
  };
  return {items,active,totals:{units:items.length && items.every(item => item.quantity !== null) ? items.reduce((sum,item) => sum+item.quantity,0) : null,cpuCount:totalsFor('cpu'),cpuCores:totalsFor('cpu','cores'),cpuThreads:totalsFor('cpu','threads'),memoryGB:totalsFor('memory','capacityGB'),memoryCount:totalsFor('memory'),storageGB:totalsFor('storage','capacityGB'),storageCount:totalsFor('storage'),gpuCount:totalsFor('gpu')}};
}

export function prepareConfig(input) {
  const original = validateConfig(input);
  const parsed = parseBom(original.bom);
  const useManual = !original.bom || original.manualMode === 'include';
  const effective = {...original,...(!useManual ? Object.fromEntries(fields.map(field => [field.key,''])) : {})};
  const inferred = {};
  const conflicts = [];
  const propose = (key,value,rows) => {
    if (value == null || value === '' || !fields.some(field => field.key === key)) return;
    if (typeof value === 'string' && value.length > 300) value = value.slice(0,300);
    // Слишком большие/невалидные числа сохраняются в разборе, но не ломают форму.
    try { validateConfig({[key]:value}); } catch { return; }
    if (effective[key] !== '') {
      if (norm(effective[key]) !== norm(value) && !/Model$/.test(key)) {
        conflicts.push({key,manual:effective[key],parsed:value,lines:rows.map(row => row.line)});
        effective[key] = '';
      }
      return;
    }
    effective[key] = value;
    inferred[key] = {value,lines:rows.map(row => row.line)};
  };
  const byKind = kind => parsed.active.filter(item => item.kind === kind);
  const one = (kind,mapping) => {
    const rows = byKind(kind);
    if (rows.length !== 1) return;
    const row = rows[0];
    if (kind === 'platform' && row.quantity !== 1) return;
    for (const [key,fact] of Object.entries(mapping)) propose(key,fact === '$model' ? row.sku || row.description : fact === '$quantity' ? row.quantity : row.facts[fact],rows);
  };
  one('platform',{caseModel:'$model',boardSocket:'socket',boardSockets:'socketCount',boardMaxTdp:'cpuTdpLimit',boardDdr:'ddr',psuCount:'psuCount',psuWatts:'psuWatts'});
  one('board',{boardModel:'$model',boardSocket:'socket',boardSockets:'socketCount',boardMaxTdp:'cpuTdpLimit',boardDdr:'ddr'});
  one('cpu',{cpuModel:'$model',cpuSocket:'socket',cpuCount:'$quantity',cpuTdp:'tdp'});
  one('memory',{ramModel:'$model',ramDdr:'ddr',ramType:'type',ramCount:'$quantity',ramSize:'capacityGB'});
  one('psu',{psuModel:'$model',psuCount:'$quantity',psuWatts:'watts'});
  const cards = parsed.active.filter(item => ['gpu','controller','network'].includes(item.kind));
  if (cards.length === 1) {
    const card = cards[0];
    for (const [key,value] of Object.entries({cardModel:card.sku || card.description,cardCount:card.quantity,cardWatts:card.facts.watts,cardWidth:card.facts.width,cardProfile:card.facts.profile})) propose(key,value,cards);
  }
  // Разные диски не сводятся к одному типу и одному набору отсеков.
  one('storage',{driveModel:'$model',driveCount:'$quantity',driveProtocol:'protocol'});
  return {original,effective:validateConfig(effective),parsed,inferred,conflicts,useManual};
}

export function describeFacts(item) {
  const f = item.facts;
  return [f.socket,f.socketCount != null ? `${f.socketCount} сокета` : '',f.tdp != null ? `${f.tdp} Вт TDP` : '',f.cpuTdpLimit != null ? `лимит CPU ${f.cpuTdpLimit} Вт` : '',f.ddr,f.type,f.dimmSlots != null ? `${f.dimmSlots} слотов DIMM` : '',f.capacityGB != null ? `${f.capacityGB} ГБ / шт.` : '',f.speed != null ? `${f.speed} MT/s` : '',f.form ? `${f.form}${f.m2Size ? ` ${f.m2Size}` : ''}` : '',f.protocol,f.pcieGeneration ? `PCIe ${f.pcieGeneration}${f.pcieLanes ? ` x${f.pcieLanes}` : ''}` : '',f.vramGB != null ? `${f.vramGB} ГБ VRAM / GPU` : '',f.psuCount ? `встроено ${f.psuCount} БП × ${f.psuWatts} Вт` : ''].filter(Boolean).join(' · ');
}
