import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  centsFromShopifyAmount,
  processWebhookOnce,
  recordAudit,
} from "../lib/lff.server";

function orderCodes(payload) {
  return (payload.discount_codes || [])
    .map((discount) => String(discount.code || "").toUpperCase())
    .filter(Boolean);
}

function validationDate() {
  const date = new Date();
  date.setDate(date.getDate() + 15);
  return date;
}

export const action = async ({ request }) => {
  const { payload, topic, shop } = await authenticate.webhook(request);
  const webhookId = request.headers.get("x-shopify-webhook-id");

  await processWebhookOnce({
    id: webhookId,
    shop,
    topic,
    payload,
    handler: async () => {
      const codes = orderCodes(payload);
      const commercial = await db.commercialUser.findFirst({
        where: {
          shop,
          status: "active",
          captureCode: { in: codes },
        },
      });

      if (!commercial) {
        await recordAudit(shop, "order.paid_without_commercial_code", {
          targetType: "order",
          targetId: String(payload.admin_graphql_api_id || payload.id),
          codes,
        });
        return;
      }

      const customerGid = payload.customer?.admin_graphql_api_id || null;
      const customerEmail = payload.email || payload.customer?.email || null;
      const orderGid = String(payload.admin_graphql_api_id || payload.id);
      const orderName = payload.name || String(payload.order_number || "");
      const existingAttribution = customerGid
        ? await db.commercialCustomerAttribution.findUnique({
            where: {
              shop_customerGid: {
                shop,
                customerGid,
              },
            },
          })
        : null;

      const isFirstAttributedOrder = !existingAttribution?.firstOrderAt;
      const rateBps = isFirstAttributedOrder ? 3000 : 1000;
      const basisCents = centsFromShopifyAmount(
        payload.current_subtotal_price || payload.subtotal_price,
      );
      const amountCents = Math.round((basisCents * rateBps) / 10000);

      if (customerGid) {
        await db.commercialCustomerAttribution.upsert({
          where: {
            shop_customerGid: {
              shop,
              customerGid,
            },
          },
          update: {
            customerEmail,
            firstOrderAt: existingAttribution?.firstOrderAt || new Date(),
            orderGid: existingAttribution?.orderGid || orderGid,
          },
          create: {
            shop,
            commercialId: commercial.id,
            customerGid,
            customerEmail,
            orderGid,
            sourceCode: commercial.captureCode,
            firstOrderAt: new Date(),
          },
        });
      } else if (customerEmail) {
        await db.commercialCustomerAttribution.create({
          data: {
            shop,
            commercialId: commercial.id,
            customerEmail,
            orderGid,
            sourceCode: commercial.captureCode,
            firstOrderAt: new Date(),
          },
        });
      }

      await db.commission.upsert({
        where: {
          shop_orderGid_commercialId: {
            shop,
            orderGid,
            commercialId: commercial.id,
          },
        },
        update: {
          basisCents,
          rateBps,
          amountCents,
          status: "pending_validation",
          validationDate: validationDate(),
        },
        create: {
          shop,
          commercialId: commercial.id,
          orderGid,
          orderName,
          basisCents,
          rateBps,
          amountCents,
          validationDate: validationDate(),
        },
      });

      await recordAudit(shop, "commission.created_from_order", {
        targetType: "order",
        targetId: orderGid,
        commercialId: commercial.id,
        code: commercial.captureCode,
        rateBps,
        basisCents,
        amountCents,
      });
    },
  });

  return new Response();
};
