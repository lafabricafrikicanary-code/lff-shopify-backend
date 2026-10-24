import { unauthenticated } from "../shopify.server";
import { requireAdminSession } from "../lib/api-auth.server";
import { assertAllowedOrigin, corsHeaders, json } from "../lib/public-api.server";
import { recordAudit } from "../lib/lff.server";

// V121: independent transparent storefront PNG, never replaces print mockups.
// Metafield stored on the product; Shopify CDN hosts the image.
const shopDomain = () => process.env.SHOPIFY_SHOP_DOMAIN || "lafabricafriki.myshopify.com";
const KEY = { namespace: "lff", key: "showcase_png" };
const LIMIT = 8 * 1024 * 1024;
async function client() {
  const { admin } = await unauthenticated.admin(shopDomain());
  if (!admin) throw new Error("La conexión de Shopify no está disponible.");
  return admin;
}
async function graph(admin, query, variables, field) {
  const res = await admin.graphql(query, { variables });
  const body = await res.json();
  const errs = [...(body.errors || []), ...(field ? body.data?.[field]?.userErrors || [] : [])];
  if (errs.length) throw new Error(errs.map(e => e.message).join("; "));
  return field ? body.data?.[field] : body.data;
}
async function readImage(admin, productId) {
  const d = await graph(admin,
    \`#graphql query LffShowcaseImage($id:ID!){product(id:$id){id title metafield(namespace:"lff",key:"showcase_png"){value}}}\`,
    { id: productId });
  if (!d?.product) throw new Error("El producto no existe.");
  return d.product.metafield?.value || "";
}
function validId(id) { return /^gid:\/\/shopify\/Product\/\d+$/.test(id); }
function validUrl(value) {
  try { const u = new URL(value); return u.protocol === "https:" && (u.hostname === "cdn.shopify.com" || u.hostname.endsWith(".shopifycdn.net")); }
  catch { return false; }
}
async function waitForImage(admin, id) {
  for (let i = 0; i < 15; i++) {
    const d = await graph(admin,
      \`#graphql query LffShowcaseFile($id:ID!){node(id:$id){... on MediaImage{id fileStatus image{url}}}}\`,
      { id });
    const file = d?.node;
    if (file?.image?.url) return file.image.url;
    if (file?.fileStatus === "FAILED") throw new Error("Shopify no pudo procesar el PNG.");
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  throw new Error("La imagen se ha subido, pero Shopify aún la está procesando. Vuelve a intentarlo en unos segundos.");
}
export const loader = async ({ request }) => {
  try {
    await requireAdminSession(request);
    const id = new URL(request.url).searchParams.get("productId") || "";
    if (!validId(id)) throw new Error("ID de producto no válido.");
    const url = await readImage(await client(), id);
    return json(request, { ok:true, url });
  } catch (err) { return json(request, { ok:false, error: err.message }, { status:400 }); }
};
export const action = async ({ request }) => {
  if (request.method === "OPTIONS") return new Response(null, { headers:corsHeaders(request) });
  try {
    assertAllowedOrigin(request);
    const auth = await requireAdminSession(request);
    const admin = await client();
    const data = await request.formData();
    const productId = String(data.get("productId") || "");
    if (!validId(productId)) throw new Error("Selecciona un producto válido.");
    const mode = String(data.get("intent") || "upload");
    if (mode === "remove") {
      await graph(admin,
        \`#graphql mutation RemoveLffShowcase($input:[MetafieldsSetInput!]!){metafieldsSet(metafields:$input){userErrors{field message}}}\`,
        { input:[{ ownerId:productId, namespace:KEY.namespace, key:KEY.key, type:"url", value:"https://cdn.shopify.com/" }] }, "metafieldsSet");
      // Never delete media or file; previous assets may be referenced elsewhere.
      return json(request,{ok:true,url:""});
    }
    if (mode !== "upload") throw new Error("Acción no admitida.");
    const file = data.get("file");
    if (!file || !file.size || !file.arrayBuffer) throw new Error("Selecciona el PNG transparente.");
    if (file.type !== "image/png" || !String(file.name).toLowerCase().endsWith(".png")) throw new Error("La imagen debe ser PNG transparente.");
    if (file.size > LIMIT) throw new Error("Máximo 8 MB por PNG. Usa una versión optimizada.");
    // Limit server processing: Shopify receives original bytes directly.
    const current = await readImage(admin, productId);
    const staged = await graph(admin,
      \`#graphql mutation LffShowcaseStage($input:[StagedUploadInput!]!){stagedUploadsCreate(input:$input){stagedTargets{url resourceUrl parameters{name value}}userErrors{field message}}}\`,
      {input:[{filename:file.name, mimeType:"image/png", resource:"SHOP_IMAGE", httpMethod:"POST"}]}, "stagedUploadsCreate");
    const target = staged?.stagedTargets?.[0];
    if (!target) throw new Error("Shopify no devolvió una URL de carga.");
    const fd = new FormData();
    for (const item of target.parameters || []) fd.append(item.name,item.value);
    fd.append("file",file,file.name);
    const transfer = await fetch(target.url,{method:"POST",body:fd});
    if (!transfer.ok) throw new Error("La transferencia del PNG falló: "+transfer.status);
    const created = await graph(admin,
      \`#graphql mutation LffShowcaseFileCreate($files:[FileCreateInput!]!){fileCreate(files:$files){files{id fileStatus ... on MediaImage{image{url}}}userErrors{field message code}}}\`,
      {files:[{contentType:"IMAGE", originalSource:target.resourceUrl,alt:"Escaparate LFF | "+productId}]}, "fileCreate");
    const media = created?.files?.[0];
    if (!media?.id) throw new Error("Shopify no confirmó la imagen.");
    const url = media.image?.url || await waitForImage(admin, media.id);
    if (!validUrl(url)) throw new Error("Shopify devolvió una URL no válida.");
    await graph(admin,
      \`#graphql mutation LffShowcaseMeta($input:[MetafieldsSetInput!]!){metafieldsSet(metafields:$input){userErrors{field message}}}\`,
      {input:[{ownerId:productId,namespace:KEY.namespace,key:KEY.key,type:"url",value:url}]},"metafieldsSet");
    await recordAudit(shopDomain(),"product.showcase_uploaded",{
      actor:auth?.user?.displayName || auth?.user?.username || "Admin",
      targetType:"product",targetId:productId, previous:Boolean(current)
    }).catch(()=>{});
    return json(request,{ok:true,url});
  } catch (err) { return json(request,{ok:false,error:err.message},{status:400}); }
};