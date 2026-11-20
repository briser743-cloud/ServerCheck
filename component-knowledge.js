// Reusable product facts only; never store BOM quantities or assembly verdicts.
export function cleanComponentLink(sku, link, usable = () => true) {
  try {
    const url = new URL(link?.url);
    if (!usable(sku,link) || !['https:','http:'].includes(url.protocol) || url.username || url.password
      || url.hostname === 'localhost' || /^[\d.:[\]]+$/.test(url.hostname)
      || [...url.searchParams.keys()].some(key => /token|secret|password|api.?key|signature|credential/i.test(key))) return null;
    url.hash = '';
    return {url:url.href,title:String(link.title || url.hostname).replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,250),modelOnly:String(sku).startsWith('MODEL:') || link.modelOnly === true};
  } catch { return null; }
}

export function cleanComponentFacts(sku, facts, usable) {
  return (Array.isArray(facts) ? facts : []).slice(0,6).flatMap(fact => {
    const name = typeof fact?.name === 'string' ? fact.name.trim().slice(0,80) : '';
    const value = typeof fact?.value === 'string' ? fact.value.trim().slice(0,180) : '';
    const sources = (Array.isArray(fact?.sources) ? fact.sources : []).slice(0,2)
      .map(source => cleanComponentLink(sku,source,usable)).filter(Boolean);
    return name && value && sources.length ? [{name,value,sources}] : [];
  });
}
