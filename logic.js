// Lakáskereső döntéstámogató: tiszta számoló logika, DOM és platform nélkül.
// Később önálló appba átvihető; minden szabály itt él, a felület csak megjeleníti.
(function (root) {
  "use strict";

  const SZABALY = {
    plafonM2: 1.5e6,          // Otthon Start: max bruttó 1,5 M Ft / m²
    erkelySuly: 0.5,          // erkély, terasz, loggia fele számít
    lakasPlafon: 100e6,       // Otthon Start ingatlan-értékhatár (lakás)
    hitelMax: 50e6,
    minOneroArany: 0.10,
    kamat: 0.03,              // fix 3%
    futamidoEv: 25,
    forras: "Otthon Start feltételek (OTP terméktájékoztató, money.hu), ellenőrizve 2026-10-20",
  };

  const RUBRIKA = [
    { k: "ar", nev: "Ár, finanszírozás", max: 20, mit: "teljes költség a kerethez, Otthon Start-plafon, m²-ár a környékhez" },
    { k: "meret", nev: "Méret, alaprajz", max: 15, mit: "min. 40 m², 2 szoba, konyha/étkező, home office hely, tárolás" },
    { k: "feny", nev: "Fény", max: 15, mit: "tájolás, emelet, takarás, erkély mélysége" },
    { k: "kozlek", nev: "Közlekedés", max: 15, mit: "metró, villamos, HÉV gyalogtávolsága, belváros elérése" },
    { k: "allapot", nev: "Állapot, épület", max: 15, mit: "tégla/panel/új, felújítottság, fűtés, lift, energetika, közös költség" },
    { k: "csend", nev: "Csend, környezet", max: 10, mit: "utcai/udvari, főút, zöld, szomszédság" },
    { k: "boltok", nev: "Boltok", max: 10, mit: "élelmiszer, orvos, park gyalog" },
  ];

  const FORRASOK = [
    [/ingatlan\.com/i, "ingatlan.com"],
    [/zenga\.hu/i, "Zenga"],
    [/oc\.hu|otthoncentrum/i, "Otthon Centrum"],
    [/dh\.hu|dunahouse/i, "Duna House"],
    [/jofogas\.hu/i, "Jófogás"],
    [/facebook\.com|fb\.com|fb\.me/i, "Facebook Marketplace"],
    [/otthonterkep\.hu/i, "Otthontérkép"],
    [/ingatlanbazar\.hu/i, "Ingatlanbazár"],
    [/cdc\.hu|cdcingatlan/i, "CDC"],
    [/remax\.hu/i, "RE/MAX"],
  ];

  function forrasOldal(url) {
    if (!url) return "kézi";
    for (const [re, nev] of FORRASOK) if (re.test(url)) return nev;
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return "egyéb"; }
  }

  // Stabil azonosító a linkből: forrás + hirdetésszám, különben rövid véletlen.
  function azonosito(url) {
    const src = forrasOldal(url);
    const pre = { "ingatlan.com": "ic", "Zenga": "zg", "Otthon Centrum": "oc", "Duna House": "dh", "Jófogás": "jf", "Facebook Marketplace": "fb" }[src] || "x";
    const m = (url || "").match(/([A-Z]?\d{5,})(?!.*\d{5,})/);
    const id = m ? m[1] : Math.random().toString(36).slice(2, 10);
    return pre + "-" + id;
  }

  function osTerulet(l) { return (+l.netto || 0) + (+l.erkely || 0) * SZABALY.erkelySuly; }

  function torleszto(hitel, kamat = SZABALY.kamat, ev = SZABALY.futamidoEv) {
    if (hitel <= 0) return 0;
    const r = kamat / 12, n = ev * 12;
    return hitel * r / (1 - Math.pow(1 + r, -n));
  }

  // keret: {onero, hitel, illetek, ugyved, egyeb} — M Ft és %
  function szamol(l, keret, ajanlatM) {
    const ar = ajanlatM ? ajanlatM * 1e6 : (+l.ar || 0);
    const terulet = osTerulet(l);
    const m2 = terulet ? ar / terulet : Infinity;
    const max = SZABALY.plafonM2 * terulet;
    const osOk = m2 <= SZABALY.plafonM2 + 1 && ar <= SZABALY.lakasPlafon;
    const hitel = osOk ? Math.min(keret.hitel * 1e6, ar * (1 - SZABALY.minOneroArany)) : 0;
    const koltseg = ar * (keret.illetek + keret.ugyved) / 100 + keret.egyeb * 1e6;
    const keszpenz = ar - hitel + koltseg;
    const havi = torleszto(hitel);
    const haviOssz = havi + (+l.kozos || 0) + (+l.rezsi || 0);
    return {
      ar, terulet, m2, max, osOk, hitel, koltseg, keszpenz, havi, haviOssz,
      tartalek: keret.onero * 1e6 - keszpenz,
      engedmeny: (+l.ar || 0) - max,
    };
  }

  // Súlyozott pontszám 0–100: minden szempont a saját maximumához mérve, a súlyok arányában.
  function pontszam(pontok, sulyok) {
    let s = 0, w = 0;
    for (const r of RUBRIKA) {
      const suly = sulyok && sulyok[r.k] != null ? +sulyok[r.k] : r.max;
      s += Math.max(0, Math.min(r.max, +((pontok || {})[r.k]) || 0)) / r.max * suly;
      w += suly;
    }
    return w ? Math.round(s / w * 100) : 0;
  }

  // Ugyanaz a lakás több portálon: hasonló méret és ár, egyező utcanév.
  function duplikatum(a, b) {
    if (!a || !b || a === b) return false;
    const utca = s => String(s || "").toLowerCase().split(/[ ,.]/)[0];
    const meret = Math.abs((+a.netto || 0) - (+b.netto || 0)) <= 1.5;
    const ar = Math.abs((+a.ar || 0) - (+b.ar || 0)) <= 0.04 * Math.max(+a.ar || 0, +b.ar || 0);
    return meret && ar && utca(a.cim) && utca(a.cim) === utca(b.cim);
  }

  const ELLENOR = [
    ["tulajdoni", "Tulajdoni lap: tehermentes, nincs haszonélvezet, végrehajtás, elidegenítési tilalom"],
    ["tartozas", "Közös költség tartozásmentességi igazolás a közös képviselőtől"],
    ["kozgyules", "Utolsó két közgyűlési jegyzőkönyv: tervezett felújítás, rendkívüli befizetés, felújítási alap"],
    ["vizes", "Vizesedés, penész: fürdő, ablaksarkok, mennyezet, bútorok mögött"],
    ["nyilaszaro", "Nyílászárók zárása, huzat, páralecsapódás"],
    ["villany", "Villany: biztosítéktábla, vezetékek kora; víznyomás a zuhanyban"],
    ["futes", "Fűtés és mérők: radiátorok, kazán kora, egyedi mérés"],
    ["zaj", "Zaj: nappal és este is megnézni, szomszédok, utca, lift"],
    ["net", "Mobiltérerő és internet-szolgáltatók"],
    ["kozos", "Lépcsőház, pince, tároló, kukatároló állapota"],
  ];

  function elemzoPrompt({ url, szoveg, keret, kepekSzama }) {
    const rub = RUBRIKA.map(r => `- ${r.k} (max ${r.max}): ${r.mit}`).join("\n");
    return `Magyar lakásvásárlási elemző vagy. Egy budapesti pár lakást keres: kb. ${keret.onero} M Ft önerő és legfeljebb ${keret.hitel} M Ft Otthon Start hitel (fix 3%).
Szempontjaik: legalább 40 m², modern, világos, csendes, jó tömegközlekedés és boltok a közelben, részben otthonról dolgoznak.

Feladat: a lenti hirdetésből${kepekSzama ? ` és a ${kepekSzama} csatolt képernyőképből` : ""} nyerd ki az adatokat, és pontozd a lakást.

Szabályok:
- Tényként csak azt írd, ami a hirdetésben szerepel. Ami hiányzik, az null legyen, és kerüljön a "hianyzo" listába.
- Ha pontozáskor a környék általános ismeretére támaszkodsz, az indoklás kezdődjön így: "BECSLÉS:".
- Számot ne találj ki. Az ár forintban, egész számként (pl. 69900000).
- Otthon Start-plafon: vételár / (nettó m² + erkély m² fele) legfeljebb 1 500 000 Ft/m². Ha ez fölötte van, az "ar" pontszám legyen alacsonyabb, és írd meg, mennyit kell lealkudni.
- Piros zászló például: haszonélvezet, végrehajtás, osztatlan közös tulajdon, beázás, földszinti utcai lakás, gázkonvektor magas rezsivel, „befektetőknek” hirdetés, sürgős eladás ok nélkül, túl alacsony ár.

Pontozás:
${rub}

Válaszolj CSAK egy JSON objektummal, pontosan ezekkel a kulcsokkal:
{"cim":"utca, házszám ha van","kerulet":"pl. XIII. ker., Angyalföld","ar":69900000,"netto":56,"erkely":11,"szobak":"2","emelet":"3. / 3","tajolas":"DK","kilatas":"udvari","epult":"2019","tipus":"tégla","futes":"házközponti, egyedi mérés","energia":"C","kozos":23000,"rezsi":null,"hirdeto":"magánszemély vagy iroda neve","pontok":{"ar":0,"meret":0,"feny":0,"kozlek":0,"allapot":0,"csend":0,"boltok":0},"indok":{"ar":"1-2 mondat","meret":"","feny":"","kozlek":"","allapot":"","csend":"","boltok":""},"plusz":["..."],"minusz":["..."],"piros":["..."],"kerdesek":["kérdések a hirdetőnek"],"hianyzo":["hiányzó adatok"]}

Hirdetés linkje: ${url || "nincs megadva"} (forrás: ${forrasOldal(url)})
Hirdetés szövege:
<<<
${(szoveg || "(nincs szöveg, csak képernyőkép)").slice(0, 24000)}
>>>`;
  }

  function alkuPrompt(l, sz) {
    return `Írj egy rövid, udvarias, magyar nyelvű üzenetet a hirdetőnek egy budapesti lakásról. Egy pár írja, akik Otthon Start hitellel vásárolnának.
Cél: a lakást megnéznék, és jeleznék, hogy a hitel miatt legfeljebb ${(sz.max / 1e6).toFixed(2).replace(".", ",")} M Ft-os vételárat tudnak elfogadni (Otthon Start: legfeljebb 1,5 M Ft/m², a terület ${sz.terulet.toLocaleString("hu-HU")} m² az erkély felével). A hirdetési ár ${(l.ar / 1e6).toFixed(2).replace(".", ",")} M Ft.
Szabályok: csak az alábbi tényeket használd, ne találj ki semmit a lakásról. Ne sürgess, ne fenyegess, ne írj hamis indokot. Tegezés nélkül, magázva. Legfeljebb 120 szó. Aláírás helyén: [nevetek].
Ha a hirdetési ár már a plafon alatt van, akkor ne alkudj, csak kérj időpontot, és tedd fel a két legfontosabb kérdést.
Tények: ${JSON.stringify({ cim: l.cim, kerulet: l.kerulet, netto: l.netto, erkely: l.erkely, emelet: l.emelet, kerdesek: (l.kerdesek || []).slice(0, 3) })}
Csak az üzenet szövegét add vissza.`;
  }

  function dontesPrompt(sorok, keret) {
    return `Egy budapesti pár lakást választ (kb. ${keret.onero} M Ft önerő, legfeljebb ${keret.hitel} M Ft Otthon Start hitel; a hitel csak akkor jár, ha a vételár legfeljebb 1,5 M Ft/m², az erkély fele beszámít). Az Otthon Start 2027-ben megszűnik, a megkötött szerződések maradnak.
Az alábbi lakásokat már pontozták. Adj rövid döntési javaslatot magyarul:
1. Melyik a legjobb választás most, és miért (2-3 mondat).
2. Melyiket érdemes először megnézni, és mit kell ott ellenőrizni.
3. Hol van értelme alkudni, mennyit, és mi a reális esély.
4. Melyiket hagynád el, és miért.
Csak a megadott adatokra támaszkodj; ahol becsülsz, írd oda: becslés. Legfeljebb 250 szó, egyszerű bekezdésekben, Markdown-jelölés nélkül.
Lakások: ${JSON.stringify(sorok)}`;
  }

  root.LK = { SZABALY, RUBRIKA, ELLENOR, forrasOldal, azonosito, osTerulet, torleszto, szamol, pontszam, duplikatum, elemzoPrompt, alkuPrompt, dontesPrompt };
})(typeof window !== "undefined" ? window : globalThis);
