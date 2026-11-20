// Compact transport only: the public report keeps complete source metadata.
export function compactEvidenceFormat(format, documents) {
  const compact = structuredClone(format);
  const refs = documents.map(document => document.ref);
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.properties?.url && node.properties?.title && node.properties?.scope && node.properties?.sourceType) {
      delete node.properties.url;
      delete node.properties.title;
      node.properties.ref = {type:'string',enum:refs};
      node.required = ['ref','scope','sourceType'];
    }
    for (const value of Object.values(node)) visit(value);
  }
  visit(compact.schema);
  return compact;
}

export function expandEvidenceReferences(report, documents) {
  const byRef = new Map(documents.map(document => [document.ref,document]));
  function visit(node) {
    if (Array.isArray(node)) return node.map(visit);
    if (!node || typeof node !== 'object') return node;
    return Object.fromEntries(Object.entries(node).map(([key,value]) => {
      if (key !== 'sources' || !Array.isArray(value)) return [key,visit(value)];
      return [key,value.flatMap(source => {
        // Retain legacy URL responses for compatibility with existing fixtures.
        if (!source || !Object.hasOwn(source,'ref')) return [source];
        const document = byRef.get(source.ref);
        if (!document) return [];
        return [{url:document.url,title:document.title,scope:source.scope,sourceType:source.sourceType}];
      })];
    }));
  }
  return visit(report);
}

export function provodBilling(data, response) {
  const usage = data.usage || {};
  const reused = response.headers.get('x-servercheck-cache') === 'hit' || response.headers.get('x-servercheck-coalesced') === 'true';
  const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
  return {
    costRub:reused ? 0 : usage.currency === 'RUB' ? finite(usage.cost) : undefined,
    promptTokens:finite(usage.prompt_tokens ?? usage.input_tokens),
    completionTokens:finite(usage.completion_tokens ?? usage.output_tokens),
    reasoningTokens:finite(usage.completion_tokens_details?.reasoning_tokens ?? usage.output_tokens_details?.reasoning_tokens),
    reused,
  };
}
