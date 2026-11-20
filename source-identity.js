const storageBrands = [
  ['samsung',/\bsamsung\b/i],
  ['wd',/\b(?:wd|western[\s_-]*digital|ultrastar)\b/i],
  ['seagate',/\bseagate\b/i],['kingston',/\bkingston\b/i],
  ['micron',/\bmicron\b/i],['solidigm',/\bsolidigm\b/i],
  ['kioxia',/\bkioxia\b/i],['crucial',/\bcrucial\b/i],
];

// A shared interface/capacity never overrides an explicitly different product.
export function sourceConflictsWithPosition(position, source) {
  const description = `${position?.sku || ''} ${position?.description || ''}`;
  const heading = `${source?.title || ''} ${source?.url || ''}`;
  const brand = storageBrands.find(([,pattern]) => pattern.test(description))?.[0]
    || (/^MZ[A-Z0-9]/i.test(position?.sku || '') ? 'samsung' : '');
  const stated = storageBrands.filter(([,pattern]) => pattern.test(heading)).map(([name]) => name);
  if (brand && stated.length && !stated.includes(brand)) return true;
  const model = description.match(/\b(?:PM|SM)\d{3,4}[A-Z]?\b/i)?.[0]?.toUpperCase();
  const otherModels = heading.match(/\b(?:PM|SM)\d{3,4}[A-Z]?\b/gi) || [];
  return Boolean(model && otherModels.length && !otherModels.some(value => value.toUpperCase() === model));
}
