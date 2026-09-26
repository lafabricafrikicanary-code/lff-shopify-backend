import db from "../db.server";

export function normalizeCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function makeCode(prefix, seed = "") {
  const base = normalizeCode(seed).slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  return normalizeCode([prefix, base, suffix].filter(Boolean).join("-"));
}

export function centsFromShopifyAmount(value) {
  const amount = Number(value || 0);
  return Math.round(amount * 100);
}

export async function createPercentageCode(admin, input) {
  const startsAt = input.startsAt || new Date().toISOString();
  const response = await admin.graphql(
    `#graphql
      mutation LffCreateBasicDiscount($discount: DiscountCodeBasicInput!) {
        discountCodeBasicCreate(basicCodeDiscount: $discount) {
          codeDiscountNode {
            id
            codeDiscount {
              ... on DiscountCodeBasic {
                title
                status
                codes(first: 1) {
                  nodes {
                    code
                  }
                }
              }
            }
          }
          userErrors {
            field
            message
            code
          }
        }
      }`,
    {
      variables: {
        discount: {
          title: input.title,
          code: input.code,
          startsAt,
          usageLimit: input.usageLimit ?? null,
          appliesOncePerCustomer: input.appliesOncePerCustomer ?? false,
          customerSelection: { all: true },
          customerGets: {
            value: {
              percentage: Number(input.percent) / 100,
            },
            items: { all: true },
          },
          combinesWith: input.combinesWith || {
            orderDiscounts: false,
            productDiscounts: false,
            shippingDiscounts: false,
          },
        },
      },
    },
  );

  const json = await response.json();
  const result = json.data?.discountCodeBasicCreate;
  const errors = result?.userErrors || json.errors || [];

  if (errors.length) {
    throw new Error(errors.map((error) => error.message).join("; "));
  }

  return result.codeDiscountNode;
}

export async function recordAudit(shop, action, details = {}) {
  return db.auditLog.create({
    data: {
      shop,
      action,
      actor: details.actor || "admin",
      targetType: details.targetType,
      targetId: details.targetId,
      detailsJson: JSON.stringify(details),
    },
  });
}

export async function processWebhookOnce({ id, shop, topic, payload, handler }) {
  if (!id) {
    throw new Error("Missing webhook id");
  }

  const existing = await db.processedWebhook.findUnique({ where: { id } });
  if (existing) {
    return { skipped: true };
  }

  await db.processedWebhook.create({
    data: {
      id,
      shop,
      topic,
      payloadJson: JSON.stringify(payload || {}),
    },
  });

  if (handler) {
    await handler();
  }

  return { skipped: false };
}

export async function createCommercialWithCodes({ admin, shop, name, email }) {
  const captureCode = makeCode("LFF15", name || email || "COMERCIAL");
  const personalCode = makeCode("LFF40", name || email || "PROPIO");

  const captureDiscount = await createPercentageCode(admin, {
    title: `LFF comercial captacion - ${name}`,
    code: captureCode,
    percent: 15,
    appliesOncePerCustomer: true,
    combinesWith: {
      orderDiscounts: true,
      productDiscounts: false,
      shippingDiscounts: false,
    },
  });

  const personalDiscount = await createPercentageCode(admin, {
    title: `LFF comercial propio 40 - ${name}`,
    code: personalCode,
    percent: 40,
    appliesOncePerCustomer: false,
    combinesWith: {
      orderDiscounts: false,
      productDiscounts: false,
      shippingDiscounts: false,
    },
  });

  const commercial = await db.commercialUser.create({
    data: {
      shop,
      name,
      email,
      captureCode,
      personalCode,
      shopifyCaptureDiscountId: captureDiscount.id,
      shopifyPersonalDiscountId: personalDiscount.id,
    },
  });

  await db.discountIssuance.createMany({
    data: [
      {
        shop,
        code: captureCode,
        kind: "commercial_capture",
        ownerType: "commercial",
        ownerId: commercial.id,
        percent: 15,
        usageLimit: null,
        shopifyDiscountId: captureDiscount.id,
        combinesWithJson: JSON.stringify({
          arcade: true,
          ownCommercial40: false,
        }),
      },
      {
        shop,
        code: personalCode,
        kind: "commercial_personal",
        ownerType: "commercial",
        ownerId: commercial.id,
        percent: 40,
        usageLimit: null,
        shopifyDiscountId: personalDiscount.id,
        combinesWithJson: JSON.stringify({
          arcade: false,
          otherDiscounts: false,
        }),
      },
    ],
  });

  await recordAudit(shop, "commercial.created", {
    targetType: "commercial",
    targetId: commercial.id,
    captureCode,
    personalCode,
  });

  return commercial;
}

export async function issueArcadeDiscount({ admin, shop, email, keysSpent }) {
  const percentByKeys = { 1: 5, 2: 10, 3: 15, 4: 20, 5: 25, 6: 30 };
  const discountPercent = percentByKeys[Number(keysSpent)] || 0;

  if (!discountPercent) {
    throw new Error("Llaves Arcade invalidas. Usa de 1 a 6.");
  }

  const code = makeCode(`ARCADE${discountPercent}`, email || "PLAYER");
  const discount = await createPercentageCode(admin, {
    title: `LFF Arcade ${discountPercent}%`,
    code,
    percent: discountPercent,
    usageLimit: 1,
    appliesOncePerCustomer: true,
    combinesWith: {
      orderDiscounts: false,
      productDiscounts: false,
      shippingDiscounts: false,
    },
  });

  const redemption = await db.arcadeRedemption.create({
    data: {
      shop,
      email,
      keysSpent: Number(keysSpent),
      discountPercent,
      code,
      shopifyDiscountId: discount.id,
    },
  });

  await db.discountIssuance.create({
    data: {
      shop,
      code,
      kind: "arcade",
      ownerType: "arcade_player",
      ownerId: redemption.id,
      percent: discountPercent,
      usageLimit: 1,
      shopifyDiscountId: discount.id,
      combinesWithJson: JSON.stringify({
        arcade: false,
        commercialCapture15: true,
        commercialPersonal40: false,
      }),
    },
  });

  await recordAudit(shop, "arcade.discount_issued", {
    targetType: "arcade_redemption",
    targetId: redemption.id,
    code,
    discountPercent,
  });

  return redemption;
}

export async function issueArcadePooledDiscount({
  shop,
  email,
  keysSpent,
  customerId = null,
}) {
  const percentByKeys = { 1: 5, 2: 10, 3: 15, 4: 20, 5: 25, 6: 30 };
  const discountPercent = percentByKeys[Number(keysSpent)] || 0;

  if (!discountPercent) {
    throw new Error("Llaves Arcade invalidas. Usa de 1 a 6.");
  }

  const availableCode = await db.arcadeDiscountCode.findFirst({
    where: {
      shop,
      discountPercent,
      status: "available",
    },
    orderBy: { createdAt: "asc" },
  });

  if (!availableCode) {
    throw new Error(
      `Codigos Arcade ${discountPercent}% agotados temporalmente.`,
    );
  }

  const updatedCode = await db.arcadeDiscountCode.update({
    where: { id: availableCode.id },
    data: {
      status: "assigned",
      assignedToEmail: email || null,
      assignedCustomerId: customerId || null,
      assignedAt: new Date(),
    },
  });

  const redemption = await db.arcadeRedemption.create({
    data: {
      shop,
      customerGid: customerId,
      email,
      keysSpent: Number(keysSpent),
      discountPercent,
      code: updatedCode.code,
      status: "issued",
    },
  });

  await db.discountIssuance.create({
    data: {
      shop,
      code: updatedCode.code,
      kind: "arcade_pool",
      ownerType: "arcade_player",
      ownerId: redemption.id,
      percent: discountPercent,
      usageLimit: 1,
      combinesWithJson: JSON.stringify({
        arcade: false,
        commercialCapture15: true,
        commercialPersonal40: false,
      }),
    },
  });

  await recordAudit(shop, "arcade.pool_code_assigned", {
    targetType: "arcade_redemption",
    targetId: redemption.id,
    code: updatedCode.code,
    discountPercent,
  });

  return redemption;
}
