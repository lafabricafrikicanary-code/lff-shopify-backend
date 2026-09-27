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

  // Reserve the webhook id first so concurrent deliveries cannot process twice.
  try {
    await db.processedWebhook.create({
      data: {
        id,
        shop,
        topic,
        payloadJson: JSON.stringify(payload || {}),
      },
    });
  } catch (error) {
    // A concurrent request may have inserted the same unique id.
    const raced = await db.processedWebhook.findUnique({ where: { id } });
    if (raced) return { skipped: true };
    throw error;
  }

  try {
    if (handler) {
      await handler();
    }
    return { skipped: false };
  } catch (error) {
    // Do not permanently acknowledge failed work: Shopify can retry it.
    await db.processedWebhook.delete({ where: { id } }).catch(() => {});
    throw error;
  }
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
  const normalizedEmail = email ? String(email).trim().toLowerCase() : null;

  if (!discountPercent) {
    throw new Error("Llaves Arcade invalidas. Usa de 1 a 6.");
  }

  // If this player already has an unused code for the same tier, return it
  // instead of consuming another code from the pool.
  if (customerId || normalizedEmail) {
    const existing = await db.arcadeRedemption.findFirst({
      where: {
        shop,
        discountPercent,
        status: "issued",
        OR: [
          ...(customerId ? [{ customerGid: customerId }] : []),
          ...(normalizedEmail ? [{ email: normalizedEmail }] : []),
        ],
      },
      orderBy: { createdAt: "desc" },
    });
    if (existing) return existing;
  }

  // Claim with compare-and-swap semantics. updateMany prevents two requests
  // from receiving the same last available code.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const availableCode = await db.arcadeDiscountCode.findFirst({
      where: { shop, discountPercent, status: "available" },
      orderBy: { createdAt: "asc" },
    });

    if (!availableCode) {
      throw new Error(`Codigos Arcade ${discountPercent}% agotados temporalmente.`);
    }

    const claimed = await db.arcadeDiscountCode.updateMany({
      where: { id: availableCode.id, status: "available" },
      data: {
        status: "assigned",
        assignedToEmail: normalizedEmail,
        assignedCustomerId: customerId || null,
        assignedAt: new Date(),
      },
    });
    if (claimed.count !== 1) continue;

    try {
      const redemption = await db.$transaction(async (tx) => {
        const created = await tx.arcadeRedemption.create({
          data: {
            shop,
            customerGid: customerId,
            email: normalizedEmail,
            keysSpent: Number(keysSpent),
            discountPercent,
            code: availableCode.code,
            status: "issued",
          },
        });

        await tx.discountIssuance.upsert({
          where: { code: availableCode.code },
          update: { ownerId: created.id, status: "created" },
          create: {
            shop,
            code: availableCode.code,
            kind: "arcade_pool",
            ownerType: "arcade_player",
            ownerId: created.id,
            percent: discountPercent,
            usageLimit: 1,
            combinesWithJson: JSON.stringify({
              arcade: false,
              commercialCapture15: true,
              commercialPersonal40: false,
            }),
          },
        });
        return created;
      });

      await recordAudit(shop, "arcade.pool_code_assigned", {
        targetType: "arcade_redemption",
        targetId: redemption.id,
        code: availableCode.code,
        discountPercent,
      });
      return redemption;
    } catch (error) {
      // Return the code to the pool if creating the redemption fails.
      await db.arcadeDiscountCode.updateMany({
        where: { id: availableCode.id, status: "assigned" },
        data: {
          status: "available",
          assignedToEmail: null,
          assignedCustomerId: null,
          assignedAt: null,
        },
      });
      throw error;
    }
  }

  throw new Error("No se pudo reservar un codigo Arcade. Intentalo de nuevo.");
}
