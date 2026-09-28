import db from "../db.server";
import { requireCommercialSession } from "../lib/api-auth.server";
import { assertAllowedOrigin, corsHeaders, json } from "../lib/public-api.server";

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
  try {
    assertAllowedOrigin(request);
    const { commercial } = await requireCommercialSession(request);
    const [commissions, clients, companies] = await Promise.all([
      db.commission.findMany({ where: { commercialId: commercial.id }, orderBy: { createdAt: "desc" }, take: 100 }),
      db.commercialCustomerAttribution.count({ where: { commercialId: commercial.id, status: "active" } }),
      db.b2BCompany.findMany({ where: { commercialId: commercial.id }, orderBy: { createdAt: "desc" }, take: 50 }),
    ]);
    const pendingCents = commissions.filter((c) => c.status === "pending_validation").reduce((sum, c) => sum + c.amountCents, 0);
    const availableCents = commissions.filter((c) => c.status === "available").reduce((sum, c) => sum + c.amountCents, 0);
    const paidCents = commissions.filter((c) => c.status === "paid").reduce((sum, c) => sum + c.amountCents, 0);
    const salesBasisCents = commissions.reduce((sum, c) => sum + c.basisCents, 0);
    return json(request, {
      ok: true,
      commercial: {
        id: commercial.id,
        name: commercial.name,
        email: commercial.email,
        captureCode: commercial.captureCode,
        personalCode: commercial.personalCode,
        status: commercial.status,
      },
      stats: {
        clients,
        companies: companies.length,
        sales: commissions.length,
        pendingCents,
        availableCents,
        paidCents,
        salesBasisCents,
      },
      commissions: commissions.map((c) => ({
        id: c.id,
        orderName: c.orderName,
        basisCents: c.basisCents,
        rateBps: c.rateBps,
        amountCents: c.amountCents,
        status: c.status,
        validationDate: c.validationDate,
        createdAt: c.createdAt,
      })),
      companies: companies.map((c) => ({ id: c.id, companyName: c.companyName, status: c.status, createdAt: c.createdAt })),
    });
  } catch (error) {
    return json(request, { ok: false, error: error.message }, { status: 401 });
  }
};
