import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isBrowserVerifiedSource } from './source-identity.js';

export function pinnedLookup(address) {
  return (_host,options,callback) => options.all ? callback(null,[address]) : callback(null,address.address,address.family);
}

function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a,b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127));
  }
  // IPv6 is excluded here to avoid private and mapped address ambiguity.
  return false;
}

export async function checkSourceLink(input) {
  try {
    let url = new URL(input);
    for (let redirects = 0; redirects < 4; redirects++) {
      if (!['http:','https:'].includes(url.protocol) || url.username || url.password || isIP(url.hostname) || !url.hostname.includes('.')) return 'blocked';
      const addresses = await lookup(url.hostname,{all:true,verbatim:true});
      const address = addresses.find(item => publicAddress(item.address));
      if (addresses.some(item => item.family === 4 && !publicAddress(item.address))) return 'blocked';
      if (!address) return 'unknown';
      const result = await new Promise((resolve,reject) => {
        const req = (url.protocol === 'https:' ? https : http).get(url,{headers:{'User-Agent':'Mozilla/5.0 (compatible; ServerCheck/1.0)',Accept:'text/html,application/pdf,*/*'},lookup:pinnedLookup(address),timeout:8000},res => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return resolve({redirect:res.headers.location}); }
          let body = ''; res.setEncoding('utf8');
          res.on('data',chunk => { body += chunk; if (body.length > 32768) res.destroy(); });
          const done = () => resolve({status:res.statusCode,body});
          res.once('end',done); res.once('close',done);
        });
        req.once('timeout',() => req.destroy(new Error('timeout'))); req.once('error',reject);
      });
      if (result.redirect) { url = new URL(result.redirect,url); continue; }
      if (result.status === 403 && isBrowserVerifiedSource(input)) return 'unknown';
      if ([401,403,404,410,451].includes(result.status) || /access denied|why have i been blocked|you have been blocked|attention required.{0,80}cloudflare|checking your browser|just a moment\.\.\./i.test(result.body)) return 'blocked';
      return result.status >= 200 && result.status < 300 ? 'ok' : 'unknown';
    }
  } catch {}
  return 'unknown';
}
