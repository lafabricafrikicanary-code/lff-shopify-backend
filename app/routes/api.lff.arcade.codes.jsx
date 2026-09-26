import db from "../db.server";

const corsHeaders = {
  "Access-Control-Allow-Headers": "Content-Type, Accept, X-LFF-Admin-Token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

function requireAdmin(request) {
  const configured = process.env.LFF_ADMIN_TOKEN;
  if (!configured) {
    throw new Response("LFF_ADMIN_TOKEN no configurado.", { status: 503 });
  }

  const provided = request.headers.get("x-lff-admin-token");
  if (provided !== configured) {
    throw new Response("No autorizado.", { status: 401 });
  }
}

function parseCodesText(text) {
  return String(text || "")
    .split(/[\n,;]/)
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);
}

async function bodyData(request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return request.json();
  }
  const formData = await request.formData();
  return Object.fromEntries(formData);
}

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  requireAdmin(request);

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") || "lafabricafriki.myshopify.com";
  const counts = await db.arcadeDiscountCode.groupBy({
    by: ["discountPercent", "status"],
    where: { shop },
    _count: { id: true },
  });

  return Response.json({ ok: true, shop, counts }, { headers: corsHeaders });
};

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  requireAdmin(request);

  const body = await bodyData(request);
  const shop = String(body.shop || "lafabricafriki.myshopify.com").trim();
  const discountPercent = Number(body.discountPercent);
  const codes = Array.isArray(body.codes)
    ? body.codes.map(String)
    : parseCodesText(body.codes || body.csv);

  if (![5, 10, 15, 20, 25, 30].includes(discountPercent)) {
    return Response.json(
      { ok: false, error: "Porcentaje invalido." },
      { status: 400, headers: corsHeaders },
    );
  }

  if (!codes.length) {
    return Response.json(
      { ok: false, error: "No hay codigos para importar." },
      { status: 400, headers: corsHeaders },
    );
  }

  const result = await db.arcadeDiscountCode.createMany({
    data: codes.map((code) => ({
      shop,
      code,
      discountPercent,
      status: "available",
      source: "precreated",
    })),
    skipDuplicates: true,
  });

  return Response.json(
    {
      ok: true,
      imported: result.count,
      discountPercent,
    },
    { headers: corsHeaders },
  );
};
