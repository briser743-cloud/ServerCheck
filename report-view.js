import { verdictLabels, checkLabels, sourceTypeLabels } from './positions.js';
import { kindLabels, lookupKnownComponent } from './bom.js';

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
export const safeUrl = value => { try { const url = new URL(value); return ['http:','https:'].includes(url.protocol) ? url.href : null; } catch { return null; } };

export function numberedSourceLinks(indices,sources) {
  return indices.map(index => {
    const source = sources[index - 1], url = safeUrl(source?.url);
    return url ? `<a class="source-number" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(source.title || url)}" aria-label="Открыть источник ${index}: ${escapeHtml(source.title || url)}">[${index}]</a>` : '';
  }).filter(Boolean).join(' ');
}

export function previewSourceLinks(sources,position) {
  const seen = new Set();
  const valid = sortSourcesForPosition(sources,position).filter(source => {
    const url = safeUrl(source?.url);
    if (!url || seen.has(canonicalReferenceUrl(url))) return false;
    seen.add(canonicalReferenceUrl(url));
    return true;
  });
  const link = (source,index) => `<a href="${escapeHtml(safeUrl(source.url))}" target="_blank" rel="noopener noreferrer" title="${escapeHtml((source.title || 'Источник ' + (index + 1)) + ' — ' + safeUrl(source.url))}">Ссылка${valid.length > 1 ? ' ' + (index + 1) : ''}</a>${source.modelOnly ? ' (по модели; артикул не подтверждён)' : ''}<button type="button" class="remove-source" data-remove-source="${escapeHtml(safeUrl(source.url))}" aria-label="Удалить ссылку ${escapeHtml(source.title || 'источник')}" title="Удалить ссылку">×</button>`;
  if (!valid.length) return '';
  return `<p class="field-hint">Источник: ${link(valid[0],0)}</p>${valid.length > 1 ? `<details class="more-information preview-extra-sources"><summary>Другие источники (${valid.length - 1})</summary><p class="field-hint">${valid.slice(1).map((source,index) => link(source,index + 1)).join(' · ')}</p></details>` : ''}`;
}
export const canonicalReferenceUrl = value => {
  const safe = safeUrl(value);
  if (!safe) return '';
  const url = new URL(safe);
  url.hash = '';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./,'');
  return url.href.replace(/\/$/,'');
};
export const omitRepeatedReferences = (sources, shownUrls) => {
  const seen = new Set(shownUrls.map(canonicalReferenceUrl).filter(Boolean));
  return sources.filter(source => {
    const key = canonicalReferenceUrl(source?.url);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
let sourcePriorities = [];
let sourceResources = [];
export function setSourcePriorities(resources) {
  sourceResources = (Array.isArray(resources) ? resources : []).flatMap(resource => {
    try { return [{manufacturer:String(resource.manufacturer || '').trim(),domain:new URL(resource.url).hostname.toLowerCase().replace(/^www\./,'')}]; } catch { return []; }
  });
  sourcePriorities = sourceResources.map(resource => resource.domain);
}
export function sortSourcesByPriority(sources, domains = sourcePriorities) {
  const clean = domains.map(domain => String(domain).toLowerCase().replace(/^www\./,''));
  const rank = source => {
    try {
      const host = new URL(source.url).hostname.toLowerCase().replace(/^www\./,'');
      const index = clean.findIndex(domain => host === domain || host.endsWith(`.${domain}`));
      return index < 0 ? clean.length : index;
    } catch { return clean.length; }
  };
  return [...sources].sort((a,b) => rank(a)-rank(b));
}
export function sortSourcesForPosition(sources,position) {
  if (!position) return sortSourcesByPriority(sources);
  const text = `${position.description || ''} ${position.sku || ''} ${lookupKnownComponent(position)?.text || ''}`.toLowerCase();
  const matches = sourceResources.filter(resource => resource.manufacturer && new RegExp(`(^|[^a-z0-9])${resource.manufacturer.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?=$|[^a-z0-9])`,'i').test(text));
  const domains = [...new Set([...matches.map(resource => resource.domain),...sourcePriorities])];
  return sortSourcesByPriority(sources,domains);
}
const symbols = {compatible:'✓',incompatible:'✕',unconfirmed:'?'};
const sourceLinks = (sources,position) => omitRepeatedReferences(sortSourcesForPosition(sources.filter(source => safeUrl(source.url)),position),[]).map(source => `<a href="${escapeHtml(safeUrl(source.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title || source.url)}</a>${source.sourceType ? ` (${sourceTypeLabels[source.sourceType] || sourceTypeLabels.unknown})` : ''}`).join(' · ');

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
  const overall = nodeStatus(positions.map(position => position.id));
  const grouped = status => (analysis.groups || []).filter(group => nodeStatus(group.positionIds || []) === status);
  const section = (title, items) => items.length ? `<h4>${title}</h4><ul class="assembly-overview">${items.map(group => `<li><strong>${escapeHtml(group.title)}.</strong> ${escapeHtml(group.summary)}${group.recommendation ? ` <strong>Рекомендация:</strong> ${escapeHtml(group.recommendation)}` : ''}${group.sources?.length ? `<div class="assembly-sources">Источники: ${sourceLinks(group.sources)}</div>` : ''}</li>`).join('')}</ul>` : '';
  const unclear = grouped('unconfirmed');
  return `<section class="assembly-analysis" aria-label="Проверка совместимости по узлам"><h3>Проверка совместимости по узлам</h3><p class="verdict-text-${overall}"><strong>Общий результат: ${verdictLabels[overall]}</strong></p>${overall === 'unconfirmed' ? '<p>Для окончательного вывода требуется дополнительная проверка отдельных условий.</p>' : ''}${section('Проблемы совместимости', grouped('incompatible'))}${notes ? `<h4>Рекомендации и ограничения</h4><div class="assembly-notes">${notes}</div>` : ''}${section('Подтверждённые узлы', grouped('compatible'))}${unclear.length ? `<details class="more-information"><summary>Больше информации: условия для уточнения</summary>${section('Узлы, требующие проверки', unclear)}</details>` : ''}</section>`;
}

function technicalSpecsMarkup(position, sources) {
  const specifications = (position.technicalSpecs || []).filter(spec => spec.name && spec.value && Array.isArray(spec.sources) && spec.sources.some(source => safeUrl(source.url)));
  const body = specifications.length ? `<dl class="technical-spec-list">${specifications.map(spec => {
    const indices = [...new Set(spec.sources.map(source => sources.findIndex(item => canonicalReferenceUrl(item.url) === canonicalReferenceUrl(source.url))).filter(index => index >= 0).map(index => index + 1))];
    return `<div class="technical-spec"><dt>${escapeHtml(spec.name)}</dt><dd>${escapeHtml(spec.value)}${indices.length ? ` ${numberedSourceLinks(indices,sources)}` : ''}</dd></div>`;
  }).join('')}</dl><p>Нажмите на номер, чтобы открыть источник.</p>` : '<p class="technical-spec-empty">В прочитанных источниках не найдено характеристик, которые можно подтвердить ссылкой.</p>';
  return `<section class="technical-specs" aria-label="Технические характеристики"><h4>Технические характеристики</h4>${body}</section>`;
}

function incompleteChecksMarkup(position) {
  if (!position.missing?.length) return '';
  return `<details class="more-information verification-incomplete"><summary>Не выполнено при проверке: ${position.missing.length} ${position.missing.length % 10 === 1 && position.missing.length % 100 !== 11 ? 'пункт' : position.missing.length % 10 >= 2 && position.missing.length % 10 <= 4 && (position.missing.length % 100 < 12 || position.missing.length % 100 > 14) ? 'пункта' : 'пунктов'}</summary><p>Следующие проверки не были выполнены или завершены. Совместимость по этим пунктам не подтверждена.</p><ul class="position-missing">${position.missing.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></details>`;
}

export function renderPositionsMarkup(report,filter = 'all') {
  const positions = report.positions || [];
  const shown = positions.filter(position => filter === 'all' || position.status === filter);
  const filters = [['all','Все позиции'],...Object.entries(verdictLabels)];
  return `${assemblyAnalysisMarkup(report)}<h3>Подробный отчёт по компонентам</h3><div class="report-filters" role="group" aria-label="Фильтр позиций">${filters.map(([value,label]) => `<button class="filter" type="button" data-filter="${value}" aria-pressed="${filter === value}">${label}</button>`).join('')}</div><div class="position-results">${shown.length ? shown.map(position => {
    const status = Object.hasOwn(verdictLabels,position.status) ? position.status : 'unconfirmed';
    const allSources = omitRepeatedReferences(sortSourcesForPosition([...(position.sources || []),...(position.referenceSources || []),...(position.technicalSpecs || []).flatMap(spec => spec.sources || []),...(position.checks || []).flatMap(check => check.sources || [])].filter(source => safeUrl(source.url)),position),[]);
    const reasonHeading = status === 'incompatible' ? 'Причина несовместимости' : status === 'unconfirmed' ? 'Почему не подтверждено' : 'Основание совместимости';
    return `<article class="position-card verdict-${status}" data-position-id="${escapeHtml(position.id)}"><div class="position-heading"><div><p class="position-meta">Строка ${position.line} · ${kindLabels[position.kind] || 'Комплектующее'} · Количество: <strong>${position.quantity ?? 'не указано'}</strong></p><h3>${escapeHtml(position.sku || position.description)}</h3></div><span class="verdict-badge"><span aria-hidden="true">${symbols[status]}</span> ${verdictLabels[status]}</span></div>${position.sku ? `<p class="position-description">${escapeHtml(position.description)}</p>` : ''}<div class="position-reason"><h4>${reasonHeading}</h4><p>${escapeHtml(position.reason || 'Недостаточно документальных подтверждений.')}</p></div><details class="position-detail" ><summary>Подробнее <span aria-hidden="true">↗</span></summary>${technicalSpecsMarkup(position,allSources)}${incompleteChecksMarkup(position)}${position.recommendation ? `<div class="position-reason"><h4>Рекомендация</h4><p>${escapeHtml(position.recommendation)}</p></div>` : ""}${allSources.length ? `<div class="position-sources"><strong>Источники:</strong> ${allSources.map((source,index) => `${index + 1}. ${sourceLinks([source],position)}`).join(" · ")}</div>` : `<div class="position-sources"><span>Документальные подтверждения не получены.</span></div>`}${position.checks?.length ? `<details class="position-checks"><summary>Проверенные условия (${position.checks.length})</summary>${position.checks.map(check => `<div class="position-check"><strong>${checkLabels[check.aspect] || escapeHtml(check.aspect)} — <span class="verdict-text-${check.status}">${verdictLabels[check.status] || verdictLabels.unconfirmed}</span></strong><p>${escapeHtml(check.reason)}</p>${check.sources?.length ? `<small>Источники: ${numberedSourceLinks([...new Set(check.sources.map(source => allSources.findIndex(item => canonicalReferenceUrl(item.url) === canonicalReferenceUrl(source.url))).filter(index => index >= 0).map(index => index + 1))],allSources)}</small>` : ''}</div>`).join('')}</details>` : ''}</details></article>`;
  }).join('') : '<div class="empty-report"><p>Нет позиций с выбранным статусом.</p></div>'}</div>`;
}
