import db from "../db.server";

const FALLBACK_REPLIES = [
  {
    pattern: /whats|tel[eé]fono|contact|persona|humano/i,
    reply:
      "Puedes hablar directamente con Alejandro por WhatsApp en el +34 614 002 652. Si quieres, te puedo orientar antes sobre productos, pedidos o zonas de la tienda.",
  },
  {
    pattern: /caja|misterio|sorpresa|suscripci[oó]n mensual|15 ?€/i,
    reply:
      "La Caja Friki es una suscripcion mensual pensada para recibir productos sorpresa y ventajas de la tienda. Cuando este activada al 100%, desde aqui podras ver condiciones, gestionar alta y resolver dudas.",
  },
  {
    pattern: /club|evento|drop|descuento/i,
    reply:
      "El Club Friki sirve para recibir avisos de eventos, drops y descuentos de la comunidad. Si quieres, tambien puedo explicarte la diferencia entre Club, Caja Friki y descuentos Arcade.",
  },
  {
    pattern: /tienda|empresa|mayorista|profesional|b2b/i,
    reply:
      "Si tienes una tienda o empresa, la zona profesional servira para solicitar cuenta, consultar condiciones, hacer pedidos en bloque y hablar con el equipo o comercial asignado.",
  },
  {
    pattern: /comercial|afiliad|comisi[oó]n/i,
    reply:
      "El area de comerciales esta pensada para captar clientes y tiendas, consultar codigos, comisiones, pagos y conversaciones asociadas.",
  },
  {
    pattern: /pedido|comprar|compra|carrito|checkout|env[ií]o/i,
    reply:
      "Para comprar, entra en una categoria, abre el producto, elige variante si existe y anadelo al carrito. Si tienes una duda concreta de envio o pedido, dime la isla o destino y te oriento.",
  },
];

function fallbackReply(message) {
  const match = FALLBACK_REPLIES.find((item) => item.pattern.test(message));
  if (match) return match.reply;

  return "Puedo ayudarte con productos, pedidos, Club Friki, Caja Friki, comerciales, tiendas, descuentos o contacto. Dime que necesitas y te guio paso a paso.";
}

function outputTextFromResponse(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const chunks = [];
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") chunks.push(content.text);
    }
  }

  return chunks.join("\n").trim();
}

async function createOpenAIReply(message) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const configuredModel = process.env.LFF_ASSISTANT_MODEL || "gpt-5-mini";
  const models = [...new Set([configuredModel, "gpt-5-mini"])];
  let lastError = null;

  for (const model of models) {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: 500,
        instructions:
          "Eres el asistente de La Fabrica Friki, una tienda Shopify de productos frikis, anime, gaming, Disney y multiverso. Responde en espanol de Espana, breve, claro y util. No inventes stock, pedidos, precios ni politicas que no conozcas. Si una accion requiere datos privados, pedido concreto o una persona, deriva a WhatsApp +34 614 002 652. Nunca pidas claves, contrasenas ni datos de tarjeta.",
        input: message,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      return outputTextFromResponse(data);
    }

    const detail = await response.text().catch(() => "");
    lastError = new Error(`OpenAI ${response.status}: ${detail.slice(0, 300)}`);
  }

  throw lastError;
}

export async function answerStoreAssistant({ shop, message, customerId = null }) {
  const text = String(message || "").trim().slice(0, 1200);
  if (!text) {
    return {
      reply: "Escribeme tu pregunta y te ayudo.",
      mode: "fallback",
    };
  }

  let thread = null;
  if (shop) {
    thread = await db.chatThread.create({
      data: {
        shop,
        subject: "Asistente tienda",
        channel: "store_assistant",
        ownerType: customerId ? "customer" : "visitor",
        ownerId: customerId ? String(customerId) : null,
        messages: {
          create: {
            author: "customer",
            body: text,
          },
        },
      },
    });
  }

  try {
    const aiReply = await createOpenAIReply(text);
    const reply = aiReply || fallbackReply(text);

    if (thread) {
      await db.chatMessage.create({
        data: {
          threadId: thread.id,
          author: aiReply ? "assistant_ai" : "assistant_fallback",
          body: reply,
        },
      });
    }

    return {
      reply,
      mode: aiReply ? "openai" : "fallback",
      threadId: thread?.id,
    };
  } catch (error) {
    const reply =
      "Ahora mismo el asistente IA no puede conectar con el modelo, pero puedo darte ayuda basica: productos, pedidos, Club, comerciales, tiendas o WhatsApp.";

    if (thread) {
      await db.chatMessage.create({
        data: {
          threadId: thread.id,
          author: "assistant_error",
          body: `${reply} (${error.message})`,
        },
      });
    }

    return {
      reply,
      mode: "error_fallback",
      threadId: thread?.id,
    };
  }
}
