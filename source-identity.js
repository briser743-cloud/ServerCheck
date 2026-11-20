const storageBrands = [
  ['samsung',/\bsamsung\b/i],
  ['wd',/\b(?:wd|western[\s_-]*digital|ultrastar)\b/i],
  ['seagate',/\bseagate\b/i],['kingston',/\bkingston\b/i],
  ['micron',/\bmicron\b/i],['solidigm',/\bsolidigm\b/i],
  ['kioxia',/\bkioxia\b/i],['crucial',/\bcrucial\b/i],
];

// Exact SKU mappings are used only to reject an explicitly different GPU.
const knownGpuModels = new Map([['900-21010-0040-000','H200']]);

// Browser-confirmed inaccessible page; this does not blacklist the whole domain.
const blockedPages = new Set([
  'https://global.microless.com/product/wd-ultrastar-dc-hdd-server-7k6-internal-hard-drive-3-5-form-factor-4tb-capacity-256mb-cache-size-7200-rpm-disk-speed-sas-12gb-s-interface-512e-se-0b36048',
]);
// This exact page was opened successfully in the user's browser. A 403 to a
// server-side bot alone does not prove that the browser cannot open it.
const browserVerifiedPages = new Set([
  'https://www.supermicro.com/en/products/system/gpu/4u/sys-422gb-nrt',
]);
export function isBrowserVerifiedSource(value) {
  try { const url = new URL(value); url.hash = ''; url.search = ''; return browserVerifiedPages.has(url.href.replace(/\/$/,'')); }
  catch { return false; }
}
export function isKnownBlockedSource(value) {
  try { const url = new URL(value); url.hash = ''; url.search = ''; return blockedPages.has(url.href.replace(/\/$/,'')); }
  catch { return false; }
}

// A shared interface/capacity never overrides an explicitly different product.
export function sourceConflictsWithPosition(position, source) {
  const description = `${position?.sku || ''} ${position?.description || ''}`;
  const heading = `${source?.title || ''} ${source?.url || ''}`;
  const gpuModel = description.match(/\b(?:H100|H200|B100|B200)\b/i)?.[0]?.toUpperCase()
    || knownGpuModels.get(String(position?.sku || '').trim().toUpperCase());
  if (gpuModel) {
    let named = heading.match(/\b(?:H100|H200|B100|B200)\b/gi) || [];
    if (!named.length) named = String(source?.text || source?.content || '').match(/\b(?:H100|H200|B100|B200)\b/gi) || [];
    if (named.length && !named.some(value => value.toUpperCase() === gpuModel)) return true;
  }
  const brand = storageBrands.find(([,pattern]) => pattern.test(description))?.[0]
    || (/^MZ[A-Z0-9]/i.test(position?.sku || '') ? 'samsung' : '');
  const stated = storageBrands.filter(([,pattern]) => pattern.test(heading)).map(([name]) => name);
  if (brand && stated.length && !stated.includes(brand)) return true;
  const model = description.match(/\b(?:PM|SM)\d{3,4}[A-Z]?\b/i)?.[0]?.toUpperCase();
  const otherModels = heading.match(/\b(?:PM|SM)\d{3,4}[A-Z]?\b/gi) || [];
  return Boolean(model && otherModels.length && !otherModels.some(value => value.toUpperCase() === model));
}
