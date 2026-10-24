// LFF V118 · Catalog classification in read-only mode.
// Do not modify Shopify product tags or publication status.
import prisma from '../db.server';

export const normCatalog = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const categoryKey = value => {
  const v = normCatalog(value);
  if (v.includes('anime') || v.includes('manga')) return 'anime';
  if (v.includes('gaming') || v.includes('juegos') || v.includes('videojuegos')) return 'gaming';
  if (v.includes('disney') || v.includes('pixar') || v.includes('marvel') || v.includes('star wars')) return 'disney';
  if (v.includes('multiusos') || v.includes('multiverso') || v.includes('multiverse')) return 'multiverse';
  return '';
};
const builtins = [
  { name:'One Piece', familyKey:'one-piece', category:'anime', aliases:['one piece','monkey d luffy','luffy','roronoa zoro','zoro','sanji','usopp','chopper','nico robin','mugiwara','gear 5','gear fifth','trafalgar law','portgas ace'] },
  { name:'Naruto', familyKey:'naruto', category:'anime', aliases:['naruto','sasuke','itachi','kakashi','sakura haruno','madara uchiha','uchiha','akatsuki','jiraiya','minato namikaze','gaara','obito'] },
  { name:'Coco', familyKey:'coco', category:'disney', aliases:['coco','miguel rivera','hector rivera'] },
];
function titleMatches(text, aliases){
  const normalized = ` ${normCatalog(text)} `;
  return aliases.some(value => {
    const n = normCatalog(value);
    return n.length >= 4 && normalized.includes(` ${n} `);
  });
}
function aliasList(row){
  let aliases=[];
  try { const raw=JSON.parse(row.aliasesJson || '[]'); if (Array.isArray(raw)) aliases=raw; }catch{}
  return [row.name,row.familyKey,...aliases].filter(Boolean);
}
export async function familyCatalogTaxonomy(shop, products){
  // This metadata comes from the actual family settings in LFF Administration.
  let stored=[];
  try { stored=await prisma.lffFamily.findMany({where:{shop,enabled:true},select:{name:true,familyKey:true,category:true,aliasesJson:true}}); }
  catch(error) { console.warn('[LFF taxonomy] Family metadata unavailable; built-in fallback', error?.message); }
  const families=[...stored.map(f=>({...f,category:categoryKey(f.category),aliases:aliasList(f)})),...builtins];
  return products.map(product=>{
    const tags=Array.isArray(product.tags)?product.tags:[];
    const catTag=tags.find(tag=>/^LFF_CATEGORY:/i.test(String(tag)))||'';
    const famTag=tags.find(tag=>/^LFF_FAMILY:/i.test(String(tag)))||'';
    const category=product.category||catTag.split(':').slice(1).join(':').trim();
    const family=product.family||famTag.split(':').slice(1).join(':').trim();
    // Explicit classification always wins. No automatic rewriting of Shopify data.
    if (category && family) return {...product,category,family};
    const lookup=`${product.title || ''} ${product.handle || ''}`;
    const tagged=tags.join(' ');
    const found=families.find(f=>f.category && (family && normCatalog(f.name)===normCatalog(family) ||
      titleMatches(lookup,[f.name,f.familyKey,...(f.aliases||[])]) || titleMatches(tagged,[f.name,f.familyKey])));
    if (!found) return {...product,category,family};
    return {...product, category: category || found.category, family:family || found.name};
  });
}

export function publicCategoryMatch(p, category){
  const direct=categoryKey(p.category);
  if(direct) return direct===category;
  // Public catalog metadata may contain explicit category aliases.
  const tags=Array.isArray(p.tags)?p.tags:[];
  const categoryTag=tags.find(tag=>/^LFF_CATEGORY:/i.test(String(tag)))||'';
  return categoryKey(categoryTag.replace(/^LFF_CATEGORY:/i,''))===category;
}
