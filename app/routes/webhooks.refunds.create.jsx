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
        const refundedCents = Math.round((payload.transactions || []).reduce((sum, tx) => sum + Math.max(0, Number(tx.amount || 0)), 0) * 100);
        const b2bOrders = await db.b2BOrder.findMany({ where: { shop, orderGid }, select: { id: true, refundedCents: true } });
        for (const b2bOrder of b2bOrders) {
          await db.b2BOrder.update({
            where: { id: b2bOrder.id },
            data: { status: "refund_review", refundedCents: Math.max(b2bOrder.refundedCents || 0, refundedCents) },
          });
        }
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
