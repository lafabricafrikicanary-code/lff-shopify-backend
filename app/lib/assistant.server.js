import db from "../db.server";

const FALLBACK_REPLIES = [
  {
    pattern: /hola|buenas|buenos|hey|saludos/i,
    reply:
      "Hola, soy el Asistente Friki. Puedo ayudarte a encontrar productos por universo, preparar un regalo, explicarte el Club, la Caja Friki, descuentos, comerciales, tiendas o contacto.",
  },
  {
    pattern: /anime|manga|naruto|one piece|dragon ball|kimetsu|demon slayer|jujutsu|pokemon|pok[eé]mon|goku|luffy/i,
    reply:
      "Para anime y manga, empieza por la seccion Anime & Manga. Si buscas un personaje concreto, dime el nombre o la serie y te oriento por colecciones, figuras, regalos o productos frikis relacionados.",
  },
  {
    pattern: /gaming|juego|videojuego|playstation|nintendo|xbox|minecraft|zelda|mario|fortnite|sonic/i,
    reply:
      "Para gaming, ve a la seccion Gaming. Si es para regalo, dime edad aproximada, consola/juego favorito y presupuesto, y te digo que tipo de producto buscar primero.",
  },
  {
    pattern: /disney|marvel|star wars|pixar|stitch|mickey|spiderman|deadpool|vengadores/i,
    reply:
      "Para Disney, Marvel, Star Wars y Pixar, entra en la seccion Disney. Si quieres un regalo, dime personaje o pelicula favorita y te ayudo a elegir una categoria.",
  },
  {
    pattern: /rick|morty|multiverso|harry potter|dc|batman|superman|se[ñn]or de los anillos|friki/i,
    reply:
      "La seccion Multiverso es para fandoms variados: Rick y Morty, superheroes, fantasia, cine, series y cultura friki. Dime el universo que buscas y te guio.",
  },
  {
    pattern: /regalo|cumple|cumplea[ñn]os|navidad|reyes|pareja|ni[ñn]o|ni[ñn]a|sobrino|amigo|amiga|presupuesto/i,
    reply:
      "Te ayudo con regalos. Dime tres cosas: fandom favorito, edad aproximada y presupuesto. Con eso te puedo orientar entre anime, gaming, Disney, multiverso, Caja Friki o productos sorpresa.",
  },
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
    pattern: /club|evento|drop|comunidad/i,
    reply:
      "El Club Friki sirve para recibir avisos de eventos, drops y descuentos de la comunidad. Si quieres, tambien puedo explicarte la diferencia entre Club, Caja Friki y descuentos Arcade.",
  },
  {
    pattern: /descuento|codigo|c[oó]digo|arcade|llave|cup[oó]n|promo/i,
    reply:
      "Los descuentos Arcade se conseguiran con juegos, llaves y promociones de la tienda. Cuando el backend de descuentos este activo, el codigo se creara de forma segura y se podra usar en Shopify.",
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
  {
    pattern: /imagen|foto|buscar por imagen|reconocer|localizador|localisador|personaje/i,
    reply:
      "El buscador visual servira para subir una imagen y encontrar el anime, personaje o productos relacionados. Mientras activamos la version inteligente, dime que aparece en la imagen y busco por fandom, personaje o categoria.",
  },
  {
    pattern: /admin|panel|administrador|gestionar|estad/i,
    reply:
      "El panel administrador es una zona privada para gestionar datos, conversaciones, comerciales, tiendas y descuentos. No debe usarse como panel publico; lo iremos conectando al backend real.",
  },
  {
    pattern: /rese[ñn]a|opini[oó]n|valoraci[oó]n/i,
    reply:
      "Las resenas serviran para valorar productos y experiencia. La version final guardara las resenas en backend con moderacion para que no dependan solo del navegador.",
  },
  {
    pattern: /privacidad|legal|datos|cookies|rgpd/i,
    reply:
      "La privacidad y textos legales deben quedar completos antes de publicar: datos de empresa, cookies, uso de imagenes, contacto, pedidos y comunicaciones.",
  },
];

function fallbackReply(message) {
  const match = FALLBACK_REPLIES.find((item) => item.pattern.test(message));
  if (match) return match.reply;

  return "Puedo ayudarte gratis con orientacion sobre anime, gaming, Disney, multiverso, regalos, pedidos, Club Friki, Caja Friki, descuentos, comerciales, tiendas o contacto. Dime que buscas o para quien es.";
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

function classifyOpenAIError(error) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("model") && message.includes("not")) return "model_not_found";
  if (message.includes("does not exist")) return "model_not_found";
  if (message.includes("invalid_api_key") || message.includes("incorrect api key")) return "invalid_api_key";
  if (message.includes("insufficient_quota") || message.includes("billing")) return "insufficient_quota";
  if (message.includes("permission") || message.includes("not have access")) return "model_no_access";
  return "api_error";
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
    const errorCode = classifyOpenAIError(error);
    const reply = fallbackReply(text);

    if (thread) {
      await db.chatMessage.create({
        data: {
          threadId: thread.id,
          author: "assistant_free",
          body: errorCode === "insufficient_quota" ? reply : `${reply} (${errorCode}: ${error.message})`,
        },
      });
    }

    return {
      reply,
      mode: "free_rules",
      errorCode,
      threadId: thread?.id,
    };
  }
}
