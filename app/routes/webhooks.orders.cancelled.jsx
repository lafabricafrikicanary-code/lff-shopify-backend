import { authenticate } from "../shopify.server";
import db from "../db.server";
import { processWebhookOnce, recordAudit } from "../lib/lff.server";

export const action = async ({ request }) => {
  const { payload, topic, shop } = await authenticate.webhook(request);
  const webhookId = request.headers.get("x-shopify-webhook-id");

  await processWebhookOnce({
    id: webhookId,
    shop,
    topic,
    payload,
    handler: async () => {
      const orderGid = String(payload.admin_graphql_api_id || payload.id);

      await db.commission.updateMany({
        where: { shop, orderGid },
        data: { status: "cancelled" },
      });

      await recordAudit(shop, "order.cancelled_commissions_marked", {
        targetType: "order",
        targetId: orderGid,
      });
    },
  });

  return new Response();
};
