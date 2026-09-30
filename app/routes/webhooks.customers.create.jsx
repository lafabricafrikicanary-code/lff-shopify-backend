import { authenticate } from "../shopify.server";
import db from "../db.server";
import { processWebhookOnce, recordAudit } from "../lib/lff.server";
import { cleanEmail } from "../lib/lff-v90.server";

export const action = async ({ request }) => {
  const { payload, topic, shop } = await authenticate.webhook(request);
  const webhookId = request.headers.get("x-shopify-webhook-id");

  await processWebhookOnce({
    id: webhookId,
    shop,
    topic,
    payload,
    handler: async () => {
      const customerGid = String(payload.admin_graphql_api_id || (payload.id ? `gid://shopify/Customer/${payload.id}` : ""));
      const email = cleanEmail(payload.email);
      if (email && customerGid) {
        await db.customerAccount.updateMany({
          where: { shop, email, shopifyCustomerId: null },
          data: { shopifyCustomerId: customerGid },
        }).catch(() => {});
      }
      await recordAudit(shop, "customer.created", {
        targetType: "customer",
        targetId: customerGid || String(payload.id),
        email,
      });
    },
  });

  return new Response();
};
