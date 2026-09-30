import db from "../db.server";
import { fallbackAssistantReply, assistantKnowledgeStats } from "./assistant-knowledge.server";

const KNOWLEDGE_STATS = assistantKnowledgeStats();

function fallbackReply(message) {
  return fallbackAssistantReply(message);
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
          "Eres el Asistente Friki de La Fabrica Friki. Habla en espanol de Espana y de forma natural, cercana y breve, como una persona de tienda: normalmente 1 o 2 frases, salvo que el cliente pida detalle. Si el cliente solo saluda, responde con un saludo corto y pregunta en que puedes ayudar; no le sueltes una lista larga de funciones. Si pregunta por una saga, anime, juego, pelicula o personaje, confirma de forma breve que vas a ayudarle a localizar su familia; la interfaz de la tienda se encargara de abrirla cuando exista. No inventes stock, pedidos, precios, politicas ni plazos. Si una accion requiere datos privados o revisar un pedido concreto, deriva a soporte/WhatsApp sin pedir claves, contrasenas ni datos de tarjeta.",
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
    const fallback = fallbackReply(text);
    const reply = aiReply || fallback.reply;

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
      intent: aiReply ? "ai" : fallback.intent,
      knowledgeStats: aiReply ? undefined : KNOWLEDGE_STATS,
      threadId: thread?.id,
    };
  } catch (error) {
    const errorCode = classifyOpenAIError(error);
    const fallback = fallbackReply(text);
    const reply = fallback.reply;

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
      intent: fallback.intent,
      knowledgeStats: KNOWLEDGE_STATS,
      errorCode,
      threadId: thread?.id,
    };
  }
}
