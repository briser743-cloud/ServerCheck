import { positionReportFormat, reconcilePositions } from './positions.js';
import { collectProvodAssemblyDocuments, researchAssemblyWithProvod } from './provod.js';

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    return url.href.replace(/\/$/, '');
  } catch {
    return null;
  }
}

export function extractReport(data) {
  const blocks = [];
  const sources = new Map();
  const opened = new Set();
  let searches = 0;

  for (const item of data.output || []) {
    if (item.type === 'message') {
      for (const content of item.content || []) {
        if (content.type !== 'output_text') continue;
        blocks.push({ text: content.text, annotations: content.annotations || [] });
        for (const citation of content.annotations || []) {
          if (citation.type === 'url_citation' && normalizeUrl(citation.url)) {
            sources.set(normalizeUrl(citation.url), { url: citation.url, title: citation.title });
          }
        }
      }
    }
    if (item.type !== 'web_search_call' || item.status !== 'completed') continue;
    const action = item.action || {};
    if (action.type === 'search') searches += 1;
    if (['open_page', 'find_in_page'].includes(action.type) && normalizeUrl(action.url)) {
      opened.add(normalizeUrl(action.url));
      if (!sources.has(normalizeUrl(action.url))) {
        sources.set(normalizeUrl(action.url), { url: action.url, title: action.url });
      }
    }
    for (const source of action.sources || []) {
      if (normalizeUrl(source.url)) {
        sources.set(normalizeUrl(source.url), { url: source.url, title: source.title || source.url });
      }
    }
  }

  return {
    blocks,
    sources: [...sources.values()],
    readSources: [...sources].filter(([url]) => opened.has(url)).map(([, source]) => source),
    searched: searches > 0,
    searches,
    openedDocuments: opened.size,
  };
}

const apiErrors = {
  401: 'Ключ API отклонён. Проверьте OPENAI_API_KEY на сервере.',
  403: 'Нет доступа к выбранной модели или API для этого проекта.',
  429: 'Достигнут лимит запросов или квоты API. Проверьте лимиты проекта.',
  400: 'API отклонил запрос. Модель должна поддерживать веб-поиск и структурированные ответы.',
  404: 'Модель недоступна. Проверьте OPENAI_MODEL.',
};

async function researchPosition(position, local, options) {
  const { apiKey, model, fetchImpl, signal, instructions } = options;
  const format = structuredClone(positionReportFormat);
  format.schema.properties.positions.items.properties.id.enum = [position.id];
  const body = {
    model,
    store: false,
    instructions: `${instructions}\nВ этом запросе проверь только текущую позицию expectedPositions[0] в контексте всей сборки assemblyPositions. Обязательно выполни поиск по точному артикулу и названию, найди первичные документы производителя и открой найденные документы инструментом open_page для чтения. Одних фрагментов поисковой выдачи недостаточно. Для платформы ищи руководство, CPU Support List, QVL, схемы райзеров и бэкплейна. Для компонента читай его спецификацию и применимые разделы документации платформы. Если документ не найден или не открывается, опиши конкретный итог выполненного поиска. Верни ровно одну позицию с исходным id.`,
    tools: [{ type: 'web_search' }],
    tool_choice: 'required',
    include: ['web_search_call.action.sources'],
    text: { format },
    max_output_tokens: 6000,
    input: JSON.stringify({
      configuration: local.effectiveConfig,
      expectedPositions: [position],
      assemblyPositions: local.positions.map(({ id, sku, description, quantity, kind }) => ({ id, sku, description, quantity, kind })),
      parsedItems: local.parsed.items,
      totalsFromDescriptions: local.parsed.totals,
    }),
  };
  const upstream = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(240000)]) : AbortSignal.timeout(240000),
    body: JSON.stringify(body),
  });
  if (!upstream.ok) throw new Error(apiErrors[upstream.status] || 'Сервис проверки документов временно недоступен.');
  const data = await upstream.json();
  if (data.status !== 'completed') throw new Error(`Не завершена проверка документов для позиции ${position.sku || position.id}.`);
  const extracted = extractReport(data);
  if (!extracted.searched) throw new Error(`Не выполнен поиск первичных документов для позиции ${position.sku || position.id}. Итоговый отчёт не сформирован.`);

  let structured;
  try {
    structured = JSON.parse(extracted.blocks.map(block => block.text).join(''));
  } catch {
    throw new Error('ИИ не вернул структурированный результат проверки документов.');
  }
  const candidates = structured?.positions;
  if (!Array.isArray(candidates) || candidates.length !== 1 || candidates[0]?.id !== position.id) {
    throw new Error(`Не получен однозначный результат проверки позиции ${position.sku || position.id}.`);
  }

  return {
    position,
    candidate: candidates[0],
    readSources: extracted.readSources,
    research: {
      positionId: position.id,
      sku: position.sku,
      status: 'completed',
      searches: extracted.searches,
      openedDocuments: extracted.openedDocuments,
      checkedAt: new Date().toISOString(),
    },
  };
}

export async function researchConfiguration(local, options) {
  const results = [];
  const pending = local.positions.filter(position => position.quantity !== 0);
  const notify = options.onProgress || (() => {});
  let completed = 0;
  const collected = new Map();
  if (options.provider === 'provod') {
    const documentsByPosition = await collectProvodAssemblyDocuments(pending, local, { ...options, onProgress: notify });
    for (const entry of documentsByPosition) collected.set(...entry);
    const analyzed = await researchAssemblyWithProvod(local, pending, options, collected);
    for (const result of analyzed) {
      completed += 1;
      notify({ phase: 'reviewed', ...result.research, completed, total: pending.length });
      results.push(result);
    }
  } else {
    for (let offset = 0; offset < pending.length; offset += 2) {
      const settled = await Promise.allSettled(pending.slice(offset, offset + 2).map(async position => {
        notify({ phase: 'searching', positionId: position.id, sku: position.sku, completed, total: pending.length });
        const result = await researchPosition(position, local, options);
        completed += 1;
        notify({ phase: 'reviewed', ...result.research, completed, total: pending.length });
        return result;
      }));
      for (const result of settled) {
        if (result.status === 'rejected') throw result.reason;
        results.push(result.value);
      }
    }
  }

  const readSources = results.flatMap(result => result.readSources);
  const candidates = results.map(result => result.candidate);
  const positions = reconcilePositions(local.positions, candidates, readSources).map(position => {
    if (position.quantity === 0) return position;
    const result = results.find(item => item.position.id === position.id);
    const updated = { ...position, research: result.research, readSources: result.readSources.map(({ text: _evidenceText, ...source }) => source) };
    if (position.status === 'unconfirmed' && !(result.research.documentsSelected ?? result.research.openedDocuments)) {
      updated.reason = 'После поиска не удалось прочитать применимый источник по этой позиции.';
      updated.missing = [...new Set(['Среди первых трёх результатов нет доступного применимого документа.', ...position.missing])];
    }
    return updated;
  });

  return { positions, research: results.map(result => result.research) };
}
