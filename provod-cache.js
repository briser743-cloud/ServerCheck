import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';

// Ключ и тело запроса используются только для хеша, в файл попадает ответ.
export function createCachedProvodFetch(fetchImpl, directory = new URL('./.cache/provod/', import.meta.url), now = Date.now) {
  return async (url, request) => {
    const modelRequest = url === 'https://api.provod.ai/v1/responses' || url === 'https://api.provod.ai/v1/chat/completions';
    const searchRequest = url === 'https://api.tavily.com/search';
    if ((!modelRequest && !searchRequest) || request?.method !== 'POST') return fetchImpl(url, request);
    request.signal?.throwIfAborted();
    const hash = createHash('sha256').update(JSON.stringify([url, request.headers.Authorization, request.body])).digest('hex');
    const file = new URL(`${hash}.json`, directory);
    try {
      const cached = JSON.parse(await readFile(file, 'utf8'));
      if (now() >= cached.savedAt && (searchRequest || now() - cached.savedAt < 86400000)) {
        return new Response(cached.body, { headers: { 'Content-Type': 'application/json', 'X-ServerCheck-Cache': 'hit' } });
      }
    } catch { /* Отсутствие или повреждение кеша допускает обычный запрос. */ }
    const response = await fetchImpl(url, request);
    if (!response.ok) return response;
    const body = await response.clone().text();
    try {
      const data = JSON.parse(body);
      if (modelRequest) {
        const output = url.endsWith('/chat/completions')
          ? data.choices?.[0]?.message?.content
          : (data.output || []).filter(item => item.type === 'message').flatMap(item => item.content || [])
            .filter(item => item.type === 'output_text').map(item => item.text).join('');
        const result = JSON.parse(output);
        const requestBody = JSON.parse(request.body);
        const input = url.endsWith('/chat/completions')
          ? JSON.parse(requestBody.messages?.at(-1)?.content || '{}')
          : JSON.parse(requestBody.input);
        const expected = input.expectedPositions;
        const actual = result?.positions;
        const completed = url.endsWith('/chat/completions') ? data.choices?.[0]?.finish_reason === 'stop' : data.status === 'completed';
        if (!completed || !Array.isArray(expected) || !expected.length || !Array.isArray(actual)
          || actual.length !== expected.length || expected.some((position, index) => actual[index]?.id !== position.id)) return response;
      } else if (!Array.isArray(data.results) || !data.results.length) return response;
      await mkdir(directory, { recursive: true });
      const temporary = new URL(`${hash}-${randomUUID()}.tmp`, directory);
      await writeFile(temporary, JSON.stringify({ savedAt: now(), body }), 'utf8');
      await rename(temporary, file);
    } catch { /* Ошибка сохранения не отменяет полученный результат. */ }
    return response;
  };
}
