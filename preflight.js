import { kindLabels } from './bom.js';

// Эти выводы основаны только на содержимом списка; каталог моделей не зашит в код.
export function inspectBom(prepared) {
  const { parsed, conflicts } = prepared;
  const findings = [];
  const add = (id,status,title,detail,advice = '',rows = []) => findings.push({id:`bom-${id}`,status,title,detail,advice,basis:rows.length ? `Описание пользователя, строки ${rows.map(row => row.line).join(', ')}. Документация модели не проверялась.` : 'Разбор исходного списка; спецификации моделей не проверялись.'});
  const rows = kind => parsed.active.filter(item => item.kind === kind);
  const platforms = rows('platform');
  const cpus = rows('cpu');
  const memory = rows('memory');
  const drives = rows('storage');
  const cards = parsed.active.filter(item => ['gpu','controller','network'].includes(item.kind));
  const t = parsed.totals;
  const allQuantities = items => items.length && items.every(item => item.quantity !== null);
  for (const row of parsed.items) {
    if (row.issue || row.quantity === null || row.kind === 'unknown') add(`row-${row.line}`,'warn',`Проверьте строку ${row.line}`,row.issue || (row.quantity === null ? 'Не найдено однозначное количество в конце строки.' : 'Категория комплектующего не распознана.'),'Используйте формат «артикул → описание → количество», одна позиция в строке. Для нераспознанной позиции добавьте тип: CPU, память, SSD, GPU, БП или платформа.',[row]);
  }
  for (const conflict of conflicts) add(`manual-${conflict.key}`,'warn','Противоречие исходных данных',`Поле ${conflict.key}: в дополнительных полях ${conflict.manual}, в строках ${conflict.lines.join(', ')} — ${conflict.parsed}. Этот параметр исключён из сравнений.`,'Сверьте оба источника либо отключите дополнительные поля. Из этого противоречия нельзя делать вывод о несовместимости оборудования.');
  if (platforms.length > 1 || platforms.some(row => row.quantity > 1)) add('multiple-platforms','unknown','Один список — несколько платформ','Обнаружено несколько корпусов/платформ. Неясно, как между ними распределяются компоненты.','Проверяйте один сервер за раз либо явно разделите комплектации. Все итоги ниже — по списку, не на один сервер.',platforms);
  if (t.cpuCount != null) add('cpu-total','pass','Количество процессоров',`${t.cpuCount} CPU${t.cpuCores != null ? `, суммарно ${t.cpuCores} ядер и ${t.cpuThreads} потоков` : ''}. Количество взято из последней колонки.`,'Сверьте поддержку конкретных CPU, ревизию и BIOS платформы.',cpus);
  if (t.memoryGB != null) add('memory-total','pass','Суммарный объём оперативной памяти',`${t.memoryCount} модулей, ${t.memoryGB} ГБ RAM. Объём каждого DIMM умножен на количество его строки. VRAM видеокарты сюда не включена.`,'',memory);
  if (t.cpuCount > 1 && t.memoryCount != null) add('memory-balance','unknown','Схема установки DIMM не подтверждена',`В списке ${t.memoryCount} DIMM и ${t.cpuCount} CPU. Фактические слоты установки и применимая таблица DIMM Population не указаны. Основания объявлять этот набор несовместимым или рекомендовать увеличение памяти отсутствуют.`,'Для подтверждения схемы установки нужен документ конкретной платформы.',memory);
  const ddrs = [...new Set(memory.map(row => row.facts.ddr).filter(Boolean))];
  if (ddrs.length > 1) add('mixed-ddr','bad','Разные поколения памяти в одном списке',`Указаны ${ddrs.join(', ')}. Такие модули нельзя считать единым совместимым набором для одного типа DIMM-слотов.`,'Оставьте поколение, поддерживаемое выбранной платформой, либо разделите список на разные серверы.',memory);
  const dimmTypes = [...new Set(memory.map(row => row.facts.type).filter(Boolean))];
  if (dimmTypes.length > 1) add('mixed-dimm','warn','Смешанные типы DIMM',`В списке присутствуют: ${dimmTypes.join(', ')}.`,'Не объединяйте эти модули без прямого разрешения руководства конкретной платформы.',memory);
  if (t.storageGB != null) add('storage-total','pass','Ёмкость накопителей по списку',`${t.storageCount} накопителей, суммарно ${t.storageGB} ГБ до RAID и форматирования. Разные модели и форм-факторы сохранены отдельными группами.`,'Для зеркал и массивов определите назначение каждой группы; общая сырая ёмкость не равна полезной ёмкости.',drives);
  for (const drive of drives) {
    const f = drive.facts;
    if (f.form === 'M.2') add(`m2-${drive.line}`,'unknown','Отдельное подключение M.2 NVMe',`${drive.sku || drive.description}: ${drive.quantity ?? '?'} шт., ${f.form}${f.m2Size ? ` ${f.m2Size}` : ''}, ${f.protocol || 'протокол не указан'}. Отсеки 2.5″ и задние SATA-позиции не подтверждают наличие подходящих M.2-слотов.`,'Проверьте число и размер внутренних M.2-слотов, протокол NVMe и возможность одновременной установки. При использовании адаптера учтите занятый PCIe-слот и бифуркацию.',[drive,...platforms]);
  }
  // Группируем потребности по посадочному размеру и протоколу, а не все SSD вместе.
  const bayDemands = new Map();
  for (const drive of drives) {
    const form = ['U.2','U.3'].includes(drive.facts.form) ? '2.5' : drive.facts.form;
    if (!['2.5','3.5'].includes(form) || drive.quantity === null || !drive.facts.protocol) continue;
    const key = `${form}:${drive.facts.protocol.toUpperCase()}`;
    if (!bayDemands.has(key)) bayDemands.set(key,[]);
    bayDemands.get(key).push(drive);
  }
  for (const [key,group] of bayDemands) {
    const [form,protocol] = key.split(':');
    const demand = group.reduce((sum,row) => sum+row.quantity,0);
    const declared = platforms.length === 1 && platforms[0].quantity === 1 ? (platforms[0].facts.bays || []).filter(bay => bay.form === form && bay.protocols.includes(protocol)) : [];
    if (declared.length) {
      const capacity = declared.reduce((sum,bay) => sum+bay.count,0);
      add(`bays-${key}`,demand <= capacity ? 'pass' : 'bad',`Отсеки ${form}″ / ${protocol}`,`Нужно ${demand} мест; в описании платформы заявлено ${capacity} подходящих по размеру и протоколу. Это не проверка бэкплейна и кабелей.`,'Сверьте U.2/U.3, толщину дисков, поколение PCIe, разводку бэкплейна, салазки, кабели и ограничения одновременного подключения.',[...group,...platforms]);
    } else add(`bays-${key}`,'unknown',`Подключение дисков ${form}″ / ${protocol}`,`В списке ${demand} таких дисков, но число подходящих мест не подтверждено описанием одной платформы.`,'Уточните отсеки, бэкплейн и нужные кабели, не используя общее число дисков как число занятых слотов одного типа.',group);
  }
  if (platforms.length === 1 && platforms[0].quantity === 1) {
    for (const form of ['2.5','3.5']) {
      const group = drives.filter(row => (['U.2','U.3'].includes(row.facts.form) ? '2.5' : row.facts.form) === form && row.quantity !== null);
      const bays = (platforms[0].facts.bays || []).filter(bay => bay.form === form);
      if (group.length > 1 && bays.length) {
        const demand = group.reduce((sum,row) => sum+row.quantity,0);
        const capacity = bays.reduce((sum,bay) => sum+bay.count,0);
        if (demand > capacity) add(`shared-bays-${form}`,'bad','Общее число одновременно устанавливаемых дисков',`Разные группы требуют ${demand} мест ${form}″, в описании платформы суммарно ${capacity}. Одни отсеки нельзя занять дважды.`,'Сократите число накопителей или выберите платформу с нужным количеством мест.',[...group,...platforms]);
      }
    }
  }
  if (cards.length) add('cards-layout','unknown','Одновременная установка плат расширения',`${cards.map(row => `${kindLabels[row.kind]} ${row.sku || row.description}: ${row.quantity ?? '?'} шт.`).join('; ')}. OCP-разъём и высота 2U сами по себе не подтверждают наличие PCIe-места под эти карты.`,'Запросите схему райзеров: профиль и длину карт, механическую/электрическую ширину, привязку к CPU, перекрытие слотов и воздушный поток. Учтите возможный адаптер для M.2.',cards);
  if (platforms.length === 1 && platforms[0].quantity === 1 && platforms[0].facts.psuCount) {
    const f = platforms[0].facts;
    add('integrated-psu','warn','Встроенные БП и резервирование',`В одной платформе заявлено ${f.psuCount} БП по ${f.psuWatts} Вт. Это встроенные компоненты, они не добавляются к числу платформ. Мощность ${f.psuCount * f.psuWatts} Вт не считается автоматически доступной при отказе БП.`,f.psuCount === 2 ? `Для 1+1 ориентируйтесь на один модуль (${f.psuWatts} Вт) при допустимом входном напряжении. Для итогового бюджета нужны пиковые нагрузки CPU, GPU, DIMM, дисков и вентиляторов.` : 'Уточните схему резервирования и мощность, доступную при отказе модуля.',platforms);
  }
  if (allQuantities(cpus) && cpus.every(row => row.facts.tdp != null)) add('cpu-heat','pass','TDP всех установленных CPU',`${cpus.reduce((sum,row) => sum+row.quantity*row.facts.tdp,0)} Вт — сумма заявленных TDP с учётом количества CPU. Это не максимальное потребление сервера.`,'Для оценки питания и охлаждения дополните пики CPU, нагрузку остальных компонентов и ограничения платформы.',cpus);
  return findings;
}
