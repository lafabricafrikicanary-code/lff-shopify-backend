// LFF V148 - fast checkout recommendations from existing Neon cached catalog.
// One SQL query, zero Admin API calls, and NO product galleries or variants.
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const SHOP = "unvufs-6t.myshopify.com";
const HEADERS = { "Cache-Control": "private, max-age=60", "Content-Type": "application/json; charset=utf-8" };
const VALID_HANDLE = /^[a-z0-9][a-z0-9-]{1,119}$/i;
const normalize = v => String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const isHidden = p => {
  const meta = normalize([p.title,p.productType,...(Array.isArray(p.tags)?p.tags:[])].join(" "));
  return /hentai|k-pop|kpop|libros|preparacion-para-regalo|lff-regalo|lff-hidden|lff-oculto/.test(meta);
};
function kindOf(p) {
  const meta = normalize([p.productType, ...(Array.isArray(p.tags)?p.tags.filter(t=>/^LFF_PRODUCT_TYPE:/i.test(t)):[]),p.title].join(" "));
  if (/taza|mug/.test(meta)) return "taza";
  if (/poster|lamina|cuadro/.test(meta)) return "poster";
  if (/textil|ropa|camisa|camiseta|sudadera|merchandising-lff/.test(meta)) return "textil";
  return "otros";
}
function keyHash(s) {
  let h=5381; for (let i=0;i<s.length;i++) h=((h*33)^s.charCodeAt(i))>>>0;
  return h;
}
let cached=null, loading=null;
async function snapshots(shop) {
  if(cached?.shop===shop&&cached.until>Date.now()) return cached.products;
  if(loading) return loading;
  loading=prisma.lffCatalogLiteSnapshot.findMany({
    where:{shop},select:{category:true,products:true}
  }).then(rows=>{
    const seen=new Set(),products=[];
    for(const row of rows) {
      for(const p of (Array.isArray(row.products)?row.products:[])){
        const handle=String(p?.handle||"");
        if(!VALID_HANDLE.test(handle)||seen.has(handle)||isHidden(p)) continue;
        seen.add(handle);products.push({...p,category:p.category||row.category});
      }
    }
    cached={shop,products,until:Date.now()+90_000};
    return products;
  }).finally(()=>{loading=null});
  return loading;
}
export const loader=async ({request})=>{
  try {
    const {session}=await authenticate.public.appProxy(request);
    const url=new URL(request.url);
    const shop=session?.shop||url.searchParams.get("shop");
    if(shop!==SHOP) return Response.json({ok:false,error:"Tienda no autorizada"},{status:403,headers:HEADERS});
    const handles=(url.searchParams.get("handles")||"").split(",").map(v=>v.trim()).filter(v=>VALID_HANDLE.test(v)).slice(0,12);
    if(!handles.length) return Response.json({ok:true,handles:[],count:0},{headers:HEADERS});
    const previous=new Set(handles);
    const all=await snapshots(shop);
    const originals=all.filter(p=>previous.has(p.handle));
    const knownFamilies=new Set(originals.map(p=>normalize(p.family)).filter(Boolean));
    const knownCategories=new Set(originals.map(p=>p.category).filter(Boolean));
    const kinds=new Set(originals.map(kindOf));
    const tagMatch=new Set(originals.flatMap(p=>(Array.isArray(p.tags)?p.tags:[]).map(normalize))
      .filter(x=>x.length>4&&!/^lff-|^anime$|^manga$|^friki$|^ropa$|^camiseta$|^camisa$|^sudadera$|^merchandising/.test(x)));
    const seed=handles.join(",");
    const scored=all.filter(p=>!previous.has(p.handle)).map(p=>{
      const fam=normalize(p.family);
      const kind=kindOf(p);
      const tags=(Array.isArray(p.tags)?p.tags:[]).map(normalize);
      const sameFamily= fam&&[...knownFamilies].some(k=>k===fam||k.startsWith(fam+"-")||fam.startsWith(k+"-"));
      let score=(sameFamily?180:0)+(knownCategories.has(p.category)?55:0)+(kinds.has(kind)?0:20);
      score+=Math.min(50,tags.filter(t=>tagMatch.has(t)).length*14);
      score+=keyHash(seed+p.handle)%10;
      return {p,score,kind};
    }).sort((a,b)=>b.score-a.score);
    // Avoid showing four near-identical items whenever the catalog permits.
    const chosen=[],chosenKinds=new Map(),chosenFamilies=new Map();
    while(chosen.length<24&&scored.length) {
      let index=0,best=-Infinity;
      for(let i=0;i<Math.min(scored.length,48);i++){
        const x=scored[i], fam=normalize(x.p.family);
        const adjusted=x.score-(chosenKinds.get(x.kind)||0)*18-(chosenFamilies.get(fam)||0)*12;
        if(adjusted>best){best=adjusted;index=i;}
      }
      const x=scored.splice(index,1)[0],fam=normalize(x.p.family);
      chosen.push(x.p.handle);
      chosenKinds.set(x.kind,(chosenKinds.get(x.kind)||0)+1);
      chosenFamilies.set(fam,(chosenFamilies.get(fam)||0)+1);
    }
    return Response.json({ok:true,handles:chosen,count:chosen.length},{headers:HEADERS});
  } catch(error) {
    console.error("[LFF V148 recommendations]",error?.message||String(error));
    return Response.json({ok:false,error:"Recomendaciones no disponibles"},{status:503,headers:HEADERS});
  }
};
