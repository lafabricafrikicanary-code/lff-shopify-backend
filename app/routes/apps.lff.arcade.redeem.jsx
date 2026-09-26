import { authenticate, unauthenticated } from "../shopify.server";
import { issueArcadeDiscount } from "../lib/lff.server";

async function bodyData(request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return request.json();
  }
  const formData = await request.formData();
  return Object.fromEntries(formData);
}

export const action = async ({ request }) => {
  await authenticate.public.appProxy(request);

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const customerId = url.searchParams.get("logged_in_customer_id");
  const body = await bodyData(request);

  if (!shop) {
    return Response.json({ ok: false, error: "Shop ausente." }, { status: 400 });
  }

  try {
    const { admin } = await unauthenticated.admin(shop);
    const redemption = await issueArcadeDiscount({
      admin,
      shop,
      email: body.email || null,
      keysSpent: body.keysSpent,
    });

    return Response.json({
      ok: true,
      code: redemption.code,
      percent: redemption.discountPercent,
      customerId,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error.message || "No se pudo crear el codigo Arcade.",
      },
      { status: 400 },
    );
  }
};
