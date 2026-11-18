import { prepareConfig } from './bom.js';
import { inspectBom } from './preflight.js';
import { createPositions, countVerdicts } from './positions.js';

export function analyzeConfig(input) {
  const prepared = prepareConfig(input);
  const c = prepared.effective;
  const findings = [];
  const has = key => c[key] !== '';
  const all = (...keys) => keys.every(has);
  const normalize = value => String(value).toUpperCase().replace(/[\s_-]/g, '').replace(/^FCLGA/,'LGA');
  const list = value => String(value).split(/[,;/\n]+/).map(normalize).filter(Boolean);
  const add = (id, status, title, detail, advice = '', basis = 'По введённым характеристикам; спецификации моделей не проверялись.') => findings.push({ id, status, title, detail, advice, basis });
  const unknown = (id, title, advice) => add(id, 'unknown', title, 'Недостаточно подтверждённых данных для вывода.', advice);
  const compare = (id, title, keys, condition, good, bad, advice) => {
    if (!all(...keys)) return unknown(id, title, `Укажите: ${keys.filter(key => !has(key)).map(key => labels[key] || key).join(', ')}.`);
    add(id, condition() ? 'pass' : 'bad', title, condition() ? good() : bad(), condition() ? '' : advice);
    findings.at(-1).basis = keys.map(key => `${labels[key] || key}: ${c[key]} — ${prepared.inferred[key] ? `строки ${prepared.inferred[key].lines.join(', ')}` : 'дополнительное поле'}`).join('; ')+'. Источники производителя не проверялись.';
  };
  const labels = {
    cpuSocket:'сокет CPU',boardSocket:'сокет платы',cpuCount:'число CPU',boardSockets:'число сокетов платы',cpuMaxSockets:'сокетность CPU',cpuTdp:'TDP CPU',boardMaxTdp:'лимит TDP платы',
    boardDdr:'DDR платы',ramDdr:'DDR памяти',ramType:'тип DIMM',boardRamTypes:'типы DIMM платы',ramCount:'число DIMM',boardDimmSlots:'доступные слоты DIMM',ramSize:'объём DIMM',boardMaxRam:'лимит RAM',
    caseFormats:'форм-факторы корпуса',boardFormat:'форм-фактор платы',coolerHeight:'высота кулера',caseCoolerMax:'лимит высоты кулера',coolerTdp:'лимит кулера',
    cardLength:'длина карты',caseCardMax:'максимальная длина карты',cardProfile:'профиль карты',caseCardProfile:'профиль корпуса',cardCount:'число карт',cardWidth:'толщина карт',caseExpansionSlots:'позиции расширения',boardPcieSlots:'доступные PCIe-слоты',
    driveCount:'число дисков',caseBays:'число подходящих отсеков',driveProtocol:'интерфейс дисков',storagePath:'протокол пути подключения',caseDepth:'глубина корпуса',rackDepth:'полезная глубина стойки',
  };
  compare('socket','Сокет CPU и платы',['cpuSocket','boardSocket'],() => normalize(c.cpuSocket) === normalize(c.boardSocket),() => `Сокеты совпадают: ${c.cpuSocket}. Это не подтверждает поддержку модели CPU.`,() => `CPU: ${c.cpuSocket}; плата: ${c.boardSocket}. Сокеты различаются.`, 'Подберите CPU и плату с одинаковым сокетом и проверьте CPU Support List.');
  compare('cpu-count','Число установленных CPU',['cpuCount','boardSockets'],() => c.cpuCount <= c.boardSockets,() => `${c.cpuCount} CPU на ${c.boardSockets} сокета(х).`,() => `CPU (${c.cpuCount}) больше, чем сокетов (${c.boardSockets}).`, 'Сократите количество CPU или выберите другую платформу.');
  compare('cpu-scaling','Многопроцессорная конфигурация',['cpuCount','cpuMaxSockets'],() => c.cpuCount <= c.cpuMaxSockets,() => `Заявленная сокетность CPU допускает ${c.cpuCount} CPU.`,() => `CPU допускает до ${c.cpuMaxSockets} сокетов, запрошено ${c.cpuCount}.`, 'Используйте CPU с поддержкой нужной сокетности.');
  compare('cpu-tdp','Лимит TDP материнской платы',['cpuTdp','boardMaxTdp'],() => c.cpuTdp <= c.boardMaxTdp,() => `${c.cpuTdp} Вт ≤ ${c.boardMaxTdp} Вт.`,() => `${c.cpuTdp} Вт > ${c.boardMaxTdp} Вт.`, 'Выберите поддерживаемый CPU с меньшим TDP или другую плату.');
  const confirmation = (key, id, title, advice, noStatus = 'bad') => {
    if (!has(key)) unknown(id,title,advice);
    else add(id,c[key] === 'yes' ? 'pass' : noStatus,title,c[key] === 'yes' ? 'Пользователь отметил проверку как выполненную. Независимая проверка не проводилась.' : 'По вашим данным, требование не выполнено.', c[key] === 'yes' ? '' : advice, 'Отметка пользователя; документ не проверялся.');
  };
  confirmation('cpuSupport','cpu-support','Поддержка точной модели CPU','Найдите CPU в списке поддержки именно этой ревизии платы.');
  confirmation('biosReady','bios','Версия BIOS','Проверьте минимальный BIOS для CPU и возможность обновления до установки.');
  compare('ddr','Поколение оперативной памяти',['boardDdr','ramDdr'],() => c.boardDdr === c.ramDdr,() => `Плата и DIMM: ${c.ramDdr}.`,() => `Плата: ${c.boardDdr}; DIMM: ${c.ramDdr}.`, 'Используйте поколение DDR, указанное в спецификации платы.');
  compare('dimm-type','Тип модулей памяти',['ramType','boardRamTypes'],() => list(c.boardRamTypes).includes(normalize(c.ramType)),() => `${c.ramType} указан среди поддерживаемых типов.`,() => `${c.ramType} не входит в указанный список: ${c.boardRamTypes}.`, 'Проверьте точный тип DIMM. RDIMM, LRDIMM и UDIMM нельзя считать взаимозаменяемыми.');
  compare('dimm-slots','Количество модулей памяти',['ramCount','boardDimmSlots'],() => c.ramCount <= c.boardDimmSlots,() => `${c.ramCount} DIMM на ${c.boardDimmSlots} доступных слотов.`,() => `${c.ramCount} DIMM при ${c.boardDimmSlots} доступных слотах.`, 'Сократите число DIMM либо выберите модули большей ёмкости из QVL.');
  compare('ram-capacity','Общий объём памяти',['ramCount','ramSize','boardMaxRam'],() => c.ramCount * c.ramSize <= c.boardMaxRam,() => `${c.ramCount * c.ramSize} ГБ ≤ ${c.boardMaxRam} ГБ.`,() => `${c.ramCount * c.ramSize} ГБ > ${c.boardMaxRam} ГБ.`, 'Уменьшите объём или выберите платформу с нужным лимитом памяти.');
  confirmation('ramPopulation','ram-population','Схема заполнения DIMM','Сверьте слоты, каналы, ranks и DPC с руководством и числом установленных CPU.');
  if (all('caseFormats','boardFormat') && (c.boardFormat === 'Proprietary' || /proprietary|проприет/i.test(c.caseFormats))) unknown('board-fit','Форм-фактор платы и корпуса','Для проприетарной платформы нужна матрица совместимости конкретных артикулов.');
  else compare('board-fit','Заявленный форм-фактор платы и корпуса',['caseFormats','boardFormat'],() => list(c.caseFormats).includes(normalize(c.boardFormat)),() => `${c.boardFormat} указан в списке корпуса. Геометрия, I/O и крепления требуют отдельной проверки.`,() => `${c.boardFormat} не указан среди поддерживаемых: ${c.caseFormats}.`, 'Выберите корпус с явно заявленной поддержкой этой платы; для E-ATX уточните размеры в миллиметрах.');
  confirmation('mountConfirmed','board-mount','Крепления платы и задняя панель','Проверьте стойки, размеры платы, I/O shield, PDB и разъёмы передней панели.');
  compare('cooler-height','Высота процессорного кулера',['coolerHeight','caseCoolerMax'],() => c.coolerHeight <= c.caseCoolerMax,() => `${c.coolerHeight} мм ≤ ${c.caseCoolerMax} мм.`,() => `${c.coolerHeight} мм > ${c.caseCoolerMax} мм.`, 'Выберите кулер ниже или корпус с большим полезным пространством.');
  compare('cooler-tdp','Заявленный тепловой лимит кулера',['cpuTdp','coolerTdp'],() => c.cpuTdp <= c.coolerTdp,() => `${c.cpuTdp} Вт ≤ ${c.coolerTdp} Вт. Эффективность зависит от воздушного потока.`,() => `${c.cpuTdp} Вт > ${c.coolerTdp} Вт.`, 'Подберите охлаждение под CPU и воздушный поток конкретного корпуса.');
  confirmation('coolerMount','cooler-mount','Крепление процессорного кулера','Проверьте сокет, тип ILM, backplate и совместимость с DIMM.');
  if (c.cardCount !== 0) {
    compare('card-length','Длина плат расширения',['cardLength','caseCardMax'],() => c.cardLength <= c.caseCardMax,() => `${c.cardLength} мм ≤ ${c.caseCardMax} мм, по введённому полезному лимиту.`,() => `${c.cardLength} мм > ${c.caseCardMax} мм.`, 'Выберите более короткую карту или корпус; учитывайте корзины и изгиб кабелей.');
    compare('card-profile','Профиль плат расширения',['cardProfile','caseCardProfile'],() => c.caseCardProfile === 'full' || c.cardProfile === 'low',() => 'Профиль карты укладывается в указанный лимит корпуса. Планка должна соответствовать корпусу.',() => 'Полноразмерная карта не подходит в указанную низкопрофильную позицию.', 'Используйте LP-карту с нужной планкой или поддерживаемый райзер/корпус.');
    compare('card-width','Занимаемые позиции расширения',['cardCount','cardWidth','caseExpansionSlots'],() => c.cardCount * c.cardWidth <= c.caseExpansionSlots,() => `Нужно ${c.cardCount * c.cardWidth} позиций, доступно ${c.caseExpansionSlots}. Расположение проверяется отдельно.`,() => `Нужно ${c.cardCount * c.cardWidth} позиций, доступно ${c.caseExpansionSlots}.`, 'Уменьшите число/толщину карт или смените корпус.');
    compare('pcie-slots','Количество подходящих PCIe-слотов',['cardCount','boardPcieSlots'],() => c.cardCount <= c.boardPcieSlots,() => `${c.cardCount} карт на ${c.boardPcieSlots} указанных подходящих слотов.`,() => `${c.cardCount} карт при ${c.boardPcieSlots} подходящих слотах.`, 'Пересмотрите число карт, PCIe-слоты и райзеры платформы.');
    confirmation('pcieConfirmed','pcie-layout','Линии PCIe и совместная установка карт','Проверьте электрическую ширину, поколение PCIe, райзеры, бифуркацию, привязку к CPU и перекрытие соседних слотов.');
  }
  if (c.driveCount !== 0) {
    compare('drive-bays','Отсеки для накопителей',['driveCount','caseBays'],() => c.driveCount <= c.caseBays,() => `${c.driveCount} накопителей на ${c.caseBays} подходящих отсеков.`,() => `${c.driveCount} накопителей при ${c.caseBays} подходящих отсеках.`, 'Увеличьте число подходящих отсеков или сократите количество дисков.');
    const protocols = { sata:['SATA'], 'sas-sata':['SAS','SATA'], nvme:['NVMe'], trimode:['SAS','SATA','NVMe'] };
    compare('storage-protocol','Протокол подключения накопителей',['driveProtocol','storagePath'],() => protocols[c.storagePath].includes(c.driveProtocol),() => `${c.driveProtocol} поддерживается заявленным путём подключения.`,() => `${c.driveProtocol} не поддерживается заявленным путём подключения.`, 'Подберите совместимые контроллер, бэкплейн и кабели; SAS-диск не работает через SATA-only тракт.');
    confirmation('backplaneConfirmed','backplane','Бэкплейн, кабели и форм-фактор дисков','Сверьте артикулы бэкплейна и кабелей, число портов, салазки, размер дисков и поддержку hot-swap.');
  }
  if (has('caseDepth') || has('rackDepth')) {
    if (all('caseDepth','rackDepth')) add('rack-depth',c.caseDepth < c.rackDepth ? 'warn' : 'bad','Установка в стойку',`Корпус ${c.caseDepth} мм; полезная глубина ${c.rackDepth} мм.`,c.caseDepth < c.rackDepth ? `Разница ${c.rackDepth - c.caseDepth} мм. Уточните диапазон направляющих и запас для разъёмов, кабелей и дверей.` : 'Корпус не оставляет места для подключения. Выберите более глубокую стойку или короткий корпус.');
    else unknown('rack-depth','Установка в стойку','Укажите глубину корпуса и полезную глубину стойки.');
  }
  let power = null;
  const powerKeys = ['cpuCount','cpuTdp','cardCount','psuWatts','psuCount','psuRedundancy','otherWatts'];
  if (c.cardCount !== 0) powerKeys.push('cardWatts');
  if (all(...powerKeys)) {
    const load = c.cpuCount * c.cpuTdp + c.cardCount * (c.cardWatts || 0) + c.otherWatts;
    const reserve = c.psuRedundancy === 'nplus1' ? 1 : 0;
    const available = (c.psuCount - reserve) * c.psuWatts;
    const target = Math.ceil(load * 1.25);
    power = { load, available, target, redundancy: c.psuRedundancy };
    add('power-budget', available < load ? 'bad' : available < target ? 'warn' : 'pass','Предварительный бюджет питания',`Расчётная нагрузка: ${load} Вт; доступно${reserve ? ' при отказе одного БП' : ''}: ${available} Вт. Ориентир с запасом 25%: ${target} Вт.`, available < target ? 'Увеличьте мощность/число рабочих БП или снизьте нагрузку. Подтвердите пики потребления по калькулятору производителя.' : 'Запас 25% — ориентир. Подтвердите пиковую нагрузку, напряжение сети, лимиты PDB и режим распределения питания.', 'Арифметическая оценка: CPU TDP × количество + мощность карт + прочая нагрузка. Это не измерение максимального потребления.');
  } else unknown('power-budget','Предварительный бюджет питания','Укажите CPU TDP и количество, количество карт (0, если их нет), мощность карт, прочую нагрузку и параметры БП.');
  confirmation('powerConnectors','power-connectors','Силовые разъёмы и кабели','Проверьте EPS, ATX/PDB, GPU-питание и допустимую нагрузку кабелей.');
  confirmation('psuMount','psu-mount','БП, корпус и распределительная плата','Проверьте форм-фактор, артикул БП, PDB, напряжение и поддержку резервирования.');
  confirmation('airflowConfirmed','airflow','Воздушный поток всей сборки','Проверьте вентиляторы, воздуховоды, пассивные GPU и рекомендованные производителем термопрофили.');
  const recommendations = [];
  const hasTable = prepared.parsed.items.some(item => item.quantity !== null);
  if (hasTable) {
    const missing = findings.filter(item => item.status === 'unknown');
    const checked = findings.filter(item => item.status !== 'unknown');
    findings.splice(0,findings.length,...inspectBom(prepared),...checked);
    if (missing.length) findings.push({id:'bom-documentation',status:'unknown',title:'Что ещё нужно подтвердить по документации',detail:missing.map(item => item.title).join('; ')+'.',advice:'Укажите точную ревизию и руководство платформы либо включите ИИ-проверку. Не нужно вручную заполнять все поля: вначале подтвердите BIOS/CPU, QVL и схему DIMM, M.2, райзеры, бэкплейн и охлаждение.',basis:'Неизвестные проверки сгруппированы; отсутствие данных не считается конфликтом.'});
    for (const item of checked) if (Object.keys(prepared.inferred).length) item.basis += ' Часть значений извлечена из описаний строк; см. распознанные позиции.';
  }
  for (const finding of findings) {
    if (['bad','warn'].includes(finding.status) && !finding.id.startsWith('bom-manual-') && !finding.id.startsWith('bom-row-')) finding.advice = 'Для технического вывода требуется проверка применимых документов производителя. Сравнение описаний не подтверждает неисправность или несовместимость.';
  }
  const counts = Object.fromEntries(['bad','warn','unknown','pass'].map(status => [status,findings.filter(item => item.status === status).length]));
  const positions = createPositions(prepared);
  return { mode:'local', createdAt:new Date().toISOString(), config:prepared.original, effectiveConfig:c, parsed:prepared.parsed, inferred:prepared.inferred, positions, positionCounts:countVerdicts(positions), findings, counts, power, recommendations, title:'Совместимость по позициям', summary:'Документы производителей не проверялись, поэтому каждая позиция отмечена «Не подтверждено». Причины и недостающие сведения указаны отдельно для каждой строки.' };
}
