import { groups } from './schema.js';
import { sourceConflictsWithPosition } from './source-identity.js';

export const verdictLabels = { compatible:'Совместимо', incompatible:'Не совместимо', unconfirmed:'Не подтверждено' };
export const sourceTypeLabels = { manufacturer:'производитель', distributor:'дистрибьютор', integrator:'интегратор', retailer:'продавец', review:'технический обзор', unknown:'тип не установлен' };
export const checkLabels = {
  platform_support:'поддержка точной моделью платформы', bios:'версия BIOS', quantity:'установка указанного количества',
  memory_population:'схема установки DIMM', capacity:'поддерживаемый объём памяти', slots_and_lanes:'слоты, райзеры и линии PCIe',
  dimensions:'габариты и крепления', interface_and_cabling:'интерфейс, бэкплейн и кабели', power:'питание', cooling:'охлаждение', joint_installation:'совместная установка с остальными позициями',
};
const requirements = {
  platform:['platform_support'], board:['platform_support'],
  cpu:['platform_support','quantity'], memory:['platform_support','quantity'],
  storage:['interface_and_cabling','dimensions','quantity'], gpu:['slots_and_lanes','dimensions'],
  controller:['slots_and_lanes','dimensions','quantity'], network:['slots_and_lanes','dimensions','quantity'],
  psu:['platform_support','dimensions','quantity'], cooler:['platform_support','dimensions','quantity'], unknown:['platform_support'],
};
const missingByKind = {
  platform:'Не хватает данных о физических местах платформы, отсеках, слотах или райзерах для входящих в сборку компонентов.',
  board:'Не проверены физические разъёмы, формат платы и крепления в указанной платформе.',
  cpu:'Не подтверждены физическое соответствие сокета и количество сокетов для всех процессоров.',
  memory:'Не подтверждены поколение/форм-фактор DIMM и наличие нужного количества слотов.',
  storage:'Не подтверждены физический интерфейс накопителя, тип отсека/корзины, размеры и нужное количество мест или адаптеров.',
  gpu:'Не подтверждены физический слот/райзер, профиль, длина, ширина карты и её посадка в корпус.',
  controller:'Не подтверждены физический PCIe-разъём/райзер, размеры карты и доступное количество мест.',
  network:'Не подтверждены физический слот/райзер, профиль, размеры карты и доступное количество мест.',
  psu:'Не подтверждены форм-фактор блока питания, крепление и физическое количество посадочных мест.',
  cooler:'Не подтверждены сокетное крепление, допустимые габариты и высота кулера.',
  unknown:'Не удалось определить физический интерфейс или форм-фактор позиции.',
};

export function createPositions(prepared) {
  let items = prepared.parsed.items;
  if (!items.length) {
    const kindForGroup = {platform:'platform',board:'board',cpu:'cpu',memory:'memory',storage:'storage',expansion:'gpu',power:'psu'};
    const countForGroup = {cpu:'cpuCount',memory:'ramCount',storage:'driveCount',expansion:'cardCount',power:'psuCount'};
    items = groups.filter(group => group.fields.some(field => prepared.effective[field.key] !== '')).map((group,index) => ({
      line:index+1,sku:group.fields.filter(field => /Model$/.test(field.key)).map(field => prepared.effective[field.key]).find(Boolean) || '',
      description:group.title,quantity:countForGroup[group.id] && prepared.effective[countForGroup[group.id]] !== '' ? prepared.effective[countForGroup[group.id]] : null,
      kind:kindForGroup[group.id],origin:'form',
    }));
  }
  return items.map(item => ({
    id:`${item.origin || 'line'}-${item.line}`,line:item.line,sku:item.sku,description:item.description,quantity:item.quantity,kind:item.kind,
    status:'unconfirmed',reason:item.issue || (item.quantity === 0 ? 'Количество равно нулю: позиция не входит в устанавливаемую сборку, её совместимость не оценивалась.' : missingByKind[item.kind]),
    missing:item.quantity === 0 ? [] : [...(item.quantity === null ? ['Не указано количество оборудования по этой строке.'] : []),'Не выполнена проверка применимых первичных документов.'],
    requiredChecks:requirements[item.kind] || requirements.unknown,checks:[],sources:[],technicalSpecs:[],recommendation:'',
  }));
}

export const positionReportFormat = {
  type:'json_schema',name:'server_compatibility_positions',strict:true,
  schema:{type:'object',additionalProperties:false,required:['positions','assemblyAnalysis'],properties:{
    assemblyAnalysis:{type:'object',additionalProperties:false,required:['groups','purchaseNotes'],properties:{
      groups:{type:'array',maxItems:8,items:{type:'object',additionalProperties:false,required:['title','positionIds','summary','recommendation','sources'],properties:{
        title:{type:'string',maxLength:100},positionIds:{type:'array',minItems:1,items:{type:'string'}},
        summary:{type:'string',maxLength:900},recommendation:{type:'string',maxLength:500},
        sources:{type:'array',maxItems:4,items:{type:'object',additionalProperties:false,required:['url','title','scope','sourceType'],properties:{url:{type:'string'},title:{type:'string',maxLength:180},scope:{type:'string',enum:['component','platform','joint']},sourceType:{type:'string',enum:Object.keys(sourceTypeLabels)}}}},
      }}},
      purchaseNotes:{type:'array',maxItems:8,items:{type:'object',additionalProperties:false,required:['title','text','positionIds','sources'],properties:{
        title:{type:'string',maxLength:100},text:{type:'string',maxLength:700},positionIds:{type:'array',minItems:1,items:{type:'string'}},
        sources:{type:'array',maxItems:4,items:{type:'object',additionalProperties:false,required:['url','title','scope','sourceType'],properties:{url:{type:'string'},title:{type:'string',maxLength:180},scope:{type:'string',enum:['component','platform','joint']},sourceType:{type:'string',enum:Object.keys(sourceTypeLabels)}}}},
      }}},
    }},
    positions:{type:'array',items:{
    type:'object',additionalProperties:false,required:['id','status','reason','missing','checks','technicalSpecs','recommendation'],properties:{
      id:{type:'string'},status:{type:'string',enum:Object.keys(verdictLabels)},reason:{type:'string',maxLength:500},missing:{type:'array',items:{type:'string',maxLength:240}},
      recommendation:{type:'string',maxLength:400},
      technicalSpecs:{type:'array',maxItems:6,items:{type:'object',additionalProperties:false,required:['name','value','sources'],properties:{
        name:{type:'string',maxLength:80},value:{type:'string',maxLength:180},
        sources:{type:'array',minItems:1,maxItems:2,items:{type:'object',additionalProperties:false,required:['url','title','scope','sourceType'],properties:{url:{type:'string'},title:{type:'string',maxLength:180},scope:{type:'string',enum:['component','platform','joint']},sourceType:{type:'string',enum:Object.keys(sourceTypeLabels)}}}},
      }}},
      checks:{type:'array',items:{type:'object',additionalProperties:false,required:['aspect','status','reason','sources'],properties:{
        aspect:{type:'string',enum:Object.keys(checkLabels)},status:{type:'string',enum:Object.keys(verdictLabels)},reason:{type:'string',maxLength:400},
        sources:{type:'array',items:{type:'object',additionalProperties:false,required:['url','title','scope','sourceType'],properties:{url:{type:'string'},title:{type:'string',maxLength:180},scope:{type:'string',enum:['component','platform','joint']},sourceType:{type:'string',enum:Object.keys(sourceTypeLabels)}}}},
      }}},
    },
  }}}},
};

const normalizeUrl = value => { try { const url = new URL(value); if (!['http:','https:'].includes(url.protocol)) return null; url.hash=''; return url.href.replace(/\/$/,''); } catch { return null; } };
const text = value => typeof value === 'string' ? value.trim().slice(0,4000) : '';
const hasPairEvidence = sources => sources.some(source => source.scope === 'joint') || sources.some(source => source.scope === 'platform') && sources.some(source => source.scope === 'component');
const platformDocumentChecks = new Set(['platform_support','bios','memory_population','capacity','quantity','slots_and_lanes']);
const physicalPairChecks = new Set(['dimensions','interface_and_cabling','slots_and_lanes']);
const explicitlyAbsentM2 = value => /(?:\bno\s+(?:onboard\s+)?m\.?2\s+(?:slots?|connectors?)\b|m\.?2\s+(?:slots?|connectors?)\s*[:=—-]\s*(?:none|0|absent)|m\.?2\s*[:=—-]\s*(?:нет|none|0|absent)|(?:нет|отсутствуют?)\s+(?:встроенн\w+\s+)?(?:слот\w+|разъ[её]м\w+)\s+m\.?2|m\.?2\s+(?:слот\w+|разъ[её]м\w+)\s+(?:отсутствуют|не предусмотрены|нет)|не поддерживает\s+m\.?2)/i.test(String(value || ''))
  && !/(нет данных|не указано|не подтверждено|not listed|not stated|not confirmed|no evidence)/i.test(String(value || ''));
function exactPlatformDocuments(platform,position,knownSources) {
  const sku = normalized(platform?.sku);
  if (!sku) return [];
  return [...knownSources.values()].filter(source => {
    const ids = source.positionIds;
    if (Array.isArray(ids) && ids.length && !ids.includes(position.id) && !ids.includes(platform.id)) return false;
    return normalized(`${source.url || ''} ${source.title || ''} ${source.text || source.content || ''}`).includes(sku);
  });
}
function explicitM2SlotCount(value) {
  const source = String(value || '');
  const patterns = [
    /(?:\b(\d+)\s*[xх×]\s*)m\.?2\s*(?:slots?|connectors?|sockets?|разъ[её]м\w*|слот\w*)/ig,
    /m\.?2\s*(?:slots?|connectors?|sockets?|разъ[её]м\w*|слот\w*)\s*[:=—-]?\s*(\d+)/ig,
    /(\d+)\s*(?:шт\.?\s*)?(?:слот\w*|разъ[её]м\w*)\s+m\.?2/ig,
  ];
  const counts = [];
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) {
    const count = Number(match[1]);
    if (Number.isInteger(count) && count > 0) counts.push(count);
  }
  return counts.length ? Math.max(...counts) : null;
}

const normalized = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const socketId = value => String(value || '').match(/(?:fc)?lga\s*-?\s*(\d{4,5})/i)?.[1] || null;
const ddrGeneration = value => String(value || '').match(/\bddr\s*([345])\b/i)?.[1] || null;
const itemCount = value => Number.isInteger(value) && value > 0 ? value : null;

function physicalInference(position, platform, checks, knownSources) {
  if (!platform || !itemCount(position.quantity)) return null;
  const platformSources = [...new Map(checks.flatMap(check => check.sources).filter(source => ['platform','joint'].includes(source.scope)).map(source => [source.url,source])).values()];
  const componentSources = [...new Map(checks.flatMap(check => check.sources).filter(source => ['component','joint'].includes(source.scope)).map(source => [source.url,source])).values()];
  // The BOM row itself supplies the component's declared physical format.
  // A platform source is sufficient to compare that format/count with the host;
  // do not turn a missing vendor page for an exact SKU into an unknown fit.
  const platformText = `${platform.sku || ''} ${platform.description || ''}`;
  const componentText = `${position.sku || ''} ${position.description || ''}`;
  const standardEvidence = [...new Map([...platformSources,...componentSources].map(source => [source.url,source])).values()];
  const platformOnly = platformSources;
  let aspects = [];
  let reason = '';
  let recommendation = '';

  if (['platform','board'].includes(position.kind)) {
    const sku = normalized(position.sku);
    const exactPlatform = sku && platformSources.some(source => normalized(`${source.url} ${source.title}`).includes(sku));
    if (!exactPlatform) return null;
    aspects = ['platform_support'];
    reason = `Точная модель платформы ${position.sku} найдена в источнике; она принята как базовый компонент сборки. Совместимость комплектующих оценена отдельно.`;
    recommendation = 'Этот статус подтверждает идентификацию платформы, а не совместимость всех остальных компонентов между собой.';
  } else if (position.kind === 'cpu') {
    const cpuSocket = socketId(componentText);
    const platformSocket = socketId(platformText);
    const socketCount = Number(platformText.match(/(\d+)\s*x\s*(?:fc)?lga\s*-?\s*\d{4,5}/i)?.[1] || 0);
    if (!cpuSocket || cpuSocket !== platformSocket || position.quantity > socketCount) return null;
    aspects = ['platform_support','quantity'];
    reason = `Физически подходит: LGA${cpuSocket}; ${position.quantity} CPU входят в ${socketCount} сокета платформы.`;
    recommendation = 'BIOS, тепловые ограничения и рабочая поддержка модели в этом физическом выводе не оценивались.';
  } else if (position.kind === 'memory') {
    const generation = ddrGeneration(componentText);
    const platformGeneration = ddrGeneration(platformText);
    const slots = Number(platformText.match(/(\d+)\s*x\s*(?:ddr\s*[345]\s*)?dimm/i)?.[1] || 0);
    if (!generation || generation !== platformGeneration || !/\bdimm\b/i.test(componentText) || position.quantity > slots) return null;
    aspects = ['platform_support','quantity'];
    reason = `Физически подходит: DDR${generation} DIMM; ${position.quantity} модуля помещаются в ${slots} слотов.`;
    recommendation = 'ECC/RDIMM-совместимость и частота памяти относятся к электрическому режиму и этим выводом не подтверждаются.';
  } else if (position.kind === 'storage' && /\bm\.?2\b/i.test(componentText) && /(?:22\s*x\s*80|2280)/i.test(componentText)) {
    const exactDocs = exactPlatformDocuments(platform,position,knownSources);
    const documents = exactDocs.map(source => ({source,body:`${source.title || ''}\n${source.text || source.content || ''}`}));
    const absent = documents.filter(item => explicitlyAbsentM2(item.body));
    const present = documents.map(item => ({...item,count:explicitM2SlotCount(item.body)})).filter(item => item.count !== null);
    if (absent.length && present.length) return null;
    if (!present.length || position.quantity > Math.min(...present.map(item => item.count))) return null;
    aspects = ['interface_and_cabling','quantity'];
    reason = `Для точной модели платформы документально указано ${Math.min(...present.map(item => item.count))} разъём(а/ов) M.2; ${position.quantity} накопителя формата M.2 2280 помещаются по числу посадочных мест.`;
    recommendation = 'Совместимость протокола NVMe и PCIe-скорости проверьте отдельно; этот вывод касается физического формата и числа разъёмов.';
    const exactSources = present.map(item => ({url:item.source.url,title:item.source.title || item.source.url,scope:'platform',sourceType:/nix\.ru/i.test(item.source.url) ? 'retailer' : item.source.sourceType || 'unknown'}));
    const inferredChecks = aspects.map(aspect => ({aspect,status:'compatible',reason,sources:exactSources}));
    return {aspects,checks:inferredChecks,reason,recommendation};
  } else if (!platformSources.length) return null;
  else if (position.kind === 'storage' && /\bu\s*\.\s*?2\b|\bu\.2\b/i.test(componentText) && /2\.5\s*(?:"|inch|in\b|mm|дюйм)/i.test(componentText) && /2\.5\s*"?\s*nvme/i.test(platformText)
    && !checks.some(check => /3\.5|противореч|разные версии|различаются/i.test(check.reason))) {
    const bays = Number(platformText.match(/(\d+)\s*[xх]\s*2\.5\s*"?\s*nvme/i)?.[1] || 0);
    if (!bays || position.quantity > bays) return null;
    aspects = ['interface_and_cabling','dimensions','quantity'];
    reason = `Физически подходит по формату: U.2 2,5″; ${position.quantity} накопителя входят в ${bays} отсека 2,5″ NVMe.`;
    recommendation = 'Зазор под высоту 15 мм и электрический режим PCIe отдельно не подтверждены.';
  } else return null;

  const sourcesFor = aspect => ['quantity'].includes(aspect) ? platformOnly : standardEvidence;
  const inferredChecks = aspects.map(aspect => ({
    aspect,status:'compatible',reason,sources:sourcesFor(aspect),
  }));
  return {aspects,checks:inferredChecks,reason,recommendation};
}

// Цветные выводы не принимаются по одному названию модели или неподкреплённому ответу ИИ.
export function reconcilePositions(baseline,candidates,searchedSources = []) {
  const knownSources = new Map();
  for (const source of searchedSources) {
    const url = normalizeUrl(source.url);
    if (!url) continue;
    const existing = knownSources.get(url);
    knownSources.set(url, existing ? { ...existing, positionIds: [...new Set([...(existing.positionIds || []), ...(source.positionIds || [])])] } : source);
  }
  const platformIds = new Set(baseline.filter(position => ['platform','board'].includes(position.kind)).map(position => position.id));
  const platformPosition = baseline.find(position => ['platform','board'].includes(position.kind));
  return baseline.map(position => {
    if (position.quantity === 0) return position;
    const matches = Array.isArray(candidates) ? candidates.filter(item => item?.id === position.id) : [];
    if (matches.length !== 1) return {...position,technicalSpecs:[],missing:[`ИИ ${matches.length ? 'вернул несколько ответов' : 'не вернул ответ'} для этой позиции.`,...position.missing]};
    const candidate = matches[0];
    const technicalSpecs = (Array.isArray(candidate.technicalSpecs) ? candidate.technicalSpecs : []).flatMap(spec => {
      const name = text(spec?.name).slice(0,80);
      const value = text(spec?.value).slice(0,180);
      if (!name || !value) return [];
      const sources = (Array.isArray(spec.sources) ? spec.sources : []).filter(source => {
        const url = normalizeUrl(source?.url);
        const evidence = url ? knownSources.get(url) : null;
        const ids = evidence?.positionIds;
        const applicable = !Array.isArray(ids) || ids.length === 0 || ids.includes(position.id)
          || source.scope === 'platform' && ids.some(id => platformIds.has(id));
        return ['component','platform','joint'].includes(source?.scope) && Boolean(evidence) && applicable
          && !sourceConflictsWithPosition(position,evidence) && !sourceConflictsWithPosition(position,source);
      }).map(source => ({url:source.url,title:text(source.title) || source.url,scope:source.scope,sourceType:Object.hasOwn(sourceTypeLabels,source.sourceType) ? source.sourceType : 'unknown'}));
      return sources.length ? [{name,value,sources}] : [];
    }).slice(0,6);
    const optionalNotes = (Array.isArray(candidate.checks) ? candidate.checks : []).filter(check => check?.status === 'unconfirmed' && !position.requiredChecks.includes(check.aspect)).map(check => `${checkLabels[check.aspect] || check.aspect}: ${text(check.reason)}`).filter(Boolean);
    let checks = (Array.isArray(candidate.checks) ? candidate.checks : []).filter(check => Object.hasOwn(checkLabels,check?.aspect) && !(check.status === 'unconfirmed' && !position.requiredChecks.includes(check.aspect))).map(check => {
      const sources = (Array.isArray(check.sources) ? check.sources : []).filter(source => {
        const url = normalizeUrl(source?.url);
        const evidence = url ? knownSources.get(url) : null;
        const ids = evidence?.positionIds;
        const applicable = !Array.isArray(ids) || ids.length === 0 || ids.includes(position.id)
          || source.scope === 'platform' && ids.some(id => platformIds.has(id));
        return ['component','platform','joint'].includes(source?.scope) && Boolean(evidence) && applicable
          && !sourceConflictsWithPosition(position,evidence) && !sourceConflictsWithPosition(position,source);
      }).map(source => ({url:source.url,title:text(source.title) || source.url,scope:source.scope,sourceType:Object.hasOwn(sourceTypeLabels,source.sourceType) ? source.sourceType : 'unknown'}));
      const platformEvidence = sources.some(source => ['platform','joint'].includes(source.scope));
      const componentEvidence = sources.some(source => ['component','joint'].includes(source.scope));
      const m2Storage = position.kind === 'storage' && /m\.?2/i.test(`${position.sku} ${position.description}`);
      const exactDocs = m2Storage && check.aspect === 'interface_and_cabling' ? exactPlatformDocuments(platformPosition,position,knownSources) : [];
      const exactM2Absence = exactDocs.filter(source => explicitlyAbsentM2(`${source.title || ''} ${source.text || source.content || ''}`));
      const exactM2Slots = exactDocs.map(source => ({source,count:explicitM2SlotCount(`${source.title || ''} ${source.text || source.content || ''}`)})).filter(item => item.count !== null);
      const conflictingM2Evidence = exactM2Absence.length > 0 && exactM2Slots.length > 0;
      const explicitM2Conflict = m2Storage && check.aspect === 'interface_and_cabling' && exactM2Absence.length > 0 && exactM2Slots.length === 0;
      const platformSaysM2Exists = m2Storage && check.aspect === 'interface_and_cabling' && exactM2Slots.length > 0;
      const availableM2Slots = exactM2Slots.length ? Math.min(...exactM2Slots.map(item => item.count)) : 0;
      const m2QuantityConflict = platformSaysM2Exists && position.quantity > availableM2Slots;
      // A platform support list can directly establish support for an exact part.
      // Requiring a second component document here duplicated the same fact check
      // and incorrectly downgraded explicitly listed, platform-qualified parts.
      const valid = text(check.reason) && (explicitM2Conflict || (check.aspect === 'joint_installation' || physicalPairChecks.has(check.aspect)
        ? hasPairEvidence(sources)
        : platformDocumentChecks.has(check.aspect)
          ? platformEvidence || hasPairEvidence(sources)
          : componentEvidence || hasPairEvidence(sources)));
      const status = explicitM2Conflict || m2QuantityConflict ? 'incompatible' : conflictingM2Evidence ? 'unconfirmed' : platformSaysM2Exists ? 'compatible' : valid && ['compatible','incompatible'].includes(check.status) ? check.status : 'unconfirmed';
      const exactM2Sources = [...exactM2Absence,...exactM2Slots.map(item => item.source)].map(source => ({url:source.url,title:text(source.title) || source.url,scope:'platform',sourceType:/nix\.ru/i.test(source.url) ? 'retailer' : Object.hasOwn(sourceTypeLabels,source.sourceType) ? source.sourceType : 'unknown'}));
      const finalSources = (explicitM2Conflict || conflictingM2Evidence || platformSaysM2Exists) ? exactM2Sources : sources;
      const finalReason = explicitM2Conflict
        ? 'В источнике точной модели платформы прямо указано, что разъёмов M.2 нет; устанавливаемое устройство M.2 2280 физически подключить напрямую некуда.'
        : m2QuantityConflict
          ? `В источнике точной модели указано ${availableM2Slots} разъём(а/ов) M.2, а требуется ${position.quantity}; для всех устройств физических посадочных мест не хватает.`
        : conflictingM2Evidence
          ? 'Источники точной модели платформы противоречат друг другу: один указывает отсутствие M.2, другой — наличие разъёмов. Нужна проверка ревизии/документа.'
          : platformSaysM2Exists
            ? `Источник точной модели платформы указывает ${Math.min(...exactM2Slots.map(item => item.count))} разъём(а/ов) M.2; заявленное количество устройств: ${position.quantity}.`
            : text(check.reason) || 'Основание не предоставлено.';
      const evidenceIssue = ['compatible','incompatible'].includes(check.status) && !valid
        ? sources.length ? ' Источники не подтверждают условия этой проверки для выбранной платформы и компонента.' : ' Ссылки на прочитанные документы для этой проверки отсутствуют.'
        : '';
      return {aspect:check.aspect,status,reason:finalReason + evidenceIssue,sources:finalSources};
    });
    const inference = physicalInference(position,platformPosition,checks,knownSources);
    if (inference) {
      const byAspect = new Map(checks.map(check => [check.aspect,check]));
      for (const inferred of inference.checks) {
        const existing = byAspect.get(inferred.aspect);
        byAspect.set(inferred.aspect,existing
          ? {...existing,status:'compatible',reason:inferred.reason,sources:inferred.sources}
          : inferred);
      }
      checks = [...byAspect.values()];
    }
    const sources = [...new Map(checks.flatMap(check => check.sources).map(source => [source.url,source])).values()];
    const incompatible = checks.filter(check => position.requiredChecks.includes(check.aspect) && check.status === 'incompatible');
    const unresolved = position.requiredChecks.filter(aspect => {
      const matching = checks.filter(check => check.aspect === aspect);
      return matching.length !== 1 || matching[0].status === 'unconfirmed';
    });
    const modelMissing = unresolved.length && Array.isArray(candidate.missing) ? candidate.missing.map(text).filter(Boolean) : [];
    const missing = inference ? [] : [...new Set([...modelMissing,...unresolved.map(aspect => `Не подтверждено: ${checkLabels[aspect]}.`),...(position.quantity === null ? ['Не указано количество оборудования.'] : [])])];
    let status = 'unconfirmed';
    let reason = candidate.status === 'unconfirmed' && text(candidate.reason) ? text(candidate.reason) : 'Для однозначного вывода не подтверждены все необходимые условия установки.';
    if (incompatible.length) { status = 'incompatible'; reason = incompatible.map(check => check.reason).join(' '); }
    else if (inference) {
      status = 'compatible';
      reason = inference.reason;
    } else if (!missing.length && position.requiredChecks.length && text(candidate.reason)) {
      status = 'compatible';
      reason = candidate.status === 'compatible' ? text(candidate.reason) : [...new Set(checks.filter(check => position.requiredChecks.includes(check.aspect)).map(check => check.reason))].join(' ');
    }
    const recommendation = [...new Set([status !== 'unconfirmed' && sources.length ? text(candidate.recommendation) : '', ...optionalNotes,inference?.recommendation || ''])].filter(Boolean).join(' ');
    // Intel documents this exact model as 1S; socket fit cannot establish 2P operation.
    const platforms = baseline.filter(item => ['platform','board'].includes(item.kind) && item.quantity !== 0);
    if (position.kind === 'cpu' && position.quantity > 1 && platforms.length === 1 && platforms[0].quantity === 1 && /\b(?:intel\s+)?xeon\s+6511p\b/i.test(`${position.sku || ''} ${position.description || ''}`)) {
      const source = {url:'https://www.intel.com/content/www/us/en/products/sku/242666/intel-xeon-6511p-processor-72m-cache-2-30-ghz/specifications.html',title:'Intel Xeon 6511P: Scalability 1S',scope:'component',sourceType:'manufacturer'};
      const reason = `Intel указывает для Xeon 6511P масштабируемость 1S: один процессор в системе. В одной платформе указано ${position.quantity} процессора; двухпроцессорная конфигурация не поддерживается.`;
      const corrected = checks.filter(check => check.aspect !== 'quantity');
      corrected.push({aspect:'quantity',status:'incompatible',reason,sources:[source]});
      return {...position,status:'incompatible',reason,missing:[],checks:corrected,sources:[source,...sources.filter(item => item.url !== source.url)],technicalSpecs,recommendation:'Используйте один процессор либо подберите модель с подтверждённой поддержкой двухпроцессорной конфигурации и совместимостью с платформой.'};
    }
    return {...position,status,reason,missing:status === 'compatible' ? [] : missing,checks,sources,technicalSpecs,recommendation};
  });
}

export function countVerdicts(positions) {
  return Object.fromEntries(Object.keys(verdictLabels).map(status => [status,positions.filter(position => position.status === status).length]));
}
