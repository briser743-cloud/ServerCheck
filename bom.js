// Универсальный разбор спецификации. Последняя колонка — число изделий в строке.
// Числа внутри описания (DIMM-слоты, отсеки, БП, VRAM) не заменяют количество строки.
import { validateConfig, fields } from './schema.js';
import { sourceConflictsWithPosition } from './source-identity.js';

export const kindLabels = { platform:'Платформа / корпус', board:'Материнская плата', cpu:'Процессор', memory:'Оперативная память', storage:'Накопитель', gpu:'GPU', controller:'Контроллер / HBA', network:'Сетевая карта', cable:'Кабель', psu:'Блок питания', cooler:'Охлаждение', unknown:'Не распознано' };
export function isUsableProductSource(sku, source) {
  if (sourceConflictsWithPosition({sku},source)) return false;
  const title = String(source?.title || '');
  if (/не содержит|нет техданных|без подтверждения|не подтвержда(?:ет|ется|ют|ются)|другая платформа|нельзя переносить|не относится к|другая (?:модель|ревизия)/i.test(title)) return false;
  const wantedQle = String(sku || '').match(/\bQLE\d{4}\b/i)?.[0]?.toUpperCase();
  const statedQle = title.match(/\bQLE\d{4}\b/i)?.[0]?.toUpperCase();
  if (wantedQle && statedQle && wantedQle !== statedQle) return false;
  if (String(sku || '').toUpperCase() === '05-60004-00' && /8643/i.test(title)) return false;
  return true;
}
export const knownComponentInfo = {
  'CD8068904657502': { text:'Intel Xeon Gold 6326 · 16 ядер / 32 потока · 185 Вт', url:'https://www.intel.com/content/www/us/en/products/sku/215274/intel-xeon-gold-6326-processor-24m-cache-2-90-ghz/ordering.html', source:'Официальная страница Intel с партномером' },
  '0.95.002.1070': { text:'Gooxi SL201-D12R-G4 · серверная платформа 2U · DDR5 RDIMM', url:'https://www.gooxi.us/ProductList/info_lcid_65_itemid_2808.html', source:'Страница производителя для модели', additionalUrl:'https://brtrade.ru/catalog/servery/komplektuyushchie_dlya_serverov/servernye_platformy/10379/', additionalSource:'Партномер у поставщика' },
  'PK8072205559500': { text:'Intel Xeon Gold 6526Y · заказной код PK8072205559500', url:'https://www.intel.com/content/www/us/en/products/sku/237560/intel-xeon-gold-6526y-processor-37-5m-cache-2-80-ghz/ordering.html', source:'Документация производителя' },
  'MTC20F1045S1RC56BD1': { text:'Micron · DDR5 RDIMM · 32 ГБ · 5600 MT/s · ECC', url:'https://mm.digikey.com/Volume0/opasdata/d220001/medias/docus/9044/MTC20F1045S1RC.pdf', source:'Спецификация Micron у дистрибьютора' },
  'SEDC600M/480G': { text:'Kingston DC600M · SSD 480 ГБ · 2,5″ SATA · 7 мм', url:'https://www.kingston.com/datasheets/SEDC600M_en.pdf', source:'Спецификация производителя' },
  '05-50077-01': { text:'Broadcom MegaRAID 9560-8i · RAID-контроллер · 4 ГБ кеша', url:'https://mm.digikey.com/Volume0/opasdata/d220001/medias/docus/7152/PA-295701.pdf', source:'Документ Broadcom у дистрибьютора' },
  'QLE2772-SR-SP': { text:'Marvell QLogic 2770 · двухпортовый Fibre Channel HBA · PCIe 4.0 x8', url:'https://www.marvell.com/products/fibre-channel-adapters-and-controllers/2770-series.html', source:'Страница производителя' },
  'LRES4164PF-2SFP28': { text:'LR-LINK · OCP 3.0 SFF · 2 × 25G SFP28 · PCIe 4.0 x8', url:'https://www.lr-link.com.cn/productshow/LRES4164PF-2SFP28.html', source:'Страница производителя' },
  'LREC9712HT': { text:'LR-LINK · сетевая карта Intel I350 · 2 × 1G RJ-45 · PCIe x4', url:'https://www.lr-link.com.cn/adaptercarddetail/LREC9712HT.html', source:'Страница производителя' },
  '90SF03Y1-M000N0': { text:'ASUS RS501A-E12-RS4 · серверная платформа 1U · Socket SP5', url:'https://servers.asus.com/products/servers/rack-servers/RS501A-E12-RS4', source:'Страница производителя для модели', additionalUrl:'https://www.factoriapc.com/products/show/servidor-asus-rs501a-e12-rs4-1g-1600w-ocp-47341', additionalSource:'Партномер у поставщика' },
  'M321R4GA0EB2-CCPKC': { text:'Samsung · DDR5 RDIMM · 32 ГБ · 6400 MT/s · ECC', url:'https://calhountechnologies.com/products/samsung-32gb-ddr5-6400-rdimm-ecc-m321r4ga0eb2-ccpkc', source:'Карточка поставщика' },
  'MZ1L2960HCJR-00A07': { text:'Samsung PM9A3 · SSD 960 ГБ · M.2 22110 · NVMe PCIe 4.0 x4', url:'https://www.stesz.com/Upload/SAMSUNG/PM9A3/PM9A3-M.2-Datasheet.pdf', source:'Спецификация Samsung' },
  '900-5G190-2570-000': { text:'NVIDIA RTX 4000 Ada · 20 ГБ GDDR6 ECC · PCIe 4.0 x16', url:'https://www.nvidia.com/en-sg/products/workstations/rtx-4000/', source:'Характеристики NVIDIA', additionalUrl:'https://www.pny.com/File%20Library/Company/Support/Product%20Brochures/NVIDIA%20Data%20Center%20GPUs/NVIDIA-Professional-Graphics-Linecard.pdf', additionalSource:'Артикул в каталоге PNY' },
  'SEDC2000BM8/480G': { text:'Kingston DC2000B · SSD 480 ГБ · M.2 2280 · PCIe 4.0 · с радиатором', url:'https://www.kingston.com.cn/datasheets/SEDC2000B_en.pdf', source:'Спецификация производителя' },
  '900-5G192-2240-000': { text:'NVIDIA RTX 2000 Ada Generation · 16 ГБ GDDR6 ECC', url:'https://www.nvidia.com/en-sg/products/workstations/rtx-2000/', source:'Характеристики NVIDIA', additionalUrl:'https://www.pny.com/File%20Library/Company/Support/linecards/pro-viz-gpus/NVIDIA-Professional-Graphics-Linecard.pdf', additionalSource:'Артикул в каталоге PNY' },
  '0.96.002.1051': { text:'Gooxi SR201-D08R-G2 · серверная платформа 2U · 2 сокета AMD SP5', url:'https://www.gooxi.us/uploadfiles/2024/03/20240315175430209.pdf', source:'Документация производителя для модели' },
  '100-000001542': { text:'AMD EPYC 9455 · SP5 · 48 ядер / 96 потоков · 300 Вт', url:'https://www.amd.com/en/products/processors/server/epyc/9005-series/amd-epyc-9455.html', source:'Сайт производителя' },
  'M321RYGA0PB2-CCPKF': { text:'Samsung · DDR5 RDIMM · 96 ГБ · 6400 MT/s · ECC', url:'https://www.kns.ru/product/operativnaya-pamyat-samsung-m321ryga0pb2-ccpkf/characteristics/', source:'Карточка поставщика' },
  'HUH721010ALN604': { text:'WD Ultrastar DC HC510 · 10 ТБ · 3,5″ SATA · 4Kn', url:'https://documents.westerndigital.com/content/dam/doc-library/en_us/assets/public/western-digital/product/data-center-drives/ultrastar-sata-series/product-manual-ultrastar-dc-hc510-sata-oem-spec.pdf', source:'Руководство производителя' },
  '05-26112-001, LSI00405': { text:'LSI CBL-SFF8643-10M · кабель SFF-8643 — SFF-8643 · 1 м', url:'https://www.netlab.ru/katalog/raid-kontrollery-kabeli/lsi-lsi00405-cbl-sff8643-10m-1-0m-acd-sff8643-10m-6705047-100/', source:'Карточка поставщика' },
  '90SF03X1-M000R0': { text:'ASUS RS521A-E12-RS24U · серверная платформа 2U · Socket SP5', url:'https://dlcdnets.asus.com/pub/ASUS/server/RS521A-E12-RS24U/Manual/E23615_RS521A-E12-RS24U_UM_WEB_20241001.pdf?model=RS521A-E12-RS24U', source:'Руководство производителя для модели' },
  '100-000001552': { text:'AMD EPYC 9115 · SP5 · 16 ядер / 32 потока · 125 Вт', url:'https://www.amd.com/en/products/processors/server/epyc/9005-series/amd-epyc-9115.html', source:'Сайт производителя' },
  'M321R2GA3EB0-CWMCH': { text:'Samsung · DDR5 RDIMM · 16 ГБ · 5600 MT/s · ECC', url:'https://www.kns.ru/product/operativnaya-pamyat-samsung-m321r2ga3eb0-cwmch/characteristics/', source:'Карточка поставщика' },
  'AL15SEB24EQ': { text:'Toshiba · HDD 2,4 ТБ · SAS 12 Гбит/с · 128 МиБ', url:'https://www.toshiba-storage.com/wp/wp-content/uploads/2018/04/TOSHIBA-Datasheet-ALSeries-barrierfree-EN.pdf', source:'Спецификация производителя' },
  '05-25420-081': { text:'Broadcom MegaRAID 9361-8i · 8 каналов SAS/SATA 12 Гбит/с · 2 × SFF-8643 · PCIe 3.0 x8 · кэш 1 ГБ', url:'https://andpro.ru/catalog/computer_hardware/controllers/raid_kontroller_broadcom_9361_8i_sas_12_gb_s_sgl_05_25420_081/', source:'Карточка поставщика' },
  'LRES3039PF-OCP': { text:'LR-Link · OCP 3.0 SFF · 2 × 10G SFP+ · Intel X710 · PCIe 3.0 x8', url:'https://www.lr-link.com.cn/productshow/LRES3039PF-OCP.html', source:'Сайт производителя' },
  '05-50077-02': { text:'Broadcom HBA 9500-16i · 16 внутренних каналов · 2 × SFF-8654 · PCIe 4.0 x8 · SAS/SATA/NVMe', url:'https://docs.broadcom.com/doc/Storage-Solutions-Selection-Guide', source:'Документация производителя' },
  '05-60004-00': { text:'Broadcom · кабель 1 м · SFF-8654 x8 → 2 × SFF-8654 x4', url:'https://docs.broadcom.com/doc/12354774', source:'Документация производителя' },
};
// Only stable model names, never the full user specification, are used as keys.
export function modelSourceKey(description) {
  const text = String(description || '');
  const asus = text.match(/\bASUS\s+(RS\d+[A-Z]?(?:-[A-Z0-9]+){2,})\b/i);
  if (asus) return `MODEL:ASUS ${asus[1].toUpperCase()}`;
  const intel = text.match(/\b(?:INTEL\s+)?XEON\s+(\d{4,5}[A-Z]{0,2})\b/i);
  if (intel) return `MODEL:INTEL XEON ${intel[1].toUpperCase()}`;
  const amd = text.match(/\b(?:AMD\s+)?EPYC\s+(\d{4}[A-Z]{0,2})\b/i);
  if (amd) return `MODEL:AMD EPYC ${amd[1].toUpperCase()}`;
  const solidigm = text.match(/\bSOLIDIGM\b.*?\b(D\d-P\d{4}[A-Z]?)\b/i);
  if (solidigm) return `MODEL:SOLIDIGM ${solidigm[1].toUpperCase()}`;
  if (/\bSAMSUNG\b/i.test(text) && /\bDDR5\b/i.test(text) && /\b64\s*GB\b/i.test(text) && /\bRDIMM\b/i.test(text) && /\b5600\b/i.test(text)) return 'MODEL:SAMSUNG DDR5 64GB RDIMM 5600';
  if (/\bCONNECTX[- ]4\s+LX\b/i.test(text)) return 'MODEL:CONNECTX-4 LX';
  return '';
}
export function lookupKnownComponent(item) {
  const bySku = knownComponentInfo[String(item.sku || '').trim().toUpperCase()];
  if (bySku) return bySku;
  const description = String(item.description || '');
  if (item.sku) return null;
  const aliases = [
    {sku:'100-000001552', pattern:/\bAMD\b(?=.*\bEPYC\s+9115(?![A-Z0-9]))/i},
    {sku:'100-000001542', pattern:/\bAMD\b(?=.*\bEPYC\s+9455(?![A-Z0-9]))/i},
    {sku:'900-5G192-2240-000', pattern:/\bNVIDIA\b(?=.*\bRTX\s*2000\s+Ada\b)(?!.*\b(?:SFF|laptop|mobile)\b)/i},
    {sku:'900-5G190-2570-000', pattern:/\bNVIDIA\b(?=.*\bRTX\s*4000\s+Ada\b)(?!.*\b(?:SFF|laptop|mobile)\b)/i},
    {sku:'90SF03X1-M000R0', pattern:/\bASUS\b(?=.*\bRS521A-E12-RS24U\b)/i},
    {sku:'0.96.002.1051', pattern:/\bGooxi\b(?=.*\bSR201-D08R-G2\b)/i},
  ];
  const matches = aliases.filter(entry => entry.pattern.test(description));
  if (matches.length !== 1) return null;
  const {text,url,source} = knownComponentInfo[matches[0].sku];
  return {text,url,source:`${source}; модель по описанию, точный артикул не подтверждён`};
}
const norm = value => String(value).toUpperCase().replace(/[\s_-]/g,'');
const valueOf = value => Number(String(value).replace(',','.'));
const matchNumber = (text,regex) => { const match = text.match(regex); return match ? valueOf(match[1]) : null; };
const unique = values => [...new Set(values.filter(value => value != null && value !== ''))];
export const isPackagingRow = line => /^(?:\s*гофрокороб|[^\t;|]*[\t;|]\s*гофрокороб|\s*BOX[_-][^\s]*\s+гофрокороб)/i.test(String(line || ''));
export function removePackagingRows(text = '') {
  const lines = String(text).replace(/\r\n?/g,'\n').split('\n');
  const kept = lines.filter(line => !isPackagingRow(line));
  return { text:kept.join('\n'), removed:lines.length-kept.length };
}
const storageSize = text => {
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(TB|ТБ|GB|ГБ)(?=$|[\s,/)])/i);
  return match ? valueOf(match[1]) * (/TB|ТБ/i.test(match[2]) ? 1000 : 1) : null;
};

export function classify(text) {
  if (/^(?:cable\b|кабель(?=\s|[/:,]|$))/i.test(text.trim())) return 'cable';
  if (/\b(?:platform|barebone|chassis)\b|платформ|корпус|\bserver\b(?=.*(?:\d+\s*bay\b|\b(?:bay|riser|psu)\b))|\b\d\s*U\b(?=.*(?:LGA\s*\d+|\bSP[3456]\b))|\d\s*U\s*[/,].*(?:DIMM|LGA|SP[345])/i.test(text)) return 'platform';
  if (/\b(?:HBA|RAID|MegaRAID|controller)\b|контроллер/i.test(text)) return 'controller';
  if (/\b(?:SSD|HDD|NVMe)\b|накопител|ж[её]стк.*диск/i.test(text) && !/\b(?:HBA|RAID|controller)\b|контроллер/i.test(text)) return 'storage';
  if (/\b(?:RDIMM|LRDIMM|UDIMM|DIMM|Kingston|KSM\w*|DDR[345])\b|оперативн.*памят/i.test(text) && !/плат[аы]|motherboard|mainboard|\bCPU\b|Xeon|EPYC/i.test(text)) return 'memory';
  if (/\b(?:motherboard|mainboard)\b|материнск|^плата\s*[:—-]/i.test(text)) return 'board';
  if (/\b(?:GPU|NVIDIA|GeForce|Quadro|Radeon|Tesla)\b|видеокарт|графическ.*карт/i.test(text)) return 'gpu';
  if (/\b(?:NIC|ConnectX|Ethernet|network card|X710|E810)\b|сетев.*(?:карт|адаптер)/i.test(text)) return 'network';
  if (/\b(?:PSU|power supply|CRPS)\b|блок.*питания|^БП\b/i.test(text)) return 'psu';
  if (/\b(?:cooler|heatsink)\b|кулер|радиатор/i.test(text)) return 'cooler';
  if (/\b(?:CPU|Xeon|EPYC|Ryzen|Core\s+i[3579])\b|процессор/i.test(text)) return 'cpu';
  return 'unknown';
}

function parseRow(raw,line) {
  const cleaned = raw.trim().replace(/^\|\s*|\s*\|$/g,'').replace(/^\d{10}(?:\s+|\s*[;|]\s*)(?=\S)/,'');
  if (isPackagingRow(cleaned)) return null;
  if (!cleaned || /^[-:|\s]+$/.test(cleaned) || /^(?:артикул|парт\s*номер|part\s*(?:number|no)|sku)[\s\t;|]/i.test(cleaned)) return null;
  let cells = cleaned.includes('\t') ? cleaned.split(/\t+/) : cleaned.includes('|') ? cleaned.split('|') : cleaned.includes(';') ? cleaned.split(';') : cleaned.split(/\s{2,}/);
  cells = cells.map(value => value.trim()).filter(Boolean);
  // A separate price column may follow quantity; it is not a quantity or a specification.
  if (cells.length >= 4 && /^(?:[$€£₽]\s*[\d\s.,]+|[\d\s.,]+\s*(?:[$€£₽]|USD|EUR|RUB))$/i.test(cells.at(-1))) cells.pop();
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
  if (!sku && /^[A-Z0-9][A-Z0-9._/-]*\d[A-Z0-9._/-]*$/i.test(description) && (/[A-Z]/i.test(description) || /[-_/]/.test(description))) sku = description;
  if (description.length > 4000) issue = 'Слишком длинное описание позиции; сократите его до 4000 символов.';
  // Exact identification only; supported interfaces in the description do not
  // make the platform itself a drive. This is not a compatibility claim.
  const knownKinds = { '0.95.001.1001':'platform', '0.95.002.1070':'platform', '05-25420-081':'controller', '05-50077-01':'controller', 'QLE2772-SR-SP':'controller', 'LRES4164PF-2SFP28':'network', 'LRES3039PF-OCP':'network', '05-50077-02':'controller', '05-60004-00':'cable', '05-26112-001, LSI00405':'cable' };
  const knownInfo = lookupKnownComponent({sku,description});
  const kind = knownKinds[sku.trim().toUpperCase()] || (classify(description) === 'unknown' && knownInfo ? classify(knownInfo.text) : classify(description));
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
