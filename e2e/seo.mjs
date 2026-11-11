import { chromium } from 'playwright';
import fs from 'fs';
const B=process.env.U||'http://127.0.0.1:4100';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs=[]; p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
const pub=['index','products','transfers','matches','leagues','about'];
const noindex=['owner-leagues','owner-league','transfer','match','match-new','requests','request-new','request','login','register','booking','my-bookings','notifications','styleguide','owner','owner-bookings','owner-requests','owner-schedule','owner-settings','admin','admin-bookings','admin-logs','cart'];
const all=fs.readdirSync('.').filter(f=>f.endsWith('.html')).map(f=>f.slice(0,-5));
let fail=0; const bad=(m)=>{fail++;console.log('FAIL',m)};
for(const n of all) if(!pub.includes(n)&&n!=='product-detail'&&n!=='league'&&!noindex.includes(n)) bad('unclassified page '+n);
const D='https://ggo-datsan.pages.dev'; const staticTitles=new Map(); const staticRows=[]; const titles=new Map(); const rows=[];
const imgOk=new Map();
async function info(url){ await p.goto(B+url,{waitUntil:'domcontentloaded'}); await p.waitForTimeout(1200);
  return p.evaluate(()=>{const m=(a,k)=>document.head.querySelector(`meta[${a}="${k}"]`)?.content||null;return {lang:document.documentElement.lang,title:document.title,desc:m('name','description'),robots:m('name','robots'),canon:document.head.querySelector('link[rel=canonical]')?.href||null,og:Object.fromEntries(['og:title','og:description','og:image','og:url','og:type','og:locale'].map(k=>[k,m('property',k)])),final:location.pathname}}); }
const decode=(t)=>t.replace(/&amp;/g,'&');
for(const n of all){ const html=await (await fetch(B+(n==='index'?'/':'/'+n))).text();
  const head=html.slice(0,html.indexOf('</head>'));
  const g=(re)=>{const m=head.match(re);return m?decode(m[1]):null};
  const st={lang:/<html lang="vi"/.test(html),title:g(/<title>([^<]*)<\/title>/),desc:g(/<meta name="description" content="([^"]*)"/),robots:g(/<meta name="robots" content="([^"]*)"/),ogTitle:g(/property="og:title" content="([^"]*)"/),ogDesc:g(/property="og:description" content="([^"]*)"/),ogImg:g(/property="og:image" content="([^"]*)"/),ogUrl:g(/property="og:url" content="([^"]*)"/),ogLocale:g(/property="og:locale" content="([^"]*)"/),ogType:g(/property="og:type" content="([^"]*)"/)};
  const idx=pub.includes(n)||n==='product-detail'||n==='league'; const chrome=!n.startsWith('owner')&&!n.startsWith('admin')&&n!=='styleguide';
  if(!st.lang) bad(n+' static lang'); if(!st.title) bad(n+' static title');
  if(idx&&st.robots) bad(n+' static robots '+st.robots); if(!idx&&!/noindex/.test(st.robots||'')) bad(n+' static no noindex');
  if(chrome){ for(const k of ['desc','ogTitle','ogDesc','ogImg','ogUrl','ogLocale','ogType']) if(!st[k]) bad(n+' static missing '+k);
    if(st.ogLocale!=='vi_VN') bad(n+' static locale'); if(st.ogTitle!==st.title) bad(n+' og:title!=title');
    if(st.ogUrl!==D+(n==='index'?'/':'/'+n+'.html')) bad(n+' og:url '+st.ogUrl);
    if(st.title&&staticTitles.has(st.title)) bad(n+' static dup title '+staticTitles.get(st.title)); staticTitles.set(st.title,n);
    if(st.ogImg) imgOk.set(st.ogImg,n); }
  staticRows.push(`${n.padEnd(18)} ${idx?'index  ':'noindex'} | ${(st.title||'').slice(0,72)} | desc ${(st.desc||'').length}c`);
}
for(const n of all){
  if(false) continue;
  const url=n==='index'?'/':'/'+n+(n==='product-detail'?'?id=12':n==='league'?'?id=1':'');
  const r=await info(url); const idx=pub.includes(n)||n==='product-detail';
  if(r.lang!=='vi') bad(n+' lang '+r.lang);
  if(!r.title) bad(n+' no title');
  const isGate=r.final!==(url.split('?')[0]); // redirect to login
  if(!isGate){ if(titles.has(r.title)) bad(`${n} duplicates title of ${titles.get(r.title)}`); titles.set(r.title,n); }
  if(idx){ if(r.robots) bad(n+' should be indexable but has robots '+r.robots); }
  else if(!/noindex/.test(r.robots||'')) bad(n+' missing noindex');
  if(!n.startsWith('owner')&&!n.startsWith('admin')&&n!=='styleguide'){
    if(!r.desc) bad(n+' no description');
    for(const [k,v] of Object.entries(r.og)) if(!v) bad(n+' missing '+k);
    if(r.og['og:locale']!=='vi_VN') bad(n+' locale');
    if(r.og['og:image']) imgOk.set(r.og['og:image'],n);
    if(r.og['og:url'] && !r.og['og:url'].startsWith('https://ggo-datsan.pages.dev/')) bad(n+' og:url '+r.og['og:url']);
  }
  rows.push(`${n.padEnd(18)} ${idx?'index  ':'noindex'} | ${r.title.slice(0,70)} | ${(r.desc||'').length}c ${isGate?'(chuyển sang '+r.final+')':''}`);
}
for(const [u,n] of imgOk){ const path=new URL(u).pathname; const r=await fetch(B+path); if(r.status!==200||!(r.headers.get('content-type')||'').startsWith('image/')) bad(`og:image of ${n} -> ${r.status} ${u}`); }
console.log('STATIC HEAD (từ HTML tải về)\n'+staticRows.join('\n'));
// venue pages: title có tên sân và quận
const ids=await p.evaluate(async()=>{const {api}=await import('/js/api.js');const L=(await api.venues({})).venues; const out=[]; for(const v of L){ const d=await api.venue(v.id); out.push({id:v.id,name:v.name,district:v.district,real:!!(d.venue||d).dataSource}); } return out;});
let vOk=0;const vt=new Set();
for(const v of ids){ const r=await info('/product-detail?id='+v.id); const okT=r.title.includes(v.name)&&r.title.includes(v.district); if(!okT) bad('venue '+v.id+' title '+r.title); if(vt.has(r.title)) bad('venue dup title '+v.id); vt.add(r.title);
  if(!(r.desc||'').includes(v.name)) bad('venue '+v.id+' desc'); if(r.canon!=='https://ggo-datsan.pages.dev/product-detail.html?id='+v.id) bad('venue canon '+r.canon); if(!r.og['og:title']?.includes(v.name)||!r.og['og:url']?.endsWith('id='+v.id)) bad('venue og '+v.id); if(v.real){ if(r.robots) bad('real venue '+v.id+' robots '+r.robots); } else if(!/noindex/.test(r.robots||'')) bad('demo venue '+v.id+' missing noindex'); if(okT) vOk++; if(v.id===12) console.log('venue 12:',r.title,'|',r.desc); }
console.log('venue pages ok',vOk,'/',ids.length);
// robots + sitemap
const rb=await fetch(B+'/robots.txt'); console.log('robots',rb.status,(await rb.text()).replace(/\n/g,' ⏎ '));
const sm=await fetch(B+'/sitemap.xml'); const x=await sm.text(); console.log('sitemap',sm.status,sm.headers.get('content-type'));
const urls=[...x.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1].replace(/&amp;/g,'&'));
console.log('sitemap urls',urls.length); const ids2=new Set(ids.map(v=>v.id)); let sbad=0;
for(const u of urls){ const U=new URL(u); if(U.origin!=='https://ggo-datsan.pages.dev'){bad('sitemap origin '+u);continue}
  const path=U.pathname==='/'?'/':U.pathname; const page=path==='/'?'index':path.replace(/^\//,'').replace(/\.html$/,'');
  if(!(pub.includes(page)||page==='product-detail')) bad('sitemap has non-public '+u);
  const r=await fetch(B+path+(page==='product-detail'?'':'')); if(r.status!==200) bad('sitemap 404 '+u);
  if(page==='product-detail'&&!ids2.has(Number(U.searchParams.get('id')))) bad('sitemap unknown venue '+u); }
for(const n of pub) if(!urls.includes(n==='index'?'https://ggo-datsan.pages.dev/':`https://ggo-datsan.pages.dev/${n}.html`)) bad('sitemap lacks '+n);
for(const v of ids){ const inMap=urls.includes(`https://ggo-datsan.pages.dev/product-detail.html?id=${v.id}`); if(v.real&&!inMap) bad('sitemap lacks venue '+v.id); if(!v.real&&inMap) bad('sitemap has demo venue '+v.id); }
console.log('demo ids in sitemap:',ids.filter(v=>!v.real&&urls.some(u=>u.endsWith('id='+v.id))).length,'; demo venues:',ids.filter(v=>!v.real).map(v=>v.id).join(','));
console.log('console errors',errs.length?errs.slice(0,3):0,'FAILS',fail);
await b.close();

// từ cấm trong <head> của mọi trang
import {readdirSync,readFileSync} from 'fs'; const forbid=/booking|slot|chào giá|nhu cầu|chờ duyệt|hoàn tiền/i; let fb=0;
for(const f of readdirSync('.').filter(f=>f.endsWith('.html'))){ const h=readFileSync(f,'utf8').split('</head>')[0]; const t=(h.match(/<title>[^<]*/)||[''])[0]+' '+(h.match(/name="description" content="[^"]*/)||[''])[0]+' '+(h.match(/og:(title|description)" content="[^"]*/g)||[]).join(' '); const m=t.match(forbid); if(m){ bad('forbidden word in head '+f+': '+m[0]); fb++; } }
console.log('head forbidden-word pages:',fb);
