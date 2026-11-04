/* ===== LFF ASISTENTE V189 · 196 FAMILIAS, ALIAS + RESPUESTAS DINAMICAS, EVITA FALSOS POSITIVOS ===== */
(() => {
  if(window.__LFF_ASSISTANT_V106__) return;
  window.__LFF_ASSISTANT_V106__=true;
  const launcher=document.getElementById('aiAssistantLauncher');
  const panel=document.getElementById('aiAssistantPanel');
  const close=document.getElementById('aiAssistantClose');
  const form=document.getElementById('aiAssistantForm');
  const input=document.getElementById('aiAssistantInput');
  const body=document.getElementById('aiAssistantBody');
  if(!launcher||!panel||!form||!input||!body)return;

  /* V107 · Capa global del asistente
     Lo movemos al body y reforzamos su capa cada vez que abre un portal/familia,
     para que nunca quede detrás de Anime, Gaming, Disney, Multiusos o previews. */
  function ensureAssistantLayer(forceOpen=false){
    try{ if(launcher.parentElement!==document.body)document.body.appendChild(launcher); }catch(e){}
    try{ if(panel.parentElement!==document.body)document.body.appendChild(panel); }catch(e){}
    try{
      launcher.style.setProperty('z-index','2147483000','important');
      launcher.style.setProperty('position','fixed','important');
      panel.style.setProperty('z-index','2147483001','important');
      panel.style.setProperty('position','fixed','important');
      if(forceOpen){
        panel.classList.add('open');
        panel.setAttribute('aria-hidden','false');
      }
    }catch(e){}
  }
  ensureAssistantLayer(false);

  const ENDPOINTS=['/apps/lff/assistant','https://lff-shopify-backend.onrender.com/api/lff/assistant'];
  const STATE_KEY='lff_assistant_v106_state';
  const PENDING_FAMILY_KEY='lff_assistant_v106_pending_family';
  const MAX_HISTORY=36;
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const norm=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[×＆&]/g,' x ').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
  const squash=value=>norm(value).replace(/\s+/g,'');
  const pick=(arr,seed)=>arr[Math.abs([...String(seed||'')].reduce((a,c)=>((a*31)+c.charCodeAt(0))|0,7))%arr.length];
  let localTopic='';
  let runtimeFamilies=[];
  let state={messages:[],open:false,threadId:'',lastFamilyId:''};

  function loadState(){
    try{
      const raw=sessionStorage.getItem(STATE_KEY);if(!raw)return;
      const parsed=JSON.parse(raw);if(!parsed||typeof parsed!=='object')return;
      state.messages=Array.isArray(parsed.messages)?parsed.messages.filter(x=>x&&['user','bot'].includes(x.role)&&typeof x.text==='string').slice(-MAX_HISTORY):[];
      state.open=Boolean(parsed.open);state.threadId=String(parsed.threadId||'');state.lastFamilyId=String(parsed.lastFamilyId||'');
    }catch(e){}
  }
  function saveState(){
    try{sessionStorage.setItem(STATE_KEY,JSON.stringify({messages:state.messages.slice(-MAX_HISTORY),open:state.open,threadId:state.threadId,lastFamilyId:state.lastFamilyId}));}catch(e){}
  }
  function openAssistant(){ensureAssistantLayer(true);panel.classList.add('open');panel.setAttribute('aria-hidden','false');state.open=true;saveState();setTimeout(()=>input.focus(),120)}
  function closeAssistant(){panel.classList.remove('open');panel.setAttribute('aria-hidden','true');state.open=false;saveState()}
  function renderMessage(role,text){
    const wrap=document.createElement('div');wrap.className='aiMessage '+role;
    wrap.innerHTML=`<div class="aiBubble"><b>${role==='user'?'Tú':'Asistente Friki'}</b><p>${esc(text)}</p></div>`;
    body.appendChild(wrap);return wrap;
  }
  function addMessage(role,text,{save=true}={}){
    renderMessage(role,text);body.scrollTop=body.scrollHeight;
    if(save){state.messages.push({role,text:String(text||'').slice(0,1800)});state.messages=state.messages.slice(-MAX_HISTORY);saveState();}
  }
  function restoreConversation(){
    if(!state.messages.length)return;
    body.innerHTML='';state.messages.forEach(m=>renderMessage(m.role,m.text));body.scrollTop=body.scrollHeight;
  }

  const CHARACTER_HINTS={
    'one-piece':['luffy','lufi','ruffy','zoro','roronoa','nami','sanji','ace','law','chopper','robin','usopp','shanks','kaido'],
    'naruto':['naruto','sasuke','sakura','kakashi','itachi','hitachi','jiraiya','hinata','gaara','madara','obito','minato','tsunade','akatsuki'],
    'dragon-ball':['goku','gocu','gokuh','vegeta','bejita','gohan','trunks','piccolo','freezer','frieza','broly','bulma','krilin','majin buu','cell','beerus','bills'],
    'bleach':['ichigo','rukia','aizen','renji','byakuya','kenpachi','ulquiorra','orihime'],
    'jujutsu-kaisen':['gojo','goyo','gojou','satoru gojo','sukuna','yuji','yuuji','itadori','megumi','nobara','toji','yuta','geto'],
    'demon-slayer':['tanjiro','tanyiro','nezuko','nesuko','zenitsu','inosuke','rengoku','tomioka','shinobu','muzan','mitsuri'],
    'attack-on-titan':['eren','mikasa','levi','armin','reiner','annie','hange','erwin'],
    'my-hero-academia':['deku','midoriya','bakugo','bakugou','todoroki','all might','uraraka','dabi','toga'],
    'solo-leveling':['sung jinwoo','sung jin woo','jinwoo','jin woo','igris','beru','cha hae'],
    'chainsaw-man':['denji','power','makima','aki','pochita'],
    'spy-family':['anya','ania','loid','yor','bond forger'],
    'one-punch-man':['saitama','genos','tatsumaki','garou'],
    'death-note':['light yagami','kira','ryuk','riuk','l lawliet','misa'],
    'hunter-x-hunter':['gon','killua','kilua','kurapika','hisoka','chrollo'],
    'fullmetal':['edward elric','alphonse','roy mustang','winry','scar'],
    'jojo':['jotaro','dio','giorno','josuke','jolyne','jonathan joestar','joseph joestar'],
    'sword-art-online':['kirito','asuna','sinon','alice sao'],
    'pokemon':['pikachu','picachu','charizard','eevee','gengar','mewtwo','lucario','bulbasaur','squirtle'],
    'sailor-moon':['usagi','sailor moon','tuxedo mask'],
    'blue-lock':['isagi','bachira','rin itoshi','nagi'],
    'haikyuu':['hinata shoyo','kageyama','oikawa','kenma'],
    'tokyo-ghoul':['kaneki','touka'],
    'berserk':['guts','griffith','casca'],
    'black-clover':['asta','yuno','noelle'],
    'fairy-tail':['natsu','lucy heartfilia','erza','gray fullbuster'],
    'evangelion':['shiniji','shinji','asuka','rei ayanami','eva 01'],
    'rick-morty':['rick sanchez','morty','rick','portal gun'],
    'harry-potter':['harry potter','harry poter','harri potter','hermione','ron weasley','dumbledore','snape','voldemort'],
    'dc-universe':['batman','superman','wonder woman','joker','harley quinn','flash'],
    'star-wars':['darth vader','dar vader','yoda','luke skywalker','leia','grogu','mandalorian','ahsoka'],
    'marvel':['spiderman','spider man','iron man','thor','hulk','deadpool','wolverine','venom','capitan america','captain america']
  };

  const EXTRA_FAMILY_ALIASES_V189 = {"one-piece":["one piece","mugiwara","straw hat","one piece","luffy gear 5","nika","sombrero de paja","tripulacion de luffy","one pis","ace portgas","boa hancock","jimbei","jinbe"],"naruto":["naruto","naruto shippuden","shippuden","naruto","naruto uzumaki","itachi uchiha","sasuke uchiha","kakashi hatake","saske","itachi","hokage","uzumaki"],"boruto":["boruto","karma","boruto","sarada","mitsuki","kawaki"],"dragon-ball":["dragon ball","dbz","dragon ball z","goku","dragon ball","dragon bol","bola de dragon","son goku","goku ssj","goku super saiyan","vegeta","trunks","gohan","picolo","freezer","frieza","broly"],"bleach":["bleach","shinigami","bleach","ichigo kurosaki","rukia","aizen","kenpachi","soul society","bankai"],"jujutsu-kaisen":["jujutsu kaisen","jjk","jujutsu kaisen","goyo","goyou","gojo satoru","satoru gojo","sukuna","itadori","yuji itadori","megumi fushiguro","nobara","toji","yuta"],"demon-slayer":["demon slayer","kimetsu","kimetsu no yaiba","demon slayer","guardianes de la noche","kimetsu","tanjiro kamado","nezuko kamado","inosuke","zenitsu","rengoku","pilares"],"attack-on-titan":["attack on titan","shingeki","shingeki no kyojin","aot","attack on titan","ataque de los titanes","ataque a los titanes","eren jaeger","levi ackerman","mikasa ackerman","shingeki"],"my-hero-academia":["my hero academia","boku no hero","bnha","mha","my hero academia","academia de heroes","boku no hero","deku","bakugo","todoroki","uraraka","all might"],"solo-leveling":["solo leveling","sung jinwoo","jinwoo","solo leveling","solo levelling","jin woo","sung jin woo","sung jinwoo","igris","beru","monarca de las sombras"],"chainsaw-man":["chainsaw man","denji","chainsaw man","hombre motosierra","denji","pochita","power","makima","aki hayakawa"],"dan-da-dan":["dan da dan","dandadan","dan da dan","dandadan","momo ayase","okarun","turbo granny","abuela turbo"],"sakamoto-days":["sakamoto days","sakamoto","sakamoto days"],"frieren":["frieren","beyond journey's end","sousou no frieren","frieren","frieren el viaje","frieren mas alla del final del viaje","fern","stark","himmel"],"apothecary-diaries":["los diarios de la boticaria","apothecary diaries","kusuriya","apothecary diaries","los diarios de la boticaria","diarios de la boticaria","the apothecary diaries","mao mao","maomao","jinshi"],"spy-family":["spy family","spy x family","anya","spy family","spy x family","anya forger","loid forger","yor forger","bond forger"],"kaiju-no-8":["kaiju no 8","kaiju 8","kaiju no 8"],"oshi-no-ko":["oshi no ko","oshi","oshi no ko"],"blue-lock":["blue lock","bluelock","blue lock","blue lock","isagi yoichi","nagi","bachira","rin itoshi"],"haikyuu":["haikyuu","haikyu","volleyball","haikyuu","haikyu","hinata shoyo","tobio kageyama","oikawa","kenma"],"hunter-x-hunter":["hunter x hunter","hunter hunter","hxh","hunter x hunter"],"fullmetal":["fullmetal alchemist","fma","fmab","brotherhood","fullmetal"],"death-note":["death note","kira","ryuk","death note","death note","cuaderno de la muerte","light yagami","l lawliet","misa amane","ryuk"],"one-punch-man":["one punch man","opm","saitama","one punch man"],"mob-psycho-100":["mob psycho 100","mob psycho","mob","mob psycho 100"],"black-clover":["black clover","asta","black clover","asta","yuno","noelle","yami sukehiro"],"fairy-tail":["fairy tail","natsu","fairy tail"],"tokyo-revengers":["tokyo revengers","mikey","tokyo revengers"],"tokyo-ghoul":["tokyo ghoul","kaneki","tokyo ghoul"],"vinland-saga":["vinland saga","thorfinn","vinland saga"],"berserk":["berserk","guts","berserk","guts","griffith","casca"],"jojo":["jojo","jojo's bizarre adventure","jjba","jojo","jojos","jojo bizarre adventure","jotaro","dio brando","giorno giovanna","jolyne"],"evangelion":["evangelion","neon genesis evangelion","eva","evangelion"],"cowboy-bebop":["cowboy bebop","bebop","cowboy bebop"],"code-geass":["code geass","lelouch","geass","code geass"],"gurren-lagann":["gurren lagann","tengen toppa","gurren lagann"],"sword-art-online":["sword art online","sao","kirito","sword art online"],"rezero":["re zero","rezero","re:zero","rezero"],"mushoku-tensei":["mushoku tensei","rudeus","mushoku tensei"],"shield-hero":["shield hero","rising of the shield hero","tate no yuusha","shield hero"],"slime":["that time i got reincarnated as a slime","slime","rimuru","tensei shitara slime","slime"],"konosuba":["konosuba","megumin","konosuba"],"dr-stone":["dr stone","dr. stone","senku","dr stone"],"fire-force":["fire force","enen no shouboutai","fire force"],"gachiakuta":["gachiakuta","rudo","gachiakuta"],"mashle":["mashle","magic and muscles","mashle"],"dungeon-meshi":["dungeon meshi","delicious in dungeon","dungeon meshi"],"bocchi-rock":["bocchi the rock","bocchi","bocchi rock"],"sailor-moon":["sailor moon","usagi","sailor moon","guerrero luna","guerreras luna","usagi tsukino","sailor mercury","sailor mars"],"pokemon":["pokemon","pokémon","pikachu","pokemon","pokemons","pikachu","charizard","bulbasaur","eevee","mewtwo","lucario","gengar"],"minecraft":["creeper","ender","nether","steve","blocks","minecraft","creeper","enderman","steve minecraft","alex minecraft","bloques minecraft"],"fortnite":["battle royale","epic","skins","fortnite","fortnite battle royale","fortnite skins","peely","banana fortnite"],"gta":["gta","grand theft auto","vice city","san andreas","gta"],"call-of-duty":["cod","warzone","black ops","mw","modern warfare","call of duty"],"league-of-legends":["lol","riot","summoners rift","arcane","league of legends","league of legends","liga de leyendas","lol","arcane","jinx","vi arcane","ahri","yasuo","caitlyn"],"valorant":["vct","riot shooter","jett","sage","valorant","valorant","jett","sage valorant","raze","reyna valorant"],"counter-strike-2":["cs2","counter strike","csgo","counter strike 2"],"roblox":["blox","robux","roblox","roblox","robux","blox fruits","brookhaven","adopt me"],"zelda":["zelda","hyrule","link","triforce","zelda","zelda","leyenda de zelda","legend of zelda","link","princesa zelda","hyrule","ganondorf"],"super-mario":["mario","luigi","bowser","mushroom","super mario","super mario bros","mario bros","mario","luigi","princesa peach","bowser","yoshi","toad"],"sonic":["sonic","tails","rings","eggman","sonic","sonic","sonic el erizo","tails","knuckles","shadow sonic","eggman"],"fnaf":["fnaf","freddy","bonnie","chica","fnaf","five nights at freddys","five nights at freddy s","freddy fazbear","chica fnaf","foxy","bonnie fnaf"],"resident-evil":["resident evil","umbrella","biohazard","re","resident evil"],"silent-hill":["silent hill","pyramid head","silent hill"],"elden-ring":["elden ring","fromsoftware","tarnished","elden ring"],"dark-souls":["dark souls","bonfire","solaire","dark souls"],"god-of-war":["god of war","kratos","atreus","god of war","dios de la guerra","kratos","atreus","mimir"],"the-last-of-us":["the last of us","tlou","ellie","joel","the last of us","last of us","the last of us","tlou","ellie","joel","abby"],"red-dead-redemption":["rdr","red dead","arthur","john marston","red dead redemption"],"assassins-creed":["assassins creed","ezio","altair","assassin creed","assassins creed"],"cyberpunk-2077":["cyberpunk","night city","v","edgerunners","cyberpunk 2077"],"fallout":["fallout","vault boy","nuka cola","fallout"],"skyrim":["skyrim","elder scrolls","dragonborn","tes","skyrim"],"doom":["doom","doom slayer","doom"],"halo":["halo","master chief","spartan","halo"],"monster-hunter":["monster hunter","mh","palico","monster hunter"],"final-fantasy":["final fantasy","ff7","cloud","sephiroth","final fantasy"],"persona":["persona","persona 5","joker","phantom thieves","persona"],"hollow-knight":["hollow knight","hornet","silksong","hollow knight"],"undertale-deltarune":["undertale","deltarune","sans","kris","undertale deltarune"],"terraria":["terraria","eye of cthulhu","pickaxe","terraria"],"expedition-33":["expedition 33","clair obscur","expedition 33"],"horizon":["horizon","aloy","zero dawn","forbidden west","horizon"],"ark":["ark","survival evolved","dinosaur","ark"],"rust":["rust","wipe","survival rust","rust"],"meccha-chameleon":["meccha chameleon","mecha chameleon","meccha chameleon"],"destiny":["destiny","guardian","ghost","bungie","destiny"],"among-us":["among us","crewmate","impostor","amon gus","among us"],"ea-sports-fc":["ea sports fc","fifa","fut","ea sports fc"],"golf-it":["golf it","golfit","golf it"],"overwatch":["overwatch","ow","tracer","mercy","overwatch","overwatch","dva","d va","d va overwatch","mercy","kiriko","reinhardt","tracer"],"no-mans-sky":["no man's sky","nms","no mans sky"],"clash-of-clans-royale":["supercell","clash of clans","clash royale","brawl stars","hay day","boom beach","clash of clans royale"],"it-takes-two":["it takes two","hazelight","it takes two"],"tomb-raider":["tomb raider","lara croft","tomb raider"],"uncharted":["uncharted","nathan drake","uncharted"],"diablo":["diablo","sanctuary","lilith","diablo"],"the-witcher":["witcher","geralt","wolf school","the witcher","the witcher","el brujo","geralt de rivia","geralt","yennefer","ciri"],"baldurs-gate":["baldurs gate","bg3","baldur's gate","baldurs gate","baldurs gate","baldurs gate 3","baldur s gate","astarion","shadowheart","karlach"],"hades":["hades","zagreus","supergiant","hades"],"marvel":["marvel","avengers","vengadores","spiderman","spider-man","iron man","captain america","capitan america","thor","hulk","guardians of the galaxy","guardianes galaxia","deadpool","x-men","wolverine","black panther","pantera negra","doctor strange","loki","scarlet witch","marvel"],"mickey-friends":["mickey","minnie","donald","goofy","pluto","mickey friends"],"lilo-stitch":["stitch","lilo","626","lilo stitch","lilo y stitch","lilo stitch","stich","stitch","experimento 626","angel stitch"],"frozen":["elsa","anna","olaf","frozen","frozen","frozen el reino del hielo","reino del hielo","elsa frozen","anna frozen","olaf"],"lion-king":["lion king","simba","mufasa","lion king","el rey leon","el rey león","simba","mufasa","scar rey leon","timon","pumba"],"beauty-beast":["beauty and the beast","bella","beast","rose","beauty beast","la bella y la bestia","bella y bestia","bella disney","bestia disney","bella la princesa"],"aladdin":["aladdin","jasmine","genie","aladdin","aladin","aladdin","genio aladdin","princesa jasmine","jazmin aladdin","jafar"],"little-mermaid":["little mermaid","ariel","sebastian","little mermaid","la sirenita","sirenita","sirena ariel","la sirena ariel","princesa ariel","ariel disney","ariel","sebastian cangrejo","flounder","flounder pez","ursula sirenita","rey triton","prince eric","principe eric"],"tangled":["tangled","rapunzel","flynn","tangled","enredados","rapunzel","rapuncel","flynn rider","pascal rapunzel"],"moana":["moana","maui","vaiana","moana","vaiana","moana","vaiana disney","maui","pua vaiana","hei hei"],"encanto":["encanto","mirabel","bruno","encanto","encanto disney","mirabel madrigal","isabela madrigal","bruno madrigal","luisa madrigal","no se habla de bruno"],"mulan":["mulan","mushu","mulan","mulan","mulan disney","mushu","shang"],"hercules":["hercules","hades","megara","hercules","hercules disney","hades","megara","pegaso hercules"],"alice-wonderland":["alice","wonderland","cheshire","mad hatter","alice wonderland","alicia en el pais de las maravillas","alicia maravillas","sombrerero loco","gato de cheshire","reina de corazones"],"peter-pan":["peter pan","tinker bell","campanilla","peter pan","peter pan","campanilla","tinker bell","garfio"],"winnie-pooh":["winnie pooh","pooh","tigger","winnie pooh","winnie de pooh","winnie the pooh","winnie pooh","piglet","tigger","igor pooh"],"nightmare-before-christmas":["nightmare before christmas","jack skellington","sally","nightmare before christmas","pesadilla antes de navidad","pesadilla antes de navidad","jack skellington","sally skellington","zero fantasma"],"pirates-caribbean":["pirates caribbean","jack sparrow","pirates","pirates caribbean","piratas del caribe","jack sparrow","capitan jack sparrow","davy jones"],"zootopia":["zootopia","judy hopps","nick wilde","zootopia","zootropolis","zootopia","judy hopps","nick wilde"],"big-hero-6":["big hero 6","baymax","hiro","big hero 6","big hero 6","grandes heroes","baymax","hiro hamada"],"disney-villains":["villains","maleficent","ursula","scar","cruella","disney villains","villanos disney","villanas disney","malefica","maleficent","cruella","malefica disney","reina malvada"],"toy-story":["toy story","woody","buzz","toy story","toy story","woody","buzz lightyear","buzz","jessie toy story","rayo no"],"cars":["cars","lightning mcqueen","rayo mcqueen","cars","cars disney","rayo mcqueen","mate cars","mate la grua","sally carrera"],"monsters-inc":["monsters inc","sulley","mike wazowski","monsters inc","monstruos sa","monstruos s a","monstruos sa disney","mike wazowski","sullivan","sulley","boo"],"finding-nemo":["finding nemo","nemo","dory","finding nemo","buscando a nemo","buscando a dory","nemo","dory","marlin","pez payaso nemo"],"incredibles":["incredibles","mr incredible","elastigirl","incredibles","los increibles","increibles","mr increible","elastigirl","violeta increibles","dash"],"ratatouille":["ratatouille","remy","ratatouille","ratatui","ratatouille","remy","linguini"],"wall-e":["wall-e","walle","eve","wall e","walle","wall e","wall-e","eva walle","eve wall e"],"up":["up","carl","russell","up"],"inside-out":["inside out","del reves","joy","sadness","inside out","del reves","del revés","intensamente","alegria del reves","tristeza del reves","ansiedad del reves"],"coco":["coco","miguel","remember me","coco","coco disney","miguel rivera","hector rivera","dia de muertos coco","mama coco"],"brave":["brave","merida","brave","indomable","brave disney","merida disney","princesa merida"],"soul":["soul","joe gardner","22","soul"],"luca":["luca","alberto","luca"],"turning-red":["turning red","red","mei","turning red","red disney","turning red","red pixar","panda rojo mei"],"star-wars":["star wars","galaxy far far away","jedi","sith","mandalorian","the mandalorian","mando","din djarin","grogu","baby yoda","the child","darth vader","vader","empire","imperio","stormtrooper","clone wars","the clone wars","ahsoka","clones","republic","star wars","la guerra de las galaxias","guerra de las galaxias","darth vader","dar vader","baby yoda","grogu","ahsoka tano","mandaloriano","obi wan"],"snow-white":["snow white","blancanieves","seven dwarfs","snow white","blancanieves","blanca nieves","siete enanitos","7 enanitos","reina malvada blancanieves"],"cinderella":["cinderella","cenicienta","glass slipper","cinderella","cenicienta","la cenicienta","hada madrina","principe encantador cenicienta"],"sleeping-beauty":["sleeping beauty","aurora","maleficent","sleeping beauty","la bella durmiente","bella durmiente","princesa aurora","aurora disney","malefica bella durmiente"],"pinocchio":["pinocchio","pinocho","jiminy cricket","pinocchio","pinocho","pepe grillo","pepito grillo","geppetto","gepeto"],"bambi":["bambi","thumper","tambor","bambi"],"dumbo":["dumbo","circus","dumbo"],"101-dalmatians":["101 dalmatians","101 dalmatas","cruella","dalmatians","101 dalmatians","101 dalmatas","101 dalmatas disney","los 101 dalmatas","cruella de vil"],"aristocats":["aristocats","aristogatos","marie","aristocats","los aristogatos","aristogatos","marie aristogatos"],"tarzan":["tarzan","jane","gorilla","tarzan"],"treasure-planet":["treasure planet","planeta del tesoro","jim hawkins","treasure planet","el planeta del tesoro","planeta del tesoro","jim hawkins","john silver planeta"],"harry-potter":["harry potter","wizarding world","hogwarts","hermione","ron","dumbledore","voldemort","harry potter","harry poter","harry potter","hermione granger","ron weasley","snape","severus snape","hogwarts","dumbledore","voldemort"],"dc-universe":["dc","batman","superman","wonder woman","joker","harley quinn","flash","aquaman","green lantern","dc universe","dc comics","batman","superman","wonder woman","mujer maravilla","joker","harley quinn","flash","aquaman"],"lord-rings":["lord of the rings","lotr","hobbit","gandalf","frodo","middle earth","lord rings","el señor de los anillos","senor de los anillos","el hobbit","frodo bolson","gandalf","aragorn","legolas","gollum"],"stranger-things":["stranger things","eleven","vecna","upside down","demogorgon","stranger things","stranger things","once stranger things","eleven","eleven stranger things","demogorgon","vecna"],"jurassic":["jurassic park","jurassic world","t rex","raptor","dinosaur","jurassic","jurassic park","parque jurasico","jurassic world","mundo jurasico","dinosaurios jurassic"],"ghostbusters":["ghostbusters","cazafantasmas","slimer","stay puft","ghostbusters","los cazafantasmas","cazafantasmas","ghostbusters","moquete","slimer"],"back-future":["back to the future","regreso al futuro","delorean","marty mcfly","doc brown","back future","regreso al futuro","volver al futuro","doc brown","marty mcfly","delorean"],"matrix":["matrix","neo","trinity","morpheus","matrix","matrix","the matrix","neo matrix","trinity matrix","morfeo matrix"],"the-boys":["the boys","homelander","starlight","butcher","the boys","the boys","homelander","patriota","carnicero","butcher"],"transformers":["transformers","optimus prime","bumblebee","megatron","autobot","decepticon","transformers","transformers","optimus prime","bumblebee","megatron"],"star-trek":["star trek","enterprise","spock","kirk","star trek","star trek","viaje a las estrellas","spock","enterprise","capitan kirk"],"doctor-who":["doctor who","tardis","dalek","time lord","doctor who","doctor who","doctor quién","tardis","dalek"],"wednesday":["wednesday","miercoles","addams family","thing","familia addams","wednesday","miercoles addams","miércoles addams","miercoles","wednesday addams","familia addams","merlina","cosa addams"],"game-thrones":["game of thrones","got","house of the dragon","hotd","targaryen","stark","game thrones","juego de tronos","la casa del dragon","house of dragon","daenerys","jon snow","rhaenyra"],"walking-dead":["walking dead","twd","rick grimes","daryl","walking dead","the walking dead","los muertos vivientes","rick grimes","daryl dixon","negan"],"squid-game":["squid game","juego del calamar","456","pink guards","squid game","el juego del calamar","juego calamar","squid game","jugador 456"],"peaky-blinders":["peaky blinders","thomas shelby","shelby","peaky blinders","peaky blinders","tommy shelby","thomas shelby"],"breaking-bad":["breaking bad","better call saul","walter white","jesse pinkman","saul goodman","breaking bad","breaking bad","better call saul","walter white","heisenberg","jesse pinkman","saul goodman"],"friends":["friends","central perk","rachel","ross","monica","chandler","joey","phoebe","friends"],"the-office":["the office","dunder mifflin","michael scott","dwight","the office"],"rick-morty":["rick and morty","rick","morty","portal gun","rick morty","rick y morty","rick and morty","rick morty","rick sanchez","morty smith"],"south-park":["south park","cartman","kenny","stan","kyle","south park"],"tmnt":["tmnt","ninja turtles","tortugas ninja","leonardo","raphael","donatello","michelangelo","tmnt","las tortugas ninja","tortugas ninja","tortugas mutantes","raphael","leonardo tortuga","donatello","michelangelo"],"power-rangers":["power rangers","mighty morphin","megazord","power rangers"],"masters-universe":["masters of the universe","he man","skeletor","eternia","masters universe"],"thundercats":["thundercats","lion o","mumm ra","thundercats"],"scooby-doo":["scooby doo","shaggy","mystery machine","scooby doo"],"looney-tunes":["looney tunes","bugs bunny","daffy duck","tweety","looney tunes","looney tunes","bugs bunny","el conejo bugs","pato lucas","piolin","silvestre"],"beetlejuice":["beetlejuice","beetle juice","lydia","beetlejuice","bitelchus","beetlejuice","bitelchus bitelchus","lidia deetz"],"gremlins":["gremlins","gizmo","mogwai","gremlins","gremlins","gizmo","mogwai"],"rocky-creed":["rocky","creed","balboa","apollo creed","rocky creed","rocky balboa","rocky","apollo creed","adoni creed"],"cobra-kai":["karate kid","cobra kai","daniel larusso","johnny lawrence","cobra kai","karate kid","cobra kai","daniel larusso","johnny lawrence","sr miyagi"],"fast-furious":["fast and furious","fast furious","toretto","dom","fast furious","rapidos y furiosos","a todo gas","fast and furious","dom toretto","paul walker"],"john-wick":["john wick","baba yaga","continental","john wick","john wick","john wick baba yaga","baba yaga"],"top-gun":["top gun","maverick","goose","top gun"],"mission-impossible":["mission impossible","ethan hunt","imf","mission impossible"],"alien":["alien","xenomorph","ripley","alien","alien el octavo pasajero","xenomorfo","alien","ripley"],"predator":["predator","yautja","predator","depredador","predator","yautja"],"terminator":["terminator","t800","skynet","sarah connor","terminator","terminator","terminator 2","t 800","t800","sarah connor"],"robocop":["robocop","ocp","alex murphy","robocop"],"monsterverse":["godzilla","kong","king kong","monsterverse","kaiju","monsterverse","godzilla","king kong","kong","godzilla vs kong","monsterverse"],"dune":["dune","arrakis","paul atreides","sandworm","dune","dune","duna","paul atreides","arrakis","gusanos de arena"],"blade-runner":["blade runner","replicant","deckard","blade runner","blade runner","replicantes","rick deckard"],"mad-max":["mad max","fury road","furiosa","mad max"],"warhammer-40k":["warhammer","40k","warhammer 40000","space marine","warhammer 40k","warhammer","warhammer 40k","space marine","marines espaciales"],"dungeons-dragons":["dungeons and dragons","dnd","d&d","forgotten realms","dungeons dragons","dungeons dragons","dungeons and dragons","dragones y mazmorras","calabozos y dragones","d&d","dnd"],"magic-gathering":["magic the gathering","mtg","planeswalker","mana","magic gathering","magic the gathering","magic gathering","magic cartas","mtg","planeswalker"],"universal-monsters":["universal monsters","dracula","frankenstein","wolf man","mummy","creature black lagoon","universal monsters","monstruos clasicos","monstruos universales","dracula","frankenstein","hombre lobo"],"the-mummy":["the mummy","momia","imhotep","rick oconnell","the mummy","la momia","momia","imhotep"],"men-in-black":["men in black","mib","agents j k","neuralyzer","men in black","hombres de negro","men in black","mib","agente j","agente k"]};
  function categoryPortal(category){
    const c=norm(category);
    if(c.includes('anime'))return'anime';
    if(c.includes('gaming')||c.includes('juego'))return'gaming';
    if(c.includes('disney')||c.includes('marvel')||c.includes('star wars'))return'disney';
    if(c.includes('multi'))return'multiverse';
    if(c.includes('youtube')||c.includes('creador'))return'youtubers';
    return'';
  }
  function familyCandidates(){
    const map=new Map();
    const add=item=>{
      if(!item)return;const id=String(item.id||item.key||'').trim();if(!id)return;
      const current=map.get(id)||{id,name:item.name||id,category:item.category||'',aliases:[]};
      current.name=item.name||current.name;current.category=item.category||current.category;
      current.aliases=[...new Set([...(current.aliases||[]),...(item.aliases||[]),item.name,id.replace(/-/g,' ')].filter(Boolean))];
      map.set(id,current);
    };
    (window.LFF_ASSISTANT_FAMILIES_V106||[]).forEach(add);
    (window.LFF_FAMILY_DEFAULTS||[]).forEach(add);
    runtimeFamilies.forEach(add);
    document.querySelectorAll('.animeUniverseCard,.gamingUniverseCard,.disneyUniverseCard,.multiUniverseCard').forEach(card=>{
      const root=card.closest('[id^="categoryWorld-"]');const portal=(root?.id||'').replace('categoryWorld-','');
      const category={anime:'Anime & Manga',gaming:'Gaming',disney:'Disney',multiverse:'Multiusos'}[portal]||'';
      add({id:card.dataset.id||card.dataset.name,name:card.dataset.name||card.querySelector('img[alt]')?.alt||card.textContent.trim(),category,aliases:[card.dataset.name,card.textContent.trim()]});
    });
    for(const [id,aliases] of Object.entries(CHARACTER_HINTS)){
      const item=map.get(id);if(item)item.aliases=[...new Set([...(item.aliases||[]),...aliases])];
    }
    for(const entry of map.values())entry.aliases=[...new Set([...(entry.aliases||[]),...(EXTRA_FAMILY_ALIASES_V189[entry.id]||[])])];
    return [...map.values()];
  }
  function refreshRuntimeFamilies(force=false){
    try{
      const promise=window.LFFFamiliesRuntime?.all?.(force);
      if(promise&&typeof promise.then==='function')promise.then(items=>{if(Array.isArray(items))runtimeFamilies=items;}).catch(()=>{});
    }catch(e){}
  }
  function editDistance(a,b){
    a=norm(a);b=norm(b);if(a===b)return 0;if(!a)return b.length;if(!b)return a.length;
    const prev=Array.from({length:b.length+1},(_,i)=>i),curr=new Array(b.length+1);
    for(let i=1;i<=a.length;i++){curr[0]=i;for(let j=1;j<=b.length;j++){const cost=a[i-1]===b[j-1]?0:1;curr[j]=Math.min(curr[j-1]+1,prev[j]+1,prev[j-1]+cost);}for(let j=0;j<=b.length;j++)prev[j]=curr[j];}
    return prev[b.length];
  }
  function phraseInText(text,phrase){return (` ${text} `).includes(` ${phrase} `)}
  // V189: match whole names/tokens; approximate matches only for close typos.
  // This prevents "la sirenita" accidentally resolving to unrelated anime.
  function fuzzyAliasScore(query,rawAlias){
    const q=norm(query),alias=norm(rawAlias);
    if(!q||!alias||alias.length<2)return 0;
    if(q===alias)return 30000+alias.length*10;
    const trivial=new Set(['up','re','it','no','lo','de','el','la','los','las','yo','si','mi','red','mob','eva','re','ark','rust']);
    if(trivial.has(alias)&&q!==alias){ if(['up','ark','rust'].includes(alias) && new RegExp('(?:^| )(?:de|del|sobre|pelicula|videojuego|juego) '+alias+'(?: |$)').test(q))return 14500+alias.length*10;return 0; }
    if(phraseInText(q,alias))return alias.length>=4?15000+alias.length*10:0;
    if(alias.length<6||q.length<4)return 0;
    const target=alias.split(' '),words=q.split(' ');
    const lim=alias.length>=18?3:alias.length>=10?2:1;
    let best=0;
    for(let size=Math.max(1,target.length-1);size<=Math.min(words.length,target.length+1);size++){
      for(let i=0;i<=words.length-size;i++){
        const candidate=words.slice(i,i+size).join(' ');
        if(Math.abs(candidate.length-alias.length)>lim)continue;
        const d=editDistance(candidate,alias);
        const sim=1-d/Math.max(candidate.length,alias.length);
        if(d<=lim&&sim>=0.88)best=Math.max(best,6000+Math.round(sim*1000)+alias.length);
      }
    }
    return best;
  }
    // No usar la primera coincidencia de un producto: mezclaba familias.
  function familyFromProducts(q,families){return null;}

    function assistantFamilyResolution(raw){
    const q=norm(raw);
    if(q.length<2)return {family:null,ambiguous:[]};
    const matches=[];
    for(const family of familyCandidates()){
      let best=0,alias='';
      for(const rawAlias of [family.name,family.id,...(family.aliases||[])]){
        const score=fuzzyAliasScore(q,rawAlias);
        if(score>best){best=score;alias=norm(rawAlias);}
      }
      if(best>=6000)matches.push({family,score:best,alias});
    }
    matches.sort((a,b)=>b.score-a.score);
    if(!matches.length)return {family:null,ambiguous:[]};
    const explicit=matches.filter(x=>x.score>=15000);
    if(explicit.length>1){
      const top=explicit[0];
      let independent=explicit.filter(x=>x.family.id!==top.family.id&&!(' '+top.alias+' ').includes(' '+x.alias+' '));
      const gamingCue=/videojuego|gaming|consola|juego de|juego hades|steam/.test(q);
      const disneyCue=/disney|pelicula|dibujos animados|princesa/.test(q);
      if(gamingCue!==disneyCue){
        const preferred=explicit.find(x=>categoryPortal(x.family.category)===(gamingCue?'gaming':'disney'));
        if(preferred)return {family:preferred.family,ambiguous:[]};
      }
      // A shorter nickname embedded in a full franchise title is not a second family.
      // Multi-family requests are only ambiguous when distinct names are genuinely requested.
      if(independent.length){
        const coordinated=/(?:^| )(?:y|o|vs|versus|entre|tambien de|ademas de)(?: |$)/.test(q);
        const sameAlias=independent.some(x=>x.alias===top.alias);
        const strongOther=independent.some(x=>x.alias.split(' ').length>=2 && x.alias.length>=7);
        if(coordinated||sameAlias||strongOther){
          return {family:null,ambiguous:[top,...independent].slice(0,3).map(x=>x.family)};
        }
      }
    }
    return {family:matches[0].family,ambiguous:[]};
  }

  function findAssistantFamily(raw){return assistantFamilyResolution(raw).family;}

    const CHARACTER_CANONICAL={
    'lufi':'Luffy','ruffy':'Luffy','gocu':'Goku','gokuh':'Goku','bejita':'Vegeta',
    'hitachi':'Itachi','goyo':'Gojo','gojou':'Gojo','yuuji':'Yuji','tanyiro':'Tanjiro',
    'nesuko':'Nezuko','kilua':'Killua','riuk':'Ryuk','picachu':'Pikachu','dar vader':'Darth Vader',
    'harry poter':'Harry Potter','harri potter':'Harry Potter','shiniji':'Shinji'
  };
  function prettyCharacterName(alias){
    const n=norm(alias);if(CHARACTER_CANONICAL[n])return CHARACTER_CANONICAL[n];
    return String(alias||'').split(/\s+/).filter(Boolean).map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' ');
  }
  function detectCharacterMatch(raw,family){
    if(!family)return'';
    const q=norm(raw),hints=CHARACTER_HINTS[family.id]||[];if(!q||!hints.length)return'';
    let best='',bestScore=0;
    for(const hint of hints){const score=fuzzyAliasScore(q,hint);if(score>bestScore){best=hint;bestScore=score;}}
    if(bestScore<3000||!best)return'';
    const n=norm(best),familyName=norm(family.name),familyId=norm(String(family.id||'').replace(/-/g,' '));
    if(n===familyId||familyName===n||familyName.startsWith(n+' ')||familyName.includes(' '+n+' /'))return'';
    return prettyCharacterName(best);
  }
  function familyContextReply(question,family){
    const q=norm(question),character=detectCharacterMatch(question,family);
    const where=character?character+" ("+family.name+")":family.name;
    const open="Te llevo a "+family.name+" para que veas los diseños y productos reales de la tienda.";
    if(/taza|tazas|mug|ceramica|vaso/.test(q))return "¡Vamos a buscar tazas de "+where+"! "+open+" Comprueba las opciones disponibles en cada ficha.";
    if(/sudadera|hoodie|sweatshirt/.test(q))return "¡Vamos a mirar sudaderas de "+where+"! "+open+" Si un diseño admite sudadera, podrás seleccionarla dentro del producto.";
    if(/camiseta|camisa|playera|ropa|top|prenda/.test(q))return "Te ayudo a encontrar ropa de "+where+". "+open+" Dentro de cada producto eliges modelo, color y talla.";
    if(/poster|poster|p[oó]ster|lamina|cuadro/.test(q))return "Vamos a buscar pósteres o láminas de "+where+". "+open+" Revisa los formatos disponibles en cada ficha.";
    if(/regalo|regalar|cumple|hijo|hija|nieto|nieta|pareja|sobrino/.test(q))return "¡Buena idea para un regalo! "+open+" Si me dices si prefieres camiseta, taza o sudadera, te oriento mejor.";
    if(/precio|cuanto|cu[aá]nto|costar|valer|barato|oferta/.test(q))return open+" Los precios actualizados aparecen en la ficha; no quiero darte un precio inventado.";
    if(/stock|disponib|queda|ten[eé]is|teneis|venden|hay|existenc/.test(q))return open+" La disponibilidad se comprueba en la ficha, según el artículo y su variante.";
    return character?"¡He localizado "+where+"! "+open:"¡He encontrado "+family.name+"! "+open;
  }

    function findFamilyCard(family){
    const portal=categoryPortal(family?.category);const root=portal?document.getElementById(`categoryWorld-${portal}`):null;
    const cards=[...(root||document).querySelectorAll('.animeUniverseCard,.gamingUniverseCard,.disneyUniverseCard,.multiUniverseCard')];
    const targetId=norm(family?.id).replace(/ /g,'-'),targetName=norm(family?.name);
    return cards.find(card=>norm(card.dataset.id).replace(/ /g,'-')===targetId||norm(card.dataset.name)===targetName)||cards.find(card=>{const hay=norm(`${card.dataset.name||''} ${card.textContent||''}`);return targetName&&hay.includes(targetName);})||null;
  }
  function routeToFamily(family){
    try{sessionStorage.setItem(PENDING_FAMILY_KEY,JSON.stringify({id:family.id,name:family.name,category:family.category}));}catch(e){}
    state.lastFamilyId=family.id;state.open=true;saveState();
    const url=new URL(location.origin+'/');url.searchParams.set('lff_family',family.id);location.href=url.toString();
  }
  function openAssistantFamily(family,{allowNavigate=true}={}){
    if(!family)return false;state.lastFamilyId=family.id;state.open=true;saveState();openAssistant();ensureAssistantLayer(true);
    const portal=categoryPortal(family.category);const portalButton=portal?document.querySelector(`[data-portal-open="${portal}"]`):null;
    if(!portalButton){if(allowNavigate)routeToFamily(family);return false;}
    portalButton.click();
    [60,260,700].forEach(ms=>setTimeout(()=>{ensureAssistantLayer(true);openAssistant();},ms));
    setTimeout(()=>{
      const card=findFamilyCard(family);
      if(!card){if(allowNavigate&&location.pathname!=='/')routeToFamily(family);return;}
      card.scrollIntoView({behavior:'smooth',block:'center'});setTimeout(()=>{card.click();ensureAssistantLayer(true);openAssistant();setTimeout(()=>{ensureAssistantLayer(true);openAssistant();},420);},280);
    },620);
    return true;
  }
  function instantReply(q){
    const s=norm(q);
    if(/^(hola+|holi+|hey+|ey+|buenas+|hola buenas|buenos dias|buenas tardes|buenas noches|que tal)$/.test(s))return pick(['¡Hola! 👋 ¿En qué puedo ayudarte?','¡Buenas! 😊 ¿Qué estás buscando?','¡Hola! Cuéntame, ¿qué necesitas?','¡Muy buenas! Dime, ¿qué te gustaría encontrar?'],s);
    if(/^(gracias+|muchas gracias|perfecto gracias|genial gracias|te lo agradezco)$/.test(s))return pick(['¡De nada! 😊','¡Para eso estoy!','¡Genial! Si necesitas otra cosa, dime.','¡A ti! 👌'],s);
    if(/^(adios|hasta luego|nos vemos|chao|ciao|hasta pronto)$/.test(s))return pick(['¡Hasta luego! 👋','¡Nos vemos!','¡Hasta pronto!'],s);
    return'';
  }
  function localReply(q){
    const s=norm(q);
    if(/sirenita|sirena ariel|ariel disney/.test(s))return "La Sirenita pertenece a Disney. Si no consigo abrir su familia, entra en Disney y busca La Sirenita; también puedes escribir Ariel.";
    if(/regalo|regalar|cumpleanos|cumple|hijo|hija|nieto|nieta|pareja|sobrino|amigo invisible|navidad|reyes/.test(s)){localTopic='gift';return "¡Te ayudo a acertar! Dime qué personaje, película, anime o videojuego le gusta. Si no lo sabes, dime su edad aproximada y si prefieres camiseta, sudadera o taza.";}
    if(/taza|tazas|mug|poster|posteres|lamina|cuadro|camiseta|sudadera|ropa|camisa/.test(s)){localTopic='products';return "Tenemos diseños en distintas clases de productos. Dime la saga o personaje que buscas y te llevo a su familia; las opciones reales se ven en cada ficha.";}
    if(/envio|enbio|entrega|portes|cuanto tarda|reparto|domicilio/.test(s)){localTopic='shipping';return "Los costes y opciones de envío dependen del destino y aparecen en el checkout. En algunas zonas también hay entrega en mano; consulta tu dirección antes de pagar.";}
    if(/devol|reembolso|cambio de talla|desistimiento/.test(s)){localTopic='returns';return "Consulta la Política de devoluciones en Nosotros & contacto. Para un caso concreto, soporte puede revisarlo.";}
    if(/pedido|seguimiento|tracking|paquete/.test(s)){localTopic='orders';return "Para consultar un pedido abre Seguir pedido. Si necesitas ayuda, contacta con soporte y ten a mano el número de pedido.";}
    if(/talla|medida|guia de talla/.test(s)){localTopic='sizes';return "En cada diseño elige Modelo, Color y Talla. Las medidas y combinaciones dependen del modelo seleccionado.";}
    if(/precio|cuanto cuesta|cuanto vale|precios|barato/.test(s)){localTopic='prices';return "El precio actualizado se muestra en la ficha de cada producto y en el checkout.";}
    if(/stock|agotado|disponib|existencias/.test(s)){localTopic='stock';return "La disponibilidad depende de cada artículo y variante. Selecciona Modelo, Color y Talla en la ficha.";}
    if(/descuento|cupon|codigo|promocion|oferta/.test(s)){localTopic='discounts';return "Si tienes un código promocional, introdúcelo en el checkout. Comprueba sus condiciones y fecha de validez.";}
    if(/pago|pagar|tarjeta|paypal|efectivo|dat[aá]fono/.test(s)){localTopic='payments';return "Los métodos disponibles se muestran en el checkout. No compartas datos bancarios en este chat.";}
    if(/arcade|llave|juego friki/.test(s)){localTopic='arcade';return "En Arcade puedes participar en juegos y consultar las recompensas vigentes dentro de esa sección.";}
    if(/club/.test(s)){localTopic='club';return "El Club Friki es nuestra zona de comunidad y novedades. Puedes consultar las opciones de registro allí.";}
    if(/b2b|mayorista|empresa|zona profesional|al por mayor/.test(s)){localTopic='b2b';return "Si tienes una tienda o empresa, entra en Tiendas para conocer la zona profesional y sus opciones.";}
    if(/whats|telefono|contact|persona|humano|soporte/.test(s)){localTopic='contact';return "Puedes escribirnos desde el enlace de WhatsApp del chat o entrando en Nosotros & contacto.";}
    if(/disney|pixar|marvel|videojuego|gaming|anime|manga|multiusos|peliculas|series/.test(s)){localTopic='categories';return "Tenemos Anime & Manga, Gaming, Disney y Multiusos. Dime una saga o un personaje y te llevaré a su familia sin adivinar.";}
    return "No quiero llevarte a una familia equivocada. ¿Me escribes el nombre de la saga o personaje, o me dices si necesitas ayuda con un pedido o regalo?";
  }

    async function getReply(question){
    const quick=instantReply(question);if(quick)return{reply:quick,mode:'instant'};
    const resolution=assistantFamilyResolution(question);
    if(resolution.ambiguous.length){return{reply:'He encontrado varias familias posibles: '+resolution.ambiguous.map(f=>f.name).join(', ')+'. ¿Cuál te interesa?',mode:'ambiguous'};}
    const family=resolution.family;
    if(family){
      return{reply:familyContextReply(question,family),mode:'family',family};
    }
    if(location.protocol==='http:'||location.protocol==='https:'){
      for(const endpoint of ENDPOINTS){
        try{
          const res=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({message:question,source:'store-assistant',shop:location.hostname,customerId:window.LFF_SHOPIFY_CUSTOMER_ID||null,threadId:state.threadId||null})});
          if(res.ok){const data=await res.json();if(data?.threadId){state.threadId=String(data.threadId);saveState();}if(data&&typeof data.reply==='string'&&data.reply.trim())return{reply:data.reply.trim(),mode:data.mode||'backend',intent:data.intent||''};}
        }catch(e){}
      }
    }
    return{reply:localReply(question),mode:'local'};
  }
  async function ask(question){
    const q=String(question||'').trim();if(!q)return;openAssistant();addMessage('user',q);input.value='';
    const typing=document.createElement('div');typing.className='aiTyping';typing.textContent='Asistente Friki está pensando…';body.appendChild(typing);body.scrollTop=body.scrollHeight;
    const result=await getReply(q);typing.remove();addMessage('bot',result.reply||'¿En qué puedo ayudarte?');
    if(result.family)setTimeout(()=>openAssistantFamily(result.family),480);
  }

  loadState();restoreConversation();refreshRuntimeFamilies(false);
  if(state.open)setTimeout(openAssistant,80);
  launcher.addEventListener('click',()=>panel.classList.contains('open')?closeAssistant():openAssistant());
  close?.addEventListener('click',closeAssistant);
  form.addEventListener('submit',e=>{e.preventDefault();ask(input.value)});
  panel.querySelectorAll('[data-ai-question]').forEach(b=>b.addEventListener('click',()=>ask(b.dataset.aiQuestion)));
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&panel.classList.contains('open'))closeAssistant()});
  window.addEventListener('lff:families-updated',()=>refreshRuntimeFamilies(true));
  window.addEventListener('lff:family-manager-data',e=>{const rows=e?.detail?.families;if(Array.isArray(rows))runtimeFamilies=rows;});

  /* V107 · Guardián de capa: si el usuario abre manualmente una categoría o
     una familia mientras el chat estaba abierto, lo mantenemos delante. */
  const assistantStorePortals=[...document.querySelectorAll('.categoryWorld,.lfAnimePreviewPage,.lfGamingPreviewPage,.lfDisneyPreviewPage,.lfMultiPreviewPage')];
  function assistantStorePortalActive(){
    return assistantStorePortals.some(el=>el.classList.contains('open')||el.getAttribute('aria-hidden')==='false');
  }
  function syncAssistantStorePortalLayer(){
    const active=assistantStorePortalActive();
    document.body.classList.toggle('lffAssistantStorePortalActive',active);
    ensureAssistantLayer(false);
    if(active&&state.open){ensureAssistantLayer(true);panel.classList.add('open');panel.setAttribute('aria-hidden','false');}
  }
  const assistantLayerObserver=new MutationObserver(()=>setTimeout(syncAssistantStorePortalLayer,0));
  assistantStorePortals.forEach(el=>assistantLayerObserver.observe(el,{attributes:true,attributeFilter:['class','aria-hidden','style']}));
  document.addEventListener('click',()=>setTimeout(syncAssistantStorePortalLayer,80),true);
  window.addEventListener('popstate',()=>setTimeout(syncAssistantStorePortalLayer,50));
  window.addEventListener('hashchange',()=>setTimeout(syncAssistantStorePortalLayer,50));
  syncAssistantStorePortalLayer();

  setTimeout(()=>{
    refreshRuntimeFamilies(false);
    const params=new URLSearchParams(location.search);let pendingId=params.get('lff_family')||'';
    if(!pendingId){try{pendingId=JSON.parse(sessionStorage.getItem(PENDING_FAMILY_KEY)||'null')?.id||'';}catch(e){}}
    if(!pendingId)return;
    const family=familyCandidates().find(f=>String(f.id)===String(pendingId));if(!family)return;
    try{sessionStorage.removeItem(PENDING_FAMILY_KEY);}catch(e){}
    if(params.has('lff_family')){params.delete('lff_family');const next=location.pathname+(params.toString()?`?${params}`:'')+location.hash;history.replaceState(null,'',next);}
    openAssistant();openAssistantFamily(family,{allowNavigate:false});
  },900);

  window.LFFAssistantV106={ask,findFamily:findAssistantFamily,openFamily:openAssistantFamily,stats:{familiasReconocidas:196,modo:'coincidencias verificables y respuestas dinamicas'}};
})();


