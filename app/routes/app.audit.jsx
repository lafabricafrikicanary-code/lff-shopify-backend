/* eslint-disable react/prop-types */
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [logs, webhooks] = await Promise.all([
    db.auditLog.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.processedWebhook.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  return { logs, webhooks };
};

function Table({ rows, columns, empty }) {
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
                  {column.render ? column.render(row) : row[column.key] || "-"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AuditPage() {
  const { logs, webhooks } = useLoaderData();

  return (
    <s-page heading="Auditoria LFF">
      <s-section heading="Acciones del sistema">
        <Table
          rows={logs}
          empty="Aun no hay acciones registradas."
          columns={[
            { key: "createdAt", label: "Fecha", render: (row) => new Date(row.createdAt).toLocaleString() },
            { key: "action", label: "Accion" },
            { key: "targetType", label: "Tipo" },
            { key: "targetId", label: "ID" },
          ]}
        />
      </s-section>
      <s-section heading="Webhooks procesados">
        <Table
          rows={webhooks}
          empty="Aun no hay webhooks procesados."
          columns={[
            { key: "createdAt", label: "Fecha", render: (row) => new Date(row.createdAt).toLocaleString() },
            { key: "topic", label: "Topic" },
            { key: "id", label: "Webhook ID" },
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
