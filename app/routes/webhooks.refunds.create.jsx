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
      const orderGid = String(
        payload.order_admin_graphql_api_id ||
          payload.order_id ||
          payload.admin_graphql_api_id ||
          "",
      );

      if (orderGid) {
        await db.commission.updateMany({
          where: { shop, orderGid },
          data: { status: "refund_review" },
        });
      }

      await recordAudit(shop, "refund.created_commissions_review", {
        targetType: "refund",
        targetId: String(payload.admin_graphql_api_id || payload.id),
        orderGid,
      });
    },
  });

  return new Response();
};
