const normalize = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[¿?¡!.,;:()\[\]{}"']/g, " ")
  .replace(/\s+/g, " ")
  .trim();

function hashText(value) {
  let hash = 2166136261;
  for (const ch of String(value || "")) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function pick(list, seed) {
  if (!Array.isArray(list) || !list.length) return "";
  return list[hashText(seed) % list.length];
}

const INTENTS = [
  {
    id: "greeting",
    words: ["hola", "buenas", "buenos dias", "buenas tardes", "buenas noches", "hey", "holi", "ey", "saludos"],
    examples: ["hola", "buenas", "hola buenas", "hey", "buenas tardes", "que tal"],
    replies: [
      "¡Hola! 👋 ¿En qué puedo ayudarte?",
      "¡Buenas! 😊 ¿Qué estás buscando?",
      "¡Hola! Cuéntame, ¿qué necesitas?",
      "¡Buenas! Estoy por aquí. ¿Qué quieres encontrar?",
      "¡Hola! 👋 Dime qué buscas y te echo una mano.",
    ],
  },
  {
    id: "thanks",
    words: ["gracias", "muchas gracias", "perfecto gracias", "genial gracias", "te lo agradezco"],
    examples: ["gracias", "muchas gracias", "perfecto gracias", "genial", "me has ayudado"],
    replies: [
      "¡De nada! 😊",
      "¡Para eso estoy!",
      "¡Genial! Si necesitas otra cosa, dime.",
      "¡A ti! 👌",
      "Cuando quieras 😊",
    ],
  },
  {
    id: "goodbye",
    words: ["adios", "hasta luego", "nos vemos", "chao", "ciao", "hasta pronto"],
    examples: ["adios", "hasta luego", "nos vemos", "chao", "hasta pronto"],
    replies: [
      "¡Hasta luego! 👋",
      "¡Nos vemos! Que tengas buen día.",
      "¡Hasta pronto!",
      "¡Chao! 👋",
    ],
  },
  {
    id: "help",
    words: ["ayuda", "me ayudas", "puedes ayudarme", "no se que buscar", "que puedes hacer"],
    examples: ["me ayudas", "que puedes hacer", "necesito ayuda", "no se que buscar", "puedes orientarme"],
    replies: [
      "Claro. Puedo ayudarte a encontrar una saga o personaje, resolver dudas de tallas, pedidos, envíos, Club, Arcade o la zona profesional.",
      "Sí. Dime qué buscas: una saga, personaje, producto, talla, pedido o cualquier duda de la tienda.",
      "Claro 😊 Dime qué necesitas y vamos directo a ello.",
    ],
  },
  {
    id: "products",
    words: ["producto", "productos", "camiseta", "camisa", "sudadera", "top", "ropa", "merch", "merchandising"],
    examples: ["que productos teneis", "busco una camiseta", "teneis sudaderas", "quiero ver ropa", "que merchandising hay"],
    replies: [
      "Dime la saga o personaje y te llevo a su familia para que veas los productos disponibles.",
      "¿De qué saga o personaje lo buscas? Si me dices el nombre, intento llevarte directamente a su familia.",
      "Sí. Puedes buscar por categoría y familia; si me dices el personaje o universo, te lo localizo.",
    ],
  },
  {
    id: "sizes",
    words: ["talla", "tallas", "medida", "medidas", "guia de tallas", "que talla"],
    examples: ["que tallas hay", "como se mi talla", "tenéis guia de tallas", "qué talla necesito", "hay talla xl"],
    replies: [
      "Las tallas dependen del modelo. En la ficha elige primero Modelo, después Color y luego Talla; solo aparecen combinaciones válidas.",
      "Depende de la prenda. Abre el diseño, selecciona el modelo y verás las tallas disponibles para ese modelo y color.",
      "Cada modelo tiene sus propias tallas. La ficha del producto te enseña únicamente las opciones disponibles.",
    ],
  },
  {
    id: "models",
    words: ["modelo", "camisa hombre", "camisa mujer", "camisa infantil", "sudadera", "deportiva mujer", "crop top", "top mujer"],
    examples: ["qué modelos hay", "hay camisa de mujer", "teneis infantil", "hay sudaderas", "qué prendas tenéis"],
    replies: [
      "Un mismo diseño puede estar en Camisa hombre, Camisa mujer, Camisa infantil, Sudadera, Deportiva mujer y Top, según disponibilidad.",
      "Los modelos LFF incluyen camisas de hombre, mujer e infantil, sudadera, Deportiva mujer y Top. Después eliges color y talla.",
      "Elige primero el diseño y dentro verás los modelos disponibles con sus colores y tallas.",
    ],
  },
  {
    id: "prices",
    words: ["precio", "precios", "cuanto cuesta", "cuanto vale", "coste", "barato", "caro"],
    examples: ["cuanto cuesta", "qué precio tiene", "cuánto vale una camiseta", "precios", "cuánto sale"],
    replies: [
      "El precio válido es siempre el que ves en la ficha del producto y en el checkout. Si me dices qué modelo buscas, te oriento.",
      "Depende del modelo. Abre el producto y verás el precio actualizado antes de añadirlo al inventario.",
      "Los precios pueden variar por modelo; la ficha y el checkout muestran siempre el importe vigente.",
    ],
  },
  {
    id: "stock",
    words: ["stock", "disponible", "disponibilidad", "agotado", "queda", "hay existencias", "sin stock"],
    examples: ["hay stock", "está disponible", "se ha agotado", "queda talla m", "hay existencias"],
    replies: [
      "La disponibilidad real es la que aparece en la ficha al elegir Modelo → Color → Talla. Si una combinación no está disponible, no debería poder seleccionarse.",
      "Comprueba la combinación exacta de modelo, color y talla en la ficha; ahí se muestra la disponibilidad real.",
      "El stock depende de la variante concreta. Selecciona modelo, color y talla para comprobarla.",
    ],
  },
  {
    id: "shipping",
    words: ["envio", "envios", "entrega", "portes", "cuanto tarda", "tardar", "gastos de envio"],
    examples: ["cuanto tarda el envio", "cuánto cuesta enviar", "hacéis envíos", "cuando llega", "portes"],
    replies: [
      "El coste y el plazo final dependen del destino y se muestran en el checkout antes de pagar.",
      "Introduce tu dirección en el checkout y verás las opciones de envío disponibles, con su coste y plazo.",
      "Los envíos dependen del destino. El checkout te muestra la información definitiva antes de confirmar la compra.",
    ],
  },
  {
    id: "returns",
    words: ["devolucion", "devoluciones", "devolver", "cambio", "reembolso", "desistimiento"],
    examples: ["puedo devolverlo", "cómo hago una devolución", "quiero cambiar una talla", "hay reembolso", "política de devoluciones"],
    replies: [
      "Puedes consultar las condiciones completas en Nosotros & contacto → Política de devoluciones. Si ya tienes un pedido, soporte puede revisar tu caso.",
      "La política de devoluciones está en Nosotros & contacto. Para un pedido concreto, ten a mano el número de pedido.",
      "Sí, revisa primero la Política de devoluciones. Algunos artículos personalizados pueden tener condiciones especiales.",
    ],
  },
  {
    id: "payment",
    words: ["pago", "pagar", "tarjeta", "paypal", "checkout", "metodo de pago", "forma de pago"],
    examples: ["como puedo pagar", "aceptáis tarjeta", "qué métodos de pago hay", "paypal", "pago seguro"],
    replies: [
      "Los métodos disponibles aparecen de forma segura en el checkout de Shopify. No escribas datos de tarjeta en este chat.",
      "El pago se realiza en el checkout seguro de Shopify, donde verás los métodos disponibles para tu compra.",
      "Cuando llegues al checkout podrás ver y elegir los métodos de pago habilitados.",
    ],
  },
  {
    id: "orders",
    words: ["pedido", "seguimiento", "tracking", "donde esta mi pedido", "estado del pedido", "numero de pedido"],
    examples: ["donde está mi pedido", "quiero hacer seguimiento", "estado de mi pedido", "tracking", "mi pedido no llega"],
    replies: [
      "Para consultar un pedido abre “Seguir pedido” en el menú. Si necesitas soporte, ten a mano el número de pedido.",
      "Puedes revisar el estado desde “Seguir pedido”. Si algo no cuadra, soporte puede ayudarte con el número de pedido.",
      "Abre “Seguir pedido” para verlo. Si necesitas que lo revise una persona, contacta con soporte.",
    ],
  },
  {
    id: "favorites",
    words: ["favorito", "favoritos", "wishlist", "lista de deseos", "guardar producto", "corazon"],
    examples: ["cómo guardo favoritos", "dónde están mis favoritos", "lista de deseos", "quiero guardar esto", "corazón"],
    replies: [
      "Pulsa el corazón del producto para guardarlo en Favoritos y encontrarlo después.",
      "Los artículos que marques con el corazón quedan en tu zona de Favoritos.",
      "Usa el corazón para guardar productos y volver a ellos más tarde.",
    ],
  },
  {
    id: "arcade",
    words: ["arcade", "juego", "juegos", "llave", "llaves", "descuento arcade", "cupon arcade"],
    examples: ["cómo funciona arcade", "qué son las llaves", "puedo conseguir descuento jugando", "cuántos juegos hay", "cómo canjeo"],
    replies: [
      "En Arcade hay 6 juegos. Cada juego completado puede darte una llave del 5%, hasta un máximo acumulado del 30%.",
      "Cada uno de los 6 juegos puede darte una llave del 5%. Puedes acumularlas y canjear hasta el 30%.",
      "Juega, consigue llaves y canjéalas cuando quieras. El máximo del ciclo es 6 llaves = 30%.",
    ],
  },
  {
    id: "club",
    words: ["club", "club friki", "evento", "eventos", "drop", "drops", "comunidad"],
    examples: ["qué es el club", "cómo me uno", "club friki", "recibir eventos", "qué ventajas tiene"],
    replies: [
      "El Club Friki es gratuito y sirve para recibir avisos de eventos, drops y novedades de la comunidad.",
      "Puedes crear tu perfil en el Club para recibir avisos y novedades. Es independiente de la Caja Friki.",
      "El Club es la parte gratuita de comunidad y avisos. La Caja Friki es un servicio distinto.",
    ],
  },
  {
    id: "box",
    words: ["caja friki", "caja sorpresa", "misterio", "suscripcion", "suscripción", "caja mensual"],
    examples: ["qué es la caja friki", "cuánto cuesta la caja", "caja sorpresa", "suscripción mensual", "cómo me apunto a la caja"],
    replies: [
      "La Caja Friki es la zona de suscripción mensual de la tienda. Consulta su panel para ver el estado y las condiciones disponibles.",
      "La Caja Friki es distinta del Club gratuito. Desde tu cuenta puedes consultar su estado y las opciones activas.",
      "Si quieres información de la Caja Friki, entra en tu cuenta y abre su apartado; ahí se muestra la información vigente.",
    ],
  },
  {
    id: "b2b",
    words: ["tienda", "empresa", "mayorista", "profesional", "b2b", "pedido profesional", "pedido rapido"],
    examples: ["tengo una tienda", "quiero comprar al por mayor", "zona profesional", "pedido rápido", "cuenta de empresa"],
    replies: [
      "Si tienes una tienda o empresa, entra en “Tiendas”. Allí puedes solicitar cuenta profesional, hacer pedidos rápidos y hablar con Administración.",
      "La zona Tiendas es para cuentas profesionales: acceso, pedidos en bloque, pedidos rápidos y soporte.",
      "Para compras profesionales abre “Tiendas” en el menú y entra con tu cuenta B2B.",
    ],
  },
  {
    id: "commercial",
    words: ["comercial", "comerciales", "afiliado", "afiliados", "comision", "comisiones", "captar clientes"],
    examples: ["quiero ser comercial", "cómo funcionan las comisiones", "zona comerciales", "soy afiliado", "quiero captar clientes"],
    replies: [
      "La zona Comerciales permite gestionar tu cuenta, códigos, actividad y comisiones. Si eres YouTuber también accedes desde esa área.",
      "En “Comerciales” están las cuentas de comerciales y creadores, con sus códigos y actividad.",
      "Si quieres trabajar como comercial o creador, entra en la zona Comerciales para consultar el acceso disponible.",
    ],
  },
  {
    id: "creator",
    words: ["youtuber", "youtube", "creador", "creadores", "influencer", "codigo creador", "marca creador"],
    examples: ["soy youtuber", "quiero colaborar", "código de creador", "productos de un youtuber", "programa de creadores"],
    replies: [
      "Los YouTubers y creadores tienen su cuenta dentro de Comerciales, con código propio, productos vinculados y seguimiento de ventas.",
      "El programa de creadores se gestiona desde Comerciales. Cada creador puede tener su código y sus familias de productos vinculadas.",
      "Si eres creador, entra en Comerciales. Ahí se gestiona tu cuenta, código y actividad asociada.",
    ],
  },
  {
    id: "reviews",
    words: ["reseña", "reseñas", "opinion", "opiniones", "valoracion", "valoraciones"],
    examples: ["quiero dejar una reseña", "dónde veo opiniones", "valoraciones", "reseñas de productos", "puedo subir foto a reseña"],
    replies: [
      "Las reseñas aparecen en la ficha del producto. Puedes consultar las publicadas y usar el formulario disponible para dejar la tuya.",
      "Abre la ficha del producto y baja hasta Reseñas para verlas o dejar una valoración.",
      "Las opiniones se gestionan desde la propia página del producto.",
    ],
  },
  {
    id: "privacy",
    words: ["privacidad", "cookies", "datos", "rgpd", "legal", "politica de privacidad"],
    examples: ["política de privacidad", "qué hacéis con mis datos", "cookies", "rgpd", "información legal"],
    replies: [
      "La información de privacidad, cookies y textos legales está dentro de Nosotros & contacto.",
      "Puedes consultar privacidad y cookies desde Nosotros & contacto.",
      "La información legal y de privacidad está disponible en la sección Nosotros & contacto.",
    ],
  },
  {
    id: "visual_search",
    words: ["buscar por imagen", "buscador visual", "subir foto", "reconocer imagen", "reconocer personaje", "foto personaje"],
    examples: ["puedo buscar con una foto", "buscador por imagen", "reconoces este personaje", "subir una imagen", "buscar personaje por foto"],
    replies: [
      "El buscador visual sigue en mantenimiento. Mientras tanto, si sabes el nombre del personaje o saga, escríbemelo y te llevo a su familia.",
      "La búsqueda automática por imagen todavía no está activa. Dime el personaje o universo y lo busco por nombre.",
      "Ahora mismo el reconocimiento visual está en mantenimiento, pero puedo localizar una saga o personaje por texto.",
    ],
  },
  {
    id: "contact",
    words: ["contacto", "contactar", "whatsapp", "telefono", "teléfono", "hablar con alguien", "persona", "humano", "soporte"],
    examples: ["quiero hablar con alguien", "whatsapp", "teléfono", "contacto", "necesito soporte"],
    replies: [
      "Puedes usar el enlace de WhatsApp que aparece debajo del chat o entrar en Nosotros & contacto.",
      "Si necesitas una persona, tienes WhatsApp justo debajo del chat y también la sección Nosotros & contacto.",
      "Claro. Para soporte humano usa WhatsApp o Nosotros & contacto.",
    ],
  },
  {
    id: "discounts",
    words: ["descuento", "descuentos", "codigo promocional", "código promocional", "promo", "promocion", "cupón", "cupon"],
    examples: ["hay descuentos", "tengo un código", "cómo uso un cupón", "promoción", "código promocional"],
    replies: [
      "Si tienes un código promocional, introdúcelo en el checkout. Los descuentos Arcade se canjean desde la propia zona Arcade.",
      "Los códigos válidos se aplican en el checkout. Si viene de Arcade, primero tienes que canjear tus llaves.",
      "Puedes aplicar tu código en el checkout antes de pagar.",
    ],
  },
  {
    id: "gift",
    words: ["regalo", "regalar", "cumpleaños", "cumple", "navidad", "reyes", "pareja", "amigo", "amiga"],
    examples: ["busco un regalo", "qué puedo regalar", "regalo de cumpleaños", "regalo para mi pareja", "idea de regalo"],
    replies: [
      "Dime qué saga o personaje le gusta y te llevo a esa familia. Si no lo sabes, dime si prefiere anime, gaming, Disney o películas/series.",
      "Claro. ¿Qué fandom o personaje le gusta? Con eso podemos ir directos a una familia.",
      "Para acertar con el regalo, dime su saga o personaje favorito y te enseño dónde mirar.",
    ],
  },
  {
    id: "categories",
    words: ["categoria", "categorias", "anime y manga", "gaming", "disney", "multiusos"],
    examples: ["qué categorías hay", "dónde está anime", "quiero ver gaming", "zona disney", "multiusos"],
    replies: [
      "Las zonas principales son Anime & Manga, Gaming, Disney y Multiusos. Si me dices una saga o personaje, te llevo directamente a su familia.",
      "Puedes entrar en Anime & Manga, Gaming, Disney o Multiusos. Escríbeme el nombre de una saga y te la localizo.",
      "Hay cuatro grandes zonas de catálogo: Anime & Manga, Gaming, Disney y Multiusos.",
    ],
  },
  {
    id: "store_identity",
    words: ["que es la fabrica friki", "quienes sois", "qué vendéis", "que vendeis", "de que va esta tienda", "qué es esta tienda"],
    examples: ["qué es la fábrica friki", "quienes sois", "qué vendéis", "de qué va la tienda", "qué puedo encontrar aquí"],
    replies: [
      "La Fábrica Friki es una tienda centrada en anime, gaming, Disney y cultura friki. La idea es que encuentres cada diseño dentro de su universo.",
      "Somos La Fábrica Friki: anime, videojuegos, Disney, películas, series y más, organizado por categorías y familias.",
      "Aquí encontrarás diseños y productos frikis organizados por universos para que sea fácil llegar a tu saga favorita.",
    ],
  },
];

const PREFIXES = [
  "", "hola ", "buenas ", "oye ", "una duda ", "tengo una duda ", "me puedes decir ", "puedes decirme ",
  "queria saber ", "quisiera saber ", "necesito saber ", "sabes si ", "por favor ", "perdona ", "disculpa ",
  "me gustaria saber ", "me puedes ayudar con ", "quiero saber ", "podrias decirme ", "me interesa saber ",
];
const SUFFIXES = ["", "?", " por favor", " gracias", " en la tienda", " aqui", " ahora", " mas o menos"];

function buildPhraseIndex() {
  const map = new Map();
  outer: for (const intent of INTENTS) {
    const bases = [...new Set([...(intent.examples || []), ...(intent.words || [])])];
    for (const base of bases) {
      for (const prefix of PREFIXES) {
        for (const suffix of SUFFIXES) {
          const phrase = normalize(`${prefix}${base}${suffix}`);
          if (phrase && !map.has(phrase)) map.set(phrase, intent.id);
          if (map.size >= 6500) break outer;
        }
      }
    }
  }
  return map;
}

const PHRASE_INDEX = buildPhraseIndex();
const BY_ID = new Map(INTENTS.map((intent) => [intent.id, intent]));

function containsPhrase(message, phrase) {
  const p = normalize(phrase);
  if (!p) return false;
  if (p.length <= 3) return message === p || message.split(" ").includes(p);
  return message.includes(p);
}

function classify(message) {
  const text = normalize(message);
  if (!text) return null;
  const exact = PHRASE_INDEX.get(text);
  if (exact) return BY_ID.get(exact) || null;

  // Conversación corta primero para que "hola" no devuelva una respuesta kilométrica.
  if (/^(hola|holi|hey|ey|buenas|buenos dias|buenas tardes|buenas noches|que tal|hola buenas)$/.test(text)) return BY_ID.get("greeting");
  if (/^(gracias|muchas gracias|genial gracias|perfecto gracias|te lo agradezco)$/.test(text)) return BY_ID.get("thanks");
  if (/^(adios|hasta luego|nos vemos|chao|ciao|hasta pronto)$/.test(text)) return BY_ID.get("goodbye");

  let best = null;
  let bestScore = 0;
  for (const intent of INTENTS) {
    let score = 0;
    for (const word of intent.words || []) {
      if (containsPhrase(text, word)) score += Math.max(1, normalize(word).split(" ").length * 2);
    }
    if (score > bestScore) {
      best = intent;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

export function fallbackAssistantReply(message) {
  const intent = classify(message);
  if (intent) {
    return {
      reply: pick(intent.replies, `${intent.id}:${normalize(message)}`),
      intent: intent.id,
    };
  }
  return {
    reply: pick([
      "No quiero inventarte nada. Dime una saga, personaje o qué necesitas hacer y te ayudo desde ahí.",
      "No te he entendido del todo. ¿Buscas un producto, una saga, ayuda con un pedido o información de la tienda?",
      "Cuéntamelo de otra forma y lo intento de nuevo. Si buscas una saga o personaje, escribe solo su nombre.",
      "Puedo ayudarte, pero necesito un poco más de contexto. ¿Qué estás intentando encontrar o hacer?",
    ], message),
    intent: "general",
  };
}

export function assistantKnowledgeStats() {
  return {
    generatedQuestionVariants: PHRASE_INDEX.size,
    intents: INTENTS.length,
    responseVariants: INTENTS.reduce((sum, item) => sum + (item.replies?.length || 0), 0),
  };
}
