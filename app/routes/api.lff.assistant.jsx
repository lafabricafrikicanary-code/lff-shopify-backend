import { answerStoreAssistant } from "../lib/assistant.server";

const corsHeaders = {
  "Access-Control-Allow-Headers": "Content-Type, Accept",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

async function bodyData(request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return request.json();
  }
  const formData = await request.formData();
  return Object.fromEntries(formData);
}

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  return Response.json(
    {
      ok: true,
      service: "lff-assistant-direct",
      message: "LFF assistant direct endpoint is ready. Send POST with a message.",
    },
    { headers: corsHeaders },
  );
};

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const body = await bodyData(request);
  const message = String(body.message || "").trim();
  const shop = String(body.shop || "lafabricafriki.es").trim();
  const customerId = body.customerId ? String(body.customerId) : null;

  const result = await answerStoreAssistant({
    shop,
    customerId,
    message,
  });

  return Response.json(
    {
      ok: true,
      reply: result.reply,
      mode: result.mode,
      threadId: result.threadId,
    },
    { headers: corsHeaders },
  );
};
