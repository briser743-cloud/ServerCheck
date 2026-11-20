import { groups, fields, optionPairs, validateConfig } from './schema.js';
import { cleanLegacyDraft } from './draft.js';
import { analyzeConfig } from './engine.js';
import { parseBom, describeFacts, kindLabels, knownComponentInfo, lookupKnownComponent, classify, removePackagingRows, modelSourceKey, isUsableProductSource } from './bom.js';
import { verdictLabels, sourceTypeLabels } from './positions.js';
import { renderPositionsMarkup, escapeHtml, safeUrl, omitRepeatedReferences, setSourcePriorities, sortSourcesByPriority, previewSourceLinks } from './report-view.js';
import { cleanComponentFacts } from './component-knowledge.js';

const $ = selector => document.querySelector(selector);
const form = $('#config-form');
const storageKey = 'servercheck.config.v1';
const statusLabels = verdictLabels;
let currentReport = null;
let productLookup = new Map();

let selectedFilter = 'all';
let busy = false;
let apiReady = false;
let connectionError = '';
const modelStorageKey = 'servercheck.model.v1';
let selectedModel = localStorage.getItem(modelStorageKey) || '';

const themeKey = 'servercheck.theme.v1';
const themeMedia = matchMedia('(prefers-color-scheme: light)');
function applyTheme(value) {
  const mode = ['system','light','dark'].includes(value) ? value : 'system';
  document.documentElement.dataset.theme = mode === 'system' ? (themeMedia.matches ? 'light' : 'dark') : mode;
  document.querySelector('#theme-select').value = mode;
}
let savedTheme = 'system';
try { savedTheme = localStorage.getItem(themeKey) || 'system'; } catch {}
applyTheme(savedTheme);
document.querySelector('#theme-select').addEventListener('change', event => {
  const value = event.target.value;
  try { localStorage.setItem(themeKey,value); } catch {}
  applyTheme(value);
});
themeMedia.addEventListener('change', () => { if (document.querySelector('#theme-select').value === 'system') applyTheme('system'); });

const resourceKey = 'servercheck.priorityResources.v1';
let priorityPreviewReady = false;
function readPriorityResources() {
  try { const value = JSON.parse(localStorage.getItem(resourceKey) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; }
}
function renderPriorityResources() {
  const resources = readPriorityResources();
  setSourcePriorities(resources);
  $('#priority-list').innerHTML = resources.length ? resources.map((item, index) => `<div class="priority-row"><strong>${escapeHtml(item.manufacturer)}</strong><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.url)}</a><button class="text-button" type="button" data-remove-resource="${index}">Удалить</button></div>`).join('') : '<p>Ресурсы пока не добавлены.</p>';
  if (currentReport) renderPositionReport(currentReport);
  else if (priorityPreviewReady && $('#bom')?.value) { const parsed = parseBom($('#bom').value); $('#bom-preview').innerHTML = parsed.items.length ? inventoryHtml(parsed,'Распознано из списка',true) : ''; }
}
let priorityWrites = Promise.resolve();
async function persistPriorityResources(resources) {
  try { localStorage.setItem(resourceKey,JSON.stringify(resources)); } catch {}
  const operation = priorityWrites.then(async () => {
    const response = await fetch('/api/priority-resources',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({resources})});
    if (!response.ok) throw new Error('Не удалось сохранить настройки в проекте.');
  });
  priorityWrites = operation.catch(() => {});
  try { await operation; $('#priority-message').textContent = 'Настройки сохранены в файле проекта.'; return true; }
  catch { $('#priority-message').textContent = 'Не удалось сохранить настройки в проекте. Они остались в этом браузере.'; return false; }
}
async function syncPriorityResources() {
  try {
    const response = await fetch('/api/priority-resources');
    if (!response.ok) throw new Error('Настройки недоступны.');
    const data = await response.json();
    if (data.initialized) {
      localStorage.setItem(resourceKey,JSON.stringify(data.resources));
      renderPriorityResources();
    } else {
      const existing = readPriorityResources();
      if (existing.length) await persistPriorityResources(existing);
    }
  } catch { $('#priority-message').textContent = 'Не удалось загрузить настройки из проекта. Используются данные этого браузера.'; }
}
const priorityLoadPromise = syncPriorityResources();
document.querySelector('a[href="#settings"]').addEventListener('click', () => { $('#settings').open = true; });
$('#priority-form').addEventListener('submit', async event => {
  event.preventDefault();
  await priorityLoadPromise;
  const manufacturer = $('#priority-maker').value.trim();
  let url; try { url = new URL($('#priority-url').value.trim()); } catch { return; }
  if (!manufacturer || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) { $('#priority-message').textContent = 'Укажите производителя и корректный адрес http или https.'; return; }
  const resources = readPriorityResources();
  if (resources.length >= 30) { $('#priority-message').textContent = 'Можно добавить не более 30 ресурсов.'; return; }
  resources.push({manufacturer, url: url.origin});
  event.target.reset(); const saving = persistPriorityResources(resources); renderPriorityResources(); await saving;
});
$('#priority-list').addEventListener('click', async event => {
  const button = event.target.closest('[data-remove-resource]'); if (!button) return;
  await priorityLoadPromise;
  const resources = readPriorityResources(); resources.splice(Number(button.dataset.removeResource), 1);
  const saving = persistPriorityResources(resources); renderPriorityResources(); await saving;
});
renderPriorityResources();

function renderFields() {
  $('#component-fields').innerHTML = groups.map(group => `<details class="component" id="group-${group.id}"><summary><span class="component-icon" aria-hidden="true">${group.icon}</span><span><span class="component-title">${group.title}</span><span class="component-subtitle">${group.subtitle}</span></span><span class="component-count" id="count-${group.id}">Не заполнено</span></summary><div class="component-body"><p class="component-help">${group.help}</p><div class="field-grid">${group.fields.map(field => {
    let control;
    if (field.type === 'select') control = `<select id="${field.key}" name="${field.key}"><option value="">Не указано / не знаю</option>${optionPairs(field).map(([value,label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('')}</select>`;
    else control = `<input id="${field.key}" name="${field.key}" type="${field.type}" ${field.type === 'number' ? `min="${field.min}" max="${field.max}" step="${field.step}" inputmode="decimal"` : 'maxlength="300"'} placeholder="${escapeHtml(field.placeholder || 'Не указано')}">`;
    return `<div${field.wide ? ' class="wide"' : ''}><label for="${field.key}">${field.label}</label>${control}</div>`;
  }).join('')}</div></div></details>`).join('');
}

function readConfig() { return validateConfig(Object.fromEntries(new FormData(form))); }
function fillForm(data) {
  const config = validateConfig(data);
  for (const [key,value] of Object.entries(config)) {
    const element = form.elements.namedItem(key);
    if (element?.type === 'checkbox') element.checked = value === 'include';
    else if (element) element.value = value;
  }
}
function hasHardware(config) { return Boolean(config.bom || fields.some(field => config[field.key] !== '')); }
function signature(config) { return JSON.stringify(config); }
function isStale() {
  if (!currentReport) return false;
  try { return signature(readConfig()) !== signature(currentReport.config); } catch { return true; }
}
function updateStale() {
  const notice = $('#stale-notice');
  if (notice) notice.hidden = !isStale();
}
function changed() {
  const cleaned = removePackagingRows($('#bom').value);
  if (cleaned.removed) {
    $('#bom').value = cleaned.text;
    $('#packaging-notice').textContent = `Строк упаковки удалено: ${cleaned.removed}.`;
    $('#packaging-notice').hidden = false;
  }
  let count = 0;
  for (const group of groups) {
    const groupCount = group.fields.filter(field => form.elements.namedItem(field.key).value.trim() !== '').length;
    count += groupCount;
    $(`#count-${group.id}`).textContent = groupCount ? `${groupCount} / ${group.fields.length}` : 'Не заполнено';
  }
  $('#filled-count').textContent = `Заполнено полей: ${count}`;
  const parsed = parseBom($('#bom').value);
  $('#bom-preview').innerHTML = parsed.items.length ? inventoryHtml(parsed,'Распознано из списка',true) : '';
  updateStale();
  try {
    localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(new FormData(form))));
    $('#save-status').textContent = 'Черновик сохранён в этом браузере';
  } catch { $('#save-status').textContent = 'Хранилище браузера недоступно. Черновик не сохранён.'; }
}

const productLinkCacheKey = 'servercheck.productLinks.v1';
const productFactsCacheKey = 'servercheck.productFacts.v1';
function loadProductFactsCache() {
  try { const value = JSON.parse(localStorage.getItem(productFactsCacheKey) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; }
}
function savedComponentFacts(item) {
  const key = item.sku ? item.sku.toUpperCase() : modelSourceKey(item.description);
  return key ? cleanComponentFacts(key,loadProductFactsCache()[key],isUsableProductSource) : [];
}
function savedComponentSummary(item) {
  const facts = savedComponentFacts(item);
  return facts.length ? `Из сохранённых характеристик: ${facts.slice(0,3).map(fact => `${fact.name}: ${fact.value}`).join(' · ')}` : '';
}
function loadProductLinkCache() {
  try { const value = JSON.parse(localStorage.getItem(productLinkCacheKey) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; }
}
function showSourceSaveStatus(message) {
  const status = $('#source-save-status');
  status.textContent = message;
  status.hidden = !message;
}
async function saveProjectSources(entries) {
  if (!entries.length) return true;
  try {
    let rejected = 0;
    for (let offset = 0; offset < entries.length; offset += 100) {
      const response = await fetch('/api/component-sources',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({entries:entries.slice(offset,offset+100)})});
      if (!response.ok) throw new Error('Сервер не сохранил ссылки.');
      rejected += (await response.json()).rejected || 0;
    }
    showSourceSaveStatus(rejected ? `Ссылки сохранены в справочнике проекта; не удалось перенести позиций: ${rejected}.` : 'Ссылки сохранены в справочнике проекта.');
    return true;
  } catch {
    showSourceSaveStatus('Не удалось сохранить ссылки в справочник проекта; они остались в этом браузере.');
    return false;
  }
}
async function syncProjectSources() {
  try {
    const response = await fetch('/api/component-sources');
    if (!response.ok) throw new Error('Справочник недоступен.');
    const data = await response.json();
    const local = loadProductLinkCache();
    const facts = loadProductFactsCache();
    const entries = Object.entries(local).filter(([,links]) => Array.isArray(links) && links.length).map(([sku,links]) => ({sku,links,technicalSpecs:cleanComponentFacts(sku,facts[sku],isUsableProductSource)}));
    for (const [sku,entry] of Object.entries(data.components || {})) {
      if (!Array.isArray(entry?.links)) continue;
      local[sku] = [...new Map([...entry.links,...(Array.isArray(local[sku]) ? local[sku] : [])].filter(link => safeUrl(link?.url) && isUsableProductSource(sku,link)).map(link => [safeUrl(link.url),link])).values()].slice(0,5);
      const savedFacts = cleanComponentFacts(sku,entry.technicalSpecs,isUsableProductSource);
      if (savedFacts.length) facts[sku] = savedFacts;
    }
    try { localStorage.setItem(productLinkCacheKey,JSON.stringify(local)); } catch {}
    try { localStorage.setItem(productFactsCacheKey,JSON.stringify(facts)); } catch {}
    const parsed = parseBom($('#bom').value);
    $('#bom-preview').innerHTML = parsed.items.length ? inventoryHtml(parsed,'Распознано из списка',true) : '';
    await saveProjectSources(entries.map(entry => ({...entry,technicalSpecs:cleanComponentFacts(entry.sku,facts[entry.sku],isUsableProductSource)})));
  } catch { showSourceSaveStatus('Не удалось открыть справочник ссылок проекта.'); }
}
function sourceMatchesModel(position, source) {
  const modelKey = modelSourceKey(position.description);
  const model = modelKey.replace(/^MODEL:(?:ASUS |INTEL |AMD |SOLIDIGM )/, '');
  const evidence = `${source.title || ''} ${source.url || ''}`.toUpperCase().replace(/[^A-Z0-9]+/g,' ');
  if (modelKey === 'MODEL:SAMSUNG DDR5 64GB RDIMM 5600') return ['SAMSUNG','DDR5','64GB','RDIMM','5600'].every(token => (` ${evidence} `).includes(` ${token} `));
  const modelTerms = model.replace(/[^A-Z0-9]+/g,' ').trim();
  if (model && (` ${evidence} `).includes(` ${modelTerms} `)) return true;
  const models = String(position.description || '').match(/\b(?=[A-Z0-9-]*[A-Z])(?=[A-Z0-9-]*\d)[A-Z0-9]+(?:-[A-Z0-9]+)+\b/gi) || [];
  const text = `${source.title || ''} ${source.url || ''}`.toUpperCase();
  return models.some(model => {
    if (model.length < 8) return false;
    const token = model.toUpperCase();
    let index = text.indexOf(token);
    while (index >= 0) {
      if (!/[A-Z0-9]/.test(text[index - 1] || '') && !/[A-Z0-9-]/.test(text[index + token.length] || '')) return true;
      index = text.indexOf(token, index + 1);
    }
    return false;
  });
}
function rememberProductLinks(report) {
  const cache = loadProductLinkCache();
  const facts = loadProductFactsCache();
  const newEntries = [];
  const norm = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g,'');
  for (const position of report.positions || []) {
    const sku = position.sku || modelSourceKey(position.description); const key = norm(sku);
    if (key.length < 5) continue;
    const sources = [...(position.sources || []), ...(position.readSources || []), ...(position.technicalSpecs || []).flatMap(spec => spec.sources || [])];
    const matches = sortSourcesByPriority(sources).filter(source => { const url = safeUrl(source.url); if (!url || !isUsableProductSource(sku,source)) return false; let decoded = url; try { decoded = decodeURIComponent(url); } catch {} return source.exactSkuMentioned === true || norm((source.title || '') + ' ' + decoded).includes(key) || sourceMatchesModel(position,source); }).map(source => ({url:safeUrl(source.url),title:String(source.title || 'Страница товара').slice(0,250),modelOnly:sku.startsWith('MODEL:') || (!source.exactSkuMentioned && !norm((source.title || '') + ' ' + source.url).includes(key))})).slice(0,3);
    const technicalSpecs = cleanComponentFacts(sku,position.technicalSpecs,isUsableProductSource);
    const links = omitRepeatedReferences(sortSourcesByPriority([...matches,...technicalSpecs.flatMap(fact => fact.sources)]),[]).slice(0,5);
    if (technicalSpecs.length) facts[sku.toUpperCase()] = technicalSpecs;
    if (links.length) { cache[sku.toUpperCase()] = links; newEntries.push({sku,links,technicalSpecs}); }
  }
  try { localStorage.setItem(productLinkCacheKey,JSON.stringify(cache)); } catch {}
  try { localStorage.setItem(productFactsCacheKey,JSON.stringify(facts)); } catch {}
  void saveProjectSources(newEntries);
}

function productSourceMarkup(item) {
  const known = lookupKnownComponent(item);
  const identifier = item.sku ? item.sku.toUpperCase() : modelSourceKey(item.description);
  const cached = identifier ? loadProductLinkCache()[identifier] : [];
  const saved = Array.isArray(cached) ? cached : [];
  const position = currentReport && !isStale() ? currentReport.positions?.find(row => row.line === item.line && row.sku === item.sku) : null;
  const knownSources = known ? [{url:known.url,title:known.source,modelOnly:!item.sku},...(known.additionalUrl ? [{url:known.additionalUrl,title:known.additionalSource,modelOnly:false}] : [])] : [];
  const researchSources = [...(position?.sources || []), ...(position?.readSources || []), ...(position?.technicalSpecs || []).flatMap(spec => spec.sources || [])];
  const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g,'');
  const sku = normalize(item.sku);
  const matches = researchSources.filter(source => {
    if (!safeUrl(source?.url) || !isUsableProductSource(item.sku,source)) return false;
    let decoded = source.url; try { decoded = decodeURIComponent(decoded); } catch {}
    return (sku.length >= 5 && (source.exactSkuMentioned || normalize(`${source.title || ''} ${decoded}`).includes(sku))) || sourceMatchesModel(item,source);
  }).map(source => ({...source,modelOnly:!item.sku || (!source.exactSkuMentioned && !normalize(`${source.title || ''} ${source.url}`).includes(sku))}));
  // A specification can have an applicable source whose title/URL omits the
  // ordering SKU. Keep the same sources already offered in the facts disclosure.
  const factSources = (position?.technicalSpecs?.length ? position.technicalSpecs : savedComponentFacts(item)).filter(fact => fact.name && fact.value)
    .flatMap(fact => fact.sources || [])
    .filter(source => safeUrl(source?.url) && isUsableProductSource(item.sku,source))
    .map(source => ({...source,factOnly:true}));
  const sources = [...knownSources, ...saved.filter(source => isUsableProductSource(item.sku,source)), ...matches, ...factSources].filter(source => safeUrl(source?.url));
  const selected = omitRepeatedReferences(sortSourcesByPriority(sources),[]).slice(0,5);
  return previewSourceLinks(selected);
}

function previewKind(item) {
  if (item.kind !== 'unknown') return kindLabels[item.kind];
  const kinds = [...new Set((productLookup.get(item.sku) || []).map(source => classify(source.title || '')).filter(kind => kind !== 'unknown'))];
  return kinds.length === 1 ? kindLabels[kinds[0]] + ' (по названию страницы)' : kindLabels.unknown;
}

function previewResearchFacts(item) {
  const position = currentReport && !isStale() ? currentReport.positions?.find(row => row.line === item.line && row.sku === item.sku) : null;
  const facts = (position?.technicalSpecs?.length ? position.technicalSpecs : savedComponentFacts(item)).filter(fact => fact.name && fact.value && fact.sources?.some(source => safeUrl(source.url) && isUsableProductSource(item.sku,source))).slice(0,6);
  if (!facts.length) return '';
  return `<details class="more-information"><summary>Характеристики с источниками (${facts.length})</summary><div class="field-hint"><strong>Найдено при проверке:</strong> ${facts.map(fact => {
    const source = sortSourcesByPriority(fact.sources).find(entry => safeUrl(entry.url) && isUsableProductSource(item.sku,entry));
    return `<span>${escapeHtml(fact.name)}: ${escapeHtml(fact.value)} (<a href="${escapeHtml(safeUrl(source.url))}" target="_blank" rel="noopener noreferrer">источник</a>)</span>`;
  }).join(' · ')}</div></details>`;
}

function inventoryHtml(parsed,title,open = false) {
  const t = parsed.totals;
  const metrics = [[t.cpuCount,'CPU'],[t.memoryGB,'ГБ RAM'],[t.storageCount,'накопителей'],[t.storageGB,'ГБ до RAID'],[t.gpuCount,'GPU']].filter(([value]) => value !== null);
  return `<details class="inventory" ${open ? 'open' : ''}><summary>${title}: ${parsed.items.length} строк${t.units != null ? ` · ${t.units} ед.` : ''}</summary><p class="field-hint">Итоги по всему списку. Количество — после описания; цена игнорируется. Характеристики из описания требуют проверки.</p>${metrics.length ? `<div class="inventory-totals">${metrics.map(([value,label]) => `<span><strong>${value}</strong> ${label}</span>`).join('')}</div>` : ''}<div class="table-scroll"><table class="inventory-table"><thead><tr><th scope="col">Артикул и категория</th><th scope="col">Извлечённые характеристики</th><th scope="col">Кол-во</th><th scope="col"><span class="visually-hidden">Удаление</span></th></tr></thead><tbody>${parsed.items.map(item => `<tr${item.quantity === 0 ? ' class="inactive-row"' : ''}><td><strong>${escapeHtml(item.sku || `Строка ${item.line}`)}</strong><small>${escapeHtml(previewKind(item))}</small><p class="source-description">${escapeHtml(item.description)}</p></td><td>${escapeHtml(lookupKnownComponent(item)?.text || savedComponentSummary(item) || describeFacts(item) || 'Характеристики не найдены в описании.')}${productSourceMarkup(item)}${previewResearchFacts(item)}${item.issue ? `<p class="warn">${escapeHtml(item.issue)}</p>` : ''}</td><td><strong class="${item.quantity === null ? 'warn' : 'accent'}">${item.quantity ?? '?'}</strong>${item.quantity === 0 ? '<small>исключено</small>' : ''}</td><td><button type="button" class="remove-position" data-remove-line="${item.line}" aria-label="Удалить ${escapeHtml(item.sku || `строку ${item.line}`)} из спецификации" title="Удалить строку">×</button></td></tr>`).join('')}</tbody></table></div></details>`;
}

function reportHeader(report) {
  return basicReportHeader(report);
}

function basicReportHeader(report) {
  if (report.preliminary) {
    const issues = (report.findings || []).filter(finding => ['bad','warn'].includes(finding.status));
    return `<section class="decision-hero verdict-unconfirmed" aria-label="Предварительный результат"><div><p class="decision-kicker">ПРЕДВАРИТЕЛЬНЫЙ РЕЗУЛЬТАТ</p><h3>Список разобран: ${report.positions.length} строк</h3><p>Это быстрая проверка введённых данных. ${report.preliminaryError ? 'Подробная проверка не завершена. Исправьте указанную ошибку и повторите проверку.' : 'Документы ещё проверяются в фоне; техническая совместимость пока не подтверждена.'}</p>${issues.length ? `<ul>${issues.slice(0,6).map(issue => `<li>${escapeHtml(issue.title)}: ${escapeHtml(issue.detail)}</li>`).join('')}</ul>` : '<p>Явных противоречий в доступных введённых данных не обнаружено. Это не подтверждение совместимости.</p>'}</div></section>`;
  }
  const positions = report.positions || [];
  const counts = { compatible: 0, incompatible: 0, unconfirmed: 0 };
  for (const position of positions) counts[Object.hasOwn(counts, position.status) ? position.status : 'unconfirmed']++;
  const status = counts.incompatible ? 'incompatible' : !positions.length || counts.unconfirmed ? 'unconfirmed' : 'compatible';
  const titles = { compatible: 'Физическая установка подтверждена', incompatible: 'Есть несовместимые компоненты', unconfirmed: 'Нужно уточнить совместимость' };
  const guidance = { compatible: 'Проверены физические условия установки. Рабочую совместимость, BIOS, питание и охлаждение уточняйте отдельно.', incompatible: 'Исправьте отмеченные конфликты перед покупкой.', unconfirmed: 'Часть условий ещё не подтверждена. Откройте позиции с жёлтым статусом, чтобы узнать, что проверить.' };
  return `<div id="stale-notice" class="stale-notice" ${isStale() ? '' : 'hidden'}>Конфигурация изменилась. Отчёт относится к предыдущей версии — запустите проверку повторно.</div><div class="decision-hero verdict-${status}"><div><p class="decision-kicker">РЕЗУЛЬТАТ ПРОВЕРКИ</p><h3>${titles[status]}</h3><p>${guidance[status]}</p></div><div class="decision-counts"><span class="verdict-text-compatible"><strong>${counts.compatible}</strong> Совместимо</span><span class="verdict-text-incompatible"><strong>${counts.incompatible}</strong> Не совместимо</span><span class="verdict-text-unconfirmed"><strong>${counts.unconfirmed}</strong> Уточнить</span></div></div>`;
}

function renderPositionReport(report) {
  const parsed = parseBom($('#bom').value);
  const wasOpen = $('#bom-preview .inventory')?.open ?? true;
  $('#bom-preview').innerHTML = parsed.items.length ? inventoryHtml(parsed,'Распознано из списка',wasOpen) : '';
  $('#report-content').innerHTML = reportHeader(report) + renderPositionsMarkup(report,selectedFilter);
}

function showError(message) { $('#form-error').textContent = message; $('#form-error').hidden = false; }
function showResearchProgress(config) {
  const positions = analyzeConfig(config).positions;
  const active = positions.filter(position => position.quantity !== 0);
  $('#report-content').insertAdjacentHTML('beforeend', `<section class="research-progress"><h3>Проверка первичных документов в фоне</h3><p id="research-state">Подготовка поиска. Позиций для проверки: ${active.length}.</p><ul>${positions.map(position => `<li data-research-id="${escapeHtml(position.id)}"><span>${escapeHtml(position.sku || position.description)}</span><strong>${position.quantity === 0 ? 'Не устанавливается' : 'Ожидает поиска'}</strong></li>`).join('')}</ul></section>`);
}

function updateResearchProgress(progress) {
  const row = document.querySelector(`[data-research-id="${CSS.escape(progress.positionId)}"] strong`);
  if (row) row.textContent = progress.phase === 'searching' ? 'Поиск и чтение документов…' : `Поиск выполнен · прочитано документов: ${progress.openedDocuments}${progress.fromCache ? ' · ответ из кеша, новый запрос к модели не выполнялся' : ''}`;
  $('#research-state').textContent = `Завершена проверка позиций: ${progress.completed} из ${progress.total}. Итоговый отчёт формируется после завершения всех проверок.`;
}

async function readResearchResponse(response) {
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Не удалось выполнить проверку документов.');
  }
  if (!response.headers.get('content-type')?.includes('application/x-ndjson')) return response.json();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let report;
  function consume(line) {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'error') throw new Error(event.error);
    if (event.type === 'progress') updateResearchProgress(event);
    if (event.type === 'complete') report = event.report;
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        consume(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
      if (done) break;
    }
    consume(buffer);
  } finally {
    reader.releaseLock();
  }
  if (!report) throw new Error('Соединение прервалось до завершения проверки документов. Повторите проверку.');
  return report;
}

async function runAnalysis(event) {
  event.preventDefault();
  if (busy || !form.reportValidity()) return;
  $('#form-error').hidden = true;
  let config;
  try { config = readConfig(); } catch(error) { showError(error.message); return; }
  if (!hasHardware(config)) { showError('Добавьте список моделей или заполните характеристики комплектующих.'); $('#bom').focus(); return; }
  busy = true;
  const button = $('#analyze-button');
  button.disabled = true;
  button.textContent = 'Подключаем проверку документов…';
  currentReport = {...analyzeConfig(config), config, preliminary:true};
  selectedFilter = 'all';
  renderPositionReport(currentReport);
  $('#export-report').disabled = false;
  $('#action-note').textContent = 'Предварительный результат готов. Подробная проверка документов продолжается в фоне.';
  $('#report').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
  try {
    await priorityLoadPromise;
    await priorityWrites;
    // /api/analyze checks configuration, credentials and model capabilities.
    // Avoid a second key/catalog round trip before the actual analysis.
    button.textContent = 'Проверяем первичные документы…';
    $('#action-note').textContent = 'Поиск и чтение выполняются отдельно по каждой позиции. Дождитесь завершения.';
    showResearchProgress(config);
    const response = await fetch('/api/analyze', { method:'POST', headers:{'Content-Type':'application/json','Accept':'application/x-ndjson'}, body:JSON.stringify({config,model:selectedModel,priorityResources:readPriorityResources()}), signal:AbortSignal.timeout(1810000) });
    const data = await readResearchResponse(response);
    const report = {...data, config};
    currentReport = report;
    rememberProductLinks(report);
    selectedFilter = 'all';
    renderPositionReport(report);
    $('#export-report').disabled = false;
    $('#report').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
  } catch(error) {
    if (currentReport?.preliminary) { currentReport.preliminaryError = true; renderPositionReport(currentReport); }
    showError(error.name === 'TimeoutError' ? 'Время проверки документов истекло. Итоговый отчёт не сформирован.' : error.message === 'Failed to fetch' ? 'Нет соединения с сервером. Проверьте, что npm start запущен.' : error.message);
    const progress = $('#research-state');
    if (progress) progress.textContent = 'Проверка прервана. Устраните ошибку подключения и повторите запрос.';
  } finally {
    busy = false;
    button.disabled = false;
    button.innerHTML = 'Проверить документы и совместимость <span aria-hidden="true">↗</span>';
    $('#action-note').textContent = currentReport?.preliminary ? 'Показан предварительный результат. Проверка документов не завершена.' : 'Проверка документов завершена. Подробный результат готов.';
  }
}

function exportReport() {
  if (!currentReport) return;
  const r = currentReport;
  const lines = ['# ServerCheck — отчёт', '', `Сборка: ${r.config.projectName || 'Без названия'}`, `Дата: ${r.createdAt}`, `Режим: ${r.mode === 'local' ? 'Быстрая проверка' : 'ИИ + документация'}`, '', ...(isStale() ? ['ВНИМАНИЕ: конфигурация была изменена после проверки. Отчёт относится к снимку ниже.', ''] : []), `## ${r.title}`, r.summary, ''];
  const allPositions = r.positions || [];
  const overallStatus = allPositions.some(position => position.status === 'incompatible') ? 'Не совместимо'
    : !allPositions.length || allPositions.some(position => position.status !== 'compatible') ? 'Не подтверждено' : 'Совместимо';
  lines.push('## Общая совместимость сборки', overallStatus, '');
  for (const group of r.assemblyAnalysis?.groups || []) {
    const related = allPositions.filter(position => group.positionIds?.includes(position.id));
    const status = related.some(position => position.status === 'incompatible') ? 'Не совместимо'
      : !related.length || related.some(position => position.status !== 'compatible') ? 'Не подтверждено' : 'Совместимо';
    lines.push(`- ${group.title} — ${status}: ${group.summary}`);
  }
  lines.push('');
  if (r.assemblyAnalysis?.groups?.length) {
    lines.push('## Подробный отчёт по узлам','');
    for (const group of r.assemblyAnalysis.groups) {
      const related = (r.positions || []).filter(position => group.positionIds?.includes(position.id));
      const status = related.some(position => position.status === 'incompatible') ? 'Не совместимо'
        : !related.length || related.some(position => position.status === 'unconfirmed') ? 'Не подтверждено' : 'Совместимо';
      lines.push(`### ${group.title} — ${status}`, group.summary, '');
      if (group.recommendation) lines.push('Замечание: '+group.recommendation, '');
      if (group.sources?.length) lines.push('Источники:', ...sortSourcesByPriority(group.sources).map(source => '- '+source.title+': '+source.url), '');
    }
  }
  if (r.assemblyAnalysis?.purchaseNotes?.length) {
    lines.push('## Перед покупкой и сборкой','');
    for (const note of r.assemblyAnalysis.purchaseNotes) lines.push(`### ${note.title}`,note.text,...(note.sources?.length ? ['Источники:',...sortSourcesByPriority(note.sources).map(source => '- '+source.title+': '+source.url)] : []),'');
  }
  lines.push('## Подробный отчёт по компонентам', '');
  for (const position of r.positions || []) {
    lines.push(`## ${position.sku || position.description} — ${verdictLabels[position.status]}`,
      `Количество: ${position.quantity ?? 'не указано'}`, position.reason, '');
    if (position.recommendation) lines.push('Рекомендация: '+position.recommendation, '');
    const remarks = [...(position.missing || []), ...(position.recommendation ? [position.recommendation] : [])];
    if (position.acknowledgedRemarks?.length) lines.push('Подтверждено пользователем:', ...position.acknowledgedRemarks.filter(index => remarks[index]).map(index => '- ' + remarks[index]), 'Отметки пользователя не изменяют технический вердикт.', '');
    if (position.research?.fromCache) lines.push('Использован сохранённый ответ модели (срок хранения 24 часа). Новый запрос к модели не выполнялся.', '');
    if (position.missing?.length) lines.push('Не подтверждено:', ...position.missing.map(item => '- '+item), '');
    if (position.research) lines.push(
      `Поисковых запросов по позиции: ${position.research.searches}. Прочитано документов по позиции: ${position.research.openedDocuments}. Отброшено нерелевантных документов: ${position.research.rejectedDocuments ?? 0}. Документов передано для анализа: ${position.research.sharedDocuments ?? position.research.openedDocuments}.`, '');
    if (position.readSources?.length) lines.push('Прочитанные документы:', ...sortSourcesByPriority(position.readSources).map(source => '- '+source.title+': '+source.url), '');
    lines.push('Источники:', ...(position.sources?.length ? sortSourcesByPriority(position.sources).map(source => '- '+source.title+' ('+(sourceTypeLabels[source.sourceType] || sourceTypeLabels.unknown)+'): '+source.url) : ['Документальные подтверждения не получены.']), '');
    for (const check of position.checks || []) lines.push(`- ${check.aspect}: ${verdictLabels[check.status]}. ${check.reason}`,
      ...sortSourcesByPriority(check.sources || []).map(source => '  Источник: '+source.url));
  }
  lines.push('', '## Проверенная конфигурация', '```json', JSON.stringify(r.config,null,2), '```');
  const url = URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/markdown;charset=utf-8'}));
  const link = document.createElement('a'); link.href = url; link.download = 'servercheck-report.md'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),1000);
}

function formatRub(value) { return new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:8}).format(value); }
function buildAssistantContext(position) {
  const allSources = [...(position.sources || []),...(position.checks || []).flatMap(check => check.sources || []),...(position.technicalSpecs || []).flatMap(spec => spec.sources || [])];
  const sources = [...new Map(allSources.filter(source => /^https?:\/\//i.test(source.url || '')).map(source => [source.url,source])).values()].map(source => `- ${source.title || source.url}: ${source.url}`);
  const unresolved = (position.missing || []).map(item => `- ${item}`);
  const checks = (position.checks || []).map(check => `- ${check.aspect}: ${check.status}; ${check.reason}`);
  const specifications = (position.technicalSpecs || []).map(spec => `- ${spec.name}: ${spec.value}`);
  const assembly = currentReport?.positions?.map(item => `- ${item.sku || item.description}; количество: ${item.quantity ?? 'не указано'}`).join('\n') || '';
  return [
    'Пользователь просит уточнить результат именно по этой позиции. Проверь утверждения по фактам в контексте, не выдумывай отсутствующие характеристики и ссылки.',
    `Позиция: ${position.sku || position.description} — ${position.description} (количество: ${position.quantity ?? 'не указано'})`,
    `Текущий вердикт: ${position.status}. Основание: ${position.reason || 'не указано'}`,
    checks.length ? `Условия из отчёта:\n${checks.join('\n')}` : '',
    specifications.length ? `Подтверждённые технические характеристики:\n${specifications.join('\n')}` : '',
    unresolved.length ? `Что осталось проверить:\n${unresolved.join('\n')}` : '',
    sources.length ? `Ссылки в отчёте:\n${sources.join('\n')}` : 'Ссылок в отчёте нет.',
    assembly ? `Остальные позиции сборки:\n${assembly}` : '',
  ].filter(Boolean).join('\n\n').slice(0,12000);
}
function renderPositionChat(position,scrollLog = true) {
  if (!currentReport?.positions?.includes(position)) return;
  const pageY = window.scrollY;
  renderPositionReport(currentReport);
  window.scrollTo(0,pageY);
  if (scrollLog) {
    const card = document.querySelector(`[data-position-id="${CSS.escape(position.id)}"]`);
    const log = card?.querySelector('[data-chat-log]');
    if (log) log.scrollTop = log.scrollHeight;
  }
}
function openPositionChat(position,compose = true) {
  position.chatOpen = true;
  position.chatComposeOpen = compose;
  position.chatMessages ||= [];
  position.chatContext ||= buildAssistantContext(position);
  position.chatError = '';
  renderPositionChat(position,false);
  if (compose) document.getElementById(`chat-question-${position.id}`)?.focus();
}
$('#report-content').addEventListener('click',event => {
  const removeImage = event.target.closest('[data-remove-image]');
  if (removeImage && currentReport) {
    const form = removeImage.closest('[data-chat-form]');
    const position = currentReport.positions.find(item => item.id === form?.dataset.positionId);
    if (position) position.chatImage = '';
    form.querySelector('[data-image-status]').textContent = 'Изображение удалено.';
    form.querySelector('[data-chat-image]').value = '';
    removeImage.hidden = true;
    return;
  }
  const clarifyButton = event.target.closest('[data-clarify-id]');
  if (clarifyButton && currentReport) {
    const position = currentReport.positions.find(item => item.id === clarifyButton.dataset.clarifyId);
    if (position) openPositionChat(position,true);
    return;
  }
  const continueButton = event.target.closest('[data-chat-id]');
  if (continueButton && currentReport) {
    const position = currentReport.positions.find(item => item.id === continueButton.dataset.chatId);
    if (position) openPositionChat(position,true);
    return;
  }
  const button = event.target.closest('[data-filter]');
  if (!button || !currentReport) return;
  selectedFilter = button.dataset.filter;
  renderPositionReport(currentReport);
});
async function attachChatImage(form, file) {
  const status = form.querySelector('[data-image-status]');
  const position = currentReport?.positions?.find(item => item.id === form.dataset.positionId);
  if (!position || !file) return;
  if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 4 * 1024 * 1024) {
    status.textContent = 'Выберите PNG, JPEG или WebP не больше 4 МБ.';
    return;
  }
  try {
    const image = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
    position.chatImage = image;
    status.textContent = 'Изображение прикреплено.';
    form.querySelector('[data-remove-image]').hidden = false;
  } catch { status.textContent = 'Не удалось прочитать изображение.'; }
}
$('#report-content').addEventListener('change', event => {
  const input = event.target.closest('[data-chat-image]');
  if (input?.files?.[0]) attachChatImage(input.closest('[data-chat-form]'),input.files[0]);
});
$('#report-content').addEventListener('paste', event => {
  const form = event.target.closest('[data-chat-form]');
  if (!form) return;
  const file = [...(event.clipboardData?.files || [])].find(item => item.type.startsWith('image/'));
  if (file) { event.preventDefault(); attachChatImage(form,file); }
});
$('#report-content').addEventListener('change', event => {
  const checkbox = event.target.closest('[data-ack-position]');
  if (!checkbox || !currentReport) return;
  const position = currentReport.positions.find(item => item.id === checkbox.dataset.ackPosition);
  if (!position) return;
  const index = Number(checkbox.dataset.ackIndex);
  const selected = new Set(position.acknowledgedRemarks || []);
  if (checkbox.checked) selected.add(index); else selected.delete(index);
  position.acknowledgedRemarks = [...selected];
  const section = checkbox.closest('[data-ack-section]');
  const total = section.querySelectorAll('[data-ack-index]').length;
  const status = section.querySelector('[data-ack-status]');
  const complete = selected.size === total;
  status.textContent = complete ? '✓ Все замечания подтверждены пользователем' : 'Подтверждено: ' + selected.size + ' из ' + total;
  status.classList.toggle('is-complete', complete);
});
$('#report-content').addEventListener('submit',async event => {
  const chatForm = event.target.closest('[data-chat-form]');
  if (!chatForm || !currentReport) return;
  event.preventDefault();
  const position = currentReport.positions.find(item => item.id === chatForm.dataset.positionId);
  const question = new FormData(chatForm).get('question')?.toString().trim();
  const recheckRequested = new FormData(chatForm).get('recheck') === 'on';
  if (!position || !question || position.chatPending) return;
  position.chatMessages ||= [];
  if (position.chatMessages.length >= 10) position.chatMessages.splice(0,2);
  position.chatMessages.push({role:'user',content:question});
  position.chatPending = true;
  position.chatComposeOpen = false;
  position.chatError = '';
  const messageHistory = position.chatMessages;
  const context = position.chatContext || buildAssistantContext(position);
  renderPositionChat(position);
  try {
    const response = await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:selectedModel || $('#model-select').value,context,messages:messageHistory,image:position.chatImage || undefined}),signal:AbortSignal.timeout(155000)});
    const data = await response.json();
    if (!response.ok) throw new Error(`${data.error || 'Не удалось получить ответ ИИ.'}${data.costRub == null ? '' : ` Фактическое списание: ${formatRub(data.costRub)}.`}`);
    messageHistory.push({role:'assistant',content:data.answer,costRub:data.costRub,sources:data.sources || []});
    position.chatImage = '';
    // A normal question needs only the answer, not another paid analysis.
    if (!recheckRequested) return;
    position.chatError = 'Ответ получен. Повторно проверяем этот компонент с учётом сборки; выполняется дополнительный запрос к ИИ.';
    renderPositionChat(position);
    const previousReport = currentReport;
    const clarification = JSON.stringify({position: {sku:position.sku, description:position.description, id:position.id}, dialog:messageHistory, sources:data.sources || [], previousReportContext:context});
    const recheck = await fetch('/api/analyze', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({config:previousReport.config,model:selectedModel || $('#model-select').value,priorityResources:readPriorityResources(),clarification,targetPositionId:position.id}),signal:AbortSignal.timeout(1810000)});
    const revised = await recheck.json();
    if (!recheck.ok) throw new Error('Ответ получен, но обновить общий отчёт не удалось: ' + (revised.error || 'ошибка проверки') + '. Предыдущие выводы сохранены и требуют повторной проверки.');
    if (currentReport !== previousReport || isStale()) throw new Error('Ответ получен, но конфигурация изменилась во время проверки. Обновите отчёт для текущей конфигурации.');
    const updatedPosition = revised.positions?.find(item => item.id === position.id);
    if (!updatedPosition) throw new Error('Повторная проверка не вернула результат для этой позиции.');
    updatedPosition.chatMessages = messageHistory;
    updatedPosition.chatOpen = true;
    const positions = previousReport.positions.map(item => item.id === position.id ? updatedPosition : item);
    const positionCounts = {compatible:0,incompatible:0,unconfirmed:0};
    for (const item of positions) if (Object.hasOwn(positionCounts,item.status)) positionCounts[item.status]++;
    const priorAnalysis = previousReport.assemblyAnalysis || {};
    const assemblyAnalysis = {...priorAnalysis, groups:(priorAnalysis.groups || []).filter(group => !group.positionIds?.includes(position.id)), purchaseNotes:(priorAnalysis.purchaseNotes || []).filter(note => !note.positionIds?.includes(position.id))};
    currentReport = {...previousReport,positions,positionCounts,assemblyAnalysis,summary: `Результат после уточнения: совместимо — ${positionCounts.compatible}, несовместимо — ${positionCounts.incompatible}, требует уточнения — ${positionCounts.unconfirmed}.`};
    position.chatError = '';
    rememberProductLinks(currentReport);
    renderPositionReport(currentReport);
  } catch (error) {
    position.chatError = error.name === 'TimeoutError' ? 'Истекло время ожидания ответа. Можно повторить вопрос; повторный запрос может тарифицироваться отдельно.' : error.message;
  } finally {
    position.chatPending = false;
    position.chatComposeOpen = false;
    renderPositionChat(position);
  }
});
renderFields();
try {
  const saved = localStorage.getItem(storageKey);
  if (saved) fillForm(cleanLegacyDraft(JSON.parse(saved)));
} catch { $('#save-status').textContent = 'Не удалось восстановить черновик.'; }
changed();
priorityPreviewReady = true;
void syncProjectSources();
function handleFormChange(event) {
  if (event.target.id === 'bom') { $('#manual-mode').checked = false; productLookup.clear(); }
  if (event.target.closest('#component-fields')) $('#manual-mode').checked = true;
  changed();
}
form.addEventListener('input',handleFormChange);
form.addEventListener('change',handleFormChange);
form.addEventListener('submit',runAnalysis);
$('#bom-preview').addEventListener('click', event => {
  const button = event.target.closest('[data-remove-line]');
  if (!button) return;
  const lines = $('#bom').value.replace(/\r\n?/g, '\n').split('\n');
  const index = Number(button.dataset.removeLine) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= lines.length) return;
  lines.splice(index, 1);
  $('#bom').value = lines.join('\n');
  $('#manual-mode').checked = false;
  productLookup.clear();
  changed();
});
$('#clear-bom').addEventListener('click',() => {
  $('#bom').value = '';
  changed();
  $('#bom').focus();
});
$('#reset').addEventListener('click',() => {
  if (!confirm('Очистить конфигурацию и сохранённый черновик?')) return;
  HTMLFormElement.prototype.reset.call(form); changed();
  $('#form-error').hidden = true;
});
$('#export-report').addEventListener('click',exportReport);

async function checkConnection() {
  try {
    const response = await fetch('/api/status',{signal:AbortSignal.timeout(5000)});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Сервис проверки документов недоступен.');
    apiReady = (data.researchReady ?? data.aiConfigured) === true;
    connectionError = apiReady ? '' : data.setupMessage || 'Поиск первичных документов не подключён. Настройте провайдера в локальном файле .env.';
    $('#connection-status').textContent = apiReady ? `Сервис проверки настроен · ${data.provider || 'openai'} · ${data.model}` : connectionError;
    if (data.provider === 'provod') {
      await loadModels(data.model);
      if (apiReady) $('#connection-status').textContent = `Сервис проверки настроен · ${data.provider} · ${$('#model-select').value || data.model}`;
    }
  } catch (error) {
    apiReady = false;
    connectionError = error.message === 'Failed to fetch' ? 'Нет соединения с сервером. Запустите npm start.' : error.message;
    $('#connection-status').textContent = connectionError;
  }
}
async function loadModels(currentModel) {
  const select = $('#model-select');
  try {
    const response = await fetch('/api/models');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Не удалось получить список моделей.');
    const models = data.models || [];
    if (!selectedModel || !models.some(model => model.id === selectedModel)) selectedModel = currentModel;
    select.innerHTML = models.map(model => `<option value="${escapeHtml(model.id)}">${escapeHtml(model.id)}</option>`).join('');
    select.value = selectedModel;
    select.disabled = !models.length;
    const modelHelp = $('#model-help');
    const updateModelHelp = () => {
      const model = models.find(item => item.id === select.value);
      modelHelp.textContent = model?.supportsStructuredOutput === false
        ? 'Эта модель доступна, но каталог не заявляет поддержку JSON Schema, необходимую для отчёта проверки.'
        : model?.supportsStructuredOutput === true
          ? `Поддержка структурированного отчёта указана в каталоге Provod (${model.structuredOutputParameter}). Выбор сохраняется в этом браузере.`
          : 'Доступные модели Provod. Проверьте поддержку структурированного отчёта в каталоге; выбор сохраняется в этом браузере.';
    };
    updateModelHelp();
    if (models.length && !select.dataset.bound) {
      select.addEventListener('change', () => { selectedModel = select.value; localStorage.setItem(modelStorageKey, selectedModel); updateModelHelp(); });
      select.dataset.bound = 'true';
    }
    return models;
  } catch (error) {
    select.innerHTML = `<option value="">${escapeHtml(error.message)}</option>`;
    select.disabled = true;
    return [];
  }
}
$('#connection-test').addEventListener('click', async () => {
  const button = $('#connection-test');
  button.disabled = true;
  $('#connection-status').textContent = 'Проверяем авторизацию и доступность модели…';
  try {
    const model = $('#model-select').value || selectedModel;
    const endpoint = model ? `/api/connection?model=${encodeURIComponent(model)}` : '/api/connection';
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(35000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Проверка подключения завершилась ошибкой.');
    await checkConnection();
    const charge = data.usageRub != null ? ` Списания по ключу: ${new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 8 }).format(data.usageRub)}.` : '';
    const capability = data.modelCapabilities?.supportsStructuredOutput === false
      ? ' Каталог не подтверждает поддержку JSON Schema, необходимую для отчёта.'
      : data.modelCapabilities?.supportsStructuredOutput === true
        ? ` Каталог подтверждает структурированный вывод (${data.modelCapabilities.structuredOutputParameter}).`
        : ' Поддержка структурированного отчёта в каталоге не указана.';
    $('#connection-status').textContent = `Ключ принят. Модель ${data.model} доступна.${capability}${charge}${data.setupMessage ? ` ${data.setupMessage}` : ''}`;
  } catch (error) {
    $('#connection-status').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
checkConnection();
