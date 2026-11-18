import { fields } from './schema.js';

// Удаляем старую демонстрационную конфигурацию, сохраняя рабочий список пользователя.
export function cleanLegacyDraft(input) {
  const result = {...input};
  const demo = /^Учебная сборка/.test(result.projectName || '') || fields.some(field => /Model$/.test(field.key) && /^Условн/i.test(String(result[field.key] || '')));
  if (demo) {
    for (const field of fields) delete result[field.key];
    if (/^Учебная сборка/.test(result.projectName || '')) result.projectName = '';
    if (/^ДЕМОНСТРАЦИЯ, не реальные модели/.test(result.bom || '')) result.bom = '';
    result.budget = '';
    result.workload = 'general';
    result.manualMode = '';
  }
  return result;
}
