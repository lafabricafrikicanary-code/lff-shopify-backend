import { authenticate } from "../shopify.server";
import { answerStoreAssistant } from "../lib/assistant.server";

async function bodyData(request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return request.json();
  }
  const formData = await request.formData();
  return Object.fromEntries(formData);
}

export const loader = async ({ request }) => {
  await authenticate.public.appProxy(request);

  return new Response(
    "<!doctype html><meta charset=\"utf-8\"><title>LFF Assistant OK</title><body style=\"font-family:system-ui;padding:24px\"><h1>LFF Assistant OK</h1><p>El App Proxy del asistente esta conectado. El chat real enviara mensajes por POST desde el theme.</p></body>",
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    },
  );
};

export const action = async ({ request }) => {
  await authenticate.public.appProxy(request);

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const customerId = url.searchParams.get("logged_in_customer_id");
  const body = await bodyData(request);
  const message = String(body.message || "").trim();

  if (!shop) {
    return Response.json({ ok: false, error: "Shop ausente." }, { status: 400 });
  }

  const result = await answerStoreAssistant({
    shop,
    customerId,
    message,
  });

  return Response.json({
    ok: true,
    reply: result.reply,
    mode: result.mode,
    threadId: result.threadId,
  });
};
