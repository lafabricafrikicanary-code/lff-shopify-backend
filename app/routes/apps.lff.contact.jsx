import { authenticate } from "../shopify.server";
import db from "../db.server";
import { recordAudit } from "../lib/lff.server";

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
  const body = await bodyData(request);
  const message = String(body.message || "").trim();

  if (!shop || !message) {
    return Response.json(
      { ok: false, error: "Faltan tienda o mensaje." },
      { status: 400 },
    );
  }

  const contact = await db.contactRequest.create({
    data: {
      shop,
      email: body.email ? String(body.email) : null,
      name: body.name ? String(body.name) : null,
      subject: body.subject ? String(body.subject) : "Contacto web",
      message,
    },
  });

  await recordAudit(shop, "contact.created", {
    targetType: "contact_request",
    targetId: contact.id,
  });

  return Response.json({ ok: true, id: contact.id });
};
