import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';

// Ключ и тело запроса используются только для хеша, в файл попадает ответ.
export function createCachedProvodFetch(fetchImpl, directory = new URL('./.cache/provod/', import.meta.url), now = Date.now) {
  const pending = new Map();
  return async (url, request) => {
    const modelRequest = url === 'https://api.provod.ai/v1/responses' || url === 'https://api.provod.ai/v1/chat/completions';
    const searchRequest = url === 'https://api.tavily.com/search';
    const extractRequest = url === 'https://api.tavily.com/extract';
    if ((!modelRequest && !searchRequest && !extractRequest) || request?.method !== 'POST') return fetchImpl(url, request);
    request.signal?.throwIfAborted();
    const hash = createHash('sha256').update(JSON.stringify([url, request.headers.Authorization, request.body])).digest('hex');
    let entry = pending.get(hash);
    const joined = Boolean(entry);
    if (!entry) {
      const controller = new AbortController();
      entry = { controller, consumers: 0, settled: false };
      pending.set(hash, entry);
      entry.promise = perform(url, { ...request, signal: controller.signal }, hash, { modelRequest, searchRequest })
        .finally(() => {
          entry.settled = true;
          if (pending.get(hash) === entry) pending.delete(hash);
        });
    }
    entry.consumers++;
    let onAbort;
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(request.signal.reason);
      request.signal?.addEventListener('abort', onAbort, { once: true });
      if (request.signal?.aborted) onAbort();
    });
    try {
      const response = (await Promise.race([entry.promise, aborted])).clone();
      if (!joined) return response;
      const headers = new Headers(response.headers);
      headers.set('X-ServerCheck-Coalesced', 'true');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    } finally {
      request.signal?.removeEventListener('abort', onAbort);
      if (--entry.consumers === 0 && !entry.settled) {
        pending.delete(hash);
        entry.controller.abort();
      }
    }
  };

  async function perform(url, request, hash, { modelRequest, searchRequest }) {
    const file = new URL(`${hash}.json`, directory);
    try {
      const cached = JSON.parse(await readFile(file, 'utf8'));
      if (now() >= cached.savedAt && (searchRequest || now() - cached.savedAt < (cached.ttlMs || 86400000))) {
        return new Response(cached.body, { headers: { 'Content-Type': 'application/json', 'X-ServerCheck-Cache': 'hit' } });
      }
    } catch { /* Отсутствие или повреждение кеша допускает обычный запрос. */ }
    const response = await fetchImpl(url, request);
    if (!response.ok) return response;
    const body = await response.clone().text();
    try {
      const data = JSON.parse(body);
      let ttlMs = 86400000;
      if (modelRequest) {
        const output = url.endsWith('/chat/completions')
          ? data.choices?.[0]?.message?.content
          : (data.output || []).filter(item => item.type === 'message').flatMap(item => item.content || [])
            .filter(item => item.type === 'output_text').map(item => item.text).join('');
        const requestBody = JSON.parse(request.body);
        // Cache only complete stateless text chats; never reuse stateful sessions.
        const chat = url.endsWith('/responses') && requestBody.store === false
          && !requestBody.previous_response_id && !requestBody.conversation;
        if (chat) {
          if (data.status !== 'completed' || !output?.trim()) return response;
          ttlMs = 3600000;
        } else {
          const result = JSON.parse(output);
          const input = url.endsWith('/chat/completions')
            ? JSON.parse(requestBody.messages?.at(-1)?.content || '{}')
            : JSON.parse(requestBody.input);
          const expected = input.expectedPositions;
          const actual = result?.positions;
          const completed = url.endsWith('/chat/completions') ? data.choices?.[0]?.finish_reason === 'stop' : data.status === 'completed';
          if (!completed || !Array.isArray(expected) || !expected.length || !Array.isArray(actual)
            || actual.length !== expected.length || new Set(actual.map(position => position?.id)).size !== expected.length
            || expected.some(position => !actual.some(candidate => candidate?.id === position.id))) return response;
        }
      } else if (!Array.isArray(data.results) || !data.results.length) return response;
      await mkdir(directory, { recursive: true });
      const temporary = new URL(`${hash}-${randomUUID()}.tmp`, directory);
      await writeFile(temporary, JSON.stringify({ savedAt: now(), ttlMs, body }), 'utf8');
      await rename(temporary, file);
    } catch { /* Ошибка сохранения не отменяет полученный результат. */ }
    return response;
  }
}
