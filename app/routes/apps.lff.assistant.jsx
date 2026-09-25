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
