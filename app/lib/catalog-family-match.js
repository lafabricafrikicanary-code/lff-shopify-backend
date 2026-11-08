// LFF V191 — Single source of truth for storefront family membership.
// A generic product tag is NEVER evidence of belonging to a family.
export function normalizedFamily(value) {
  return String(value || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[×＆&]/g, " x ")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

// Deliberately restricted synonyms for *family names*, not characters or
// decorative tags. The same identity is used by both public catalog routes.
const FAMILY_NAMES = [
  ["naruto", "naruto naruto shippuden", "naruto shippuden"],
  ["dragon ball", "dragon ball z", "dragon ball super", "dragon ball gt"],
  ["attack on titan shingeki no kyojin", "attack on titan", "shingeki no kyojin"],
  ["demon slayer kimetsu no yaiba", "demon slayer", "kimetsu no yaiba"],
  ["my hero academia", "boku no hero academia"],
  ["los diarios de la boticaria", "the apothecary diaries", "the apothecary diaries los diarios de la boticaria", "apothecary diaries"],
  ["spy x family", "spy family"],
  ["hunter x hunter", "hunter hunter"],
  ["haikyuu", "haikyu"],
  ["jojo s bizarre adventure", "jojo bizarre adventure", "jojo"],
  ["saint seiya los caballeros del zodiaco", "saint seiya", "los caballeros del zodiaco"],
  ["record of ragnarok shuumatsu no valkyrie", "record of ragnarok", "shuumatsu no valkyrie"],
  // Imported product labels may combine Spanish, English and subtitles.
  // These are exact synonyms: never interpret generic decorative tags as families.
  ["frieren beyond journey s end", "frieren beyond journey s end sousou no frieren"],
  ["mickey x friends", "mickey mouse y sus amigos disney clasicos", "mickey mouse and friends"],
  ["tarzan", "tarzan disney tarzan"],
  ["monsters inc", "monsters", "monstruos s a", "monstruos sa"],
  ["ghostbusters", "cazafantasmas"],
  ["dc universe", "dc comics"],
  ["warhammer 40 000", "warhammer 40", "warhammer 40k", "warhammer 40000"],
  ["karate kid cobra kai", "karate kid", "cobra kai"],
  ["game of thrones house of the dragon", "game of thrones", "house of the dragon"],
  ["harry potter wizarding world", "harry potter", "wizarding world"],
  ["godzilla x kong monsterverse", "monsterverse", "godzilla x kong"],
  ["lilo x stitch", "lilo and stitch", "lilo stitch"],
  ["pirates of the caribbean", "piratas del caribe"],
  ["beauty and the beast", "beauty beast", "la bella y la bestia", "la bella y la bestia beauty and the beast"],
  ["little mermaid", "the little mermaid", "la sirenita"],
  ["the lion king", "lion king", "el rey leon", "el rey leon the lion king"],
  ["sleeping beauty", "la bella durmiente"],
  ["cinderella", "la cenicienta"],
  ["the incredibles", "los increibles"],
  ["101 dalmatians", "101 dalmatas"],
  ["frozen", "frozen el reino del hielo"],
  ["star wars", "la guerra de las galaxias"]
];
const KNOWN_FAMILY = new Map();
for (const [canonical, ...names] of FAMILY_NAMES) {
  for (const name of [canonical, ...names]) {
    KNOWN_FAMILY.set(normalizedFamily(name), normalizedFamily(canonical));
  }
}
export function catalogFamilyIdentity(value) {
  const name = normalizedFamily(value);
  return KNOWN_FAMILY.get(name) || name;
}
export function declaredProductFamily(product) {
  const tags = Array.isArray(product?.tags) ? product.tags : [];
  const explicit = tags.find(tag => /^LFF_FAMILY:/i.test(String(tag || "")));
  return (explicit ? String(explicit).replace(/^LFF_FAMILY:/i, "").trim() : "") ||
    String(product?.family || "").trim();
}
export function matchesProductFamily(product, familyName) {
  const assigned = declaredProductFamily(product);
  if (!assigned || !familyName) return false;
  return catalogFamilyIdentity(assigned) === catalogFamilyIdentity(familyName);
}

/**
 * Public storefront product kind, derived from explicit type metadata first.
 * Avoid false positive titles like "Una Taza de Magia Eterna" (a shirt).
 */
export function catalogProductKind(product) {
  const tags=Array.isArray(product?.tags)?product.tags:[];
  const declared=tags.find(t=>/^LFF_PRODUCT_TYPE:/i.test(String(t||'')));
  const hint=normalizedFamily(declared?String(declared).replace(/^LFF_PRODUCT_TYPE:/i,''):'');
  const title=normalizedFamily(product?.title);
  const productType=normalizedFamily(product?.productType||product?.type);
  const classify=value=>{
    if(/\b(poster|posters|lamina|laminas|cuadro|cuadros)\b/.test(value))return 'poster';
    if(/\b(taza|tazas|mug|mugs)\b/.test(value))return 'taza';
    if(/\b(textil|ropa|camiseta|camisetas|camisa|camisas|sudadera|sudaderas|hoodie|crop top|apparel)\b/.test(value))return 'textil';
    return '';
  };
  if(hint)return classify(hint)||hint.replace(/\s+/g,'-').slice(0,65);
  if(tags.some(t=>String(t).toUpperCase()==='LFF_LIGHT_OPTIONS_V1'))return 'textil';
  const fromType=classify(productType);
  if(fromType)return fromType;
  // Titles only indicate the type when they START with the product type.
  if(/^(poster|posters|lamina|laminas|cuadro|cuadros|taza|tazas|mug|mugs)\b/.test(title))
    return classify(title);
  if(/merchandising lff/.test(productType))return 'textil';
  if(classify(title))return classify(title);
  return productType?productType.replace(/\s+/g,'-').slice(0,65):'otros';
}
