import { verdictLabels, checkLabels, sourceTypeLabels } from './positions.js';
import { kindLabels } from './bom.js';

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
export const safeUrl = value => { try { const url = new URL(value); return ['http:','https:'].includes(url.protocol) ? url.href : null; } catch { return null; } };
const symbols = {compatible:'✓',incompatible:'✕',unconfirmed:'?'};
const sourceLinks = sources => sources.filter(source => safeUrl(source.url)).map(source => `<a href="${escapeHtml(safeUrl(source.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title || source.url)}</a>${source.sourceType ? ` (${sourceTypeLabels[source.sourceType] || sourceTypeLabels.unknown})` : ''}`).join(' · ');

function assemblyAnalysisMarkup(report) {
  const analysis = report.assemblyAnalysis;
  if (!analysis || (!analysis.groups?.length && !analysis.purchaseNotes?.length)) return '';
  const positions = report.positions || [];
  const nodeStatus = ids => {
    const linked = positions.filter(position => ids.includes(position.id));
    if (linked.some(position => position.status === 'incompatible')) return 'incompatible';
    if (!linked.length || linked.some(position => position.status === 'unconfirmed')) return 'unconfirmed';
    return 'compatible';
  };
  const labels = ids => positions.filter(position => ids.includes(position.id)).map(position => `${position.sku || position.description} × ${position.quantity ?? '?'}`);
  const groups = (analysis.groups || []).map(group => {
    const status = nodeStatus(group.positionIds || []);
    return `<article class="assembly-node verdict-${status}"><div class="assembly-node-heading"><h4>${escapeHtml(group.title)}</h4><span class="verdict-text-${status}">${verdictLabels[status]}</span></div><p>${escapeHtml(group.summary)}</p><small>Позиции: ${labels(group.positionIds || []).map(escapeHtml).join(' · ')}</small>${group.recommendation ? `<p class="assembly-recommendation"><strong>Замечание:</strong> ${escapeHtml(group.recommendation)}</p>` : ''}${group.sources?.length ? `<div class="assembly-sources">Источники: ${sourceLinks(group.sources)}</div>` : ''}</article>`;
  }).join('');
  const notes = (analysis.purchaseNotes || []).map(note => `<article class="assembly-note"><h4>${escapeHtml(note.title)}</h4><p>${escapeHtml(note.text)}</p><small>Позиции: ${labels(note.positionIds || []).map(escapeHtml).join(' · ')}</small>${note.sources?.length ? `<div class="assembly-sources">Источники: ${sourceLinks(note.sources)}</div>` : ''}</article>`).join('');
  return `<section class="assembly-analysis" aria-label="Анализ узлов сборки"><h3>Проверка совместимости по узлам</h3>${groups ? `<div class="assembly-nodes">${groups}</div>` : ''}${notes ? `<h3>Перед покупкой и сборкой</h3><div class="assembly-notes">${notes}</div>` : ''}</section>`;
}

function researchAudit(research) {
  if (!research) return '';
  const cacheNote = research.fromCache ? '<p class="research-audit">Ответ модели из кеша (до 24 часов). Новый запрос к модели не выполнялся.</p>' : '';
  const batchNote = research.modelRequests ? `Общий анализ сборки: ${research.modelRequests} запрос к модели по ${research.assemblyRows} строкам. ` : '';
  return `<p class="research-audit">${batchNote}Поисковых запросов по позиции: ${research.searches}. Прочитано выдержек источников: ${research.openedDocuments}. Проверено ${escapeHtml(new Date(research.checkedAt).toLocaleString('ru-RU'))}.</p>${cacheNote}`;
}

function technicalSpecsMarkup(position) {
  const specifications = (position.technicalSpecs || []).filter(spec => spec.name && spec.value
    && Array.isArray(spec.sources) && spec.sources.some(source => safeUrl(source.url)));
  const body = specifications.length
    ? `<dl class="technical-spec-list">${specifications.map(spec => `<div class="technical-spec"><dt>${escapeHtml(spec.name)}</dt><dd>${escapeHtml(spec.value)}</dd><p>Источник: ${sourceLinks(spec.sources)}</p></div>`).join('')}</dl>`
    : '<p class="technical-spec-empty">В прочитанных источниках не найдено характеристик, которые можно подтвердить ссылкой.</p>';
  return `<section class="technical-specs" aria-label="Технические характеристики"><h4>Технические характеристики</h4>${body}</section>`;
}

function positionChatMarkup(position) {
  const messages = Array.isArray(position.chatMessages) ? position.chatMessages : [];
  if (!position.chatOpen) return '';
  const log = `${messages.map(message => `<article class="position-chat-message chat-${message.role}"><strong>${message.role === 'user' ? 'Вы' : 'ИИ'}</strong><p>${escapeHtml(message.content)}</p>${message.role === 'assistant' ? `<small>${message.costRub == null ? 'Стоимость в рублях в ответе API не указана.' : `Списание: ${new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:8}).format(message.costRub)}`}</small>${message.sources?.length ? `<div class="position-chat-sources"><span>Прочитанные источники: </span>${sourceLinks(message.sources)}</div>` : ''}` : ''}</article>`).join('')}${position.chatPending ? '<p class="position-chat-pending" role="status">ИИ готовит ответ… Можно просматривать страницу; ответ появится здесь.</p>' : ''}${position.chatError ? `<p class="position-chat-error" role="alert">${escapeHtml(position.chatError)}</p>` : ''}`;
  const controls = position.chatComposeOpen
    ? `<form class="position-chat-compose" data-chat-form data-position-id="${escapeHtml(position.id)}"><label for="chat-question-${escapeHtml(position.id)}">Ваш вопрос</label><textarea id="chat-question-${escapeHtml(position.id)}" name="question" rows="2" maxlength="3000" placeholder="Напишите вопрос по этой позиции…" required></textarea><div class="position-chat-actions"><span>${position.chatPending ? 'ИИ формирует ответ…' : 'Ссылки читаются через Tavily (расходуется его квота); списание модели покажется в ₽.'}</span><button class="clarify-button" type="submit" ${position.chatPending ? 'disabled' : ''}>Отправить <span aria-hidden="true">↗</span></button></div></form>`
    : position.chatPending ? ''
      : `<button type="button" class="clarify-button" data-chat-id="${escapeHtml(position.id)}">Уточнить у ИИ <span aria-hidden="true">↗</span></button>`;
  return `<section class="position-chat" aria-label="Диалог с ИИ по этой позиции"><h4>Диалог с ИИ по этой позиции</h4><div class="position-chat-log" data-chat-log tabindex="0" aria-label="Сообщения по позиции">${log || '<p class="position-chat-empty">Напишите вопрос по этой позиции. Ответ останется в этой карточке.</p>'}</div>${controls}</section>`;
}

export function renderPositionsMarkup(report,filter = 'all') {
  const positions = report.positions || [];
  const shown = positions.filter(position => filter === 'all' || position.status === filter);
  const filters = [['all','Все позиции'],...Object.entries(verdictLabels)];
  return `${assemblyAnalysisMarkup(report)}<div class="report-filters" role="group" aria-label="Фильтр позиций">${filters.map(([value,label]) => `<button class="filter" type="button" data-filter="${value}" aria-pressed="${filter === value}">${label}</button>`).join('')}</div><div class="position-results">${shown.length ? shown.map(position => {
    const status = Object.hasOwn(verdictLabels,position.status) ? position.status : 'unconfirmed';
    const reasonHeading = status === 'incompatible' ? 'Причина несовместимости' : status === 'unconfirmed' ? 'Почему не подтверждено' : 'Основание совместимости';
    return `<article class="position-card verdict-${status}" data-position-id="${escapeHtml(position.id)}"><div class="position-heading"><div><p class="position-meta">Строка ${position.line} · ${kindLabels[position.kind] || 'Комплектующее'} · Количество: <strong>${position.quantity ?? 'не указано'}</strong></p><h3>${escapeHtml(position.sku || position.description)}</h3></div><span class="verdict-badge"><span aria-hidden="true">${symbols[status]}</span> ${verdictLabels[status]}</span></div>${position.sku ? `<p class="position-description">${escapeHtml(position.description)}</p>` : ''}${technicalSpecsMarkup(position)}<div class="position-reason"><h4>${reasonHeading}</h4><p>${escapeHtml(position.reason || 'Недостаточно документальных подтверждений.')}</p></div>${position.missing?.length ? `<ul class="position-missing">${position.missing.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}${!position.chatOpen ? `<button class="clarify-button" type="button" data-clarify-id="${escapeHtml(position.id)}">Уточнить у ИИ <span aria-hidden="true">↗</span></button>` : ''}${position.recommendation ? `<div class="position-reason"><h4>Рекомендация</h4><p>${escapeHtml(position.recommendation)}</p></div>` : ""}${positionChatMarkup(position)}${researchAudit(position.research)}<div class="position-sources"><strong>Источники:</strong> ${position.sources?.length ? sourceLinks(position.sources) : '<span>Документальные подтверждения не получены.</span>'}</div>${position.checks?.length ? `<details class="position-checks"><summary>Проверенные условия (${position.checks.length})</summary>${position.checks.map(check => `<div class="position-check"><strong>${checkLabels[check.aspect] || escapeHtml(check.aspect)} — <span class="verdict-text-${check.status}">${verdictLabels[check.status] || verdictLabels.unconfirmed}</span></strong><p>${escapeHtml(check.reason)}</p>${check.sources?.length ? `<div>${sourceLinks(check.sources)}</div>` : ''}</div>`).join('')}</details>` : ''}</article>`;
  }).join('') : '<div class="empty-report"><p>Нет позиций с выбранным статусом.</p></div>'}</div>`;
}
