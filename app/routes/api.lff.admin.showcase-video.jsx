import { unauthenticated } from "../shopify.server";
import { requireAdminSession } from "../lib/api-auth.server";
import { corsHeaders, assertAllowedOrigin, json } from "../lib/public-api.server";
import { recordAudit } from "../lib/lff.server";

// Optional VIDEO in Shopify Files; no modification of print mockups or galleries.
const SHOP=()=>process.env.SHOPIFY_SHOP_DOMAIN||"lafabricafriki.myshopify.com";
const KEY={namespace:"lff",key:"showcase_video"};
const MAX_BYTES=12*1024*1024;
const validId=id=>/^gid:\/\/shopify\/Product\/\d+$/.test(String(id||""));
async function graph(admin,query,variables,key){
  const result=await admin.graphql(query,{variables});
  const body=await result.json();
  const errors=[...(body.errors||[]),...(key?body.data?.[key]?.userErrors||[]:[])];
  if(!result.ok||errors.length)throw new Error(errors.map(e=>e.message).join("; ")||"Error de Shopify "+result.status);
  return key?body.data?.[key]:body.data;
}
async function getVideo(admin,productId){
  const d=await graph(admin,
    `query LffShowcaseVideoProduct($id:ID!){
      product(id:$id){id metafield(namespace:"lff",key:"showcase_video"){
        id value type reference{... on Video{id fileStatus sources{url mimeType format}}}
      }}
    }`,{id:productId});
  if(!d.product)throw new Error("El producto no existe.");
  const f=d.product.metafield,video=f?.reference;
  const mp4=video?.sources?.find(s=>s.mimeType==="video/mp4"||s.format==="mp4");
  return {hasVideo:Boolean(f?.value),fileStatus:video?.fileStatus||(f?.value?"PROCESSING":"NONE"),url:mp4?.url||"",metafieldId:f?.id||""};
}
async function shopifyClient(){
  const {admin}=await unauthenticated.admin(SHOP());
  if(!admin)throw new Error("Conexión de Shopify no disponible.");
  return admin;
}
export const loader=async({request})=>{
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers:corsHeaders(request)});
  try{
    await requireAdminSession(request);
    const productId=new URL(request.url).searchParams.get("productId");
    if(!validId(productId))throw new Error("Producto no válido.");
    return json(request,{ok:true,...await getVideo(await shopifyClient(),productId)});
  }catch(error){
    console.error("[LFF showcase-video GET]",error);
    return json(request,{ok:false,error:error.message},{status:400});
  }
};
export const action=async({request})=>{
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers:corsHeaders(request)});
  try{
    assertAllowedOrigin(request);
    const auth=await requireAdminSession(request);
    const admin=await shopifyClient();
    const data=await request.formData();
    const productId=String(data.get("productId")||"");
    if(!validId(productId))throw new Error("Selecciona un producto válido.");
    const intent=String(data.get("intent")||"upload");
    const current=await getVideo(admin,productId);
    if(intent==="remove"){
      if(current.metafieldId)await graph(admin,
        `mutation RemoveLffShowcaseVideo($input:[MetafieldIdentifierInput!]!){
          metafieldsDelete(metafields:$input){deletedMetafields{key namespace ownerId} userErrors{field message}}
        }`,{input:[{ownerId:productId,namespace:KEY.namespace,key:KEY.key}]},"metafieldsDelete");
      return json(request,{ok:true,hasVideo:false,fileStatus:"NONE",url:""});
    }
    if(intent!=="upload")throw new Error("Acción no permitida.");
    const file=data.get("file");
    if(!file||!file.size||!file.slice||!file.arrayBuffer)throw new Error("Selecciona un vídeo MP4.");
    if(!String(file.name||"").toLowerCase().endsWith(".mp4")||(file.type&&file.type!=="video/mp4"))
      throw new Error("El formato debe ser MP4 (H.264).");
    if(file.size>MAX_BYTES)throw new Error("Máximo 12 MB; recomendamos vídeos de 1–2 MB.");
    const sig=new Uint8Array(await file.slice(0,12).arrayBuffer());
    if(String.fromCharCode(...sig.slice(4,8))!=="ftyp")throw new Error("El archivo no es un MP4 válido.");
    const staged=await graph(admin,
      `mutation LffVideoStaged($input:[StagedUploadInput!]!){
        stagedUploadsCreate(input:$input){stagedTargets{url resourceUrl parameters{name value}}userErrors{field message}}
      }`,{input:[{filename:file.name,mimeType:"video/mp4",resource:"VIDEO",fileSize:String(file.size),httpMethod:"POST"}]},"stagedUploadsCreate");
    const target=staged?.stagedTargets?.[0];
    if(!target?.url||!target?.resourceUrl)throw new Error("Shopify no facilitó la carga del vídeo.");
    const payload=new FormData();
    for(const param of target.parameters||[])payload.append(param.name,param.value);
    payload.append("file",file,file.name);
    const transferred=await fetch(target.url,{method:"POST",body:payload});
    if(!transferred.ok)throw new Error("No se pudo transferir el vídeo: "+transferred.status);
    const created=await graph(admin,
      `mutation LffVideoFileCreate($files:[FileCreateInput!]!){
        fileCreate(files:$files){
          files{id fileStatus ... on Video{sources{url mimeType format}}}
          userErrors{field message code}
        }
      }`,{files:[{contentType:"VIDEO",originalSource:target.resourceUrl,alt:"Animación de escaparate LFF | "+productId}]},"fileCreate");
    const video=created?.files?.[0];
    if(!video?.id)throw new Error("Shopify no confirmó el vídeo.");
    // Save VIDEO reference immediately; public catalog gets MP4 source after processing.
    await graph(admin,
      `mutation LffVideoProductReference($input:[MetafieldsSetInput!]!){
        metafieldsSet(metafields:$input){userErrors{field message}}
      }`,{input:[{ownerId:productId,namespace:KEY.namespace,key:KEY.key,type:"file_reference",value:video.id}]},"metafieldsSet");
    await recordAudit(SHOP(),"product.showcase_video_uploaded",{
      actor:auth?.user?.displayName||auth?.user?.username||"Admin",
      targetType:"product",targetId:productId,replaced:current.hasVideo
    }).catch(()=>{});
    return json(request,{ok:true,hasVideo:true,fileStatus:video.fileStatus||"PROCESSING",url:"",message:"Vídeo recibido. Shopify lo procesará en segundo plano."});
  }catch(error){
    console.error("[LFF showcase-video upload]",error);
    return json(request,{ok:false,error:error.message},{status:400});
  }
};