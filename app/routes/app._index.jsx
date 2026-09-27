/* eslint-disable react/prop-types */
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  createArcadePoolBatch,
  createCommercialWithCodes,
  issueArcadeDiscount,
  recordAudit,
  syncArcadePoolJobs,
} from "../lib/lff.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [
    commercialCount,
    b2bPendingCount,
    openChatCount,
    arcadeIssuedCount,
    discountCount,
    latestCommercials,
    latestB2B,
    latestDiscounts,
    arcadePoolGroups,
  ] = await Promise.all([
    db.commercialUser.count({ where: { shop } }),
    db.b2BCompany.count({ where: { shop, status: "pending" } }),
    db.chatThread.count({ where: { shop, status: "open" } }),
    db.arcadeRedemption.count({ where: { shop } }),
    db.discountIssuance.count({ where: { shop } }),
    db.commercialUser.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    db.b2BCompany.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    db.discountIssuance.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    db.arcadeDiscountCode.groupBy({
      by: ["discountPercent", "status"],
      where: { shop },
      _count: { id: true },
    }),
  ]);

  const arcadePool = [5, 10, 15, 20, 25, 30].map((percent) => {
    const row = {
      id: `pool-${percent}`,
      discountPercent: percent,
      available: 0,
      pending: 0,
      assigned: 0,
      redeemed: 0,
      failed: 0,
    };
    for (const group of arcadePoolGroups) {
      if (group.discountPercent === percent && group.status in row) {
        row[group.status] = group._count.id;
      }
    }
    return row;
  });
  const arcadePoolAvailable = arcadePool.reduce(
    (total, row) => total + row.available,
    0,
  );

  return {
    shop,
    counters: {
      commercialCount,
      b2bPendingCount,
      openChatCount,
      arcadeIssuedCount,
      discountCount,
      arcadePoolAvailable,
    },
    arcadePool,
    latestCommercials,
    latestB2B,
    latestDiscounts,
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    if (intent === "create-commercial") {
      const name = String(formData.get("name") || "").trim();
      const email = String(formData.get("email") || "").trim();

      if (!name) {
        throw new Error("Pon un nombre para el comercial.");
      }

      const commercial = await createCommercialWithCodes({
        admin,
        shop,
        name,
        email: email || null,
      });

      return {
        ok: true,
        message: `Comercial creado: ${commercial.captureCode} y ${commercial.personalCode}`,
      };
    }

    if (intent === "create-b2b") {
      const companyName = String(formData.get("companyName") || "").trim();
      const contactEmail = String(formData.get("contactEmail") || "").trim();
      const referredByCode = String(formData.get("referredByCode") || "").trim();

      if (!companyName) {
        throw new Error("Pon el nombre de la tienda.");
      }

      const b2b = await db.b2BCompany.create({
        data: {
          shop,
          companyName,
          contactEmail: contactEmail || null,
          referredByCode: referredByCode || null,
          priceTier: referredByCode ? "referred_55_first_63" : "direct_60",
        },
      });

      await recordAudit(shop, "b2b.created", {
        targetType: "b2b_company",
        targetId: b2b.id,
        referredByCode,
      });

      return { ok: true, message: `Tienda B2B registrada: ${companyName}` };
    }

    if (intent === "issue-arcade") {
      const email = String(formData.get("email") || "").trim();
      const keysSpent = Number(formData.get("keysSpent") || 0);

      const redemption = await issueArcadeDiscount({
        admin,
        shop,
        email: email || null,
        keysSpent,
      });

      return {
        ok: true,
        message: `Codigo Arcade creado: ${redemption.code} (${redemption.discountPercent}%)`,
      };
    }

    if (intent === "generate-arcade-pool") {
      const discountPercent = Number(formData.get("discountPercent") || 0);
      const quantity = Number(formData.get("quantity") || 100);
      const result = await createArcadePoolBatch({
        admin,
        shop,
        discountPercent,
        quantity,
      });
      const available = result.statusCounts.find((row) => row.status === "available")?._count.id || 0;
      const pending = result.statusCounts.find((row) => row.status === "pending")?._count.id || 0;
      return {
        ok: true,
        message: `Lote Arcade ${discountPercent}% creado. Disponibles: ${available}. Pendientes de Shopify: ${pending}.`,
      };
    }

    if (intent === "sync-arcade-pool") {
      const result = await syncArcadePoolJobs({ admin, shop });
      return {
        ok: true,
        message: `Bolsa sincronizada. Activados: ${result.activated}. Fallidos: ${result.failed}. Lotes aun pendientes: ${result.waiting}.`,
      };
    }

    throw new Error("Accion no reconocida.");
  } catch (error) {
    return { ok: false, message: error.message };
  }
};

function Field({ label, name, type = "text", required = false, placeholder }) {
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <span style={{ display: "block", fontWeight: 650, marginBottom: 6 }}>
        {label}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        style={{
          width: "100%",
          border: "1px solid #c9cccf",
          borderRadius: 6,
          padding: "9px 11px",
          fontSize: 14,
        }}
      />
    </label>
  );
}

function Stat({ label, value }) {
  return (
    <div
      style={{
        border: "1px solid #dfe3e8",
        borderRadius: 8,
        padding: 14,
        minWidth: 150,
      }}
    >
      <div style={{ fontSize: 13, color: "#616a75" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 750 }}>{value}</div>
    </div>
  );
}

function SimpleTable({ rows, columns, empty }) {
  if (!rows.length) {
    return <s-paragraph>{empty}</s-paragraph>;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                style={{
                  textAlign: "left",
                  borderBottom: "1px solid #dfe3e8",
                  padding: "8px 6px",
                  fontSize: 13,
                }}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  style={{
                    borderBottom: "1px solid #edf0f2",
                    padding: "8px 6px",
                    fontSize: 13,
                  }}
                >
                  {column.render ? column.render(row) : (row[column.key] ?? "-")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Index() {
  const data = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <s-page heading="Control Center LFF">
      <s-section heading="Estado real">
        <s-paragraph>
          Backend conectado a {data.shop}. Desde aqui se crean codigos reales de
          Shopify y se registran atribuciones, tiendas, chats, canjes y auditoria
          en servidor.
        </s-paragraph>
        {actionData?.message && (
          <div
            style={{
              margin: "12px 0",
              border: `1px solid ${actionData.ok ? "#95c9a7" : "#e0a0a0"}`,
              background: actionData.ok ? "#f0fff4" : "#fff5f5",
              borderRadius: 8,
              padding: 12,
            }}
          >
            {actionData.message}
          </div>
        )}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Stat label="Comerciales" value={data.counters.commercialCount} />
          <Stat label="Tiendas pendientes" value={data.counters.b2bPendingCount} />
          <Stat label="Chats abiertos" value={data.counters.openChatCount} />
          <Stat label="Canjes Arcade" value={data.counters.arcadeIssuedCount} />
          <Stat label="Codigos emitidos" value={data.counters.discountCount} />
          <Stat label="Arcade disponibles" value={data.counters.arcadePoolAvailable} />
        </div>
      </s-section>

      <s-section heading="Crear comercial">
        <s-paragraph>
          Genera codigo de captacion 15% para nuevo cliente y codigo propio 40%.
          Ambos quedan vinculados al comercial.
        </s-paragraph>
        <Form method="post">
          <input type="hidden" name="intent" value="create-commercial" />
          <Field label="Nombre" name="name" required placeholder="Nombre comercial" />
          <Field label="Email" name="email" type="email" placeholder="email@ejemplo.com" />
          <button type="submit" disabled={busy}>
            Crear comercial y codigos
          </button>
        </Form>
      </s-section>

      <s-section heading="Registrar tienda">
        <s-paragraph>
          Registra una tienda B2B. Si trae codigo comercial, queda marcada como
          referida para aplicar las reglas aprobadas.
        </s-paragraph>
        <Form method="post">
          <input type="hidden" name="intent" value="create-b2b" />
          <Field label="Nombre tienda" name="companyName" required placeholder="Tienda Friki SL" />
          <Field label="Email contacto" name="contactEmail" type="email" placeholder="compras@tienda.es" />
          <Field label="Codigo comercial referido" name="referredByCode" placeholder="LFF15-..." />
          <button type="submit" disabled={busy}>
            Registrar tienda
          </button>
        </Form>
      </s-section>


      <s-section heading="Bolsa Arcade Shopify">
        <s-paragraph>
          Crea lotes de codigos reales de Shopify para que el Arcade los entregue
          automaticamente al canjear llaves. Cada lote usa un porcentaje fijo y
          cada codigo queda registrado en PostgreSQL.
        </s-paragraph>
        <Form method="post">
          <input type="hidden" name="intent" value="generate-arcade-pool" />
          <label style={{ display: "block", marginBottom: 12 }}>
            <span style={{ display: "block", fontWeight: 650, marginBottom: 6 }}>
              Porcentaje
            </span>
            <select
              name="discountPercent"
              defaultValue="5"
              style={{ width: "100%", padding: "9px 11px", borderRadius: 6 }}
            >
              {[5, 10, 15, 20, 25, 30].map((percent) => (
                <option key={percent} value={percent}>
                  {percent}%
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "block", marginBottom: 12 }}>
            <span style={{ display: "block", fontWeight: 650, marginBottom: 6 }}>
              Cantidad de codigos
            </span>
            <input
              name="quantity"
              type="number"
              min="1"
              max="250"
              defaultValue="100"
              required
              style={{
                width: "100%",
                border: "1px solid #c9cccf",
                borderRadius: 6,
                padding: "9px 11px",
                fontSize: 14,
              }}
            />
          </label>
          <button type="submit" disabled={busy}>
            Crear lote en Shopify
          </button>
        </Form>
        <div style={{ marginTop: 12 }}>
          <Form method="post">
            <input type="hidden" name="intent" value="sync-arcade-pool" />
            <button type="submit" disabled={busy}>
              Sincronizar lotes pendientes
            </button>
          </Form>
        </div>
        <div style={{ marginTop: 16 }}>
          <SimpleTable
            rows={data.arcadePool}
            empty="Aun no hay codigos en la bolsa Arcade."
            columns={[
              { key: "discountPercent", label: "%" },
              { key: "available", label: "Disponibles" },
              { key: "pending", label: "Pendientes" },
              { key: "assigned", label: "Asignados" },
              { key: "redeemed", label: "Canjeados" },
              { key: "failed", label: "Fallidos" },
            ]}
          />
        </div>
      </s-section>

      <s-section heading="Emitir codigo Arcade">
        <s-paragraph>
          Herramienta manual de prueba: crea un codigo individual directamente
          en Shopify. El Arcade publico usa la bolsa gestionada arriba.
        </s-paragraph>
        <Form method="post">
          <input type="hidden" name="intent" value="issue-arcade" />
          <Field label="Email jugador" name="email" type="email" placeholder="cliente@email.com" />
          <Field label="Llaves gastadas (1-6)" name="keysSpent" type="number" required placeholder="3" />
          <button type="submit" disabled={busy}>
            Crear codigo Arcade
          </button>
        </Form>
      </s-section>

      <s-section heading="Ultimos comerciales">
        <SimpleTable
          rows={data.latestCommercials}
          empty="Aun no hay comerciales."
          columns={[
            { key: "name", label: "Nombre" },
            { key: "email", label: "Email" },
            { key: "captureCode", label: "Captacion 15%" },
            { key: "personalCode", label: "Propio 40%" },
            { key: "status", label: "Estado" },
          ]}
        />
      </s-section>

      <s-section heading="Ultimas tiendas">
        <SimpleTable
          rows={data.latestB2B}
          empty="Aun no hay tiendas registradas."
          columns={[
            { key: "companyName", label: "Tienda" },
            { key: "contactEmail", label: "Email" },
            { key: "priceTier", label: "Nivel" },
            { key: "status", label: "Estado" },
          ]}
        />
      </s-section>

      <s-section heading="Ultimos codigos">
        <SimpleTable
          rows={data.latestDiscounts}
          empty="Aun no hay codigos emitidos."
          columns={[
            { key: "code", label: "Codigo" },
            { key: "kind", label: "Tipo" },
            { key: "percent", label: "%" },
            { key: "status", label: "Estado" },
          ]}
        />
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
