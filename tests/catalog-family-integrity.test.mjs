import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesProductFamily, catalogFamilyIdentity, catalogProductKind } from '../app/lib/catalog-family-match.js';

const product = (family, extra = [], category = 'Disney') => ({
  family, category, tags: [...extra, 'LFF_CATEGORY:' + category, 'LFF_FAMILY:' + family]
});

test('generic Disney tag NEVER routes Bambi to Disney Villains', () => {
  const bambi = product('Bambi', ['disney', 'disney villains']);
  assert.equal(matchesProductFamily(bambi, 'Disney Villains'), false);
  assert.equal(matchesProductFamily(bambi, 'Bambi'), true);
});
test('aliases in decorative tags NEVER move items to unrelated families', () => {
  const lol = product('League of Legends', ['cyberpunk', 'Arcane', 'Jinx'], 'Gaming');
  assert.equal(matchesProductFamily(lol, 'Cyberpunk 2077'), false);
  const evangelion = product('Evangelion', ['Berserk', 'EVA-01'], 'Anime & Manga');
  assert.equal(matchesProductFamily(evangelion, 'Berserk'), false);
  const stranger = product('Stranger Things', ['Dungeons & Dragons'], 'Multiusos');
  assert.equal(matchesProductFamily(stranger, 'Dungeons & Dragons'), false);
});
test('keep genuine family synonyms and imported spellings', () => {
  for (const [actual, displayed] of [
    ['Cazafantasmas', 'Ghostbusters'], ['Warhammer 40', 'Warhammer 40,000'],
    ['The Apothecary Diaries', 'Los diarios de la boticaria'],
    ['Monsters', 'Monsters, Inc.'], ['DC Comics', 'DC Universe'],
    ['Game of Thrones', 'Game of Thrones / House of the Dragon'],
    ['Naruto', 'Naruto / Naruto Shippuden'], ['Cobra Kai', 'Karate Kid / Cobra Kai'], ['La Sirenita', 'The Little Mermaid']
  ]) {
    assert.equal(matchesProductFamily(product(actual), displayed), true, actual + ' -> ' + displayed);
  }
});
test('explicit LFF_FAMILY tag wins over stale derived family, not other tags', () => {
  assert.equal(matchesProductFamily({
    family:'Disney Villains', tags:['disney','LFF_FAMILY:Bambi']
  }, 'Disney Villains'), false);
  assert.equal(matchesProductFamily({
    family:'Disney Villains', tags:['disney','LFF_FAMILY:Bambi']
  }, 'Bambi'), true);
});
test('unknown and empty family are not assigned by guessing', () => {
  assert.equal(matchesProductFamily({family:'',tags:['disney','pokemon']}, 'Pokemon'), false);
  assert.equal(matchesProductFamily(null,'Naruto'), false);
  assert.equal(catalogFamilyIdentity('Disney Villains'), 'disney villains');
  assert.notEqual(catalogFamilyIdentity('Disney'),catalogFamilyIdentity('Disney Villains'));
});

test('bilingual and parenthesized Shopify family tags match exact storefront family', () => {
  for(const [real, portal] of [
    ['La Bella y la Bestia (Beauty and the Beast)', 'Beauty and the Beast'],
    ['El Rey León (The Lion King)', 'The Lion King'],
    ["Frieren: Beyond Journey's End (Sousou no Frieren)", "Frieren: Beyond Journey’s End"],
    ['Mickey Mouse y sus Amigos (Disney Clásicos)', 'Mickey & Friends'],
    ['Tarzán (Disney Tarzan)', 'Tarzan']
  ]) assert.equal(matchesProductFamily(product(real), portal), true, real + ' -> ' + portal);
});
test('type inference uses real product metadata before a word hidden in the title', () => {
  assert.equal(catalogProductKind({title:'La Bella y la Bestia · Una Taza de Magia Eterna', productType:'Merchandising LFF',tags:['LFF_LIGHT_OPTIONS_V1']}),'textil');
  assert.equal(catalogProductKind({title:'Una Taza de Magia Eterna',productType:'Merchandising LFF',tags:[]}), 'textil');
  assert.equal(catalogProductKind({title:'Taza One Piece · Secretos de Ohara',productType:'Taza personalizada LFF',tags:['LFF_PRODUCT_TYPE:TAZA']}),'taza');
  assert.equal(catalogProductKind({title:'Taza Naruto',productType:'Taza personalizada LFF',tags:[]}), 'taza');
  assert.equal(catalogProductKind({title:'Póster de Dune',productType:'Merchandising LFF',tags:[]}), 'poster');
  assert.equal(catalogProductKind({title:'One Piece · Monkey D. Luffy',productType:'Camisetas, tops y sudaderas',tags:[]}), 'textil');
});
test('new bilingual aliases do not merge neighboring families', () => {
  assert.equal(matchesProductFamily(product('Sleeping Beauty'), 'Beauty and the Beast'), false);
  assert.equal(matchesProductFamily(product('The Lion King'), 'Lilo & Stitch'), false);
  assert.equal(matchesProductFamily(product('Mickey & Friends'), 'Disney Villains'), false);
  assert.equal(matchesProductFamily(product('Tarzan'), 'The Lion King'), false);
});
