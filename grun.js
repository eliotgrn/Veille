/* GRÜN — noyau commun à tous les modules (chargé AVANT le script du module).
   Tout est stocké sur l'appareil (localStorage). Demain : comptes + base en ligne branchés ici (G.sync).
   Règle : un module ne lit/écrit JAMAIS directement les joueurs, groupes, journal, banque perso, tests perso :
   il passe par GRUN.*. Ses propres données (séances, plans, routines…) restent sous sa clé historique. */
(function () {
  "use strict";
  const G = (window.GRUN = {});
  G.version = "1.4"; G.versionDate = "16 oct.";

  /* ---------- stockage ---------- */
  G.load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  G.save = (k, o) => { try { localStorage.setItem(k, JSON.stringify(o)); emit(k); return true; } catch (e) { console.warn("GRUN.save", k, e); return false; } };
  G.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  G.today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
  G.esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  G.frD = s => s ? String(s).slice(0, 10).split("-").reverse().join("/") : "";

  /* Clés : les clés historiques sont gardées (reprise automatique des données des anciennes applis, même origine). */
  G.K = {
    joueurs: "grilles_joueurs_v1",     // {joueurs:[Joueur]}  (partagé depuis l'appli Grilles)
    groupes: "grun_groupes_v1",        // {groupes:[Groupe]}
    journal: "grun_journal_v1",        // {retours:[Retour], forme:[Forme]}
    banque: "grun_banque_v1",          // {perso:[Exo], over:{id:patch}, fav:[id], hide:[id]}
    tests: "grun_tests_v1",            // {perso:[Test], over:{id:patch}}
    handoff: "grun_handoff_v1",        // passage de relais entre modules (poupée russe)
    mode: "grun_mode_v1",              // {m:"coach"|"joueur", jid}
    reglages: "grun_reglages_v1",      // {theme, fs, nomCoach}
    objectifs: "grun_objectifs_v1",    // {obj:[Objectif]}  objectifs suivis par joueur
    presences: "grun_presences_v1",    // {s:{cle:Seance de groupe pointée}}  assiduité
    // données propres aux modules (inchangées) :
    veille: "veille_v1", banqueDocs: "banque_v1", grillesDocs: "grilles_docs_v1", saisons: "saisons_v1",
    prog: "programmation_v1", progCache: "programmation_cache_v1", seances: "seances_v1", routines: "routines_v1",
    radar: "radar_joueurs_v1",
    questions: "grun_questions_v1",    // questions posées à l'Assistant GRÜN (assistant.js)
    courant: "grun_courant_v1"         // {c:{t:"j"|"g",id}, rec:[{t,id}], dernier:{titre,href,date}}  joueur/groupe en cours (socle 1.1)
  };

  /* 1.4 · vocabulaire professionnel : libellés DÉJÀ ENREGISTRÉS mis à jour (« Mes exos » → « Mes exercices », « Exo sans nom », plans « Prog du … »).
     Seuls des libellés affichés changent : identifiants, clés et contenus restent intacts ; sans effet s'il n'y a rien à changer. */
  (function migrer14() { try {
    const b = G.load(G.K.banque, null); if (b && Array.isArray(b.perso)) { let ch = false;
      for (const x of b.perso) { if (!x) continue; if (x.s === "Mes exos") { x.s = "Mes exercices"; ch = true; } if (x.n === "Exo sans nom") { x.n = "Exercice sans nom"; ch = true; } }
      if (ch) localStorage.setItem(G.K.banque, JSON.stringify(b)); }
    const p = G.load(G.K.prog, null); if (p && typeof p === "object") { let ch = false;
      for (const L of [p.plans, p.brouillons]) for (const x of (Array.isArray(L) ? L : [])) if (x && typeof x.nom === "string" && /^Prog\b/.test(x.nom)) { x.nom = x.nom.replace(/^Prog\b/, "Programmation"); ch = true; }
      if (ch) localStorage.setItem(G.K.prog, JSON.stringify(p)); }
  } catch (e) { console.warn("GRUN.migrer14", e); } })();

  /* ---------- évènements (même page + autres onglets) ---------- */
  const L = {};
  function emit(k) { (L[k] || []).forEach(f => { try { f(); } catch (e) { console.error(e); } }); }
  G.on = (k, f) => { (L[k] ||= []).push(f); };
  addEventListener("storage", e => { if (e.key) emit(e.key); });

  /* ---------- modules et pôles ---------- */
  G.POLES = [
    { id: "ind", t: "Individualisation", s: "Le dossier complet de chaque joueur et de chaque groupe", c: "#0F766E" },
    { id: "create", t: "Create", s: "Programmation, séance, échauffement : construits pour le joueur", c: "#C2410C" },
    { id: "res", t: "Ressources et savoirs", s: "Veille, banque d'exercices, référentiel de programmation", c: "#1D4ED8" },
    { id: "tests", t: "Tests et profilage", s: "Grilles de compétences, tests, profil radar", c: "#6D3FC0" }
  ];
  G.MODS = {
    accueil: { f: "index.html", t: "Accueil", pole: null },
    joueurs: { f: "index.html", h: "#/joueurs", t: "Individualisation", pole: "ind" },
    prog: { f: "prog.html", t: "Create my prog", pole: "create", s: "Programmation adaptée au joueur : semaine, cycle ou saison" },
    seances: { f: "seances.html", t: "Create my session", pole: "create", s: "Structure automatique, exercices choisis dans la banque" },
    warmup: { f: "warmup.html", t: "Choose your warm-up", pole: "create", s: "30 échauffements performance prêts à lancer, modifiables" },
    veille: { f: "veille.html", t: "Veille de connaissances", pole: "res", s: "230 documents : âge, préparation physique, biomécanique, entraîner" },
    banque: { f: "banque.html", t: "Banque d'exercices", pole: "res", s: "Tous les exercices, jeux et situations, plus les tiens" },
    saisons: { f: "saisons.html", t: "Référentiel de programmation", pole: "res", s: "Les saisons de référence de la méthode, 4 à 18 ans" },
    grilles: { f: "grilles.html", t: "Grilles et tests", pole: "tests", s: "Grilles de compétences 4-18 ans, tests, barèmes, bilans, profil radar" }
  };
  /* version « appli seule » d'un module (window.GRUN_SEUL = {mod, base}) : ses propres pages restent locales, les autres modules ouvrent GRÜN en ligne */
  const SEUL = window.GRUN_SEUL || null; G.seul = SEUL;
  G.href = (mod, hash) => { const m = G.MODS[mod]; const h = hash != null ? (String(hash).startsWith("#") ? hash : "#" + hash) : (m && m.h || "");
    if (SEUL) { if (mod === SEUL.mod) return "index.html" + h; return SEUL.base + (m ? m.f : "index.html") + h; }
    if (!m) return "index.html"; return m.f + h; };
  G.go = (mod, hash) => { location.href = G.href(mod, hash); };

  /* ---------- mode coach / joueur ---------- */
  G.mode = () => G.load(G.K.mode, { m: "coach", jid: null });
  G.setMode = (m, jid) => G.save(G.K.mode, { m, jid: jid || null });
  G.isJoueur = () => G.mode().m === "joueur";
  /* profil d'utilisation : "coach" (défaut) ou "autonome" (joueur sans coach, son propre profil jidMoi) */
  G.reglages = () => G.load(G.K.reglages, {});
  G.profil = () => G.reglages().profil || "coach";
  G.moi = () => G.reglages().jidMoi || null;
  G.isAutonome = () => G.profil() === "autonome";
  /* mode simple (défaut : l'essentiel) / mode expert (tout : surcouches, barèmes détaillés, détails du moteur, codes, options avancées).
     Réglage grun_reglages_v1.expert ; chaque module le lit par GRUN.expert(). En mode simple, tout élément de classe « xp » est masqué (grun.css). */
  G.expert = () => !!G.reglages().expert;
  G.setExpert = on => { const r = G.reglages(); r.expert = !!on; G.save(G.K.reglages, r); };
  /* thème, taille du texte et mode expert, appliqués à chaque module */
  function appliquerReglages() { const r = G.reglages(); const h = document.documentElement;
    if (r.theme === "light" || r.theme === "dark") h.setAttribute("data-theme", r.theme); else if (r.theme === "auto") h.removeAttribute("data-theme");
    if (r.fs && +r.fs !== 100) { h.style.setProperty("--grun-fs", r.fs / 100); h.style.fontSize = r.fs + "%"; }
    h.classList.toggle("grun-expert", !!r.expert); h.classList.toggle("grun-simple", !r.expert); }
  appliquerReglages();

  /* ---------- NOMS EN CLAIR (aucun code interne affiché) ---------- */
  G.LIGNES = {
    PP: ["Force du bas du corps", "Force du haut du corps", "Gainage et stabilité du tronc", "Puissance des jambes : sauts et pliométrie", "Puissance du haut du corps et rotation", "Vitesse et accélération", "Freinage, changements de direction et agilité", "Endurance aérobie", "Répétition d'efforts intenses", "Coordination, motricité fondamentale et rythme", "Équilibre et proprioception", "Mobilité et souplesse"],
    GE: ["Service à plat", "Service slicé", "Service lifté", "Coup droit lifté", "Coup droit à plat", "Coup droit slicé", "Revers lifté", "Revers à plat", "Revers slicé", "Volée de coup droit", "Volée de revers", "Smash", "Amortie et touché de balle"],
    DE: ["Position d'attention", "Allègement et reprise d'appuis", "Démarrage et premiers pas", "Déplacements latéraux", "Déplacements vers l'avant et vers l'arrière", "Pas d'ajustement et mise à distance", "Appuis de frappe", "Freinage et décélération", "Changement de direction et réaccélération", "Replacement", "Enchaînements et liaison des actions"]
  };
  G.DOMAINES = { PP: "Préparation physique", GE: "Geste", DE: "Déplacement" };
  /* « PP6 » → « Vitesse et accélération » (un code inconnu est rendu tel quel) */
  G.ligne = code => { const m = /^(PP|GE|DE)(\d+)$/.exec(String(code || "").trim()); return m ? (G.LIGNES[m[1]][+m[2] - 1] || code) : code; };
  G.lignesTxt = (L, sep) => (Array.isArray(L) ? L : []).map(G.ligne).join(sep || " · ");
  G.ETAPES = { MR: "Mise en route", MO: "Mobilité", AC: "Activation", CV: "Coordination et vitesse", PO: "Mise en tension", ST: "Spécifique tennis" };
  G.etape = c => G.ETAPES[c] || c;
  /* textes des documents (veille, grilles, saisons) : en mode simple, « PP1 Force du bas du corps » devient « Force du bas du corps »
     et un code seul (« PP6 ») devient le nom de la ligne. Rien ne change en mode expert. */
  const RXL = /\b(PP|GE|DE)(1[0-3]|[1-9])\b(\s*[·:–]\s*|\s+)?/g;
  G.clair = root => {
    if (!root || G.expert()) return;
    const W = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentNode && /^(SCRIPT|STYLE|TEXTAREA|INPUT|CODE)$/.test(n.parentNode.nodeName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    const L = []; while (W.nextNode()) if (/\b(PP|GE|DE)\d/.test(W.currentNode.nodeValue)) L.push(W.currentNode);
    for (const n of L) { const apres = ((n.nextSibling || (n.parentNode && n.parentNode.nextSibling) || {}).textContent || "").trimStart();
      n.nodeValue = n.nodeValue.replace(RXL, (m, d, k, sep, off, str) => { const nom = (G.LIGNES[d] || [])[+k - 1]; if (!nom) return m;
        let reste = str.slice(off + m.length); if (!reste.trim()) reste = apres; return reste.startsWith(nom) ? "" : nom + (sep ? (/[·:–]/.test(sep) ? " · " : " ") : ""); }); }
    /* identifiants d'exercices cités dans un texte (FOR-0021…) : remplacés par le nom de l'exercice, qui ouvre sa fiche dans la banque */
    const W2 = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), E = [];
    while (W2.nextNode()) { const n = W2.currentNode; if (/\b[A-Z]{3}-\d{4}\b/.test(n.nodeValue) && !(n.parentNode && n.parentNode.closest && n.parentNode.closest("a,code,textarea"))) E.push(n); }
    if (E.length) G.banque.load().then(B => { for (const n of E) { if (!n.parentNode) continue; const f = document.createDocumentFragment(); let last = 0; const t = n.nodeValue;
      t.replace(/\b[A-Z]{3}-\d{4}\b/g, (id, off) => { const e = B.byId[id]; if (!e) return id; f.appendChild(document.createTextNode(t.slice(last, off))); const a = document.createElement("a"); a.className = "ref"; a.href = G.href("banque", "#/ex/" + id); a.textContent = e.n; f.appendChild(a); last = off + id.length; return id; });
      f.appendChild(document.createTextNode(t.slice(last))); n.parentNode.replaceChild(f, n); } }).catch(() => {});
  };

  /* ---------- JOUEURS ----------
     Joueur = {id, nom, sexe:"F"|"G", naissance:"AAAA-MM-JJ", groupe:"texte libre (ancien)", notes,
       bilans:[{id,date,age,note,v:{PP:[],GE:[],DE:[]},sel:[],res:{}}], cur,         // grilles (module Grilles)
       main:"D"|"G", revers:"1"|"2", classement:"NC"|"40"|…, croissance:bool, zones:[], prio:[], objectifs:"",
       dispo:{pp:n, tennis:n}, mesures:[{date,taille,assise,poids,envergure}], blessures:[{id,debut,fin,zone,desc,statut}],
       agenda:[{id,date,fin,type:"tournoi"|"bilan"|"seance"|"repos"|"autre",titre,ref}], favWarmup:[idRoutine], cree, maj } */
  const JDEF = { groupe: "", notes: "", bilans: [], main: "D", revers: "2", classement: "NC", croissance: false, zones: [], prio: [], objectifs: "", dispo: {}, mesures: [], blessures: [], agenda: [], favWarmup: [] };
  function jstore() { const s = G.load(G.K.joueurs, { joueurs: [] }); if (!Array.isArray(s.joueurs)) s.joueurs = []; return s; }
  function norm(j) { for (const k in JDEF) if (j[k] == null) j[k] = JSON.parse(JSON.stringify(JDEF[k])); return j; }
  G.joueurs = {
    all(o) { return jstore().joueurs.filter(j => (o && o.archives) || !j.archive).map(norm).sort((a, b) => a.nom.localeCompare(b.nom, "fr")); },
    get(id) { const j = jstore().joueurs.find(x => x.id === id); return j ? norm(j) : null; },
    save(j) { const s = jstore(); const i = s.joueurs.findIndex(x => x.id === j.id); j.maj = G.today(); if (i < 0) s.joueurs.push(j); else s.joueurs[i] = j; return G.save(G.K.joueurs, s); },
    create(f) { const j = norm({ id: G.uid(), nom: (f.nom || "").trim() || "Sans nom", sexe: f.sexe === "F" ? "F" : "G", naissance: f.naissance || "", cree: G.today(), ...f }); j.id = j.id || G.uid(); G.joueurs.save(j); return j; },
    update(id, patch) { const j = G.joueurs.get(id); if (!j) return null; Object.assign(j, patch); G.joueurs.save(j); return j; },
    /* SUPPRESSION DÉFINITIVE : la fiche + tout ce qui ne concerne que lui (journal, plans individuels, séances et routines dont il est le seul joueur) ;
       il est retiré des groupes, des séances et routines partagées. */
    remove(id) {
      const s = jstore(); s.joueurs = s.joueurs.filter(x => x.id !== id); G.save(G.K.joueurs, s);
      const g = gstore(); g.groupes.forEach(x => x.jids = x.jids.filter(y => y !== id)); G.save(G.K.groupes, g);
      const J = G.load(G.K.journal, null); if (J) { J.retours = (J.retours || []).filter(r => r.jid !== id); J.forme = (J.forme || []).filter(r => r.jid !== id); G.save(G.K.journal, J); }
      const P = G.load(G.K.prog, null); if (P) { if (Array.isArray(P.plans)) P.plans = P.plans.filter(p => p.jid !== id); if (Array.isArray(P.brouillons)) P.brouillons = P.brouillons.filter(p => p.jid !== id); if (P.profils) delete P.profils[id]; G.save(G.K.prog, P); }
      const C = G.load(G.K.progCache, null); if (C && typeof C === "object") { for (const k in C) if (C[k] && C[k].jid === id) delete C[k]; G.save(G.K.progCache, C); }
      const S = G.load(G.K.seances, null); if (S && Array.isArray(S.seances)) { S.seances = S.seances.filter(x => !(Array.isArray(x.joueurs) && x.joueurs.length === 1 && x.joueurs[0] === id && !x.gid)); S.seances.forEach(x => { if (Array.isArray(x.joueurs)) x.joueurs = x.joueurs.filter(y => y !== id); }); G.save(G.K.seances, S); }
      const R = G.load(G.K.routines, null); if (R && typeof R === "object") { if (!Array.isArray(R.routines)) R.routines = []; R.routines = R.routines.filter(x => !(Array.isArray(x.jids) && x.jids.length === 1 && x.jids[0] === id && !x.gid)); R.routines.forEach(x => { if (Array.isArray(x.jids)) x.jids = x.jids.filter(y => y !== id); }); if (Array.isArray(R.hist)) R.hist = R.hist.filter(h => h.jid !== id && h.who !== id); if (R.profil) delete R.profil[id]; G.save(G.K.routines, R); }
      const D = G.load(G.K.grillesDocs, null); if (D && Array.isArray(D.gbs)) { D.gbs.forEach(x => { if (Array.isArray(x.jids)) x.jids = x.jids.filter(y => y !== id); }); G.save(G.K.grillesDocs, D); }
      const C2 = G.load(G.K.progCache, null); if (C2 && typeof C2 === "object") { for (const k in C2) if (C2[k] && Array.isArray(C2[k].jids)) C2[k].jids = C2[k].jids.filter(y => y !== id); G.save(G.K.progCache, C2); }
      const O = G.load(G.K.objectifs, null); if (O && Array.isArray(O.obj)) { O.obj = O.obj.filter(x => x.jid !== id); G.save(G.K.objectifs, O); }
      const Pr = G.load(G.K.presences, null); if (Pr && Pr.s) { for (const k in Pr.s) { const x = Pr.s[k]; if (x && x.p) delete x.p[id]; if (x && x.p && !Object.keys(x.p).length) delete Pr.s[k]; } G.save(G.K.presences, Pr); }
      const Rg = G.reglages(); if (Rg.jidMoi === id) { delete Rg.jidMoi; G.save(G.K.reglages, Rg); }
      const M = G.mode(); if (M.jid === id) G.setMode("coach", null);
      const Cu = G.load(G.K.courant, null); if (Cu) { if (Cu.c && Cu.c.id === id) Cu.c = null; Cu.rec = (Cu.rec || []).filter(x => x.id !== id); if (Cu.dernier && String(Cu.dernier.href || "").includes(id)) Cu.dernier = null; G.save(G.K.courant, Cu); }
    },
    /* ARCHIVER (« je ne l'entraîne plus ») : il disparaît de toutes les listes, son dossier reste consultable et restaurable. */
    archiver(id, oui = true) { return G.joueurs.update(id, { archive: !!oui, archiveLe: oui ? G.today() : null }); },
    archives() { return jstore().joueurs.filter(j => j.archive).map(norm).sort((a, b) => a.nom.localeCompare(b.nom, "fr")); },
    /* retrouver ou créer (réception d'un envoi) */
    ensure(f) { const s = jstore(); let j = s.joueurs.find(x => x.id === f.id) || s.joueurs.find(x => x.nom === f.nom && (x.naissance || "") === (f.naissance || "")); return j ? norm(j) : G.joueurs.create(f); }
  };
  G.on(G.K.joueurs, () => emit("grun:joueurs"));
  G.on(G.K.reglages, appliquerReglages);

  /* âge civil (entier) et décimal */
  G.ageCiv = (nai, ref) => { if (!nai) return null; const a = new Date(nai), r = new Date(ref || G.today()); let y = r.getFullYear() - a.getFullYear(); if (r.getMonth() < a.getMonth() || (r.getMonth() === a.getMonth() && r.getDate() < a.getDate())) y--; return y; };
  /* adulte : case cochée sur la fiche (j.adulte) ou 19 ans et plus. Grille de référence adulte = 18 ans. */
  G.adulte = () => false; /* GRÜN = 4-18 ans uniquement (décision du 15 oct. 23 h 12) ; les adultes auront leur propre appli « GRÜN Adulte » */
  G.ageDec = (nai, ref) => nai ? (new Date(ref || G.today()) - new Date(nai)) / (365.25 * 864e5) : null;

  /* ---------- MATURATION (âge biologique) ----------
     Décalage de maturité (Mirwald) à partir de la taille, de la taille assise, du poids et de l'âge ;
     âge du pic de croissance (APHV) = âge − décalage ; âge biologique = âge + (APHV de référence − APHV du joueur),
     références de la méthode : filles ≈ 12 ans, garçons ≈ 14 ans. Sans taille assise : formule de Moore (taille ou taille assise). */
  G.REF_APHV = { F: 12.0, G: 14.0 };
  G.maturite = (j, m) => {
    if (G.adulte(j)) return null;
    m = m || (j.mesures || []).filter(x => x.taille).sort((a, b) => a.date < b.date ? 1 : -1)[0];
    if (!m || !j.naissance) return null;
    const A = G.ageDec(j.naissance, m.date), H = +m.taille, SH = +m.assise || null, W = +m.poids || null;
    if (!A || !H) return null;
    let off = null, methode = "";
    if (SH && W) {
      const LL = H - SH;
      off = j.sexe === "F"
        ? -9.376 + 0.0001882 * (LL * SH) + 0.0022 * (A * LL) + 0.005841 * (A * SH) - 0.002658 * (A * W) + 0.07693 * (W / H * 100)
        : -9.236 + 0.0002708 * (LL * SH) - 0.001663 * (A * LL) + 0.007216 * (A * SH) + 0.02292 * (W / H * 100);
      methode = "taille, taille assise, poids";
    } else if (j.sexe === "F") { off = -7.709133 + 0.0042232 * (A * H); methode = "taille seule (estimation)"; }
    else if (SH) { off = -8.1 + 0.0070346 * (A * SH); methode = "taille assise (estimation)"; }
    else return null;
    const aphv = A - off, bio = A + (G.REF_APHV[j.sexe] - aphv);
    const statut = off < -1 ? "avant le pic" : off <= 1 ? "autour du pic (zone sensible)" : "après le pic";
    const avance = aphv < G.REF_APHV[j.sexe] - 1 ? "précoce" : aphv > G.REF_APHV[j.sexe] + 1 ? "tardif" : "dans la moyenne";
    return { date: m.date, age: A, decalage: off, aphv, bio, grille: Math.max(4, Math.min(18, Math.round(bio))), statut, avance, methode };
  };
  /* vitesse de croissance (cm/an) entre les 2 dernières mesures espacées d'au moins 3 mois */
  G.vitesseCroissance = j => {
    const M = (j.mesures || []).filter(x => x.taille).sort((a, b) => a.date < b.date ? -1 : 1); if (M.length < 2) return null;
    const b = M[M.length - 1]; let a = null; for (let i = M.length - 2; i >= 0; i--) { if ((new Date(b.date) - new Date(M[i].date)) / 864e5 >= 90) { a = M[i]; break; } }
    if (!a) return null; const ans = (new Date(b.date) - new Date(a.date)) / (365.25 * 864e5); return (b.taille - a.taille) / ans;
  };
  /* grille conseillée : âge biologique si mesures, sinon âge civil */
  G.grilleConseillee = j => { if (G.adulte(j)) return 18; const m = G.maturite(j); if (m) return m.grille; const a = G.ageCiv(j.naissance); return a == null ? null : Math.max(4, Math.min(18, a)); };

  /* ---------- GROUPES ---------- Groupe = {id, nom, jids:[], notes, couleur, cree} */
  function gstore() { const s = G.load(G.K.groupes, { groupes: [] }); if (!Array.isArray(s.groupes)) s.groupes = []; return s; }
  G.groupes = {
    all() { return gstore().groupes.sort((a, b) => a.nom.localeCompare(b.nom, "fr")); },
    get(id) { return gstore().groupes.find(x => x.id === id) || null; },
    save(g) { const s = gstore(); const i = s.groupes.findIndex(x => x.id === g.id); if (i < 0) s.groupes.push(g); else s.groupes[i] = g; return G.save(G.K.groupes, s); },
    create(f) { const g = { id: G.uid(), nom: (f.nom || "").trim() || "Groupe", jids: f.jids || [], notes: f.notes || "", cree: G.today() }; G.groupes.save(g); return g; },
    remove(id) { const s = gstore(); s.groupes = s.groupes.filter(x => x.id !== id); G.save(G.K.groupes, s);
      const Cu = G.load(G.K.courant, null); if (Cu) { if (Cu.c && Cu.c.id === id) Cu.c = null; Cu.rec = (Cu.rec || []).filter(x => x.id !== id); G.save(G.K.courant, Cu); }
      const Pr = G.load(G.K.presences, null); if (Pr && Pr.s) { let n = 0; for (const k in Pr.s) if (Pr.s[k] && Pr.s[k].gid === id) { delete Pr.s[k]; n++; } if (n) G.save(G.K.presences, Pr); } },
    joueurs(id) { const g = G.groupes.get(id); return g ? g.jids.map(G.joueurs.get).filter(j => j && !j.archive) : []; },   // un joueur archivé n'apparaît plus dans son groupe
    de(jid) { return gstore().groupes.filter(g => g.jids.includes(jid)); }
  };

  /* ---------- JOURNAL ----------
     Retour = {id, jid, date, type:"seance"|"warmup"|"tennis"|"match"|"autre", ref (id séance/routine), titre, duree (min), rpe (0-10), douleur:{zone,int}|null, fait:true|false|"partiel", comment}
     Forme  = {id, jid, date, sommeil, fatigue, courbatures, stress, humeur (tous de 1 à 5, 5 = MEILLEUR état : fatigue 5 = plein d'énergie), douleur:{zone,int}|null, comment}
     Charge d'une séance = rpe × durée (UA). Aiguë = somme 7 j ; chronique = moyenne hebdo sur 28 j ; ratio aigu/chronique. */
  function jr() { const s = G.load(G.K.journal, { retours: [], forme: [] }); s.retours ||= []; s.forme ||= []; return s; }
  G.journal = {
    retours(jid) { return jr().retours.filter(r => !jid || r.jid === jid).sort((a, b) => a.date < b.date ? 1 : -1); },
    forme(jid) { return jr().forme.filter(r => !jid || r.jid === jid).sort((a, b) => a.date < b.date ? 1 : -1); },
    addRetour(r) { const s = jr(); r.id ||= G.uid(); r.date ||= G.today(); const i = s.retours.findIndex(x => x.id === r.id); if (i < 0) s.retours.push(r); else s.retours[i] = r; G.save(G.K.journal, s); return r; },
    addForme(f) { const s = jr(); f.id ||= G.uid(); f.date ||= G.today(); const i = s.forme.findIndex(x => x.jid === f.jid && x.date === f.date); if (i < 0) s.forme.push(f); else s.forme[i] = { ...s.forme[i], ...f }; G.save(G.K.journal, s); return f; },
    remove(id) { const s = jr(); s.retours = s.retours.filter(x => x.id !== id); s.forme = s.forme.filter(x => x.id !== id); G.save(G.K.journal, s); },
    charge(jid, ref) {
      const R = jr().retours.filter(r => r.jid === jid && r.rpe != null && r.duree), end = new Date(ref || G.today());
      const days = n => R.filter(r => { const d = (end - new Date(r.date)) / 864e5; return d >= 0 && d < n; }).reduce((a, r) => a + r.rpe * r.duree, 0);
      const prem = R.length ? R.map(r => r.date).sort()[0] : null, recul = prem ? (end - new Date(prem)) / 864e5 : 0;
      const aigu = days(7), chron = days(28) / 4, ratio = chron && recul >= 21 ? aigu / chron : null;
      const alerte = ratio == null ? null : ratio > 1.5 ? "haute" : ratio > 1.3 ? "attention" : ratio < 0.8 ? "basse" : "ok";
      const semaines = []; for (let k = 11; k >= 0; k--) { const e = new Date(end - k * 7 * 864e5); semaines.push({ fin: e.toISOString().slice(0, 10), ua: R.filter(r => { const d = (e - new Date(r.date)) / 864e5; return d >= 0 && d < 7; }).reduce((a, r) => a + r.rpe * r.duree, 0) }); }
      return { aigu, chronique: chron, ratio, alerte, semaines };
    }
  };


  /* ---------- OBJECTIFS SUIVIS ----------
     Objectif = {id, jid, txt, ech:"AAAA-MM-JJ"|"", statut:"encours"|"atteint"|"abandonne", cree, maj}
     (le champ texte j.objectifs de la fiche reste l'objectif général) */
  function ostore() { const s = G.load(G.K.objectifs, { obj: [] }); if (!Array.isArray(s.obj)) s.obj = []; return s; }
  G.OBJ_STATUTS = { encours: "En cours", atteint: "Atteint", abandonne: "Abandonné" };
  G.objectifs = {
    de(jid) { const o = { encours: 0, atteint: 1, abandonne: 2 }; return ostore().obj.filter(x => x.jid === jid).sort((a, b) => ((o[a.statut] || 0) - (o[b.statut] || 0)) || String(a.ech || "9").localeCompare(String(b.ech || "9"))); },
    add(f) { const s = ostore(); const x = { id: G.uid(), jid: f.jid, txt: String(f.txt || "").trim(), ech: f.ech || "", statut: f.statut || "encours", cree: G.today() }; if (!x.jid || !x.txt) return null; s.obj.push(x); G.save(G.K.objectifs, s); return x; },
    update(id, patch) { const s = ostore(); const x = s.obj.find(y => y.id === id); if (!x) return null; Object.assign(x, patch, { maj: G.today() }); G.save(G.K.objectifs, s); return x; },
    remove(id) { const s = ostore(); s.obj = s.obj.filter(x => x.id !== id); G.save(G.K.objectifs, s); }
  };

  /* ---------- ASSIDUITÉ (présences aux séances de groupe) ----------
     grun_presences_v1 = {s:{ cle: {cle, date, gid, titre, p:{jid:true (présent) | false (absent)}} }}
     cle = identifiant de la séance (Create my session) ou clé de la séance du plan (« p|plan|date|… »). */
  function pstore() { const s = G.load(G.K.presences, { s: {} }); if (!s.s || typeof s.s !== "object") s.s = {}; return s; }
  G.presences = {
    get(cle) { return pstore().s[cle] || null; },
    all() { return Object.values(pstore().s); },
    /* val : true = présent, false = absent, null = effacer */
    set(info, jid, val) { const s = pstore(); const x = s.s[info.cle] ||= { cle: info.cle, date: info.date, gid: info.gid || null, titre: info.titre || "", p: {} };
      if (val == null) delete x.p[jid]; else x.p[jid] = !!val; if (!Object.keys(x.p).length) delete s.s[info.cle]; G.save(G.K.presences, s); },
    /* taux d'un joueur : {present, total, pct (0-100) | null, dernieres:[{date,titre,present}]} */
    taux(jid, depuis) { const L = Object.values(pstore().s).filter(x => x && x.p && jid in x.p && (!depuis || x.date >= depuis)).sort((a, b) => a.date < b.date ? 1 : -1);
      const pr = L.filter(x => x.p[jid]).length; return { present: pr, total: L.length, pct: L.length ? Math.round(pr / L.length * 100) : null, dernieres: L.slice(0, 12).map(x => ({ date: x.date, titre: x.titre, gid: x.gid, present: !!x.p[jid] })) }; }
  };

  /* ---------- BANQUE D'EXERCICES (répertoire central) ----------
     Base : data-banque.json {ex:[Exo], fams:[{c,t,dom,dossier,intro,subs}], mat:[[code,nom]]}
     Exercice = {id, n, f (famille 5.x.y), s (sous-famille), dom ("PP"|"GE"|"DE"|"PH"|"JEU"…), L:["PP1","DE6"…], a (âge min), ax (âge max), v (niveau 1-4),
            ob, ma, de, co, er, ut, an, m:[codes matériel], c (1 = sur le court), e (1 = grand espace), k (catégorie de dosage),
            w: {et:"MR|MO|AC|CV|ST|PO", but, fmt:[], lieu:[], mat:[], int, dur, apres:[], ci:[], complet, va, a:[min,max]} (si utilisable en échauffement),
            // champs ajoutés pour les exercices créés/modifiés :
            dos (dosage conseillé, texte), vid (lien vidéo), img (image dataURL réduite), auteur ("moi"), st ("perso"|"propose"|"valide"), cree }
     Perso : grun_banque_v1 {perso:[Exo], over:{id:patch}, fav:[id], hide:[id], seq:n}
     Les exercices perso ont un identifiant MOI-0001… ; « over » = modifications d'un exercice d'origine (bouton « remettre l'original » = supprimer over[id]). */
  let BQ = null, BQP = null;
  function bstore() { const s = G.load(G.K.banque, { perso: [], over: {}, fav: [], hide: [], seq: 0 }); s.perso ||= []; s.over ||= {}; s.fav ||= []; s.hide ||= []; s.seq ||= 0; return s; }
  function merge(base) {
    const s = bstore(), byId = {};
    const ex = base.ex.map(e => { const o = s.over[e.id]; const x = o ? { ...e, ...o, modifie: true, orig: e } : e; byId[x.id] = x; return x; });
    for (const p of s.perso) { const x = { ...p, perso: true }; ex.push(x); byId[x.id] = x; }
    return { ex, fams: base.fams, mat: base.mat, lv: base.lv, byId, fav: s.fav, hide: s.hide };
  }
  G.banque = {
    async load() { if (!BQP) BQP = fetch("data-banque.json").then(r => r.json()); const base = await BQP; BQ = merge(base); return BQ; },
    cache() { return BQ; },
    get(id) { return BQ ? BQ.byId[id] : null; },
    add(e) { const s = bstore(); s.seq++; const x = { ...e, id: "MOI-" + String(s.seq).padStart(4, "0"), auteur: "moi", st: e.st || "perso", cree: G.today() }; s.perso.push(x); G.save(G.K.banque, s); return x; },
    edit(id, patch) { const s = bstore(); const p = s.perso.find(x => x.id === id); if (p) Object.assign(p, patch); else s.over[id] = { ...(s.over[id] || {}), ...patch }; G.save(G.K.banque, s); },
    reset(id) { const s = bstore(); delete s.over[id]; G.save(G.K.banque, s); },
    remove(id) { const s = bstore(); s.perso = s.perso.filter(x => x.id !== id); G.save(G.K.banque, s); },
    perso() { return bstore().perso; },
    toggleFav(id) { const s = bstore(); s.fav = s.fav.includes(id) ? s.fav.filter(x => x !== id) : [...s.fav, id]; G.save(G.K.banque, s); return s.fav.includes(id); },
    toggleHide(id) { const s = bstore(); s.hide = s.hide.includes(id) ? s.hide.filter(x => x !== id) : [...s.hide, id]; G.save(G.K.banque, s); return s.hide.includes(id); }
  };
  G.on(G.K.banque, () => { if (BQP) BQP.then(b => { BQ = merge(b); emit("grun:banque"); }); });

  /* vidéos : videos.json (commun, rempli par Claude) + liens perso (champ vid) */
  let VP = null;
  G.videos = () => VP ||= fetch("videos.json", { cache: "no-store" }).then(r => r.ok ? r.json() : {}).catch(() => ({}));
  G.video = async id => { const e = G.banque.get(id); if (e && e.vid) return e.vid; const v = await G.videos(); return v[id] || null; };

  /* ---------- TESTS PERSO ----------
     Test = {id:"T-MOI-001", nom, dom:"PP"|"GE"|"DE", lignes:[n], protocole, materiel, mesures:[{k:"m1",nom:"Essai",unite:"s"}], sens:"petit"|"grand" (meilleur résultat),
             seuils:{F:{"4":[s2,s3,s4] ou {cléMesure:[s2,s3,s4]},…,"18":…,"A":… (adulte, repli sur 18)}, G:{…}}  (3 seuils : passage au niveau 2, 3, 4), prio:false, vid, cree }
     Mesure à plusieurs essais : mesures[i].essais (2-5) et mesures[i].calc ("best" par défaut | "mean") ; dans bilan.res[testId], chaque essai est
     stocké sous "k#1", "k#2"… et le résultat retenu sous "k" (les affichages ignorent les clés qui contiennent « # »).
     Bilan (fiche joueur) : {id,date,age,adulte:bool,note,v:{PP,GE,DE},sel,res}.
     over : modifications d'un test d'origine (protocole, seuils…). */
  function tstore() { const s = G.load(G.K.tests, { perso: [], over: {}, seq: 0 }); s.perso ||= []; s.over ||= {}; s.seq ||= 0; return s; }
  G.tests = {
    perso() { return tstore().perso; },
    over() { return tstore().over; },
    add(t) { const s = tstore(); s.seq++; const x = { ...t, id: "T-MOI-" + String(s.seq).padStart(3, "0"), cree: G.today() }; s.perso.push(x); G.save(G.K.tests, s); return x; },
    edit(id, patch) { const s = tstore(); const p = s.perso.find(x => x.id === id); if (p) Object.assign(p, patch); else s.over[id] = { ...(s.over[id] || {}), ...patch }; G.save(G.K.tests, s); },
    reset(id) { const s = tstore(); delete s.over[id]; G.save(G.K.tests, s); },
    remove(id) { const s = tstore(); s.perso = s.perso.filter(x => x.id !== id); G.save(G.K.tests, s); }
  };

  /* ---------- PASSAGE DE RELAIS (poupée russe) ----------
     G.relais.envoyer({de:"prog", vers:"seances", retour:"prog.html#…", jid, gid, theme, lignes, duree, type, apres, cle, plan…}) puis G.go(…)
     Le module d'arrivée lit G.relais.lire() ; quand il a fini il appelle G.relais.rendre(resultat) puis location.href = relais.retour ;
     le module de départ lit G.relais.resultat() au retour. */
  /* pile : programmation → séance → warm-up. Envoyer depuis un module qui a lui-même été appelé met le relais en cours de côté ;
     resultat() le restaure, si bien que la séance retrouve ensuite le chemin de retour vers la programmation. */
  function rget() { const h = G.load(G.K.handoff, null); return h && Date.now() - (h.t || 0) < 864e5 ? h : null; }
  G.relais = {
    envoyer(o) { const cur = rget(); const pile = cur ? [...(cur.pile || []), ...(cur.res == null ? [{ ...cur, pile: undefined }] : [])] : [];
      G.save(G.K.handoff, { ...o, t: Date.now(), res: null, pile }); },
    lire() { const h = rget(); if (!h) return null; const { pile, ...r } = h; return r; },
    rendre(res) { const h = rget(); if (h) { h.res = res; h.tr = Date.now(); G.save(G.K.handoff, h); } },
    resultat(de) { const h = rget(); if (h && h.res && (!de || h.de === de)) { const { pile, ...r } = h; const p = (pile || []).slice(); const parent = p.pop();
        G.save(G.K.handoff, parent ? { ...parent, t: Date.now(), pile: p } : null); return r; } return null; },
    vider() { const h = rget(); const p = h && h.pile ? h.pile.slice() : []; const parent = p.pop(); G.save(G.K.handoff, parent ? { ...parent, t: Date.now(), pile: p } : null); }
  };


  /* ---------- SAUVEGARDE / RESTAURATION GLOBALE ---------- */
  G.exportAll = () => { const o = { app: "GRUN", v: G.version, date: G.today(), data: {} }; for (const k of Object.values(G.K)) { const v = localStorage.getItem(k); if (v != null) o.data[k] = JSON.parse(v); } return o; };
  G.importAll = (o, fusion = true) => {
    if (!o || !o.data) throw new Error("Fichier non reconnu");
    for (const [k, v] of Object.entries(o.data)) {
      if (!fusion || localStorage.getItem(k) == null) { localStorage.setItem(k, JSON.stringify(v)); continue; }
      const cur = JSON.parse(localStorage.getItem(k));
      localStorage.setItem(k, JSON.stringify(fusionner(cur, v)));
    }
    Object.values(G.K).forEach(emit);
  };
  function fusionner(a, b) { // fusion de listes d'objets par id ; objets fusionnés récursivement ; b gagne sinon
    if (Array.isArray(a) && Array.isArray(b)) { if (a.every(x => x && x.id) && b.every(x => x && x.id)) { const m = new Map(a.map(x => [x.id, x])); b.forEach(x => m.set(x.id, x)); return [...m.values()]; } return [...new Set([...a, ...b].map(x => JSON.stringify(x)))].map(x => JSON.parse(x)); }
    if (a && b && typeof a === "object" && typeof b === "object") { const r = { ...a }; for (const k in b) r[k] = k in a ? fusionner(a[k], b[k]) : b[k]; return r; }
    return b;
  }
  G.telecharger = (obj, nom) => { const b = new Blob([JSON.stringify(obj)], { type: "application/json" }); const f = new File([b], nom, { type: "application/json" });
    if (navigator.canShare && navigator.canShare({ files: [f] })) return navigator.share({ files: [f], title: nom }).catch(() => {});
    const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = nom; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); };

  /* ---------- REPRISE DES ANCIENNES DONNÉES ---------- */
  (function migrer() {
    if (G.load("grun_migre_v1", false)) return;
    try {
      const R = G.load(G.K.radar, null); const lst = R && (R.joueurs || R.players || (Array.isArray(R) ? R : null));
      if (Array.isArray(lst)) { const s = jstore(); for (const p of lst) { if (!p || !p.nom) continue;
          const bil = (p.bilans || []).map(b => ({ id: b.id || G.uid(), date: b.date || G.today(), age: b.age, note: b.note || "", v: b.valeurs || b.v || { PP: [], GE: [], DE: [] }, sel: [], res: {} }));
          const ex = s.joueurs.find(x => x.nom === p.nom);
          if (!ex) s.joueurs.push(norm({ id: p.id || G.uid(), nom: p.nom, sexe: p.sexe === "F" ? "F" : "G", naissance: p.naissance || "", notes: p.notes || "", bilans: bil }));
          else { ex.bilans ||= []; for (const b of bil) if (!ex.bilans.some(x => x.date === b.date && x.age === b.age)) ex.bilans.push(b); } }
        G.save(G.K.joueurs, s); }
      const P = G.load(G.K.prog, null); // profils de l'appli Programmation → fiche joueur unique
      if (P && P.profils) { const s = jstore(); for (const j of s.joueurs) { const pr = P.profils[j.id]; if (pr) { for (const k of ["classement", "croissance", "zones", "prio"]) if (pr[k] != null && (j[k] == null || (Array.isArray(j[k]) && !j[k].length) || j[k] === "NC" || j[k] === false)) j[k] = pr[k]; } } G.save(G.K.joueurs, s); }
      G.save("grun_migre_v1", true);
    } catch (e) { console.warn("migration", e); }
  })();

  /* ---------- NAVIGATION COMMUNE (barre du bas) ---------- */
  const ICO = {
    acc: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
    ind: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    create: '<path d="M12 5v14M5 12h14"/><rect x="3" y="3" width="18" height="18" rx="4"/>',
    res: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/>',
    tests: '<path d="M12 3l8.5 6.2-3.2 10H6.7L3.5 9.2z"/><path d="M12 8l4 3-1.5 4.5h-5L8 11z"/>'
  };
  G.nav = (actif) => {
    if (document.getElementById("grun-nav") || document.querySelector(".grun-topx")) return;
    const j = G.isJoueur(), auto = G.isAutonome();
    if (!SEUL) {
    const items = auto && !j
      ? [["acc", "Mon dossier", "index.html"], ["create", "Create", "index.html#/pole/create"], ["plus"], ["tests", "Tests", "index.html#/pole/tests"]]
      : j
      ? [["acc", "Mon dossier", "index.html"], ["create", "Ma séance", "index.html#/pole/create"], ["plus"], ["tests", "Mes tests", "index.html#/pole/tests"]]
      : [["acc", "Accueil", "index.html"], ["ind", "Joueurs", "index.html#/joueurs"], ["plus"], ["create", "Create", "index.html#/pole/create"], ["res", "Ressources", "index.html#/pole/res"], ["tests", "Tests", "index.html#/pole/tests"]];
    const n = document.createElement("nav"); n.id = "grun-nav"; n.setAttribute("aria-label", "Pôles de GRÜN");
    n.innerHTML = items.map(([k, t, h]) => k === "plus" ? `<button type="button" id="grun-plus" aria-label="Créer : joueur, groupe, séance, test, exercice, note, échauffement"><span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></span></button>`
      : `<a href="${h}" class="${k === actif ? "on" : ""}" aria-label="${esc((G.POLES.find(p => p.id === k) || {}).t || t)}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICO[k]}</svg><span>${t}</span></a>`).join("");
    document.body.appendChild(n); document.body.classList.add("grun-has-nav");
    n.querySelector("#grun-plus").onclick = () => G.plus.ouvrir();
    }
    /* barre du haut : « joueur en cours » + « ? » (insérés à droite de la barre de chaque page) */
    const back = document.getElementById("back"), bar = back && back.parentElement;
    if (bar && !bar.querySelector(".grun-topx")) { const x = document.createElement("span"); x.className = "grun-topx";
      x.innerHTML = `${j || auto || SEUL ? "" : `<button type="button" class="grun-chip"></button>`}<button type="button" class="grun-q" aria-label="Aide : à quoi sert cet écran ?">?</button>`;
      const cfg = bar.querySelector("#cfg"); if (cfg) bar.insertBefore(x, cfg); else bar.appendChild(x);
      x.addEventListener("click", e => { if (e.target.closest(".grun-chip")) UI.choisirCourant(); if (e.target.closest(".grun-q")) G.aide.ouvrir(); }); majChip(); }
    /* bouton « ‹ » commun : toujours visible dans les modules ; sur l'accueil d'un module, il remonte à la page du pôle (ou à l'accueil) */
    const mod = (document.querySelector('meta[name="grun-module"]') || {}).content;
    if (mod && mod !== "accueil" && !SEUL) {
      document.documentElement.classList.add("grun-mod");
      document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("#back"); if (!b) return;
        if (/^#?\/?$/.test(location.hash)) { e.stopImmediatePropagation(); e.preventDefault();
          location.href = (actif && actif !== "acc" && !(auto && actif === "res")) ? "index.html#/pole/" + actif : "index.html"; } }, true);
      /* « Reprendre » : le dernier contenu ouvert dans un module (titre de la page + adresse) */
      const note = () => setTimeout(() => { if (location.hash && !/^#\/?$/.test(location.hash)) G.courant.vu(document.title.replace(/\s*·\s*GRÜN.*$/, ""), G.ici()); }, 900);
      addEventListener("hashchange", note); note();
    }
  };
  G.poleDe = mod => (G.MODS[mod] || {}).pole || "acc";


  /* =====================================================================
     SOCLE 1.1 « CHEMIN ULTRA INTUITIF » (16 oct.) — composants partagés.
     Documentation complète : RAPPORT_intuitif_socle.md. Résumé :
       G.ui.sheet / toast / annuler / confirmer / enregistre / autosave
       G.ui.nouveauJoueur / completerProfil / nouveauGroupe / nouveauTest / nouvelExo / noteJournal / session / echauffement
       G.completude(j) · G.parseJoueurs(texte) · G.tailleAdulte(j)
       G.courant.get/set/jid/gid/recents/onChange/vu/dernier · G.reglages.coach()/setCoach()
       G.aide(cle, texte) / G.aide.ecran(cle) / G.aide.montrer() · G.visite() · G.plus.ouvrir() / G.plus.ajouter()
     ===================================================================== */
  const $q = (s, r) => (r || document).querySelector(s), $qq = (s, r) => [...(r || document).querySelectorAll(s)];
  const esc = G.esc;
  const prenomDe = j => (j && j.nom || "").split(" ")[0];
  const modCourant = () => (document.querySelector('meta[name="grun-module"]') || {}).content || "accueil";
  /* adresse « où l'on est » (pour revenir exactement ici) */
  G.ici = () => (location.pathname.split("/").pop() || "index.html") + location.search + location.hash;

  /* ---------- réglages coach par défaut (grun_reglages_v1.coach) ----------
     {materiel:[codes banque], lieu:"court"|"salle"|"exterieur"|"gymnase"|"maison"|"", creneaux:[{j:0-6 (0 = lundi), h:"17:30", duree:60, gid?}], duree:60} */
  G.LIEUX = { court: "Court de tennis", salle: "Salle de préparation physique", gymnase: "Gymnase", exterieur: "Extérieur (stade, parc)", maison: "À la maison" };
  G.JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
  G.reglages.coach = () => { const c = G.reglages().coach || {}; return { materiel: Array.isArray(c.materiel) ? c.materiel : [], lieu: c.lieu || "", creneaux: Array.isArray(c.creneaux) ? c.creneaux : [], duree: +c.duree || 60, demo: !!c.demo }; };
  G.reglages.setCoach = patch => { const r = G.reglages(); r.coach = { ...G.reglages.coach(), ...patch }; G.save(G.K.reglages, r); return r.coach; };
  G.reglages.set = patch => { const r = { ...G.reglages(), ...patch }; G.save(G.K.reglages, r); return r; };
  /* prochain créneau habituel à partir d'aujourd'hui : {date, h, duree} | null */
  G.reglages.prochainCreneau = () => { const C = G.reglages.coach().creneaux; if (!C.length) return null; const t = new Date(G.today());
    for (let i = 0; i < 8; i++) { const d = new Date(t.getTime() + i * 864e5), dw = (d.getUTCDay() + 6) % 7; const c = C.filter(x => +x.j === dw).sort((a, b) => String(a.h).localeCompare(String(b.h)))[0]; if (c) return { date: d.toISOString().slice(0, 10), h: c.h || "", duree: +c.duree || G.reglages.coach().duree, gid: c.gid || null }; } return null; };

  /* ---------- joueur / groupe EN COURS (grun_courant_v1) ---------- */
  const CL = [];
  function cstore() { const s = G.load(G.K.courant, {}) || {}; s.rec = Array.isArray(s.rec) ? s.rec : []; return s; }
  G.courant = {
    /* → {t:"j", id, joueur} | {t:"g", id, groupe} | null */
    get() { const c = cstore().c; if (!c || !c.id) return null; if (c.t === "g") { const g = G.groupes.get(c.id); return g ? { t: "g", id: g.id, groupe: g, nom: g.nom } : null; }
      const j = G.joueurs.get(c.id); return j && !j.archive ? { t: "j", id: j.id, joueur: j, nom: j.nom } : null; },
    jid() { if (G.isJoueur()) return G.mode().jid; if (G.isAutonome()) return G.moi(); const c = G.courant.get(); return c && c.t === "j" ? c.id : null; },
    gid() { const c = G.courant.get(); return c && c.t === "g" ? c.id : null; },
    /* set("j", id) · set("g", id) · set({jid}) · set({gid}) · set(null) */
    set(t, id) { if (t && typeof t === "object") { id = t.jid || t.gid; t = t.jid ? "j" : "g"; } const s = cstore(), av = JSON.stringify(s.c || null);
      if (!t || !id) s.c = null; else { s.c = { t, id }; s.rec = [{ t, id }, ...s.rec.filter(x => x.id !== id)].slice(0, 6); }
      G.save(G.K.courant, s); if (JSON.stringify(s.c || null) !== av) CL.forEach(f => { try { f(G.courant.get()); } catch (e) { console.error(e); } }); },
    recents() { return cstore().rec.map(x => x.t === "g" ? (G.groupes.get(x.id) ? { t: "g", id: x.id, nom: G.groupes.get(x.id).nom } : null) : (() => { const j = G.joueurs.get(x.id); return j && !j.archive ? { t: "j", id: j.id, nom: j.nom } : null; })()).filter(Boolean); },
    onChange(f) { CL.push(f); },
    /* « Reprendre » : dernier contenu ouvert {titre, href, date} (enregistré automatiquement par G.nav dans chaque module) */
    vu(titre, href) { if (!titre || !href) return; const s = cstore(); s.dernier = { titre: String(titre).slice(0, 90), href, date: G.today(), mod: modCourant() }; try { localStorage.setItem(G.K.courant, JSON.stringify(s)); } catch (e) {} },
    dernier() { return cstore().dernier || null; }
  };
  addEventListener("storage", e => { if (e.key === G.K.courant) CL.forEach(f => { try { f(G.courant.get()); } catch (x) {} }); });

  /* ---------- complétude du profil : ce qui manque et à quoi ça sert ---------- */
  G.CHAMPS = [
    { k: "naissance", lab: "date de naissance exacte", sert: "âge, grille et saison de référence justes", ok: j => !!j.naissance && !j.naissanceApprox },
    { k: "taille", lab: "taille", sert: "courbe et vitesse de croissance", ok: j => (j.mesures || []).some(m => m.taille) },
    { k: "assise", lab: "taille assise", sert: "calcul de la maturation (âge biologique)", ok: j => (j.mesures || []).some(m => m.assise) },
    { k: "poids", lab: "poids", sert: "maturation plus précise et charges adaptées", ok: j => (j.mesures || []).some(m => m.poids) },
    { k: "parents", lab: "taille des parents", sert: "taille adulte prévue", ok: j => !!(j.parents && (j.parents.pere || j.parents.mere)) },
    { k: "main", lab: "main et revers", sert: "exercices de geste et échauffements adaptés", ok: j => !!(j.ok && j.ok.main) || j.main === "G" || j.revers === "1" },
    { k: "classement", lab: "classement", sert: "niveau de la programmation (Create my prog)", ok: j => !!(j.ok && j.ok.classement) || (j.classement && j.classement !== "NC") },
    { k: "dispo", lab: "séances par semaine", sert: "volume de la programmation", ok: j => !!(j.dispo && (j.dispo.pp != null || j.dispo.tennis != null)) },
    { k: "zones", lab: "zones fragiles", sert: "exercices à éviter et prévention dans les séances", ok: j => !!(j.ok && j.ok.zones) || (j.zones || []).length > 0 },
    { k: "groupe", lab: "groupe", sert: "séances, présences et bilans de groupe", ok: j => G.groupes.de(j.id).length > 0 || !!(j.ok && j.ok.groupe) },
    { k: "objectifs", lab: "objectif de la saison", sert: "programmation et rapport PDF orientés", ok: j => !!String(j.objectifs || "").trim() },
    { k: "bilan", lab: "premier bilan", sert: "profil radar et lignes prioritaires", ok: j => (j.bilans || []).some(b => b && b.res && Object.keys(b.res).length || ["PP", "GE", "DE"].some(d => ((b.v || {})[d] || []).some(x => x != null && x !== ""))) }
  ];
  G.completude = j => { if (!j) return null; const L = G.CHAMPS.map(c => ({ k: c.k, lab: c.lab, sert: c.sert, fait: !!c.ok(j) })); const f = L.filter(x => x.fait).length + 3;   /* + prénom, sexe, naissance */
    return { pct: Math.round(f / (L.length + 3) * 100), manque: L.filter(x => !x.fait), champs: L }; };
  /* taille adulte prévue (méthode des parents : moyenne ± 6,5 cm), en cm, ou null */
  G.tailleAdulte = j => { const p = j && j.parents; if (!p || !+p.pere || !+p.mere) return null; return Math.round(((+p.pere + +p.mere) / 2 + (j.sexe === "F" ? -6.5 : 6.5)) * 10) / 10; };

  /* ---------- saisie tolérante de plusieurs joueurs ----------
     « Léa F 2012-03-04 » · « Tom G 2011 » · « Durand Lucie, fille, 04/03/2012 » · « Noé;garçon;12/2013 »
     → [{ligne, nom, sexe, naissance, approx, erreur}] */
  G.parseJoueurs = txt => String(txt || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(ligne => {
    let reste = ligne.replace(/[;,\t|]+/g, " ").replace(/\s+/g, " ").trim(), sexe = null, nai = "", approx = false, m;
    const SX = { f: "F", fille: "F", filles: "F", feminin: "F", "féminin": "F", g: "G", garcon: "G", "garçon": "G", m: "G", h: "G", masculin: "G", homme: "G", femme: "F" };
    if ((m = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(reste))) { nai = m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0"); }
    else if ((m = /\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/.exec(reste))) { let y = +m[3]; if (y < 100) y += y > 40 ? 1900 : 2000; nai = y + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0"); }
    else if ((m = /\b(\d{1,2})[\/.\-](\d{4})\b/.exec(reste))) { nai = m[2] + "-" + m[1].padStart(2, "0") + "-15"; approx = true; }
    else if ((m = /\b((?:19|20)\d{2})\b/.exec(reste))) { nai = m[1] + "-07-01"; approx = true; }
    if (m) reste = (reste.slice(0, m.index) + " " + reste.slice(m.index + m[0].length)).trim();
    const mots = reste.split(" ").filter(Boolean), garde = [];
    for (const w of mots) { const k = w.toLowerCase().replace(/[().]/g, ""); if (!sexe && SX[k] && (k.length > 1 || mots.length > 1)) sexe = SX[k]; else garde.push(w); }
    const nom = garde.join(" ").trim();
    const ok = /^\d{4}-\d{2}-\d{2}$/.test(nai) && !isNaN(new Date(nai)), an = ok ? G.ageCiv(nai) : null;
    const erreur = !nom ? "prénom manquant" : !sexe ? "sexe manquant (F ou G)" : !nai ? "naissance manquante" : !ok ? "date illisible" : an < 3 || an > 25 ? "âge improbable (" + an + " ans)" : "";
    return { ligne, nom, sexe, naissance: nai, approx, erreur };
  });

  /* ---------- styles du socle (insérés une fois) ---------- */
  /* (les styles sont dans grun.css, injecté dans chaque page par build.py) */

  /* ---------- FEUILLE (bottom sheet sur téléphone, fenêtre au centre sur iPad) ----------
     G.ui.sheet({titre, html, principal:{t, fn}, secondaire:[{t, fn}], large, fermer:fn}) → {el, body, fermer()}
     fn(sheet) peut renvoyer false pour garder la feuille ouverte. */
  const UI = G.ui = {};
  let SHEETS = 0;
  UI.sheet = (o) => {
    const ov = document.createElement("div"); ov.className = "grun-ov"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-label", o.titre || "");
    ov.innerHTML = `<div class="grun-sheet${o.large ? " large" : ""}"><div class="gs-h"><b>${esc(o.titre || "")}</b><button type="button" class="gs-x" aria-label="Fermer">×</button></div>
      <div class="gs-b">${o.html || ""}</div>${o.principal || (o.secondaire || []).length ? `<div class="gs-f">${(o.secondaire || []).map((s, i) => `<button type="button" class="gs-btn sec" data-gs="${i}">${esc(s.t)}</button>`).join("")}${o.principal ? `<button type="button" class="gs-btn main" data-gs="p">${esc(o.principal.t)}</button>` : ""}</div>` : ""}</div>`;
    document.body.appendChild(ov); SHEETS++; document.documentElement.classList.add("grun-sheet-on");
    const sh = { el: ov, body: $q(".gs-b", ov), $: s => $q(s, ov), $$: s => $qq(s, ov), ferme: false };
    sh.fermer = (v) => { if (sh.ferme) return; sh.ferme = true; ov.classList.add("out"); setTimeout(() => ov.remove(), 160); SHEETS--; if (!SHEETS) document.documentElement.classList.remove("grun-sheet-on"); removeEventListener("keydown", kd); if (o.fermer) o.fermer(v); };
    const kd = e => { if (e.key === "Escape") sh.fermer(null); };
    addEventListener("keydown", kd);
    ov.addEventListener("click", e => { if (e.target === ov || e.target.closest(".gs-x")) { sh.fermer(null); return; }
      const b = e.target.closest("[data-gs]"); if (!b) return; const a = b.dataset.gs === "p" ? o.principal : o.secondaire[+b.dataset.gs]; if (a && a.fn && a.fn(sh) !== false) sh.fermer(true); else if (a && !a.fn) sh.fermer(true); });
    requestAnimationFrame(() => ov.classList.add("in"));
    return sh;
  };
  /* message bref en bas de l'écran (au-dessus de la barre), avec une action facultative */
  UI.toast = (msg, o = {}) => {
    let t = $q("#grun-toast"); if (!t) { t = document.createElement("div"); t.id = "grun-toast"; t.setAttribute("role", "status"); t.setAttribute("aria-live", "polite"); document.body.appendChild(t); }
    t.innerHTML = `<span>${esc(msg)}</span>${o.action ? `<button type="button">${esc(o.action)}</button>` : ""}`; t.hidden = false; t.className = "on";
    /* au-dessus de la barre d'action principale (.grun-actbar) quand elle est à l'écran : on ne cache jamais l'action */
    const ab = $qq(".grun-actbar").map(x => x.getBoundingClientRect()).find(r => r.height && r.top < innerHeight && r.bottom > 0); t.style.bottom = ab ? Math.round(innerHeight - ab.top + 8) + "px" : "";
    const b = $q("button", t); if (b) b.onclick = () => { t.hidden = true; clearTimeout(t._t); o.fn && o.fn(); };
    clearTimeout(t._t); t._t = setTimeout(() => { t.hidden = true; }, o.duree || (o.action ? 10000 : 2800));
  };
  /* « Annuler » pendant 10 s au lieu de « Sûr ? » : l'action est déjà faite, undoFn la défait */
  UI.annuler = (msg, undoFn, o = {}) => UI.toast(msg, { action: "Annuler", duree: o.duree || 10000, fn: () => { try { undoFn && undoFn(); UI.toast("Annulé"); } catch (e) { console.error(e); } } });
  /* photo de clés localStorage → fonction qui les remet telles quelles (pour annuler n'importe quelle action) */
  UI.photo = keys => { const P = {}; for (const k of keys) P[k] = localStorage.getItem(k); return () => { for (const k of keys) { if (P[k] == null) localStorage.removeItem(k); else localStorage.setItem(k, P[k]); emit(k); } }; };
  /* fait l'action tout de suite + « Annuler » (restaure les clés touchées) */
  UI.annulable = (msg, keys, fn) => { const undo = UI.photo(keys); const r = fn(); UI.annuler(msg, undo); return r; };
  /* confirmation réservée aux actions VRAIMENT définitives → Promise<bool> */
  UI.confirmer = o => new Promise(res => { let ok = false; UI.sheet({ titre: o.titre || "Confirmer", html: `<p class="gs-p">${o.texte || ""}</p>${o.detail ? `<p class="gs-m">${o.detail}</p>` : ""}`,
    secondaire: [{ t: o.non || "Garder", fn: () => true }], principal: { t: o.ok || "Confirmer", fn: () => { ok = true; return true; } }, fermer: () => res(ok) }).el.classList.toggle("danger", o.danger !== false); });
  /* petit « Enregistré » discret (en haut à droite) */
  UI.enregistre = (txt) => { let e = $q("#grun-saved"); if (!e) { e = document.createElement("div"); e.id = "grun-saved"; e.setAttribute("aria-live", "polite"); document.body.appendChild(e); }
    e.textContent = "✓ " + (txt || "Enregistré"); e.classList.add("on"); clearTimeout(e._t); e._t = setTimeout(() => e.classList.remove("on"), 1400); };
  /* enregistrement automatique d'un formulaire : fn(FormData, form) à chaque modification (0,5 s après la dernière frappe) */
  UI.autosave = (form, fn, ms = 500) => { if (!form || form._as) return; form._as = 1; let t; const go = () => { clearTimeout(t); t = setTimeout(() => { try { if (fn(new FormData(form), form) !== false) UI.enregistre(); } catch (e) { console.error(e); } }, ms); };
    form.addEventListener("input", go); form.addEventListener("change", go); form.addEventListener("submit", e => { e.preventDefault(); clearTimeout(t); try { fn(new FormData(form), form); UI.enregistre(); } catch (x) {} }); };

  const seg = (name, opts, v) => `<div class="gs-seg" role="radiogroup">${opts.map(([k, t]) => `<button type="button" role="radio" data-seg="${name}" data-v="${esc(k)}" aria-checked="${String(v) === String(k)}">${esc(t)}</button>`).join("")}</div>`;
  const segVal = (sh, name) => { const b = sh.$(`[data-seg="${name}"][aria-checked="true"]`); return b ? b.dataset.v : ""; };
  function bindSeg(sh, cb) { sh.el.addEventListener("click", e => { const b = e.target.closest("[data-seg]"); if (!b) return; sh.$$(`[data-seg="${b.dataset.seg}"]`).forEach(x => x.setAttribute("aria-checked", x === b)); cb && cb(b.dataset.seg, b.dataset.v); }); }
  const lienDossier = j => G.href("joueurs", "#/j/" + j.id);

  /* ---------- NOUVEAU JOUEUR ----------
     G.ui.nouveauJoueur({groupe:gid, prenom, multiple:bool, courant:true, ouvrir:false, sexe, naissance})
     → Promise<joueur | null>  (mode plusieurs : Promise<joueur[]>)
     3 champs obligatoires : prénom, sexe, naissance. Le reste : « Compléter le profil » dans le dossier.
     Aucune navigation : on reste où l'on était (sauf ouvrir:true). */
  UI.nouveauJoueur = (o = {}) => new Promise(res => {
    let fini = null, multi = !!o.multiple;
    const gs = G.groupes.all(), gdef = o.groupe || G.courant.gid() || "";
    const gsel = gs.length ? `<label class="gs-l">Groupe <small>(facultatif)</small><select class="gs-inp" name="gid"><option value="">Aucun</option>${gs.map(g => `<option value="${esc(g.id)}"${g.id === gdef ? " selected" : ""}>${esc(g.nom)}</option>`).join("")}</select></label>` : "";
    const un = `<div class="gs-un"><label class="gs-l">Prénom <small>(et nom si tu veux)</small><input class="gs-inp" name="nom" autocomplete="off" autocapitalize="words" enterkeyhint="next" value="${esc(o.prenom || "")}"></label>
      <div class="gs-l">Sexe ${seg("sexe", [["F", "Fille"], ["G", "Garçon"]], o.sexe || "")}</div>
      <label class="gs-l">Date de naissance<input class="gs-inp" type="date" name="naissance" value="${esc(o.naissance || "")}" max="${G.today()}"></label>
      ${gsel}<p class="gs-err" role="alert"></p>
      <p class="gs-m">Le reste (main, classement, taille, zones fragiles…) se complète plus tard dans son dossier.</p>
      <button type="button" class="gs-lien" data-multi="1">Ajouter plusieurs joueurs d'un coup</button></div>`;
    const plus = `<div class="gs-multi" hidden><p class="gs-m">Un joueur par ligne : prénom, sexe (F ou G), naissance (date ou année). Tu peux coller une liste.</p>
      <textarea class="gs-inp gs-ta" name="liste" rows="6" placeholder="Léa F 2012-03-04&#10;Tom G 2011&#10;Lucie Durand, fille, 04/03/2013"></textarea>${gsel}
      <div class="gs-prev" aria-live="polite"></div><button type="button" class="gs-lien" data-multi="0">‹ Un seul joueur</button></div>`;
    const sh = UI.sheet({ titre: "Nouveau joueur", html: `<form class="gs-form" autocomplete="off">${un}${plus}</form>`,
      principal: { t: "Créer", fn: () => creer() }, fermer: () => res(fini) });
    bindSeg(sh);
    const form = sh.$("form"), btn = sh.$('[data-gs="p"]'), err = sh.$(".gs-err");
    const mode = m => { multi = m; sh.$(".gs-un").hidden = m; sh.$(".gs-multi").hidden = !m; sh.$(".gs-h b").textContent = m ? "Plusieurs joueurs" : "Nouveau joueur"; prev(); (m ? sh.$("textarea") : sh.$("[name=nom]")).focus(); };
    sh.el.addEventListener("click", e => { const b = e.target.closest("[data-multi]"); if (b) mode(b.dataset.multi === "1"); });
    const prev = () => { if (!multi) { btn.textContent = "Créer"; return; } const L = G.parseJoueurs(sh.$("textarea").value), ok = L.filter(x => !x.erreur);
      sh.$(".gs-prev").innerHTML = L.length ? `<div class="gs-list">${L.map(x => `<div class="gs-row${x.erreur ? " ko" : ""}"><b>${esc(x.nom || "?")}</b><span>${x.sexe === "F" ? "Fille" : x.sexe === "G" ? "Garçon" : "–"} · ${x.naissance ? (x.approx ? "née vers " : "") .replace("née", x.sexe === "F" ? "née" : "né") + (x.approx ? x.naissance.slice(0, 4) : G.frD(x.naissance)) + (G.ageCiv(x.naissance) != null ? " (" + G.ageCiv(x.naissance) + " ans)" : "") : "–"}</span>${x.erreur ? `<small>${esc(x.erreur)}</small>` : ""}</div>`).join("")}</div>` : "";
      btn.textContent = ok.length ? "Créer " + (ok.length > 1 ? "les " + ok.length + " joueurs" : "1 joueur") : "Créer"; btn.disabled = !ok.length; };
    sh.$("textarea").addEventListener("input", prev);
    sh.$("[name=nom]").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); sh.$("[name=naissance]").focus(); } });
    const ajouterGroupe = (jid, gid) => { const g = gid && G.groupes.get(gid); if (g && !g.jids.includes(jid)) { g.jids.push(jid); G.groupes.save(g); } };
    function creer() {
      const F = new FormData(form), gid = $qq("[name=gid]", form).map(x => x.closest("[hidden]") ? null : x.value).filter(x => x != null)[0] || "";
      if (multi) { const L = G.parseJoueurs(F.get("liste")).filter(x => !x.erreur); if (!L.length) return false;
        const undo = UI.photo([G.K.joueurs, G.K.groupes]);
        fini = L.map(x => { const j = G.joueurs.create({ nom: x.nom, sexe: x.sexe, naissance: x.naissance, ...(x.approx ? { naissanceApprox: true } : {}) }); ajouterGroupe(j.id, gid); return j; });
        UI.annuler(fini.length + " joueur" + (fini.length > 1 ? "s créés" : " créé"), undo); return true; }
      const nom = String(F.get("nom") || "").trim(), sexe = segVal(sh, "sexe"), nai = F.get("naissance") || "";
      const manque = [!nom && "le prénom", !sexe && "le sexe", !nai && "la date de naissance"].filter(Boolean);
      if (manque.length) { err.textContent = "Il manque " + manque.join(", ") + "."; (!nom ? sh.$("[name=nom]") : !nai && sexe ? sh.$("[name=naissance]") : sh.$("[data-seg]")).focus(); return false; }
      const a = G.ageCiv(nai); if (a != null && (a < 3 || a > 25)) { err.textContent = "Vérifie la date de naissance (" + a + " ans)."; return false; }
      const j = G.joueurs.create({ nom, sexe, naissance: nai }); ajouterGroupe(j.id, gid); fini = j;
      if (o.courant !== false) G.courant.set("j", j.id);
      if (o.ouvrir) { location.href = lienDossier(j); return true; }
      UI.toast(prenomDe(j) + (sexe === "F" ? " est créée" : " est créé"), modCourant() === "accueil" && /^#\/j\//.test(location.hash) ? {} : { action: "Ouvrir son dossier", fn: () => { location.href = lienDossier(j); } });
      return true;
    }
    form.addEventListener("submit", e => { e.preventDefault(); if (creer() !== false) sh.fermer(true); });
    if (multi) mode(true); else setTimeout(() => { const n = sh.$("[name=nom]"); if (n && !o.prenom) n.focus(); }, 60);
  });

  /* ---------- COMPLÉTER LE PROFIL (tous les champs de toutes les fiches, enregistrés tout de suite) ----------
     G.ui.completerProfil(jid, {focus:"assise"}) → Promise<joueur>  */
  G.CLASSEMENTS = ["NC", "40", "30/5", "30/4", "30/3", "30/2", "30/1", "30", "15/5", "15/4", "15/3", "15/2", "15/1", "15", "5/6", "4/6", "3/6", "2/6", "1/6", "0", "-2/6", "-4/6", "-15", "-30", "Promotion", "Top 100", "Top 60", "Top 40"];
  G.ZONES = { dos: "Dos", genou: "Genou", talon: "Talon, cheville", epaule: "Épaule", poignet: "Poignet, coude", hanche: "Hanche" };
  UI.completerProfil = (jid, o = {}) => new Promise(res => {
    let j = G.joueurs.get(jid); if (!j) return res(null);
    const M = (j.mesures || []).filter(x => x).sort((a, b) => a.date < b.date ? 1 : -1), m = M[0] || {}, d = j.dispo || {}, p = j.parents || {}, mesG = new Set(G.groupes.de(j.id).map(g => g.id));
    const C = G.completude(j), aide = k => { const c = G.CHAMPS.find(x => x.k === k); return c ? `<small class="gs-sert">→ ${esc(c.sert)}</small>` : ""; };
    const num = (n, lab, v, mn, mx, st) => `<label class="gs-l gs-n">${lab}<input class="gs-inp" type="number" inputmode="decimal" name="${n}" value="${v != null && v !== "" ? esc(v) : ""}" min="${mn}" max="${mx}" step="${st || 0.1}"></label>`;
    const html = `<div class="gs-bar"><div><i style="width:${C.pct}%"></i></div><b>Profil complet à ${C.pct} %</b></div>
      <form class="gs-form gs-cp">
      <fieldset><legend>Identité</legend><label class="gs-l">Prénom et nom<input class="gs-inp" name="nom" value="${esc(j.nom)}"></label>
        <div class="gs-l">Sexe ${seg("sexe", [["F", "Fille"], ["G", "Garçon"]], j.sexe)}</div>
        <label class="gs-l">Date de naissance${j.naissanceApprox ? ` <small>(approximative : corrige-la)</small>` : ""}<input class="gs-inp" type="date" name="naissance" value="${esc(j.naissance || "")}">${aide("naissance")}</label></fieldset>
      <fieldset id="cp-mes"><legend>Mesures du jour <small>(${M.length ? "dernière le " + G.frD(m.date) : "aucune"})</small></legend>
        <div class="gs-grid">${num("taille", "Taille (cm)", "", 60, 230)}${num("assise", "Taille assise (cm)", "", 30, 130)}${num("poids", "Poids (kg)", "", 10, 150)}${num("envergure", "Envergure (cm)", "", 60, 240)}</div>
        <small class="gs-sert">→ taille : croissance · taille assise : maturation (âge biologique) · poids : précision et charges</small>
        <div class="gs-grid">${num("pere", "Taille du père (cm)", p.pere, 130, 230)}${num("mere", "Taille de la mère (cm)", p.mere, 120, 220)}</div>${aide("parents")}</fieldset>
      <fieldset><legend>Jeu</legend><div class="gs-l">Main ${seg("main", [["D", "Droitier"], ["G", "Gaucher"]], j.main)}</div>
        <div class="gs-l">Revers ${seg("revers", [["2", "2 mains"], ["1", "1 main"]], j.revers)}</div>${aide("main")}
        <label class="gs-l">Classement<select class="gs-inp" name="classement">${(G.CLASSEMENTS.includes(j.classement || "NC") ? G.CLASSEMENTS : [j.classement, ...G.CLASSEMENTS]).map(c => `<option${c === (j.classement || "NC") ? " selected" : ""}>${c}</option>`).join("")}</select>${aide("classement")}</label>
        <div class="gs-grid">${num("dpp", "Séances de préparation physique par semaine", d.pp, 0, 20, 0.5)}${num("dten", "Séances de tennis / semaine", d.tennis, 0, 30, 0.5)}</div>${aide("dispo")}</fieldset>
      <fieldset><legend>Santé</legend><div class="gs-l">Zones fragiles ou douloureuses<div class="gs-chips">${Object.entries(G.ZONES).map(([k, t]) => `<button type="button" class="gs-chip" data-zone="${k}" aria-pressed="${(j.zones || []).includes(k)}">${t}</button>`).join("")}<button type="button" class="gs-chip" data-zone="" aria-pressed="${!!(j.ok && j.ok.zones) && !(j.zones || []).length}">Aucune</button></div>${aide("zones")}</div>
        <label class="gs-c"><input type="checkbox" name="croissance"${j.croissance ? " checked" : ""}> Pic de croissance en cours <small>(charges et sauts plafonnés dans Create)</small></label></fieldset>
      ${G.groupes.all().length ? `<fieldset><legend>Groupes</legend><div class="gs-chips">${G.groupes.all().map(g => `<button type="button" class="gs-chip" data-grp="${esc(g.id)}" aria-pressed="${mesG.has(g.id)}">${esc(g.nom)}</button>`).join("")}</div>${aide("groupe")}</fieldset>` : ""}
      <fieldset><legend>Objectifs et notes</legend><label class="gs-l">Objectif de la saison<textarea class="gs-inp gs-ta" name="objectifs" rows="2" placeholder="Tournois visés, qualités à développer…">${esc(j.objectifs || "")}</textarea>${aide("objectifs")}</label>
        <label class="gs-l">Notes<textarea class="gs-inp gs-ta" name="notes" rows="2">${esc(j.notes || "")}</textarea></label>
        <p class="gs-m">Lignes prioritaires : dans Create my prog (profil du joueur). Blessures, agenda, objectifs suivis : dans son dossier.</p></fieldset></form>`;
    const sh = UI.sheet({ titre: "Compléter le profil · " + prenomDe(j), html, large: true, principal: { t: "Terminé" }, fermer: () => res(G.joueurs.get(jid)) });
    const majBar = () => { const c = G.completude(G.joueurs.get(jid)); sh.$(".gs-bar i").style.width = c.pct + "%"; sh.$(".gs-bar b").textContent = "Profil complet à " + c.pct + " %"; };
    const ok = k => { j.ok = { ...(j.ok || {}), [k]: 1 }; };
    const enreg = () => { G.joueurs.save(j); UI.enregistre(); majBar(); };
    bindSeg(sh, (k, v) => { j = G.joueurs.get(jid); j[k] = v; if (k === "main" || k === "revers") ok("main"); enreg(); });
    sh.el.addEventListener("click", e => { const z = e.target.closest("[data-zone]"), g = e.target.closest("[data-grp]"); j = G.joueurs.get(jid);
      if (z) { const k = z.dataset.zone; j.zones = !k ? [] : (j.zones || []).includes(k) ? j.zones.filter(x => x !== k) : [...(j.zones || []), k]; ok("zones"); enreg();
        sh.$$("[data-zone]").forEach(b => b.setAttribute("aria-pressed", b.dataset.zone ? j.zones.includes(b.dataset.zone) : !j.zones.length)); }
      if (g) { const gr = G.groupes.get(g.dataset.grp); gr.jids = gr.jids.includes(jid) ? gr.jids.filter(x => x !== jid) : [...gr.jids, jid]; G.groupes.save(gr); g.setAttribute("aria-pressed", gr.jids.includes(jid)); UI.enregistre(); majBar(); } });
    UI.autosave(sh.$("form"), F => { j = G.joueurs.get(jid); const n = k => { const v = String(F.get(k) || "").replace(",", "."); return v === "" ? null : +v; };
      j.nom = String(F.get("nom") || "").trim() || j.nom; if (F.get("naissance") && F.get("naissance") !== j.naissance) { j.naissance = F.get("naissance"); delete j.naissanceApprox; }
      if (F.get("classement") !== (j.classement || "NC")) { j.classement = F.get("classement"); ok("classement"); }
      j.dispo = { ...(j.dispo || {}) }; for (const [f, k] of [["dpp", "pp"], ["dten", "tennis"]]) { const v = n(f); if (v == null) delete j.dispo[k]; else j.dispo[k] = v; }
      j.parents = { pere: n("pere") || null, mere: n("mere") || null }; if (!j.parents.pere && !j.parents.mere) delete j.parents;
      j.croissance = !!F.get("croissance"); j.objectifs = F.get("objectifs") || ""; j.notes = F.get("notes") || "";
      const mz = { date: G.today() }; for (const k of ["taille", "assise", "poids", "envergure"]) { const v = n(k); if (v != null && !isNaN(v)) mz[k] = v; }
      const cur = (j.mesures || []).find(x => x.date === mz.date) || {}; const base = { date: mz.date }; for (const k of ["taille", "assise", "poids", "envergure"]) if (cur[k] != null) base[k] = cur[k];
      if (Object.keys(mz).length > 1 || Object.keys(cur).length > 1) j.mesures = (j.mesures || []).filter(x => x.date !== mz.date).concat(Object.keys(mz).length > 1 ? [{ ...base, ...mz }] : Object.keys(base).length > 1 ? [base] : []);
      G.joueurs.save(j); majBar(); }, 600);
    /* mesures du jour : préremplies si déjà saisies aujourd'hui */
    const mj = (j.mesures || []).find(x => x.date === G.today()); if (mj) for (const k of ["taille", "assise", "poids", "envergure"]) if (mj[k] != null) sh.$(`[name=${k}]`).value = mj[k];
    if (o.focus) setTimeout(() => { const f = sh.$(`[name=${o.focus}]`) || sh.$(`#cp-${o.focus}`); if (f) { f.scrollIntoView({ block: "center" }); f.focus && f.focus(); } }, 120);
  });
  /* barre de complétude (HTML), avec ce qui manque et à quoi ça sert ; data-grun="completer" ouvre la feuille */
  UI.completudeHTML = (j, max = 3) => { const c = G.completude(j); if (!c) return ""; if (!c.manque.length) return `<div class="grun-compl ok"><div class="gc-h"><b>Profil complet</b><span class="gc-bar"><i style="width:100%"></i></span></div></div>`;
    return `<div class="grun-compl"><div class="gc-h"><b>Profil complet à ${c.pct} %</b><span class="gc-bar"><i style="width:${c.pct}%"></i></span></div>
      <ul>${c.manque.slice(0, max).map(x => `<li><b>${esc(x.lab)}</b> → ${esc(x.sert)}</li>`).join("")}${c.manque.length > max ? `<li class="gc-more">et ${c.manque.length - max} autre${c.manque.length - max > 1 ? "s" : ""}</li>` : ""}</ul>
      <button type="button" class="gs-btn main sm" data-grun="completer" data-jid="${esc(j.id)}" data-focus="${esc(c.manque[0].k === "taille" || c.manque[0].k === "assise" || c.manque[0].k === "poids" ? c.manque[0].k : "")}">Compléter le profil</button></div>`; };
  document.addEventListener("click", e => { const b = e.target.closest && e.target.closest('[data-grun="completer"]'); if (b) { e.preventDefault(); UI.completerProfil(b.dataset.jid, { focus: b.dataset.focus }); } });

  /* ---------- NOUVEAU GROUPE ---------- G.ui.nouveauGroupe({nom, jids, courant:true}) → Promise<groupe|null> */
  UI.nouveauGroupe = (o = {}) => new Promise(res => {
    let fini = null; const js = G.joueurs.all(), pre = new Set(o.jids || (G.courant.jid() ? [G.courant.jid()] : []));
    const sh = UI.sheet({ titre: "Nouveau groupe", html: `<form class="gs-form"><label class="gs-l">Nom du groupe<input class="gs-inp" name="nom" autocomplete="off" placeholder="Groupe 1, 13-14 ans…" value="${esc(o.nom || "")}"></label>
      ${js.length ? `<div class="gs-l">Joueurs <small>(touche pour ajouter)</small><div class="gs-chips">${js.map(j => `<button type="button" class="gs-chip" data-j="${esc(j.id)}" aria-pressed="${pre.has(j.id)}">${esc(j.nom)}</button>`).join("")}</div></div>` : `<p class="gs-m">Tu pourras ajouter des joueurs ensuite.</p>`}
      <p class="gs-err" role="alert"></p></form>`, principal: { t: "Créer le groupe", fn: () => creer() }, fermer: () => res(fini) });
    sh.el.addEventListener("click", e => { const b = e.target.closest("[data-j]"); if (b) b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") !== "true"); });
    function creer() { const nom = String(sh.$("[name=nom]").value || "").trim(); if (!nom) { sh.$(".gs-err").textContent = "Donne un nom au groupe."; sh.$("[name=nom]").focus(); return false; }
      fini = G.groupes.create({ nom, jids: sh.$$('[data-j][aria-pressed="true"]').map(b => b.dataset.j) }); if (o.courant !== false) G.courant.set("g", fini.id);
      UI.toast("Groupe « " + nom + " » créé", { action: "Ouvrir", fn: () => { location.href = G.href("joueurs", "#/g/" + fini.id); } }); return true; }
    sh.$("form").addEventListener("submit", e => { e.preventDefault(); if (creer() !== false) sh.fermer(true); });
    setTimeout(() => sh.$("[name=nom]").focus(), 60);
  });

  /* ---------- TEST / BILAN, EXERCICE : mêmes feuilles, puis le formulaire complet du module, retour ici ---------- */
  const avecRetour = (h, r) => h + (h.includes("?") ? "&" : "?") + "retour=" + encodeURIComponent(r || G.ici());
  /* G.ui.nouveauTest({jid}) : « Bilan » (une batterie de tests pour le joueur en cours) ou « Test perso » (une nouvelle mesure) */
  UI.nouveauTest = (o = {}) => new Promise(res => { const jid = o.jid || G.courant.jid(), j = jid && G.joueurs.get(jid), gid = !jid && G.courant.gid();
    UI.sheet({ titre: "Test ou bilan", html: `<div class="gs-menu">
      <a class="gs-it" href="${G.href("grilles", "#/saisie?" + (j ? "j=" + encodeURIComponent(j.id) : gid ? "g=" + encodeURIComponent(gid) : "") + "&d=" + G.today())}"><b>Saisir un test ou un bilan</b><span>Une mesure ou une batterie prête (rentrée, mi-saison, express…), sur un seul écran.</span></a>
      ${j ? `<a class="gs-it" href="${G.href("grilles", "#/joueur/" + j.id + "/bilan/nouveau")}"><b>Bilan de ${esc(prenomDe(j))}</b><span>Une batterie de tests : les tests conseillés pour son âge, prêts à noter.</span></a>` : ""}
      ${gid ? `<button type="button" class="gs-it" data-k="bg"><b>Bilan du groupe ${esc(G.groupes.get(gid).nom)}</b><span>Tous les joueurs, les mêmes tests, saisie en mode terrain.</span></button>` : ""}
      ${!j && !gid ? `<p class="gs-m">Choisis d'abord un joueur (en haut) pour lui faire un bilan.</p>` : ""}
      <a class="gs-it" href="${G.href("grilles", "#/test-nouveau")}"><b>Créer un test personnel</b><span>Une nouvelle mesure, avec ses barèmes par âge et par sexe.</span></a>
      <a class="gs-it" href="${G.href("grilles", "#p/3")}"><b>Voir tous les tests</b><span>Les fiches de tests de la méthode.</span></a></div>`, fermer: () => res(null) })
      .el.addEventListener("click", e => { if (e.target.closest('[data-k="bg"]')) { G.ui.bilanGroupe(gid); } }); });
  /* BILAN DE GROUPE — format documenté pour Grilles :
     relais {de, vers:"grilles", type:"bilan-groupe", gid, jids:[jid…], date:"AAAA-MM-JJ", retour} + adresse grilles.html#/gbilan?g=<gid>&d=<date>
     (#/gbilan/<id> reste l'adresse d'une SÉANCE de bilan existante dans Grilles ; ?g= préremplit la création : groupe, joueurs, date.
      Grilles lit G.relais.lire() quand type === "bilan-groupe", sinon ?g= ; il rend G.relais.rendre({gid, date, sid}) puis peut revenir à relais.retour) */
  UI.bilanGroupe = (gid, retour) => { const g = G.groupes.get(gid); if (!g) return; G.relais.envoyer({ de: modCourant(), vers: "grilles", type: "bilan-groupe", gid, jids: G.groupes.joueurs(gid).map(j => j.id), date: G.today(), retour: retour || G.ici() }); G.go("grilles", "#/gbilan?g=" + encodeURIComponent(gid) + "&d=" + G.today()); };
  /* SAUVEGARDE unique (même libellé et même fichier partout) : <button data-grun="sauver">Tout sauvegarder</button> ou G.sauvegarder() */
  G.TXT = { sauver: "Tout sauvegarder", restaurer: "Restaurer une sauvegarde" };
  G.sauvegarder = () => G.telecharger(G.exportAll(), "GRUN_sauvegarde_" + G.today() + ".json");
  document.addEventListener("click", e => { const b = e.target.closest && e.target.closest('[data-grun="sauver"]'); if (b) { e.preventDefault(); G.sauvegarder(); UI.toast("Sauvegarde créée : range-la dans Fichiers (iCloud Drive)."); } });
  /* G.ui.nouvelExo({nom, ligne, age, proposer, retour}) → Promise<null> : UN seul point d'entrée pour créer un exercice (« + », Séances, Warm-up, Banque).
     Ouvre banque.html#/nouveau?n=<nom>&ligne=<PP6>&a=<âge>&st=propose&retour=<ici> ; la banque revient à retour avec &exo=<ID>.
     L'âge par défaut = grille conseillée du joueur en cours ; nom aussi dans sessionStorage.grun_exo_nom. */
  /* ===== G.ui.retour — RETOUR APRÈS SÉANCE : UN SEUL COMPOSANT pour Create my session et Choose your warm-up (socle 1.4) =====
     Un seul formulaire, une seule échelle de dureté (0-10, libellés de l'accueil), tous les champs des 3 anciens formulaires :
     durée réelle · faite oui / en partie / non (déduite du terrain, modifiable) · pour qui (joueurs, présélection) · dureté pour tous
     · douleur (zone + intensité 1-10) · commentaire · par joueur (dureté, douleur, intensité, commentaire) · Enregistrer / Passer.
     G.ui.retour.ouvrir(el, {quoi, duree, fait, joueurs:[j], choix:[j], moi, sauter:"Passer", autres:[{t,href|fn}]}, onSave(res)) ;
     res = {duree, fait, rpe, douleur, comment, lignes:[{jid, rpe, douleur, comment}]} (lignes vides = sans joueur). */
  UI.retour = (() => {
    const RPEN = ["Repos","Très très facile","Très facile","Facile","Modéré","Un peu dur","Dur","Très dur","Très très dur","Presque maximal","Maximal"];
    const ZR = {dos:"Dos",genou:"Genou",talon:"Talon",cheville:"Cheville",epaule:"Épaule",poignet:"Poignet",coude:"Coude",hanche:"Hanche",cuisse:"Cuisse",mollet:"Mollet",nuque:"Nuque",autre:"Autre"};
    const e = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    const zoneSel = (cl, v) => `<select class="${cl}" aria-label="Zone de la douleur"><option value="">Pas de douleur</option>${Object.entries(ZR).map(([k,n]) => `<option value="${k}"${v===k?" selected":""}>${n}</option>`).join("")}</select>`;
    const intSel = cl => `<select class="${cl}" aria-label="Intensité de la douleur">${[...Array(10)].map((_,i) => `<option value="${i+1}"${i===2?" selected":""}>${i+1}/10</option>`).join("")}</select>`;
    const rpeSel = cl => `<select class="${cl}" aria-label="Dureté ressentie"><option value="">comme tous</option>${RPEN.map((l,i) => `<option value="${i}">${i} · ${l}</option>`).join("")}</select>`;
    function ouvrir(el, o, onSave) {
      const tous = (o.choix && o.choix.length ? o.choix : o.joueurs || []).filter(Boolean), sel = new Set((o.joueurs || []).filter(Boolean).map(j => j.id));
      const fait0 = o.fait === undefined ? true : o.fait;
      el.innerHTML = `<div class="card retour" style="margin-top:12px">
       <div class="row"><div class="f"><label for="rt-d">Durée réelle (min)</label><input id="rt-d" type="number" inputmode="numeric" min="1" max="300" value="${+o.duree || ""}"></div>
        <div class="f"><label>${o.quoi === "échauffement" ? "Échauffement fait" : "Séance faite"}</label><div class="chips" role="radiogroup">${[["1","Oui"],["p","En partie"],["0","Non"]].map(([k,t]) => `<button type="button" class="tg" data-rtf="${k}" aria-pressed="${(fait0===true&&k==="1")||(fait0==="partiel"&&k==="p")||(fait0===false&&k==="0")}">${t}</button>`).join("")}</div></div></div>
       ${!o.moi && tous.length ? `<div class="f"><label>Pour qui ? <small class="msg">le retour part dans son dossier (charge, suivi)</small></label><div class="chips">${tous.map(j => `<button type="button" class="tg sm" data-rtj="${e(j.id)}" aria-pressed="${sel.has(j.id)}">${e(j.nom)}</button>`).join("")}</div></div>` : ""}
       <div class="f"><label>${o.moi ? "Comment as-tu ressenti l'effort ?" : "Dureté ressentie"} <small class="msg">(0 = repos, 10 = maximal)</small></label><div class="chips rpe">${RPEN.map((l,i) => `<button type="button" class="tg" data-rtr="${i}" aria-pressed="false" title="${l}">${i}</button>`).join("")}</div><p class="msg" id="rt-rl">Touche une note.</p></div>
       <div class="row"><div class="f grow"><label>Douleur</label>${zoneSel("rt-z","")}</div><div class="f" id="rt-iw" hidden><label>Intensité</label>${intSel("rt-i")}</div></div>
       <div class="f"><label for="rt-c">Commentaire</label><textarea id="rt-c" rows="2" placeholder="${o.moi ? "Ce qui était dur, ce que tu as aimé…" : "Ressenti, qualité, à retenir…"}"></textarea></div>
       ${!o.moi && tous.length > 1 ? `<details class="rt-pj"><summary>Par joueur (dureté, douleur, commentaire)</summary><div class="plist">${tous.map(j => `<div class="prow" data-rtp="${e(j.id)}"${sel.has(j.id) ? "" : " hidden"}><b>${e(j.nom)}</b><div class="f"><label>Dureté</label>${rpeSel("rt-pr")}</div><div class="f"><label>Douleur</label>${zoneSel("rt-pz","")}</div><div class="f"><label>Intensité</label>${intSel("rt-pi")}</div><div class="f pc"><label>Commentaire</label><input class="rt-pc" placeholder="facultatif"></div></div>`).join("")}</div></details>` : ""}
       <p class="msg" id="rt-m" role="alert"></p>
       <div class="tools"><button class="go big" id="rt-ok" type="button">Enregistrer le retour</button>${o.sauter ? `<button class="ib" id="rt-no" type="button">${e(o.sauter)}</button>` : ""}${(o.autres || []).map((a,i) => a.href ? `<a class="ib" href="${e(a.href)}">${e(a.t)}</a>` : `<button class="ib" type="button" data-rta="${i}">${e(a.t)}</button>`).join("")}</div></div>`;
      const $1 = s => el.querySelector(s), $n = s => [...el.querySelectorAll(s)];
      let rpe = null, fait = fait0;
      $n("[data-rtf]").forEach(b => b.onclick = () => { fait = b.dataset.rtf === "1" ? true : b.dataset.rtf === "p" ? "partiel" : false; $n("[data-rtf]").forEach(x => x.setAttribute("aria-pressed", x === b)); });
      $n("[data-rtr]").forEach(b => b.onclick = () => { rpe = +b.dataset.rtr; $n("[data-rtr]").forEach(x => x.setAttribute("aria-pressed", x === b)); $1("#rt-rl").textContent = rpe + " · " + RPEN[rpe]; });
      $n("[data-rtj]").forEach(b => b.onclick = () => { const k = b.dataset.rtj; sel.has(k) ? sel.delete(k) : sel.add(k); b.setAttribute("aria-pressed", sel.has(k)); const r = $1(`[data-rtp="${k}"]`); if (r) r.hidden = !sel.has(k); });
      $1(".rt-z").onchange = ev => { $1("#rt-iw").hidden = !ev.target.value; };
      $n("[data-rta]").forEach(b => b.onclick = () => { const a = o.autres[+b.dataset.rta]; a && a.fn && a.fn(); });
      $1("#rt-no") && ($1("#rt-no").onclick = () => o.onSkip && o.onSkip());
      $1("#rt-ok").onclick = () => {
        const z = $1(".rt-z").value, dl = z ? {zone: z, int: +$1(".rt-i").value} : null, com = $1("#rt-c").value.trim(), lignes = [];
        const ids = o.moi ? (o.joueurs || []).filter(Boolean).map(j => j.id) : tous.filter(j => sel.has(j.id)).map(j => j.id);
        for (const jid of ids) { const r = $1(`[data-rtp="${jid}"]`); let v = rpe, d = dl, c = com;
          if (r) { const pv = r.querySelector(".rt-pr").value, pz = r.querySelector(".rt-pz").value, pc = r.querySelector(".rt-pc").value.trim(); if (pv !== "") v = +pv; if (pz) d = {zone: pz, int: +r.querySelector(".rt-pi").value}; if (pc) c = pc; }
          if (v == null) continue; lignes.push({jid, rpe: v, douleur: d, comment: c}); }
        if (rpe == null && !lignes.length) { $1("#rt-m").textContent = "Choisis la dureté ressentie (0 à 10)" + (tous.length > 1 ? ", pour tous ou par joueur." : "."); return; }
        onSave({duree: Math.max(1, +$1("#rt-d").value || +o.duree || 1), fait, rpe, douleur: dl, comment: com, lignes});
      };
    }
    return {ouvrir, RPEN, ZONES: ZR};
  })();

  UI.nouvelExo = (o = {}) => new Promise(res => {
    const jc = G.courant.jid && G.courant.jid(), jj = jc && G.joueurs.get(jc), age = o.age != null ? o.age : (jj ? G.grilleConseillee(jj) : null);
    const sh = UI.sheet({ titre: "Nouvel exercice", html: `<form class="gs-form"><label class="gs-l">Nom de l'exercice<input class="gs-inp" name="nom" autocomplete="off" value="${esc(o.nom || "")}" placeholder="Ex. : relais des 4 coins"></label>
      <p class="gs-m">La fiche complète s'ouvre ensuite (but, consignes, matériel, vidéo, photo, usage en échauffement). Tu reviens ici après.</p>
      <label class="gs-c"><input type="checkbox" name="prop"${o.proposer ? " checked" : ""}> Le proposer pour la banque générale <small>(sinon il reste à toi)</small></label></form>`,
      principal: { t: "Continuer", fn: () => { const n = String(sh.$("[name=nom]").value || "").trim(); try { sessionStorage.setItem("grun_exo_nom", n); } catch (e) {}
        const q = [n && "n=" + encodeURIComponent(n), o.ligne && "ligne=" + encodeURIComponent(o.ligne), age != null && "a=" + encodeURIComponent(age), sh.$("[name=prop]").checked && "st=propose"].filter(Boolean).join("&");
        res(null); location.href = G.href("banque", avecRetour("#/nouveau" + (q ? "?" + q : ""), o.retour)); return true; } }, fermer: () => res(null) });
    sh.$("form").addEventListener("submit", e => { e.preventDefault(); sh.$('[data-gs="p"]').click(); }); setTimeout(() => { const i = sh.$("[name=nom]"); i && i.focus(); }, 60); });

  /* ---------- relais vers Create (joueur ou groupe en cours + réglages coach) ---------- */
  function versCreate(vers, o = {}) {
    const jid = o.jid !== undefined ? o.jid : G.courant.jid(), gid = o.gid !== undefined ? o.gid : (jid ? null : G.courant.gid()), j = jid && G.joueurs.get(jid), C = G.reglages.coach(), cr = G.reglages.prochainCreneau();
    G.relais.envoyer({ de: modCourant(), vers, retour: G.ici(), jid: jid || null, gid: gid || null, age: j ? G.grilleConseillee(j) : null, duree: (cr && cr.duree) || C.duree, lieu: C.lieu || null, materiel: C.materiel, date: cr ? cr.date : null, ...(o.relais || {}) });
    const H = { seances: "#/nouvelle", warmup: "#/nouveau", prog: jid ? "#/nouveau/" + jid : gid ? "#/groupe/" + gid : "#/nouveau" };
    G.go(vers, H[vers]);
  }
  /* « Session » : ouvre Create my session pour le joueur (ou groupe) en cours, durée/lieu/matériel/date du prochain créneau habituel */
  UI.session = o => versCreate("seances", o);
  UI.echauffement = o => versCreate("warmup", o);
  UI.prog = o => versCreate("prog", o);
  /* choisir un joueur si aucun n'est en cours, puis lancer fn(jid) */
  UI.choisirJoueur = (titre, fn, o = {}) => { const c = G.courant.get(); if (c && !o.toujours) return fn(c.t === "j" ? c.id : null, c.t === "g" ? c.id : null);
    const js = G.joueurs.all(), gs = o.groupes === false ? [] : G.groupes.all();
    const sh = UI.sheet({ titre: titre || "Pour qui ?", html: js.length || gs.length ? `<div class="gs-chips big">${js.map(j => `<button type="button" class="gs-chip" data-pj="${esc(j.id)}">${esc(j.nom)}</button>`).join("")}${gs.map(g => `<button type="button" class="gs-chip g" data-pg="${esc(g.id)}">${esc(g.nom)}</button>`).join("")}</div>${o.sansJoueur ? `<button type="button" class="gs-lien" data-pj="">Sans joueur</button>` : ""}` : `<p class="gs-m">Aucun joueur pour l'instant.</p><button type="button" class="gs-btn main" data-nj="1">Créer un joueur</button>` });
    sh.el.addEventListener("click", e => { const b = e.target.closest("[data-pj],[data-pg]"); if (e.target.closest("[data-nj]")) { sh.fermer(); UI.nouveauJoueur().then(j => j && fn(j.id, null)); return; } if (!b) return;
      sh.fermer(); if (b.dataset.pg) { G.courant.set("g", b.dataset.pg); fn(null, b.dataset.pg); } else { if (b.dataset.pj) G.courant.set("j", b.dataset.pj); fn(b.dataset.pj || null, null); } }); };

  /* ---------- NOTE DE JOURNAL (10 s) ---------- G.ui.noteJournal({jid}) → Promise<retour|null> */
  UI.noteJournal = (o = {}) => new Promise(res => { let fini = null;
    const go = jid => { const j = G.joueurs.get(jid); if (!j) return res(null);
      const sh = UI.sheet({ titre: "Note · " + prenomDe(j), html: `<form class="gs-form"><div class="gs-l">C'était ${seg("type", [["seance", "Une séance"], ["tennis", "Du tennis"], ["match", "Un match"], ["autre", "Une note"]], "autre")}</div>
        <label class="gs-l">Note<textarea class="gs-inp gs-ta" name="comment" rows="3" placeholder="Ce qui s'est passé, ce que tu as vu…"></textarea></label>
        <details class="gs-plus"><summary>Durée et dureté (pour la charge)</summary><div class="gs-grid"><label class="gs-l gs-n">Durée (min)<input class="gs-inp" type="number" name="duree" inputmode="numeric" min="0" max="300"></label>
        <label class="gs-l gs-n">Dureté 0-10<input class="gs-inp" type="number" name="rpe" inputmode="numeric" min="0" max="10"></label></div></details>
        <p class="gs-m"><a href="${G.href("joueurs", "#/j/" + j.id + "/retour")}">Formulaire complet (douleur, fait ou pas, forme du jour)</a></p></form>`,
        principal: { t: "Enregistrer la note", fn: () => { const F = new FormData(sh.$("form")), t = segVal(sh, "type") || "autre", c = String(F.get("comment") || "").trim(), du = +F.get("duree") || 0, rp = F.get("rpe") === "" || F.get("rpe") == null ? null : +F.get("rpe");
          if (!c && !du) { sh.$("textarea").focus(); return false; }
          fini = G.journal.addRetour({ jid, date: G.today(), type: t, titre: { seance: "Séance", tennis: "Tennis", match: "Match", autre: "Note" }[t], duree: du, rpe: rp, douleur: null, fait: true, comment: c, note: true });
          UI.annuler("Note ajoutée au journal de " + prenomDe(j), () => G.journal.remove(fini.id)); return true; } }, fermer: () => res(fini) });
      bindSeg(sh); setTimeout(() => sh.$("textarea").focus(), 60); };
    const jid = o.jid || G.courant.jid(); if (jid) go(jid); else UI.choisirJoueur("Note pour qui ?", (a) => a ? go(a) : res(null), { toujours: true, groupes: false }); });

  /* ---------- CHIP « joueur en cours » (barre du haut) ---------- */
  function chipHTML() { const c = G.courant.get(); return c ? `<span class="gc-av${c.t === "g" ? " g" : ""}">${esc((c.nom || "?").slice(0, 1).toUpperCase())}</span><span class="gc-nm">${esc(c.t === "j" ? prenomDe(c.joueur) : c.nom)}</span>` : `<span class="gc-av vide">+</span><span class="gc-nm">Joueur</span>`; }
  UI.choisirCourant = () => { const c = G.courant.get(), R = G.courant.recents().filter(x => !c || x.id !== c.id), js = G.joueurs.all(), gs = G.groupes.all();
    const sh = UI.sheet({ titre: "Joueur ou groupe en cours", html: `<p class="gs-m">Choisi une fois, il est repris partout : séance, échauffement, bilan, programmation, note.</p>
      ${c ? `<div class="gs-cur"><b>${esc(c.nom)}</b><span>${c.t === "g" ? "groupe" : "joueur"} en cours</span><a class="gs-btn sec sm" href="${G.href("joueurs", (c.t === "g" ? "#/g/" : "#/j/") + c.id)}">Ouvrir le dossier</a><button type="button" class="gs-btn sec sm" data-cc="">Aucun</button></div>` : ""}
      ${R.length ? `<div class="gs-l">Récents<div class="gs-chips big">${R.map(x => `<button type="button" class="gs-chip${x.t === "g" ? " g" : ""}" data-cc="${x.t}:${esc(x.id)}">${esc(x.nom)}</button>`).join("")}</div></div>` : ""}
      ${js.length ? `<div class="gs-l">Joueurs<div class="gs-chips">${js.map(j => `<button type="button" class="gs-chip" data-cc="j:${esc(j.id)}" aria-pressed="${!!c && c.id === j.id}">${esc(j.nom)}</button>`).join("")}</div></div>` : ""}
      ${gs.length ? `<div class="gs-l">Groupes<div class="gs-chips">${gs.map(g => `<button type="button" class="gs-chip g" data-cc="g:${esc(g.id)}" aria-pressed="${!!c && c.id === g.id}">${esc(g.nom)}</button>`).join("")}</div></div>` : ""}`,
      secondaire: [{ t: "+ Nouveau groupe", fn: () => { setTimeout(() => UI.nouveauGroupe(), 180); return true; } }], principal: { t: "+ Nouveau joueur", fn: () => { setTimeout(() => UI.nouveauJoueur(), 180); return true; } } });
    sh.el.addEventListener("click", e => { const b = e.target.closest("[data-cc]"); if (!b) return; const [t, id] = b.dataset.cc.split(":"); G.courant.set(t || null, id || null); sh.fermer(true); UI.toast(id ? "En cours : " + b.textContent : "Aucun joueur en cours"); }); };
  function majChip() { $qq(".grun-chip").forEach(b => { b.innerHTML = chipHTML(); b.setAttribute("aria-label", "Joueur en cours : " + (G.courant.get() ? G.courant.get().nom : "aucun") + ". Changer"); }); }
  G.courant.onChange(majChip); G.on(G.K.joueurs, majChip); G.on(G.K.groupes, majChip);

  /* ---------- AIDE « ? » : une ou deux phrases par écran ----------
     G.aide("seances", "texte") enregistre ; G.aide.ecran("seances/terrain") dit quel écran est affiché ; G.aide.montrer() ouvre la bulle.
     Clé cherchée : écran déclaré, puis « module/premier-segment-de-l'adresse », puis module. */
  const AIDE = {};
  let ECRAN = null;
  G.aide = (cle, texte) => { if (cle && texte) AIDE[cle] = texte; return AIDE[cle] || null; };
  G.aide.ecran = cle => { ECRAN = cle; };
  G.aide.texte = () => { const mod = modCourant(), seg0 = (location.hash.replace(/^#\/?/, "").split(/[\/?]/)[0] || "").replace(/^[a-z]$/, x => x);
    return (ECRAN && AIDE[ECRAN]) || AIDE[mod + "/" + seg0] || AIDE[mod] || "GRÜN : tout part du joueur. Choisis un joueur en haut, touche « + » pour créer, et « ? » pour savoir à quoi sert chaque écran."; };
  G.aide.montrer = () => UI.sheet({ titre: "À quoi sert cet écran ?", html: `<p class="gs-p">${esc(G.aide.texte())}</p>
    <div class="gs-menu"><button type="button" class="gs-it" data-k="visite"><b>Visite guidée (2 min)</b><span>Les 4 pôles et la poupée russe, en 7 étapes.</span></button>
    <a class="gs-it" href="${G.href("accueil", "#/comment")}"><b>Comment ça marche</b><span>Le schéma de GRÜN sur une page.</span></a>
    <div class="gs-it st"><b>Mode ${G.expert() ? "Expert" : "Simple"}</b><span>${G.expert() ? "Tu vois tout : codes, barèmes détaillés, réglages fins." : "L'essentiel. Rien n'est perdu : le mode Expert montre tout."}</span>${seg("xp", [["0", "Simple"], ["1", "Expert"]], G.expert() ? "1" : "0")}</div></div>` })
    .el.addEventListener("click", function (e) { if (e.target.closest('[data-k="visite"]')) { $qq(".grun-ov").forEach(x => x.remove()); SHEETS = 0; document.documentElement.classList.remove("grun-sheet-on"); G.visite(); }
      const s = e.target.closest('[data-seg="xp"]'); if (s) { G.setExpert(s.dataset.v === "1"); this.querySelectorAll('[data-seg="xp"]').forEach(x => x.setAttribute("aria-checked", x === s)); UI.toast(s.dataset.v === "1" ? "Mode Expert : tout est visible" : "Mode Simple : l'essentiel"); } });
  /* « ? » : ouvre l'Assistant GRÜN (G.assistant, si présent) avec l'aide de l'écran en tête ; sinon la bulle d'aide simple */
  G.aide.ouvrir = (q, source) => { const mod = modCourant(), seg0 = (location.hash.replace(/^#\/?/, "").split(/[\/?]/)[0] || "");
    if (G.assistant && typeof G.assistant.open === "function") { try { return G.assistant.open(q || "", { aide: G.aide.texte(), ecran: ECRAN || (mod + (seg0 ? "/" + seg0 : "")), source: source || "aide" }); } catch (e) { console.warn("assistant", e); } }
    return G.aide.montrer(); };
  /* textes d'aide par défaut des modules (chaque module peut les remplacer par G.aide(cle, texte)) */
  Object.entries({
    accueil: "L'accueil : en haut, l'agenda des prochains jours (touche une séance pour la lancer ou la construire, touche « Agenda » pour la semaine complète). Puis ton joueur en cours, les 4 pôles et l'assistant.",
    "accueil/semaine": "Ma semaine : l'agenda complet jour par jour, les actions conseillées (bilans à refaire, charge, profils à compléter), « Reprendre » et les alertes.",
    "accueil/joueurs": "Tous tes joueurs et tes groupes. Touche un joueur pour ouvrir son dossier ; « + » en bas pour en créer un ou plusieurs d'un coup.",
    "accueil/j": "Le dossier du joueur : tout ce qui le concerne. En haut, la prochaine action conseillée ; la Frise montre tests, séances, blessures, notes et objectifs dans l'ordre.",
    "accueil/g": "Le dossier du groupe : séance, échauffement, bilan et programmation pour tous, présences, âges et maturation. Chaque joueur garde son propre dossier.",
    "accueil/pole": "La page d'un pôle : les gros boutons mènent aux outils ; « Plus d'options » garde tous les modules et raccourcis.",
    "accueil/recherche": "La recherche trouve tout : un prénom ouvre son dossier, « F12 » la grille filles 12 ans, « tester Tom » ou « créer séance » lance l'action.",
    "accueil/reglages": "Tes réglages : affichage, mode Simple ou Expert, tes habitudes de coach (matériel, lieu, créneaux, durée) qui préremplissent les créations, sauvegarde et démonstration.",
    "accueil/comment": "GRÜN en une page : les 4 pôles et la poupée russe (la programmation contient les séances, la séance contient l'échauffement).",
    prog: "Create my prog : la programmation d'un joueur ou d'un groupe, d'une semaine à une saison. Chaque séance prévue se construit ensuite dans Create my session.",
    seances: "Create my session : la séance se construit seule (structure, exercices de la banque, échauffement) ; tu touches un exercice pour le changer, puis tu lances le mode terrain.",
    warmup: "Choose your warm-up : choisis la durée, ce qui suit et le lieu, et lance. L'échauffement s'enchaîne seul, chrono et vidéos compris.",
    veille: "La veille : les documents de la méthode (âge, physique, geste, entraîner). Commence par « L'essentiel », puis « Mettre en pratique ».",
    banque: "La banque d'exercices : tous les exercices rangés par qualité travaillée, filtrés pour l'âge. Ton exercice personnel s'ajoute avec « + ».",
    saisons: "Le référentiel : une saison de référence par âge et par sexe, semaine par semaine. « Utiliser comme base » la transforme en programmation pour ton joueur.",
    grilles: "Grilles et tests : la grille de compétences de chaque âge, les tests (une mesure) et les bilans (une batterie de tests) qui donnent le profil radar."
  }).forEach(([k, t]) => G.aide(k, t));

  /* ---------- VISITE GUIDÉE (≈ 2 min, 7 étapes) ---------- G.visite() */
  G.SCHEMA = `<svg class="grun-schema" viewBox="0 0 320 210" role="img" aria-label="Les 4 pôles de GRÜN et la poupée russe">
    <rect x="4" y="4" width="152" height="96" rx="12" class="s-ind"/><text x="80" y="34" class="s-t">Individualisation</text><text x="80" y="54" class="s-s">dossier du joueur</text><text x="80" y="70" class="s-s">et du groupe</text>
    <rect x="164" y="4" width="152" height="96" rx="12" class="s-tests"/><text x="240" y="34" class="s-t">Tests et profilage</text><text x="240" y="54" class="s-s">grilles, tests, bilans,</text><text x="240" y="70" class="s-s">profil radar</text>
    <rect x="4" y="108" width="152" height="98" rx="12" class="s-res"/><text x="80" y="138" class="s-t">Ressources</text><text x="80" y="158" class="s-s">veille, banque d'exercices,</text><text x="80" y="174" class="s-s">référentiel</text>
    <rect x="164" y="108" width="152" height="98" rx="12" class="s-create"/><text x="240" y="126" class="s-t">Create</text>
    <rect x="172" y="132" width="136" height="68" rx="9" class="s-d1"/><text x="180" y="146" class="s-k">programmation</text>
    <rect x="182" y="150" width="118" height="44" rx="7" class="s-d2"/><text x="190" y="164" class="s-k">séance</text>
    <rect x="192" y="168" width="98" height="20" rx="5" class="s-d3"/><text x="241" y="182" class="s-k c">échauffement</text></svg>`;
  G.visite = () => {
    const E = [
      ["Bienvenue dans GRÜN", "La méthode du joueur de tennis de 4 à 18 ans, dans une seule appli : préparation physique, geste, déplacement, jusqu'à la séance. Tout reste sur ton appareil.", G.SCHEMA],
      ["1 · Individualisation", "Tout part du joueur. Son dossier rassemble tout : fiche, croissance, tests, programmations, séances, journal, blessures, objectifs. La Frise les met dans l'ordre et une prochaine action est conseillée en haut.", ""],
      ["2 · Create : la poupée russe", "Create my prog contient des séances ; Create my session contient un échauffement ; Choose your warm-up le construit. Chacun s'utilise seul, ou s'emboîte : tu pars de la programmation et tu reviens à la programmation.", `<div class="grun-doll"><div>Programmation<div>Séance<div>Échauffement</div></div></div></div>`],
      ["3 · Ressources et savoirs", "La veille (les documents de la méthode), la banque d'exercices et le référentiel des saisons types. Tout ce que Create propose vient de là.", ""],
      ["4 · Tests et profilage", "Un test, c'est une mesure ; un bilan, c'est une batterie de tests. Les résultats placent le joueur sur sa grille et dessinent son profil radar.", ""],
      ["Le joueur en cours et le « + »", "Choisis ton joueur une fois, en haut : chaque outil le reprend. Le « + » en bas, toujours au même endroit, crée un joueur, un groupe, une séance, un bilan, un exercice, une note ou un échauffement.", `<div class="grun-demo-bar"><span class="grun-chip demo"><span class="gc-av">L</span><span class="gc-nm">Léa</span></span><span class="grun-plus-demo">+</span></div>`],
      ["Simple ou Expert, et « ? »", "Le mode Simple montre l'essentiel ; le mode Expert montre tout (codes, barèmes, réglages fins). Rien n'est jamais retiré. Le « ? » en haut dit à quoi sert chaque écran.", ""]
    ];
    let i = 0; const sh = UI.sheet({ titre: "Visite guidée", large: true, html: `<div class="gv"></div>`, secondaire: [{ t: "Passer", fn: () => true }], principal: { t: "Suivant", fn: () => { if (i < E.length - 1) { i++; draw(); return false; } G.reglages.set({ visite: G.today() }); return true; } } });
    const draw = () => { const [t, x, v] = E[i]; sh.$(".gv").innerHTML = `<div class="gv-dots">${E.map((_, k) => `<i class="${k === i ? "on" : k < i ? "vu" : ""}"></i>`).join("")}</div><h3>${esc(t)}</h3><p class="gs-p">${esc(x)}</p>${v || ""}`; sh.$('[data-gs="p"]').textContent = i < E.length - 1 ? "Suivant" : "C'est parti"; };
    draw();
  };

  /* ---------- BOUTON « + » UNIQUE (au centre de la barre du bas, toujours au même endroit) ----------
     G.plus.ouvrir() ; G.plus.ajouter({id, t, s, fn, haut:true}) ajoute une entrée propre à la page (en tête si haut). */
  const PLUSX = [];
  G.plus = {
    ajouter(x) { const i = PLUSX.findIndex(y => y.id === x.id); if (i >= 0) PLUSX[i] = x; else PLUSX.push(x); },
    retirer(id) { const i = PLUSX.findIndex(y => y.id === id); if (i >= 0) PLUSX.splice(i, 1); },
    ouvrir() {
      const J = G.isJoueur(), c = G.courant.get(), pour = c ? " pour " + (c.t === "j" ? prenomDe(c.joueur) : c.nom) : "";
      const L = J ? [["note", "Note de journal", "Un retour sur ta séance, en 10 secondes"], ["wu", "Échauffement", "Prépare et lance ton échauffement"]]
        : [["joueur", "Joueur", "Prénom, sexe, naissance : c'est tout. Ou plusieurs d'un coup."], ["groupe", "Groupe", "Un nom, ses joueurs."], ["session", "Séance" + pour, "Ouvre Create my session" + (c ? "" : " (choisis le joueur)")],
          ["test", "Test ou bilan" + (c && c.t === "j" ? pour : ""), "Un test = une mesure ; un bilan = une batterie de tests."], ["exo", "Exercice", "Ton exercice dans la banque, utilisable partout."], ["note", "Note de journal" + (c && c.t === "j" ? pour : ""), "Ce qui s'est passé, en 10 secondes."], ["wu", "Échauffement" + pour, "Choose your warm-up, prêt à lancer."]];
      const X = J ? [] : PLUSX;
      const sh = UI.sheet({ titre: "Créer", html: `<div class="gs-menu plus">${X.filter(x => x.haut).concat(X.filter(x => !x.haut)).map(x => `<button type="button" class="gs-it x" data-px="${esc(x.id)}"><b>${esc(x.t)}</b><span>${esc(x.s || "")}</span></button>`).join("")}
        ${L.map(([k, t, s]) => `<button type="button" class="gs-it" data-p="${k}"><i class="pi pi-${k}"></i><b>${esc(t)}</b><span>${esc(s)}</span></button>`).join("")}</div>` });
      sh.el.addEventListener("click", e => { const b = e.target.closest("[data-p],[data-px]"); if (!b) return; sh.fermer(true);
        if (b.dataset.px) { const x = PLUSX.find(y => y.id === b.dataset.px); return x && setTimeout(() => x.fn(), 170); }
        setTimeout(() => G.plus.faire(b.dataset.p), 170); });
    },
    /* lance une entrée du « + » par son nom : joueur, joueurs (plusieurs), groupe, session, test, exercice, note, wu */
    faire(k) { ({
      joueur: () => UI.nouveauJoueur(), joueurs: () => UI.nouveauJoueur({ multiple: true }), groupe: () => UI.nouveauGroupe(),
      session: () => UI.choisirJoueur("Séance pour qui ?", (jid, gid) => UI.session({ jid, gid }), { sansJoueur: true }),
      test: () => UI.nouveauTest(), exo: () => UI.nouvelExo(), note: () => UI.noteJournal({ jid: G.isJoueur() ? G.mode().jid : undefined }),
      wu: () => G.isJoueur() ? (G.relais.envoyer({ de: "accueil", vers: "warmup", retour: G.ici(), jid: G.mode().jid, mode: "joueur" }), G.go("warmup")) : UI.choisirJoueur("Échauffement pour qui ?", (jid, gid) => UI.echauffement({ jid, gid }), { sansJoueur: true })
    }[k] || (() => {}))(); }
  };

  /* ---------- PREMIER LANCEMENT dans un module (sans passer par l'accueil) : rien ; l'accueil gère l'accueil en 3 étapes ---------- */

  /* ---------- typographie française (1.4) : espace insécable avant « : ; ? ! » et à l'intérieur des guillemets « », sur les textes affichés
     (nœuds de texte seulement : jamais les champs, scripts, styles ni le code). ---------- */
  G.typo = (() => {
    const SKIP = /^(SCRIPT|STYLE|TEXTAREA|INPUT|CODE|PRE|NOSCRIPT|OPTION)$/;
    const fixT = t => t.replace(/([^\s\u00a0\u202f(]) ([:;?!»])/g, "$1\u00a0$2").replace(/« /g, "«\u00a0");
    const nd = n => { const p = n.parentNode; if (!p || SKIP.test(p.nodeName) || (p.closest && p.closest("[contenteditable],code,pre,textarea"))) return; const v = n.data; if (v.length < 2 || !/ [:;?!»]|« /.test(v)) return; const w = fixT(v); if (w !== v) n.data = w; };
    const tout = r => { if (!r) return; if (r.nodeType === 3) return nd(r); if (r.nodeType !== 1 || SKIP.test(r.nodeName)) return; const tw = document.createTreeWalker(r, NodeFilter.SHOW_TEXT); let n; while ((n = tw.nextNode())) nd(n); };
    const go = () => { tout(document.body); try { new MutationObserver(M => { for (const m of M) { if (m.type === "characterData") nd(m.target); else m.addedNodes.forEach(tout); } }).observe(document.body, { childList: true, subtree: true, characterData: true }); } catch (e) {} };
    if (typeof document !== "undefined") { if (document.body) go(); else addEventListener("DOMContentLoaded", go); }
    return { texte: fixT };
  })();

  /* service worker commun */
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
})();
