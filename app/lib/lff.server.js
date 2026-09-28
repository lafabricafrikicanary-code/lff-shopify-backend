import { randomBytes } from "node:crypto";
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
  const context = input.customerIds?.length
    ? { customers: { add: input.customerIds } }
    : { all: "ALL" };
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
          context,
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


export async function findOrCreateShopifyCustomer(admin, { email, name }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) throw new Error("El comercial necesita un correo para vincular su código propio del 40%.");
  const queryResponse = await admin.graphql(
    `#graphql
      query LffFindCustomerByEmail($query: String!) {
        customers(first: 1, query: $query) {
          nodes { id email }
        }
      }`,
    { variables: { query: `email:${normalizedEmail}` } },
  );
  const queryJson = await queryResponse.json();
  const found = queryJson.data?.customers?.nodes?.[0];
  if (found?.id) return found;

  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  const firstName = parts.shift() || "Comercial";
  const lastName = parts.join(" ") || undefined;
  const createResponse = await admin.graphql(
    `#graphql
      mutation LffCreateCommercialCustomer($input: CustomerInput!) {
        customerCreate(input: $input) {
          customer { id email }
          userErrors { field message }
        }
      }`,
    { variables: { input: { email: normalizedEmail, firstName, ...(lastName ? { lastName } : {}) } } },
  );
  const createJson = await createResponse.json();
  const errors = createJson.data?.customerCreate?.userErrors || createJson.errors || [];
  if (errors.length) throw new Error(errors.map((error) => error.message).join("; "));
  return createJson.data?.customerCreate?.customer;
}

export async function restrictCommercialPersonalDiscount(admin, commercial) {
  if (!commercial?.shopifyPersonalDiscountId) throw new Error("El comercial no tiene descuento 40% en Shopify.");
  const customer = await findOrCreateShopifyCustomer(admin, {
    email: commercial.email,
    name: commercial.name,
  });
  const response = await admin.graphql(
    `#graphql
      mutation LffRestrictPersonalDiscount($id: ID!, $discount: DiscountCodeBasicInput!) {
        discountCodeBasicUpdate(id: $id, basicCodeDiscount: $discount) {
          codeDiscountNode { id }
          userErrors { field message code }
        }
      }`,
    {
      variables: {
        id: commercial.shopifyPersonalDiscountId,
        discount: {
          context: { customers: { add: [customer.id] } },
          appliesOncePerCustomer: false,
        },
      },
    },
  );
  const json = await response.json();
  const errors = json.data?.discountCodeBasicUpdate?.userErrors || json.errors || [];
  if (errors.length) throw new Error(errors.map((error) => error.message).join("; "));
  await db.commercialUser.update({
    where: { id: commercial.id },
    data: { shopifyCustomerId: customer.id },
  });
  await recordAudit(commercial.shop, "commercial.personal_discount_restricted", {
    targetType: "commercial",
    targetId: commercial.id,
    customerId: customer.id,
    code: commercial.personalCode,
  });
  return customer;
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

export async function createCommercialWithCodes({
  admin,
  shop,
  name,
  email,
  phone = null,
  channel = null,
  about = null,
  passwordHash = null,
  passwordSalt = null,
}) {
  if (!email) throw new Error("El comercial necesita correo para crear su cuenta y proteger el código propio del 40%.");
  const captureCode = makeCode("LFF15", name || email || "COMERCIAL");
  const personalCode = makeCode("LFF40", name || email || "PROPIO");
  const shopifyCustomer = await findOrCreateShopifyCustomer(admin, { email, name });

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
    customerIds: [shopifyCustomer.id],
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
      phone,
      channel,
      about,
      passwordHash,
      passwordSalt,
      captureCode,
      personalCode,
      shopifyCustomerId: shopifyCustomer.id,
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


function makeArcadePoolCode(discountPercent, index) {
  const token = randomBytes(4).toString("hex").toUpperCase();
  const stamp = Date.now().toString(36).toUpperCase();
  return normalizeCode(`ARCADE${discountPercent}-LFF-${stamp}-${index}-${token}`);
}

async function getArcadeBulkCreation(admin, id) {
  const response = await admin.graphql(
    `#graphql
      query LffArcadeBulkCreation($id: ID!) {
        discountRedeemCodeBulkCreation(id: $id) {
          id
          done
          codesCount
          importedCount
          failedCount
          codes(first: 250) {
            nodes {
              code
              discountRedeemCode {
                code
              }
              errors {
                message
              }
            }
          }
        }
      }`,
    { variables: { id } },
  );
  const json = await response.json();
  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message).join("; "));
  }
  return json.data?.discountRedeemCodeBulkCreation || null;
}

export async function syncArcadePoolJobs({ admin, shop }) {
  const pending = await db.arcadeDiscountCode.findMany({
    where: { shop, status: "pending" },
    select: { source: true },
  });

  const jobIds = [
    ...new Set(
      pending
        .map((row) => String(row.source || ""))
        .filter((source) => source.startsWith("shopify_bulk:"))
        .map((source) => source.slice("shopify_bulk:".length))
        .filter(Boolean),
    ),
  ];

  let activated = 0;
  let failed = 0;
  let waiting = 0;

  for (const jobId of jobIds) {
    const job = await getArcadeBulkCreation(admin, jobId);
    if (!job || !job.done) {
      waiting += 1;
      continue;
    }

    const successfulCodes = (job.codes?.nodes || [])
      .filter((node) => node.discountRedeemCode)
      .map((node) => String(node.code || node.discountRedeemCode.code || "").toUpperCase())
      .filter(Boolean);
    const failedCodes = (job.codes?.nodes || [])
      .filter((node) => !node.discountRedeemCode)
      .map((node) => String(node.code || "").toUpperCase())
      .filter(Boolean);

    if (successfulCodes.length) {
      const result = await db.arcadeDiscountCode.updateMany({
        where: { shop, code: { in: successfulCodes }, status: "pending" },
        data: { status: "available" },
      });
      activated += result.count;
    }

    if (failedCodes.length) {
      const result = await db.arcadeDiscountCode.updateMany({
        where: { shop, code: { in: failedCodes }, status: "pending" },
        data: { status: "failed" },
      });
      failed += result.count;
    }
  }

  return { activated, failed, waiting, jobs: jobIds.length };
}

export async function createArcadePoolBatch({
  admin,
  shop,
  discountPercent,
  quantity = 100,
}) {
  const percent = Number(discountPercent);
  const count = Number(quantity);

  if (![5, 10, 15, 20, 25, 30].includes(percent)) {
    throw new Error("Porcentaje Arcade invalido.");
  }
  if (!Number.isInteger(count) || count < 1 || count > 250) {
    throw new Error("La cantidad debe estar entre 1 y 250 codigos.");
  }

  const codes = Array.from({ length: count }, (_, index) =>
    makeArcadePoolCode(percent, index + 1),
  );
  const primaryCode = codes[0];

  const discount = await createPercentageCode(admin, {
    title: `LFF Arcade Pool ${percent}%`,
    code: primaryCode,
    percent,
    usageLimit: 1,
    appliesOncePerCustomer: true,
    combinesWith: {
      orderDiscounts: false,
      productDiscounts: false,
      shippingDiscounts: false,
    },
  });

  await db.arcadeDiscountCode.create({
    data: {
      shop,
      code: primaryCode,
      discountPercent: percent,
      status: "available",
      source: `shopify_bulk_primary:${discount.id}`,
    },
  });

  let bulkId = null;
  if (codes.length > 1) {
    const response = await admin.graphql(
      `#graphql
        mutation LffArcadeBulkAdd($discountId: ID!, $codes: [DiscountRedeemCodeInput!]!) {
          discountRedeemCodeBulkAdd(discountId: $discountId, codes: $codes) {
            bulkCreation {
              id
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
          discountId: discount.id,
          codes: codes.slice(1).map((code) => ({ code })),
        },
      },
    );

    const json = await response.json();
    const result = json.data?.discountRedeemCodeBulkAdd;
    const errors = result?.userErrors || json.errors || [];
    if (errors.length) {
      throw new Error(errors.map((error) => error.message).join("; "));
    }
    bulkId = result?.bulkCreation?.id || null;
    if (!bulkId) {
      throw new Error("Shopify no devolvio el identificador del lote Arcade.");
    }

    await db.arcadeDiscountCode.createMany({
      data: codes.slice(1).map((code) => ({
        shop,
        code,
        discountPercent: percent,
        status: "pending",
        source: `shopify_bulk:${bulkId}`,
      })),
      skipDuplicates: true,
    });

    // The Shopify bulk operation is asynchronous. Give it a short window to
    // finish so most batches become immediately usable, while keeping a safe
    // pending state if Shopify needs longer.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const job = await getArcadeBulkCreation(admin, bulkId);
      if (job?.done) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  const sync = await syncArcadePoolJobs({ admin, shop });

  await recordAudit(shop, "arcade.pool_batch_created", {
    targetType: "arcade_pool",
    targetId: discount.id,
    discountPercent: percent,
    requested: count,
    bulkId,
    sync,
  });

  const statusCounts = await db.arcadeDiscountCode.groupBy({
    by: ["status"],
    where: { shop, discountPercent: percent },
    _count: { id: true },
  });

  return {
    discountPercent: percent,
    requested: count,
    discountId: discount.id,
    bulkId,
    statusCounts,
    sync,
  };
}
