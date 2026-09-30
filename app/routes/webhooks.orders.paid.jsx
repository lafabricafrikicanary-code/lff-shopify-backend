import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  centsFromShopifyAmount,
  processWebhookOnce,
  recordAudit,
} from "../lib/lff.server";
import {
  classifyTrafficSource,
  cleanEmail,
  markFavoritePurchasesFromOrder,
  numericShopifyId,
} from "../lib/lff-v90.server";

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
      const orderGid = String(payload.admin_graphql_api_id || payload.id);
      const customerGid = payload.customer?.admin_graphql_api_id || (payload.customer?.id ? `gid://shopify/Customer/${payload.customer.id}` : null);
      const customerNumericId = numericShopifyId(customerGid);
      const customerEmail = cleanEmail(payload.email || payload.customer?.email) || null;

      // Arcade: un código asignado que aparece en un pedido pagado queda canjeado definitivamente.
      const arcadeCodes = await db.arcadeDiscountCode.findMany({
        where: { shop, code: { in: codes }, status: "assigned" },
        select: { id: true, code: true },
      });
      for (const arcadeCode of arcadeCodes) {
        await db.$transaction([
          db.arcadeDiscountCode.update({ where: { id: arcadeCode.id }, data: { status: "redeemed" } }),
          db.arcadeRedemption.updateMany({ where: { shop, code: arcadeCode.code, status: "issued" }, data: { status: "redeemed", redeemedAt: new Date() } }),
          db.discountIssuance.updateMany({ where: { shop, code: arcadeCode.code }, data: { status: "redeemed" } }),
        ]);
        await recordAudit(shop, "arcade.code_redeemed", { targetType: "arcade_code", targetId: arcadeCode.id, code: arcadeCode.code, orderGid });
      }

      // Recuperación de favoritos: el código de recuperación usado queda marcado como canjeado.
      if (codes.length) {
        await db.retentionCampaign.updateMany({
          where: { shop, code: { in: codes }, status: { in: ["issued", "sent"] } },
          data: { status: "redeemed", redeemedAt: new Date() },
        });
        await db.boxVoucher.updateMany({
          where: { shop, code: { in: codes }, status: "available" },
          data: { status: "redeemed", redeemedAt: new Date() },
        });
      }

      // Si el producto estaba en favoritos de este cliente y ahora aparece pagado, cancelar recuperación.
      await markFavoritePurchasesFromOrder(shop, payload);

      // Vincular cuenta cliente LFF con el customer de Shopify cuando sea posible.
      if (customerEmail && customerGid) {
        await db.customerAccount.updateMany({
          where: { shop, email: customerEmail, shopifyCustomerId: null },
          data: { shopifyCustomerId: customerGid },
        }).catch(() => {});
      }

      // B2B: persistir la actividad/pedido profesional real y marcar la promoción inicial como utilizada.
      const b2bCompany = customerGid
        ? await db.b2BCompany.findFirst({ where: { shop, status: "active", shopifyCustomerId: customerGid } })
        : customerEmail
          ? await db.b2BCompany.findFirst({ where: { shop, status: "active", contactEmail: { equals: customerEmail, mode: "insensitive" } } })
          : null;
      if (b2bCompany) {
        await db.b2BCompany.update({ where: { id: b2bCompany.id }, data: { firstOrderUsed: true, shopifyCustomerId: b2bCompany.shopifyCustomerId || customerGid || null } }).catch(() => {});
        const subtotalCents = centsFromShopifyAmount(payload.current_subtotal_price || payload.subtotal_price);
        const totalCents = centsFromShopifyAmount(payload.current_total_price || payload.total_price);
        await db.b2BOrder.upsert({
          where: { shop_orderGid_companyId: { shop, orderGid, companyId: b2bCompany.id } },
          update: {
            commercialId: b2bCompany.commercialId || null,
            orderName: payload.name || String(payload.order_number || ""),
            subtotalCents,
            totalCents,
            currency: String(payload.currency || payload.presentment_currency || "").slice(0, 12) || null,
            status: "paid",
            paidAt: payload.processed_at ? new Date(payload.processed_at) : new Date(),
            cancelledAt: null,
          },
          create: {
            shop,
            companyId: b2bCompany.id,
            commercialId: b2bCompany.commercialId || null,
            orderGid,
            orderName: payload.name || String(payload.order_number || ""),
            subtotalCents,
            totalCents,
            currency: String(payload.currency || payload.presentment_currency || "").slice(0, 12) || null,
            status: "paid",
            paidAt: payload.processed_at ? new Date(payload.processed_at) : new Date(),
          },
        });
      }

      // Fuente de tráfico/venta propia, sin depender de Shopify Analytics.
      const source = classifyTrafficSource({
        commercialCode: codes.find((code) => /^LFF15/i.test(code)) || "",
        referrer: payload.referring_site || "",
        medium: payload.source_name || "",
      });
      await db.trafficEvent.create({
        data: {
          shop,
          customerId: customerNumericId || null,
          event: "order_paid",
          source,
          sourceDetail: String(payload.source_name || "").slice(0, 180) || null,
          companyId: b2bCompany?.id || null,
          path: String(payload.landing_site || "").slice(0, 500) || null,
          referrer: String(payload.referring_site || "").slice(0, 1000) || null,
          metadataJson: JSON.stringify({ orderGid, orderName: payload.name, codes }).slice(0, 12000),
        },
      }).catch(() => {});

      // Atribución comercial: primero se respeta una atribución previa del cliente.
      const existingAttribution = customerGid
        ? await db.commercialCustomerAttribution.findUnique({ where: { shop_customerGid: { shop, customerGid } } })
        : customerEmail
          ? await db.commercialCustomerAttribution.findFirst({ where: { shop, customerEmail }, orderBy: { createdAt: "asc" } })
          : null;

      const codeCommercial = await db.commercialUser.findFirst({
        where: { shop, status: "active", captureCode: { in: codes } },
      });
      const attributedCommercial = existingAttribution
        ? await db.commercialUser.findFirst({ where: { id: existingAttribution.commercialId, shop, status: "active" } })
        : null;
      const commercial = attributedCommercial || codeCommercial;

      if (!commercial) {
        await recordAudit(shop, "order.paid_without_commercial_attribution", { targetType: "order", targetId: orderGid, codes });
        return;
      }

      const orderName = payload.name || String(payload.order_number || "");
      const isFirstAttributedOrder = !existingAttribution?.firstOrderAt;
      const rateBps = isFirstAttributedOrder ? 3000 : 1000;
      const basisCents = centsFromShopifyAmount(payload.current_subtotal_price || payload.subtotal_price);
      const amountCents = Math.round((basisCents * rateBps) / 10000);

      if (existingAttribution) {
        await db.commercialCustomerAttribution.update({
          where: { id: existingAttribution.id },
          data: {
            customerGid: existingAttribution.customerGid || customerGid,
            customerEmail: existingAttribution.customerEmail || customerEmail,
            firstOrderAt: existingAttribution.firstOrderAt || new Date(),
            orderGid: existingAttribution.orderGid || orderGid,
          },
        });
      } else if (customerGid) {
        await db.commercialCustomerAttribution.create({
          data: { shop, commercialId: commercial.id, customerGid, customerEmail, orderGid, sourceCode: codeCommercial?.captureCode || commercial.captureCode, firstOrderAt: new Date() },
        });
      } else if (customerEmail) {
        await db.commercialCustomerAttribution.create({
          data: { shop, commercialId: commercial.id, customerEmail, orderGid, sourceCode: codeCommercial?.captureCode || commercial.captureCode, firstOrderAt: new Date() },
        });
      }

      await db.commission.upsert({
        where: { shop_orderGid_commercialId: { shop, orderGid, commercialId: commercial.id } },
        update: { basisCents, rateBps, amountCents, status: "pending_validation", validationDate: validationDate() },
        create: { shop, commercialId: commercial.id, orderGid, orderName, basisCents, rateBps, amountCents, validationDate: validationDate() },
      });

      await recordAudit(shop, "commission.created_from_order", {
        targetType: "order",
        targetId: orderGid,
        commercialId: commercial.id,
        source: existingAttribution ? "existing_attribution" : "capture_code",
        code: codeCommercial?.captureCode || existingAttribution?.sourceCode || commercial.captureCode,
        rateBps,
        basisCents,
        amountCents,
      });
    },
  });

  return new Response();
};
