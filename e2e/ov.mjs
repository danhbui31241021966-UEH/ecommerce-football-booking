import { chromium } from 'playwright';
import fs from 'node:fs';
const U = process.env.U || 'http://127.0.0.1:4100';
fs.mkdirSync('e2e/out', { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const p = await b.newPage({ viewport: { width: 390, height: 900 } });
await p.goto(U+'/'); await p.evaluate(async()=>{const {api}=await import('/js/api.js'); await api.proto.resetDemo();});
const ids = await p.evaluate(async()=>{const {api}=await import('/js/api.js'); return (await api.venues({})).venues.map(v=>v.id);});
const bad=[];
for (const id of ids) { await p.goto(U+'/venue?id='+id); await p.waitForTimeout(700);
  const r = await p.evaluate(()=>{const o=document.documentElement.scrollWidth-innerWidth; if(!o) return 0; const w=[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>e.tagName+'.'+e.className+':'+(e.textContent||'').trim().slice(0,40)); return o+' '+w.slice(-3).join(' || ');});
  if (r) bad.push(id+' '+r); }
console.log(ids.length, bad); await b.close();
