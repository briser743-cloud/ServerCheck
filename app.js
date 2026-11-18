import { groups, fields, optionPairs, validateConfig } from './schema.js';
import { cleanLegacyDraft } from './draft.js';
import { analyzeConfig } from './engine.js';
import { parseBom, describeFacts, kindLabels } from './bom.js';
import { verdictLabels, sourceTypeLabels } from './positions.js';
import { renderPositionsMarkup, escapeHtml } from './report-view.js';

const $ = selector => document.querySelector(selector);
const form = $('#config-form');
const storageKey = 'servercheck.config.v1';
const statusLabels = verdictLabels;
let currentReport = null;
let selectedFilter = 'all';
let busy = false;
let apiReady = false;
let connectionError = '';
const modelStorageKey = 'servercheck.model.v1';
let selectedModel = localStorage.getItem(modelStorageKey) || '';

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

function inventoryHtml(parsed,title,open = false) {
  const t = parsed.totals;
  const metrics = [[t.cpuCount,'CPU'],[t.memoryGB,'ГБ RAM'],[t.storageCount,'накопителей'],[t.storageGB,'ГБ до RAID'],[t.gpuCount,'GPU']].filter(([value]) => value !== null);
  return `<details class="inventory" ${open ? 'open' : ''}><summary>${title}: ${parsed.items.length} строк${t.units != null ? ` · ${t.units} ед.` : ''}</summary><p class="field-hint">Итоги по всему списку. Количество — последняя колонка; характеристики — из описания, без проверки документации.</p>${metrics.length ? `<div class="inventory-totals">${metrics.map(([value,label]) => `<span><strong>${value}</strong> ${label}</span>`).join('')}</div>` : ''}<div class="table-scroll"><table class="inventory-table"><thead><tr><th scope="col">Артикул и категория</th><th scope="col">Извлечённые характеристики</th><th scope="col">Кол-во</th></tr></thead><tbody>${parsed.items.map(item => `<tr${item.quantity === 0 ? ' class="inactive-row"' : ''}><td><strong>${escapeHtml(item.sku || `Строка ${item.line}`)}</strong><small>${kindLabels[item.kind]}</small><details class="source-description"><summary>Исходное описание</summary><p>${escapeHtml(item.description)}</p></details></td><td>${escapeHtml(describeFacts(item) || 'Характеристики не извлечены — нужна спецификация модели.')}${item.issue ? `<p class="warn">${escapeHtml(item.issue)}</p>` : ''}</td><td><strong class="${item.quantity === null ? 'warn' : 'accent'}">${item.quantity ?? '?'}</strong>${item.quantity === 0 ? '<small>исключено</small>' : ''}</td></tr>`).join('')}</tbody></table></div></details>`;
}

function reportHeader(report) {
  return basicReportHeader(report) + (report.parsed?.items.some(item => item.quantity !== null) ? inventoryHtml(report.parsed,'Позиции спецификации') : '');
}

function basicReportHeader(report) {
  return `<div id="stale-notice" class="stale-notice" ${isStale() ? '' : 'hidden'}>Конфигурация изменилась. Этот отчёт относится к предыдущей версии — запустите проверку повторно.</div><div class="report-summary"><h3>${escapeHtml(report.title)}</h3><p>${escapeHtml(report.summary)}</p><div class="report-meta"><span>${escapeHtml(report.config.projectName || 'Без названия')}</span><span>${new Date(report.createdAt).toLocaleString('ru-RU')}</span><span>${report.mode === 'local' ? 'Быстрая проверка · без поиска документации' : 'ИИ-проверка · с веб-поиском'}</span></div>${report.positionCounts ? `<div class="summary-stats">${Object.entries(report.positionCounts).map(([status,count]) => `<span class="stat ${status}">${count} · ${statusLabels[status]}</span>`).join('')}</div>` : ''}</div>`;
}

function renderPositionReport(report) {
  $('#report-content').innerHTML = reportHeader(report) + renderPositionsMarkup(report,selectedFilter);
}

function showError(message) { $('#form-error').textContent = message; $('#form-error').hidden = false; }
function showResearchProgress(config) {
  const positions = analyzeConfig(config).positions;
  const active = positions.filter(position => position.quantity !== 0);
  $('#report-content').innerHTML = `<section class="research-progress"><h3>Проверка первичных документов</h3><p id="research-state">Подготовка поиска. Позиций для проверки: ${active.length}.</p><ul>${positions.map(position => `<li data-research-id="${escapeHtml(position.id)}"><span>${escapeHtml(position.sku || position.description)}</span><strong>${position.quantity === 0 ? 'Не устанавливается' : 'Ожидает поиска'}</strong></li>`).join('')}</ul></section>`;
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
  currentReport = null;
  $('#export-report').disabled = true;
  $('#report-content').innerHTML = '';
  try {
    await checkConnection();
    if (!apiReady) throw new Error(connectionError || 'Поиск первичных документов не подключён. Добавьте OPENAI_API_KEY в локальный файл .env.');
    button.textContent = 'Проверяем первичные документы…';
    $('#action-note').textContent = 'Поиск и чтение выполняются отдельно по каждой позиции. Дождитесь завершения.';
    showResearchProgress(config);
    const response = await fetch('/api/analyze', { method:'POST', headers:{'Content-Type':'application/json','Accept':'application/x-ndjson'}, body:JSON.stringify({config,model:selectedModel}), signal:AbortSignal.timeout(1810000) });
    const data = await readResearchResponse(response);
    const report = {...data, config};
    currentReport = report;
    selectedFilter = 'all';
    renderPositionReport(report);
    $('#export-report').disabled = false;
    $('#report').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
  } catch(error) {
    showError(error.name === 'TimeoutError' ? 'Время проверки документов истекло. Итоговый отчёт не сформирован.' : error.message === 'Failed to fetch' ? 'Нет соединения с сервером. Проверьте, что npm start запущен.' : error.message);
    const progress = $('#research-state');
    if (progress) progress.textContent = 'Проверка прервана. Устраните ошибку подключения и повторите запрос.';
  } finally {
    busy = false;
    button.disabled = false;
    button.innerHTML = 'Проверить документы и совместимость <span aria-hidden="true">↗</span>';
    $('#action-note').textContent = 'Результаты появятся после проверки документов по всем позициям.';
  }
}

function exportReport() {
  if (!currentReport) return;
  const r = currentReport;
  const lines = ['# ServerCheck — отчёт', '', `Сборка: ${r.config.projectName || 'Без названия'}`, `Дата: ${r.createdAt}`, `Режим: ${r.mode === 'local' ? 'Быстрая проверка' : 'ИИ + документация'}`, '', ...(isStale() ? ['ВНИМАНИЕ: конфигурация была изменена после проверки. Отчёт относится к снимку ниже.', ''] : []), `## ${r.title}`, r.summary, ''];
  for (const position of r.positions || []) {
    lines.push(`## ${position.sku || position.description} — ${verdictLabels[position.status]}`,
      `Количество: ${position.quantity ?? 'не указано'}`, position.reason, '');
    if (position.recommendation) lines.push('Рекомендация: '+position.recommendation, '');
    if (position.research?.fromCache) lines.push('Использован сохранённый ответ модели (срок хранения 24 часа). Новый запрос к модели не выполнялся.', '');
    if (position.missing?.length) lines.push('Не подтверждено:', ...position.missing.map(item => '- '+item), '');
    if (position.research) lines.push(
      `Поисковых запросов по позиции: ${position.research.searches}. Прочитано документов по позиции: ${position.research.openedDocuments}. Отброшено нерелевантных документов: ${position.research.rejectedDocuments ?? 0}. Документов передано для анализа: ${position.research.sharedDocuments ?? position.research.openedDocuments}.`, '');
    if (position.readSources?.length) lines.push('Прочитанные документы:', ...position.readSources.map(source => '- '+source.title+': '+source.url), '');
    lines.push('Источники:', ...(position.sources?.length ? position.sources.map(source => '- '+source.title+' ('+(sourceTypeLabels[source.sourceType] || sourceTypeLabels.unknown)+'): '+source.url) : ['Документальные подтверждения не получены.']), '');
    for (const check of position.checks || []) lines.push(`- ${check.aspect}: ${verdictLabels[check.status]}. ${check.reason}`,
      ...(check.sources || []).map(source => '  Источник: '+source.url));
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
$('#report-content').addEventListener('submit',async event => {
  const chatForm = event.target.closest('[data-chat-form]');
  if (!chatForm || !currentReport) return;
  event.preventDefault();
  const position = currentReport.positions.find(item => item.id === chatForm.dataset.positionId);
  const question = new FormData(chatForm).get('question')?.toString().trim();
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
    const response = await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:selectedModel || $('#model-select').value,context,messages:messageHistory}),signal:AbortSignal.timeout(155000)});
    const data = await response.json();
    if (!response.ok) throw new Error(`${data.error || 'Не удалось получить ответ ИИ.'}${data.costRub == null ? '' : ` Фактическое списание: ${formatRub(data.costRub)}.`}`);
    messageHistory.push({role:'assistant',content:data.answer,costRub:data.costRub,sources:data.sources || []});
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
function handleFormChange(event) {
  if (event.target.id === 'bom') $('#manual-mode').checked = false;
  if (event.target.closest('#component-fields')) $('#manual-mode').checked = true;
  changed();
}
form.addEventListener('input',handleFormChange);
form.addEventListener('change',handleFormChange);
form.addEventListener('submit',runAnalysis);
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
