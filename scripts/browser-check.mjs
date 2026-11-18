// Проверка реального браузера через встроенный Chrome DevTools Protocol.
// Сторонних npm-зависимостей нет. Скриншоты и профиль сохраняются в .tmp/.
import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';

const candidates = [process.env.BROWSER_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/google-chrome','/usr/bin/chromium'].filter(Boolean);
let executable;
for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
if (!executable) throw new Error('Chrome / Edge не найден. Укажите путь в BROWSER_PATH.');
const output = fileURLToPath(new URL('../.tmp/',import.meta.url));
await mkdir(output,{recursive:true});
const server = createApp({apiKey:''});
server.listen(0,'127.0.0.1');
await once(server,'listening');
const browser = spawn(executable,['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${output}browser-${Date.now()}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let ws;
let aiServer;
try {
  const endpoint = await new Promise((resolve,reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('Браузер не запустил DevTools за 15 секунд.')),15000);
    browser.once('error',error => {clearTimeout(timer);reject(error);});
    browser.once('exit',code => {clearTimeout(timer);reject(new Error(`Браузер завершился: ${code}`));});
    browser.stderr.on('data',chunk => {buffer += chunk;const match = buffer.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
  });
  ws = new WebSocket(endpoint);
  await once(ws,'open');
  let counter = 0;
  const pending = new Map();
  ws.addEventListener('message',event => {
    const message = JSON.parse(event.data);
    if (pending.has(message.id)) {const {resolve,reject,timer} = pending.get(message.id);clearTimeout(timer);pending.delete(message.id);message.error ? reject(new Error(message.error.message)) : resolve(message.result);}
  });
  const command = (method,params = {},sessionId) => new Promise((resolve,reject) => {
    const id = ++counter;
    const timer = setTimeout(() => {pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},15000);
    pending.set(id,{resolve,reject,timer});
    ws.send(JSON.stringify({id,method,params,...(sessionId ? {sessionId} : {})}));
  });
  const {targetId} = await command('Target.createTarget',{url:'about:blank'});
  const {sessionId} = await command('Target.attachToTarget',{targetId,flatten:true});
  const call = (method,params = {}) => command(method,params,sessionId);
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const waitUntil = async expression => {
    for (let i = 0; i < 100; i++) {if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve,100));}
    throw new Error(`UI condition timed out: ${expression}`);
  };
  const screenshot = async name => {const {data} = await call('Page.captureScreenshot',{format:'png'});await writeFile(`${output}${name}.png`,Buffer.from(data,'base64'));};
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}`});
  await waitUntil("document.querySelectorAll('.component').length === 7 && document.querySelector('#connection-status').textContent.includes('не подключён')");
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'),true);
  assert.equal(await evaluate("document.querySelector('[name=mode]')"),null);
  const quote = await readFile(new URL('../test/fixtures/quote.tsv',import.meta.url),'utf8');
  await evaluate(`document.querySelector('#bom').value=${JSON.stringify(quote)}; document.querySelector('#bom').dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#analyze-button').click()`);
  await waitUntil("document.querySelector('#form-error').textContent.includes('не подключён')");
  assert.equal(await evaluate("document.querySelectorAll('.position-card').length"),0);
  assert.equal(await evaluate("document.querySelector('#export-report').disabled"),true);
  assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('#bom-preview .inventory-table tbody tr td:last-child strong')).map(el=>Number(el.textContent))"),[1,2,1,8,1,2]);
  await evaluate(`localStorage.setItem('servercheck.config.v1',JSON.stringify({projectName:'Учебная сборка',boardModel:'Условная плата',boardDdr:'DDR4',bom:${JSON.stringify(quote)}}))`);
  await call('Page.reload');
  await waitUntil("document.querySelector('#bom')?.value.includes('PLATFORM-TEST')");
  assert.equal(await evaluate("document.querySelector('#boardDdr').value"),'');
  await screenshot('desktop');
  // Реальная интеграция UI и сервера с подменённым внешним API, без расходов.
  aiServer = createApp({apiKey:'browser-test-only',provider:'openai',fetchImpl:async (_url,options) => {
    const {expectedPositions} = JSON.parse(JSON.parse(options.body).input);
    const index = {'CPU-QA':0,'GPU-QA':1,'SSD-QA':2}[expectedPositions[0].sku] ?? 2;
    const positions = expectedPositions.map((position) => ({id:position.id,status:['incompatible','compatible','unconfirmed'][index],reason:index === 2 ? 'Не найдена документация на подключение накопителя.' : 'Совместная установка подтверждена тестовым документом.',missing:index === 2 ? ['Нужен документ по бэкплейну.'] : [],checks:index === 2 ? [] : position.requiredChecks.map((aspect,i) => ({aspect,status:index === 0 && i === 0 ? 'incompatible' : 'compatible',reason:index === 0 && i === 0 ? 'Причина несовместимости: <img src=x onerror=alert(1)> модель исключена матрицей поддержки.' : 'Комбинация артикулов указана в тестовой матрице.',sources:[{url:'https://example.com/manual',title:'Тестовый документ',scope:'joint'}]}))}));
    return new Response(JSON.stringify({status:'completed',output:[{type:'web_search_call',status:'completed',action:{type:'search',sources:[{url:'https://example.com/manual',title:'Тестовый документ'}]}},{type:'web_search_call',status:'completed',action:{type:'open_page',url:'https://example.com/manual'}},{type:'message',content:[{type:'output_text',text:JSON.stringify({positions}),annotations:[]}]}]}));
  }});
  aiServer.listen(0,'127.0.0.1');
  await once(aiServer,'listening');
  await call('Page.navigate',{url:`http://127.0.0.1:${aiServer.address().port}`});
  await waitUntil("document.querySelector('#connection-status')?.textContent.includes('Сервис проверки настроен')");
  const qaBom = 'CPU-QA\tCPU LGA4677 195W\t2\nGPU-QA\tGPU 24GB\t1\nSSD-QA\tSSD 960GB U.2 NVMe\t2';
  await evaluate(`document.querySelector('#bom').value=${JSON.stringify(qaBom)}; document.querySelector('#analyze-button').click()`);
  await waitUntil("document.querySelectorAll('.position-card').length === 3");
  for (const status of ['compatible','incompatible','unconfirmed']) assert.equal(await evaluate(`document.querySelectorAll('.position-card.verdict-${status}').length`),1);
  assert.equal(await evaluate("document.querySelector('.position-card a').href"),'https://example.com/manual');
  assert.equal(await evaluate("document.querySelectorAll('#report-content img').length"),0);
  assert.ok(await evaluate("document.querySelector('.verdict-incompatible').textContent.includes('<img')"));
  for (const [status,color] of [['compatible','rgb(193, 241, 125)'],['incompatible','rgb(255, 163, 155)'],['unconfirmed','rgb(243, 206, 134)']]) assert.equal(await evaluate(`getComputedStyle(document.querySelector('.verdict-${status} .verdict-badge')).color`),color);
  await screenshot('three-status-report');
  await evaluate("document.querySelector('[data-filter=incompatible]').click()");
  assert.equal(await evaluate("document.querySelectorAll('.position-card').length"),1);
  await evaluate("document.querySelector('[data-filter=all]').click()");
  const downloadDirectory = `${output}downloads-${Date.now()}`;
  await mkdir(downloadDirectory,{recursive:true});
  await command('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloadDirectory});
  await evaluate("document.querySelector('#export-report').click()");
  let downloaded = '';
  for (let i = 0; i < 50; i++) {
    try { downloaded = await readFile(`${downloadDirectory}/servercheck-report.md`,'utf8'); if (downloaded.includes('GPU-QA')) break; } catch {}
    await new Promise(resolve => setTimeout(resolve,100));
  }
  assert.match(downloaded,/https:\/\/example.com\/manual/);
  assert.match(downloaded,/GPU-QA — Совместимо/);
  assert.match(downloaded,/CPU-QA — Не совместимо/);
  assert.match(downloaded,/SSD-QA — Не подтверждено/);
  await call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}`});
  await waitUntil("document.querySelectorAll('.component').length === 7");
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await evaluate('scrollTo(0,0)');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'),true,'Mobile horizontal overflow');
  await screenshot('mobile');
  console.log('PASS: required document check, connection failure without verdicts, draft cleanup, per-row research, three statuses, filters, export and mobile layout (mock API).');
  await command('Browser.close');
} finally {
  if (ws?.readyState === WebSocket.OPEN) ws.close();
  browser.kill();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  if (aiServer) { aiServer.closeAllConnections(); await new Promise(resolve => aiServer.close(resolve)); }
}
