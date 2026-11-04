import { chromium } from 'playwright';
import fs from 'node:fs';
const U = process.env.U || 'http://127.0.0.1:4100';
fs.mkdirSync('e2e/out', { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const logs=[];
for (const w of [390,1280]) {
  const p = await b.newPage({ viewport: { width: w, height: 900 } });
  p.on('console',m=>{if(['error','warning'].includes(m.type()))logs.push(w+' '+m.text())});
  p.on('pageerror',e=>logs.push('pageerror '+e.message));
  const meas = async (label, sel) => {
    const r = await p.evaluate((sel)=>{const c=[...document.querySelectorAll(sel)];const s=c.map(i=>i.querySelector('img')?.getAttribute('src')||'NONE');
      let adj=0;for(let i=1;i<s.length;i++) if(s[i]===s[i-1]) adj++;
      const broken=c.map(i=>i.querySelector('img')).filter(i=>i&&i.complete&&i.naturalWidth===0).length;const none=s.filter(x=>x==='NONE').length;
      return {n:s.length,uniq:new Set(s.filter(x=>x!=='NONE')).size,none,adj,broken,ov:document.documentElement.scrollWidth-innerWidth};},sel);
    console.log(w,label,JSON.stringify(r));
  };
  await p.goto(U+'/'); await p.evaluate(async()=>{const {api}=await import('/js/api.js'); await api.proto.resetDemo();});
  await p.goto(U+'/'); await p.waitForTimeout(1500);
  await p.evaluate(()=>document.querySelectorAll('img[loading=lazy]').forEach(i=>i.loading='eager')); await p.waitForTimeout(1500);
  await meas('home','.venue .photo');
  const y=await p.evaluate(()=>document.querySelector('a.photo')?.closest('section')?.getBoundingClientRect().top+scrollY);
  await p.evaluate(y=>scrollTo({top:y-60,behavior:'instant'}),y); await p.waitForTimeout(500);
  await p.screenshot({path:`e2e/out/home-${w}.png`});
  await p.goto(U+'/products'); await p.waitForTimeout(1500);
  await p.evaluate(()=>document.querySelectorAll('img[loading=lazy]').forEach(i=>i.loading='eager')); await p.waitForTimeout(2500);
  await meas('venues','.venue-card .media');
  await p.screenshot({path:`e2e/out/venues-${w}.png`});
  const ds = await p.evaluate(()=>[...document.querySelectorAll('#f-district option')].map(o=>o.value).filter(Boolean));
  for (const d of ds.slice(0,4)) { await p.goto(U+'/products?district='+encodeURIComponent(d)); await p.waitForTimeout(1200);
    await p.evaluate(()=>document.querySelectorAll('img[loading=lazy]').forEach(i=>i.loading='eager')); await p.waitForTimeout(800); await meas('venues '+d,'.venue-card .media'); }
  for (const id of [16,7,1,42]) { await p.goto(U+'/product-detail?id='+id); await p.waitForTimeout(1500);
    const r=await p.evaluate(()=>({img:document.querySelector('.venue-top .photo img')?.getAttribute('src')||null,ok:(()=>{const i=document.querySelector('.venue-top .photo img');return i?i.naturalWidth>0:null})(),note:document.querySelector('.photo-note')?.textContent||null,alt:document.querySelector('.venue-top .photo img')?.alt||null,ov:document.documentElement.scrollWidth-innerWidth}));
    console.log(w,'venue',id,JSON.stringify(r)); if(id!==1) await p.screenshot({path:`e2e/out/venue${id}-${w}.png`}); }
  await p.close();
}
console.log('logs',logs); await b.close();
