// node --test theme-v190/tests/assistant-matching.test.mjs
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url);
const assistant = readFileSync(new URL('assets/lff-assistant-v190.js', root),'utf8');
const familiesSource=readFileSync(new URL('test-data/lff-assistant-families-v106.js',root),'utf8');
assert.doesNotThrow(()=>new Function(assistant),'Assistant javascript must parse');
const original=JSON.parse(familiesSource.match(/window\.LFF_ASSISTANT_FAMILIES_V106=(\[[\s\S]+?\]);/)[1]);
const extras=JSON.parse(assistant.match(/const EXTRA_FAMILY_ALIASES_V189 = (\{[^\n]+\});/)[1]);
const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[×＆&]/g,' x ').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
const editDistance=(x,y)=>{
 const a=norm(x),b=norm(y);let p=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){const n=[i];for(let j=1;j<=b.length;j++)n[j]=Math.min(n[j-1]+1,p[j]+1,p[j-1]+(a[i-1]===b[j-1]?0:1));p=n;}
 return p[b.length];
};
function segment(a,b){
 const start=assistant.indexOf(a),end=assistant.indexOf(b,start+1);
 assert(start>=0&&end>start,'missing matcher boundary '+a);
 return assistant.slice(start,end);
}
const resolve=new Function('norm','editDistance','familyCandidates','phraseInText','categoryPortal',segment('function fuzzyAliasScore(','function familyFromProducts(')+segment('function assistantFamilyResolution(','function findAssistantFamily(')+'return assistantFamilyResolution;')(
 norm,editDistance,()=>original.map(f=>({...f,aliases:[...(f.aliases||[]),...(extras[f.id]||[])]})),(s,t)=>(' '+s+' ').includes(' '+t+' '),
 c=>norm(c).includes('gaming')?'gaming':norm(c).includes('disney')?'disney':norm(c).includes('anime')?'anime':'multiverse'
);
function familyId(question){const r=resolve(question);return r.ambiguous?.length?'ambiguous':r.family?.id||'none';}
test('196 family names resolve in sales questions',()=>{
 assert.equal(original.length,196);
 for(const f of original)assert.equal(familyId('¿Tienes camisetas de '+f.name+'?'),f.id,f.name);
});
const cases={
 'quiero algo de la sirenita':'little-mermaid',
 '¿Tenéis tazas de La Sirenita?':'little-mermaid',
 'busco regalos de Ariel':'little-mermaid',
 'sireniita para mi nieta':'little-mermaid',
 'Death Note':'death-note',
 'delta note':'none',
 '¿tenéis ropa de Kaiju No. 8?':'kaiju-no-8',
 'Quiero Assassin\'s Creed':'assassins-creed',
 'busco camisetas de ARK':'ark',
 'póster de Rust':'rust',
 'busco la película UP':'up',
 'busco cosas de Power Rangers':'power-rangers',
 'me gusta la película Hades de Disney':'hercules',
 'quiero el videojuego de Hades':'hades',
 'el rey león y la sirenita':'ambiguous',
 'no sé qué regalo hacer a mi nieto':'none',
 'dónde está mi pedido':'none',
 'camisa de Naruto':'naruto',
 'Maomao de la boticaria':'apothecary-diaries',
 'quiero un regalo de Zootrópolis':'zootopia',
 'cuánto cuesta un envío':'none',
 'Frozen y La Sirenita':'ambiguous',
 'Luffy':'one-piece',
 'Sung Jinwoo':'solo-leveling',
 'tengo dudas sobre precios':'none'
};
test('regressions, ambiguous requests, typo tolerance and false-match protection',()=>{
 for(const [input,expected] of Object.entries(cases))assert.equal(familyId(input),expected,input);
});
test('site FAQ is handled without waiting for Render',()=>{
 assert(assistant.includes("mode:'local-faq'"));
 assert(assistant.includes("localTopic='';"));
});
