const text = (key, label, placeholder = '', wide = false) => ({ key, label, type: 'text', placeholder, wide });
const number = (key, label, min = 0, max = 100000, step = 1) => ({ key, label, type: 'number', min, max, step });
const select = (key, label, options) => ({ key, label, type: 'select', options });
const yesNo = [['yes', 'Да, подтверждено'], ['no', 'Нет']];
const memoryTypes = ['UDIMM', 'RDIMM', 'LRDIMM', 'ECC UDIMM', '3DS RDIMM'];
const formats = ['Mini-ITX', 'Micro-ATX', 'ATX', 'E-ATX', 'SSI-CEB', 'SSI-EEB', 'Proprietary'];

export const groups = [
  { id: 'platform', title: 'Корпус и платформа', subtitle: 'Форм-фактор, габариты и монтаж', icon: '▤', help: 'Указывайте полезные размеры из документации, с учётом корзин и кабелей. Высота корпуса в U не равна допустимой высоте кулера.', fields: [
    text('caseModel', 'Точная модель / ревизия платформы', 'Производитель, артикул, ревизия', true),
    text('caseFormats', 'Поддерживаемые форм-факторы', 'Например: ATX, SSI-EEB'),
    number('caseCoolerMax', 'Макс. высота кулера, мм', 1, 500, 0.1),
    number('caseCardMax', 'Макс. длина карты, мм', 1, 1000, 0.1),
    select('caseCardProfile', 'Поддерживаемый профиль карт', [['full', 'Полноразмерный (FH)'], ['low', 'Только низкопрофильный (LP)']]),
    number('caseExpansionSlots', 'Доступно позиций расширения', 0, 32),
    number('caseBays', 'Доступно отсеков нужного размера', 0, 200),
    number('caseDepth', 'Глубина корпуса, мм', 1, 2000),
    number('rackDepth', 'Полезная глубина стойки, мм', 1, 2500),
    select('mountConfirmed', 'Крепления и I/O платы проверены', yesNo),
    select('airflowConfirmed', 'Охлаждение этой сборки проверено', yesNo),
  ]},
  { id: 'board', title: 'Материнская плата', subtitle: 'Сокеты, поддержка CPU и память', icon: '⊞', help: 'Лимиты RAM и доступных PCIe-слотов указывайте для фактически установленных CPU. Совпадение сокета не гарантирует поддержку процессора.', fields: [
    text('boardModel', 'Модель и ревизия платы', 'Точная модель', true),
    text('boardSocket', 'Сокет платы', 'Например: SP3'),
    number('boardSockets', 'Количество сокетов', 1, 16),
    number('boardMaxTdp', 'Допустимый TDP одного CPU, Вт', 1, 2000),
    select('boardFormat', 'Форм-фактор', formats),
    select('boardDdr', 'Поколение памяти', ['DDR3', 'DDR4', 'DDR5']),
    text('boardRamTypes', 'Поддерживаемые типы DIMM', 'Например: RDIMM, LRDIMM'),
    number('boardDimmSlots', 'Доступно слотов DIMM', 0, 256),
    number('boardMaxRam', 'Макс. RAM для этой сборки, ГБ', 1, 100000),
    number('boardPcieSlots', 'Доступно подходящих PCIe-слотов', 0, 32),
    select('cpuSupport', 'CPU в списке поддержки платы', yesNo),
    select('biosReady', 'Установлен нужный BIOS', yesNo),
  ]},
  { id: 'cpu', title: 'Процессор и охлаждение', subtitle: 'Количество, сокет и тепловой пакет', icon: '▧', help: 'Одна группа одинаковых процессоров. Для разных CPU укажите все модели в списке комплектующих и используйте ИИ-режим.', fields: [
    text('cpuModel', 'Точная модель CPU', 'Модель и суффикс', true),
    text('cpuSocket', 'Сокет процессора', 'Например: SP3'),
    number('cpuCount', 'Количество CPU', 1, 16),
    number('cpuMaxSockets', 'Поддерживаемая сокетность CPU', 1, 16),
    number('cpuTdp', 'TDP одного CPU, Вт', 1, 2000),
    number('coolerHeight', 'Высота кулера, мм', 1, 500, 0.1),
    number('coolerTdp', 'Заявленный лимит кулера, Вт', 1, 2000),
    select('coolerMount', 'Крепление кулера подходит', yesNo),
  ]},
  { id: 'memory', title: 'Оперативная память', subtitle: 'Тип DIMM, объём и схема установки', icon: '▥', help: 'Одна группа одинаковых DIMM. Смешанную память перечислите в свободном списке для ИИ-проверки.', fields: [
    text('ramModel', 'Артикул модулей памяти', 'Точный part number', true),
    select('ramDdr', 'Поколение памяти', ['DDR3', 'DDR4', 'DDR5']),
    select('ramType', 'Тип DIMM', memoryTypes),
    number('ramCount', 'Количество модулей', 1, 256),
    number('ramSize', 'Объём одного DIMM, ГБ', 1, 4096),
    select('ramPopulation', 'Схема установки по руководству', yesNo),
  ]},
  { id: 'storage', title: 'Накопители и контроллер', subtitle: 'Интерфейсы, отсеки и бэкплейн', icon: '▱', help: 'Одна группа накопителей одного интерфейса и размера. Число отсеков выше должно соответствовать этим накопителям. Кабели и протокол бэкплейна проверяются отдельно.', fields: [
    text('driveModel', 'Модель дисков / контроллера', 'Модели и артикулы', true),
    number('driveCount', 'Количество накопителей', 0, 200),
    select('driveProtocol', 'Интерфейс накопителей', ['SATA', 'SAS', 'NVMe']),
    select('storagePath', 'Путь от контроллера до дисков', [['sata', 'Только SATA'], ['sas-sata', 'SAS / SATA'], ['nvme', 'Только NVMe'], ['trimode', 'Tri-mode SAS / SATA / NVMe']]),
    select('backplaneConfirmed', 'Бэкплейн, кабели и диски совместимы', yesNo),
  ]},
  { id: 'expansion', title: 'GPU и платы расширения', subtitle: 'Размеры, слоты и линии PCIe', icon: '▣', help: 'Одна группа одинаковых карт. Для GPU вместе с HBA и сетевой картой перечислите каждую модель в свободном списке и запустите ИИ-проверку.', fields: [
    text('cardModel', 'Модель GPU / карты расширения', 'Точный артикул', true),
    number('cardCount', 'Количество одинаковых карт', 0, 32),
    number('cardLength', 'Длина одной карты, мм', 1, 1000, 0.1),
    select('cardProfile', 'Профиль с нужной планкой', [['full', 'Полноразмерный (FH)'], ['low', 'Низкопрофильный (LP)']]),
    number('cardWidth', 'Толщина одной карты в слотах', 1, 8, 0.5),
    number('cardWatts', 'Макс. мощность одной карты, Вт', 1, 2000),
    select('pcieConfirmed', 'Линии, райзеры и расположение проверены', yesNo),
  ]},
  { id: 'power', title: 'Блок питания', subtitle: 'Мощность, резервирование и разъёмы', icon: 'ϟ', help: 'При N+1 мощность одного БП вычитается. Прочая нагрузка включает плату, RAM, диски, вентиляторы и неучтённые карты. Оценка по TDP не заменяет расчёт пикового потребления.', fields: [
    text('psuModel', 'Модель блока питания', 'Модель и мощность при вашем напряжении сети', true),
    number('psuWatts', 'Мощность одного БП, Вт', 1, 10000),
    number('psuCount', 'Количество БП', 1, 8),
    select('psuRedundancy', 'Режим питания', [['none', 'Без резервирования'], ['nplus1', 'N+1 (один БП в резерве)']]),
    number('otherWatts', 'Остальная нагрузка, Вт', 0, 20000),
    select('powerConnectors', 'Разъёмы и кабели питания проверены', yesNo),
    select('psuMount', 'БП совместим с корпусом / PDB', yesNo),
  ]},
];

export const fields = groups.flatMap(group => group.fields);
export const optionPairs = field => field.options.map(option => Array.isArray(option) ? option : [option, option]);

export function validateConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Конфигурация должна быть объектом.');
  const result = {};
  for (const [key, limit] of [['projectName', 120], ['budget', 300], ['bom', 16000], ['workload', 40], ['manualMode', 20]]) {
    if (input[key] != null && typeof input[key] !== 'string') throw new Error(`Некорректное поле: ${key}`);
    result[key] = (input[key] || '').trim();
    if (result[key].length > limit) throw new Error(`Слишком длинное поле: ${key}`);
  }
  const workloads = ['general', 'virtualization', 'storage', 'database', 'ai'];
  if (!workloads.includes(result.workload)) result.workload = 'general';
  if (!['','include'].includes(result.manualMode)) throw new Error('Некорректный режим дополнительных параметров.');
  for (const field of fields) {
    const raw = input[field.key];
    if (raw == null || raw === '') { result[field.key] = ''; continue; }
    if (!['string', 'number'].includes(typeof raw)) throw new Error(`Некорректное поле «${field.label}».`);
    const value = String(raw).trim();
    if (!value) { result[field.key] = ''; continue; }
    if (field.type === 'number') {
      const n = Number(value);
      if (!Number.isFinite(n) || n < field.min || n > field.max || Math.abs(n / field.step - Math.round(n / field.step)) > 1e-7) throw new Error(`Проверьте поле «${field.label}»: от ${field.min} до ${field.max}, шаг ${field.step}.`);
      result[field.key] = n;
    } else if (field.type === 'select') {
      if (!optionPairs(field).some(([key]) => key === value)) throw new Error(`Недопустимое значение: ${field.label}`);
      result[field.key] = value;
    } else {
      if (value.length > 300) throw new Error(`Поле «${field.label}» слишком длинное.`);
      result[field.key] = value;
    }
  }
  return result;
}

