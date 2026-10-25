import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { unauthenticated } from "../shopify.server";
import { requireAdminSession } from "../lib/api-auth.server";
import { corsHeaders, assertAllowedOrigin, json } from "../lib/public-api.server";
import { recordAudit } from "../lib/lff.server";

// Optional VIDEO in Shopify Files; no modification of print mockups or galleries.
const SHOP=()=>process.env.SHOPIFY_SHOP_DOMAIN||"lafabricafriki.myshopify.com";
const KEY={namespace:"lff",key:"showcase_video"};
const MAX_BYTES=12*1024*1024;
const FFMPEG=process.env.FFMPEG_PATH||"ffmpeg";
const runFile=promisify(execFile);
// Shopify rechaza los MP4 MediaRecorder de Safari cuando no tienen duración
// de pista reconocible (VIDEO_MIN_DURATION_ERROR / 0 s). Forzar PTS y moov real.
async function normalizeShowcaseVideo(file){
  const dir=await mkdtemp(join(tmpdir(),"lff-video-"));
  const source=join(dir,"source.mp4");
  const output=join(dir,"ready.mp4");
  try{
    await writeFile(source,Buffer.from(await file.arrayBuffer()));
    try{
      await runFile(FFMPEG,[
        "-nostdin","-hide_banner","-loglevel","error","-y",
        "-fflags","+genpts","-i",source,
        "-map","0:v:0","-an",
        "-vf","setpts=N/(30*TB),scale=w='min(960,iw)':h='min(960,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p",
        "-r","30","-c:v","libx264","-preset","veryfast","-crf","25",
        "-profile:v","baseline","-level","3.1",
        "-movflags","+faststart","-t","20",output
      ],{timeout:120000,maxBuffer:256*1024});
    }catch(error){
      console.error("[LFF video normalize] ffmpeg",error?.stderr||error?.message);
      throw new Error("El MP4 grabado no pudo normalizarse. Prueba a exportarlo nuevamente o utiliza un vídeo H.264 estándar.");
    }
    const buffer=await readFile(output);
    if(!buffer.length||buffer.length>MAX_BYTES)
      throw new Error("El vídeo generado supera 12 MB o está vacío.");
    const sig=buffer.subarray(4,8).toString("ascii");
    if(sig!=="ftyp")throw new Error("La conversión no generó un MP4 válido.");
    let duration=0;
    try{
      const probe=await runFile("ffprobe",[
        "-v","error","-show_entries","format=duration",
        "-of","default=noprint_wrappers=1:nokey=1",output
      ],{timeout:12000,maxBuffer:100000});
      duration=Number.parseFloat((probe.stdout||"").trim())||0;
    }catch(error){
      console.error("[LFF video normalize] duration",error?.message);
    }
    if(!Number.isFinite(duration)||duration<0.25)
      throw new Error("El vídeo no tiene duración reproducible para Shopify (mínimo 0,25 s).");
    return {data:buffer,duration,size:buffer.length};
  }finally{
    await rm(dir,{recursive:true,force:true}).catch(()=>{});
  }
}
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
    // Normalizar antes de Shopify: MediaRecorder puede guardar MP4 de 0 s.
    // Validar duración REAL con ffprobe antes de subir para no crear vídeos FAILED.
    const normalized=await normalizeShowcaseVideo(file);
    const cleanName=String(file.name||"portada.mp4").replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,120);
    const cleanFile=new Blob([normalized.data],{type:"video/mp4"});
    const staged=await graph(admin,
      `mutation LffVideoStaged($input:[StagedUploadInput!]!){
        stagedUploadsCreate(input:$input){stagedTargets{url resourceUrl parameters{name value}}userErrors{field message}}
      }`,{input:[{filename:cleanName,mimeType:"video/mp4",resource:"VIDEO",fileSize:String(cleanFile.size),httpMethod:"POST"}]},"stagedUploadsCreate");
    const target=staged?.stagedTargets?.[0];
    if(!target?.url||!target?.resourceUrl)throw new Error("Shopify no facilitó la carga del vídeo.");
    const payload=new FormData();
    for(const param of target.parameters||[])payload.append(param.name,param.value);
    payload.append("file",cleanFile,cleanName);
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
    return json(request,{ok:true,hasVideo:true,fileStatus:video.fileStatus||"PROCESSING",url:"",duration:normalized.duration,message:"Vídeo H.264 validado y enlazado; Shopify lo procesará en segundo plano."});
  }catch(error){
    console.error("[LFF showcase-video upload]",error);
    return json(request,{ok:false,error:error.message},{status:400});
  }
};