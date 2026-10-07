import { authenticate } from "../shopify.server";
import { loader as directLoader, action as directAction } from "./api.lff.admin.auth.jsx";

function errorJson(error, status = 401) {
  return Response.json({ ok: false, error: error?.message || "No se pudo autenticar el App Proxy." }, { status });
}

export const loader = async (args) => {
  try {
    // Shopify firma cada petición de /apps/lff/* antes de reenviarla a Render.
    await authenticate.public.appProxy(args.request);
    // El loader directo devolverá 401 sin sesión. Eso es correcto y además sirve
    // como health-check para saber que Render está respondiendo.
    return directLoader(args);
  } catch (error) {
    console.error("[LFF ADMIN PROXY loader]", error);
    return errorJson(error);
  }
};

export const action = async (args) => {
  try {
    // Autenticar primero la petición firmada por Shopify usando un clon para no
    // consumir el body que contiene las credenciales/intención del Admin.
    await authenticate.public.appProxy(args.request.clone());

    const request = args.request;
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return directAction(args);
    }

    const body = await request.clone().json();
    const token = String(body.__lffAdminToken || "").trim();
    delete body.__lffAdminToken;

    const headers = new Headers(request.headers);
    headers.set("Content-Type", "application/json");
    headers.set("Accept", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);
    else headers.delete("Authorization");

    const forwarded = new Request(request.url, {
      method: request.method,
      headers,
      body: JSON.stringify(body),
    });

    return directAction({ ...args, request: forwarded });
  } catch (error) {
    console.error("[LFF ADMIN PROXY action]", error);
    return errorJson(error, 400);
  }
};
