/* LFF V186 · 4 recommendations before checkout. No catalogue loading until checkout click.
   Works with home #lffCheckoutBtn and /cart submit; always allows skipping. */
(() => {
  "use strict";
  if (window.__lffCrossSellV186) return;
  window.__lffCrossSellV186 = true;
  const GIFT_VARIANT = 64098152481098;
  const ROOT = ((window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || "/").replace(/\/?$/, "/");
  const SEEN_KEY = "lff_offer_seen_v187";
  const RECENT_KEY = "lff_recent_handles_v186";
  const MAX_RECENT = 18;
  const productCache = new Map();
  let opening = false, overlay = null, originalVariants = [], selected = new Set(), submitting = false;
  const euros = cents => new Intl.NumberFormat("es-ES", {style:"currency", currency:"EUR"}).format(Number(cents || 0) / 100);
  const norm = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const route = p => ROOT + p.replace(/^\/+/, "");
  function getSession(k, fallback) { try { return JSON.parse(sessionStorage.getItem(k)) || fallback; } catch { return fallback; } }
  function setSession(k, data) { try { sessionStorage.setItem(k, JSON.stringify(data)); } catch {} }
  function handleFromUrl(v) {
    try { const m = new URL(v, location.origin).pathname.match(/\/products\/([^/?#]+)/); return m ? decodeURIComponent(m[1]).slice(0,120) : ""; }
    catch { return ""; }
  }
  function rememberHandle(handle) {
    if (!/^[a-z0-9][a-z0-9-]{1,119}$/i.test(handle)) return;
    const all = getSession(RECENT_KEY, []).filter(x => x && x.handle !== handle && Date.now() - Number(x.time || 0) < 30 * 864e5);
    all.unshift({handle, time:Date.now()});
    setSession(RECENT_KEY, all.slice(0, MAX_RECENT));
  }
  const pageHandle = handleFromUrl(location.href);
  if (pageHandle) rememberHandle(pageHandle);
  document.addEventListener("click", event => {
    const a = event.target.closest("a[href*='/products/']");
    if (a) {
      const h = handleFromUrl(a.href);
      if (h) rememberHandle(h);
    }
  }, true);
  async function jsonFetch(path, opts, timeout = 5000) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(path, {...opts, signal:controller.signal, credentials:"same-origin", headers:{"Accept":"application/json", ...(opts && opts.headers || {})}});
      if (!response.ok) throw new Error("HTTP " + response.status);
      return await response.json();
    } finally { clearTimeout(timer); }
  }
  async function getProduct(handle) {
    if (!handle || !/^[a-z0-9][a-z0-9-]{1,119}$/i.test(handle)) return null;
    if (!productCache.has(handle)) {
      productCache.set(handle, jsonFetch(route("products/" + encodeURIComponent(handle) + ".js"), {}, 2600).catch(() => null));
    }
    return productCache.get(handle);
  }
  function tagsOf(product) {
    if (Array.isArray(product.tags)) return product.tags.map(String);
    if (typeof product.tags === "string") return product.tags.split(",").map(x => x.trim());
    return [];
  }
  function familyOf(product) {
    const t = tagsOf(product).find(x => /^LFF_FAMILY:/i.test(x));
    return t ? t.replace(/^LFF_FAMILY:/i, "").trim().slice(0,100) : "";
  }
  function categoryOf(product) {
    const tag = tagsOf(product).find(x => /^LFF_CATEGORY:/i.test(x));
    const v = norm(tag ? tag.split(":").slice(1).join(":") : tagsOf(product).join(" ") + " " + (product.product_type || ""));
    if (/anime|manga/.test(v)) return "anime";
    if (/gaming|videojuego|zona.de.juegos/.test(v)) return "gaming";
    if (/disney|marvel|star.wars/.test(v)) return "disney";
    if (/multiusos|multiverso|multiverse/.test(v)) return "multiverse";
    return "";
  }
  function kindOf(product) {
    const v = norm((product.product_type || product.productType || "") + " " + tagsOf(product).find(t => /^LFF_PRODUCT_TYPE:/i.test(t)) + " " + (product.title || ""));
    if (/poster|lamina|cuadro/.test(v)) return "poster";
    if (/taza|mug/.test(v)) return "taza";
    if (/textil|ropa|camiseta|camisa|sudadera|merchandising lff/.test(v)) return "textil";
    return "otros";
  }
  function eligibleProduct(p) {
    if (!p || p.available === false) return false;
    const meta = norm([p.title, p.product_type, ...tagsOf(p)].join(" "));
    if (/preparacion para regalo|lff.regalo|hentai|k.pop|kpop|\blibros\b|lff.hidden|lff.oculto/.test(meta)) return false;
    return Array.isArray(p.variants) && p.variants.some(v => v.available && Number(v.price) > 0);
  }
  function variantChoices(p) {
    return (p.variants || []).filter(v => v.available && Number(v.price) > 0).slice(0, 200);
  }
  function imageFor(p) {
    const img = p.featured_image || p.image || (p.images && p.images[0]) || "";
    if (typeof img === "string") return img;
    return img && (img.src || img.url) || "";
  }
  // 1 SQL lookup, then at most two parallel rounds of Shopify product JSON.
  async function candidatesFor(cart){
    const physical=(cart.items||[]).filter(x=>Number(x.variant_id)!==GIFT_VARIANT);
    const used=new Set(physical.map(x=>String(x.handle||"")));
    const originals=new Set((cart.items||[]).map(x=>Number(x.variant_id)));
    const handles=[...used].filter(Boolean).slice(0,10);
    const ordered=[];
    function add(handle){
      if(typeof handle!=="string"||!/^[a-z0-9][a-z0-9-]{1,119}$/i.test(handle)||used.has(handle)||ordered.includes(handle))return;
      ordered.push(handle);
    }
    try{
      const url=route("apps/lff/offer-recommendations")+"?handles="+encodeURIComponent(handles.join(","));
      const result=await jsonFetch(url,{},3200);
      if(result?.ok&&Array.isArray(result.handles))result.handles.slice(0,24).forEach(add);
    }catch(error){console.warn("[LFF V187 offers]",error?.message||error);}
    getSession(RECENT_KEY,[]).slice(0,8).forEach(item=>add(item.handle));
    if(ordered.length<4&&physical[0]?.product_id){
      try{
        const result=await jsonFetch(route("recommendations/products.json")+"?product_id="+encodeURIComponent(String(physical[0].product_id))+"&limit=10&intent=related",{},2200);
        (result.products||[]).forEach(item=>add(item.handle));
      }catch{}
    }
    const chosen=[];
    for(let i=0;i<Math.min(ordered.length,20)&&chosen.length<4;i+=8){
      const products=await Promise.all(ordered.slice(i,i+8).map(getProduct));
      for(const p of products){
        if(chosen.length>=4)break;
        if(!eligibleProduct(p))continue;
        const choices=variantChoices(p).filter(v=>!originals.has(Number(v.id)));
        if(choices.length)chosen.push({product:p,choices,score:100-i});
      }
    }
    return chosen.slice(0,4);
  }
  let warmCandidates=null;
  function cartSignature(cart){return (cart.items||[]).filter(x=>Number(x.variant_id)!==GIFT_VARIANT).map(x=>String(x.variant_id)).sort().join(",");}
  function recommendations(cart){
    const key=cartSignature(cart);
    if(warmCandidates&&warmCandidates.key===key&&Date.now()-warmCandidates.created<60000)return warmCandidates.promise;
    const promise=candidatesFor(cart);
    warmCandidates={key,created:Date.now(),promise};
    return promise;
  }
  function closeOverlay() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    document.body.classList.remove("lffOfferLock");
  }
  function normalCheckout() { submitting = true; closeOverlay(); location.assign(route("checkout")); }
  function createOverlay() {
    overlay = document.createElement("div");
    overlay.className = "lffOfferOverlay";
    overlay.innerHTML = '<section class="lffOfferDialog" role="dialog" aria-modal="true" aria-labelledby="lffOfferTitle">' +
      '<button class="lffOfferClose" type="button" aria-label="Cerrar y continuar al pago">×</button>' +
      '<div class="lffOfferKicker">LA FÁBRICA FRIKI · EXTRA DE INVENTARIO</div>' +
      '<h2 class="lffOfferTitle" id="lffOfferTitle">Antes de cruzar el <span>portal...</span></h2>' +
      '<p class="lffOfferLead">Descubre cuatro artículos que podrían encajar con tu universo. Añádelos ahora y consigue un 15 % exclusivamente en esos extras.</p>' +
      '<div class="lffOfferGrid" aria-live="polite"></div>' +
      '<div class="lffOfferActions"><div class="lffOfferCount">0 artículos extra seleccionados</div>' +
      '<button class="lffOfferContinue" type="button">No, gracias · Continuar al pago</button>' +
      '<button class="lffOfferSkip" type="button" hidden>Continuar sin descuento</button></div>' +
      '<div class="lffOfferStatus" aria-live="polite">Buscando artículos compatibles…</div>' +
      '<div class="lffOfferHint">Promoción válida únicamente para productos añadidos desde esta ventana. Los códigos existentes pueden no combinarse. Revisa siempre los descuentos en el pago seguro de Shopify.</div></section>';
    document.body.appendChild(overlay);
    document.body.classList.add("lffOfferLock");
    const dialog = overlay.querySelector(".lffOfferDialog");
    const close = overlay.querySelector(".lffOfferClose");
    close.addEventListener("click", () => continueFromOffer());
    overlay.querySelector(".lffOfferContinue").addEventListener("click", () => continueFromOffer());
    overlay.querySelector(".lffOfferSkip").addEventListener("click", normalCheckout);
    overlay.addEventListener("keydown", e => {
      if (e.key === "Escape") { e.preventDefault(); continueFromOffer(); return; }
      if (e.key !== "Tab") return;
      const nodes = [...dialog.querySelectorAll('button:not(:disabled):not([hidden]),select:not(:disabled),a[href]')].filter(x => x.getClientRects().length);
      if (!nodes.length) return;
      if (e.shiftKey && document.activeElement === nodes[0]) { e.preventDefault(); nodes[nodes.length-1].focus(); }
      else if (!e.shiftKey && document.activeElement === nodes[nodes.length-1]) { e.preventDefault(); nodes[0].focus(); }
    });
    close.focus();
  }
  function status(message, isError = false) {
    if (!overlay) return;
    const s = overlay.querySelector(".lffOfferStatus");
    s.textContent = message;
    isError ? s.setAttribute("role", "alert") : s.removeAttribute("role");
  }
  function updateCount() {
    if (!overlay) return;
    const n = selected.size;
    overlay.querySelector(".lffOfferCount").textContent = n + (n === 1 ? " artículo extra seleccionado" : " artículos extra seleccionados");
    overlay.querySelector(".lffOfferContinue").textContent = n ? "Continuar y activar el 15 %" : "No, gracias · Continuar al pago";
  }
  function appendCard(entry) {
    const p = entry.product, choices = entry.choices;
    if (!overlay) return;
    const item = document.createElement("article");
    item.className = "lffOfferItem";
    const image = document.createElement("img");
    image.className = "lffOfferImage"; image.loading = "lazy"; image.decoding = "async"; image.alt = p.title || "Producto"; image.src = imageFor(p);
    const title = document.createElement("p");
    title.className = "lffOfferName"; title.textContent = p.title || "Producto";
    const prices = document.createElement("div");
    prices.className = "lffOfferPrice";
    const old = document.createElement("s"); old.className = "lffOfferOld";
    const current = document.createElement("b"); current.className = "lffOfferNew";
    prices.append(old, current);
    const picker = document.createElement("select");
    picker.className = "lffOfferVariant"; picker.setAttribute("aria-label", "Variante para " + (p.title || "producto"));
    choices.forEach((v, index) => {
      const o = document.createElement("option"); o.value = String(index);
      o.textContent = v.public_title || v.title || "Opción estándar";
      picker.appendChild(o);
    });
    if (choices.length <= 1) picker.hidden = true;
    const button = document.createElement("button");
    button.className = "lffOfferAdd"; button.type = "button"; button.textContent = "Añadir al inventario · -15 %";
    const updatePrice = () => {
      const v = choices[Number(picker.value) || 0] || choices[0], cents = Number(v?.price || 0);
      old.textContent = euros(cents); current.textContent = euros(Math.round(cents * 0.85));
      button.disabled = selected.has(Number(v?.id));
      button.textContent = button.disabled ? "AÑADIDO ✓" : "Añadir al inventario · -15 %";
    };
    picker.addEventListener("change", updatePrice);
    button.addEventListener("click", async () => {
      const v = choices[Number(picker.value) || 0] || choices[0];
      if (!v || selected.has(Number(v.id))) return;
      button.disabled = true; button.textContent = "Añadiendo…";
      try {
        await jsonFetch(route("cart/add.js"), {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({items:[{id:Number(v.id),quantity:1,properties:{"_lff_cross_sell":"v186"}}]})}, 6500);
        selected.add(Number(v.id));
        updatePrice(); updateCount(); status("Artículo añadido. El 15 % se aplicará en el checkout si Shopify confirma la promoción.");
      } catch {
        button.disabled = false; button.textContent = "Reintentar"; status("No se pudo añadir este artículo. Puedes probar otra variante o continuar.", true);
      }
    });
    item.append(image, title, prices, picker, button);
    overlay.querySelector(".lffOfferGrid").appendChild(item);
    updatePrice();
  }
  async function continueFromOffer() {
    if (submitting) return;
    if (!selected.size) { normalCheckout(); return; }
    const button = overlay?.querySelector(".lffOfferContinue");
    if (!button) return normalCheckout();
    button.disabled = true;
    status("Verificando los artículos y creando el 15 % real en Shopify…");
    try {
      const cart = await jsonFetch(route("cart.js"), {}, 4500);
      const added = [...selected].filter(id => (cart.items || []).some(line => Number(line.variant_id) === id && line.properties && line.properties._lff_cross_sell === "v186"));
      if (!added.length) throw new Error("Los productos recomendados ya no están en el carrito.");
      const offer = await jsonFetch(route("apps/lff/cross-sell"), {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({variantIds:added,originalVariantIds:originalVariants})
      }, 9500);
      if (!offer.ok || !/^LFF-EXTRA15-[A-F0-9]{18}$/.test(String(offer.code || ""))) throw new Error("Shopify no ha confirmado el descuento.");
      submitting = true;
      // Shopify's native shareable discount link carries the code to the real checkout.
      location.assign(route("discount/" + encodeURIComponent(offer.code)) + "?redirect=%2Fcheckout");
    } catch(err) {
      status((err && err.message ? err.message : "No ha sido posible activar el descuento.") + " Puedes reintentar o continuar sin el 15 %.", true);
      if (overlay) {
        overlay.querySelector(".lffOfferSkip").hidden = false;
        button.disabled = false; button.textContent = "Reintentar aplicar el 15 %";
      } else normalCheckout();
    }
  }
  async function begin() {
    if (opening || submitting) return;
    if (getSession(SEEN_KEY, false)) return normalCheckout();
    opening = true;
    try {
      const cart = await jsonFetch(route("cart.js"), {}, 4200);
      const physical = (cart.items || []).filter(x => Number(x.variant_id) !== GIFT_VARIANT);
      if (!physical.length) return normalCheckout();
      originalVariants = (cart.items || []).map(x => String(x.variant_id));
      selected = new Set();
      setSession(SEEN_KEY, true);
      createOverlay();
      const offers = await recommendations(cart);
      if (!overlay) return;
      if (!offers.length) { status("No se han podido cargar ofertas ahora. Puedes continuar directamente al pago."); return; }
      offers.forEach(appendCard);
      status("Tus artículos originales mantienen su precio. Solo los nuevos extras seleccionados reciben la oferta.");
    } catch { return normalCheckout(); }
    finally { opening = false; }
  }
  // Warm a small, bounded offer set after the cart page is ready.
  // Nothing extra is downloaded at homepage initial render.
  if(/^\/cart\/?$/.test(location.pathname)){
    const preload=()=>{ void jsonFetch(route("cart.js"),{},2200)
      .then(cart=>{if((cart.items||[]).some(x=>Number(x.variant_id)!==GIFT_VARIANT))return recommendations(cart);})
      .catch(()=>{}); };
    if(document.readyState==="complete")setTimeout(preload,700);
    else window.addEventListener("load",()=>setTimeout(preload,700),{once:true});
  }
  const matchingButton = e => e.target.closest("#lffCheckoutBtn, button[name='checkout']");
  document.addEventListener("click", e => {
    const button = matchingButton(e);
    if (!button || button.disabled || overlay) return;
    if (button.name === "checkout" && !button.closest("form[action*='/cart']")) return;
    e.preventDefault(); e.stopImmediatePropagation();
    void begin();
  }, true);
  document.addEventListener("submit", e => {
    if (submitting || e.submitter?.name !== "checkout") return;
    if (!e.target.matches("form[action*='/cart']")) return;
    e.preventDefault(); e.stopImmediatePropagation();
    void begin();
  }, true);
})();