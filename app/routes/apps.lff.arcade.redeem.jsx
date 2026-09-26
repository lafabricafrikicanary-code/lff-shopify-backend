import { issueArcadePooledDiscount } from "../lib/lff.server";

const corsHeaders = {
  "Access-Control-Allow-Headers": "Content-Type, Accept",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

async function bodyData(request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return request.json();
  }
  const formData = await request.formData();
  return Object.fromEntries(formData);
}

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(request.url);
  const shop =
    url.searchParams.get("shop") ||
    process.env.SHOPIFY_SHOP_DOMAIN ||
    "lafabricafriki.myshopify.com";
  const customerId = url.searchParams.get("logged_in_customer_id");
  const body = await bodyData(request);

  if (!shop) {
    return Response.json({ ok: false, error: "Shop ausente." }, { status: 400 });
  }

  try {
    const redemption = await issueArcadePooledDiscount({
      shop,
      email: body.email || null,
      keysSpent: body.keysSpent,
      customerId,
    });

    return Response.json(
      {
        ok: true,
        code: redemption.code,
        percent: redemption.discountPercent,
        customerId,
      },
      { headers: corsHeaders },
    );
  } catch (error) {
    console.error("LFF_ARCADE_REDEEM_ERROR", {
      shop,
      keysSpent: body.keysSpent,
      message: error.message,
    });

    return Response.json(
      {
        ok: false,
        error: error.message || "No se pudo crear el codigo Arcade.",
      },
      { status: 400, headers: corsHeaders },
    );
  }
};
