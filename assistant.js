/* GRÜN — Assistant (hors connexion, sans IA) : répond aux questions à partir d'une base préparée (assistant.json).
   Chargé par build.py sur toutes les pages, juste après grun.js.
   API : G.assistant.open(q?, {aide, ecran, source}) · close() · chercher(q) → [{id, score, e}] · guideProg(o?) · questions()
   Moteur : normalisation (accents, casse, élisions), synonymes, racines légères, tolérance aux fautes (préfixes + Levenshtein),
   poids par champ (question et variantes > mots-clés), pondération par rareté des mots, couverture de la meilleure variante. */
(function () {
  "use strict";
  const G = window.GRUN; if (!G || G.assistant) return;
  G.K.questions = G.K.questions || "grun_questions_v1";   /* questions envoyées : incluses dans G.exportAll (qui parcourt G.K) */
  const esc = G.esc;

  /* ---------- normalisation ---------- */
  const STOP = new Set(("a au aux avec ce ces cet cette dans de des du elle en est et il ils je j l la le les leur lui ma mais me mes moi mon ne ni nous on ou par pas pour qu que qui sa se ses si son sur ta te tes toi ton tu un une vos votre vous y d s c n m t "
    + "comment quoi quel quelle quels quelles est-ce faut veux voudrais peux peut puis dois doit faire fait fais comment combien ou svp stp merci bonjour salut hello oui alors donc bah ben euh bon "
    + "ca cela ceci ici la-bas tout toute tous toutes tres trop plus moins bien encore deja aussi comme quand chez etre avoir ai as avons ont suis es sommes sont va vais vas aller c'est est faut-il dit dire mettre met").split(/\s+/));
  /* mots porteurs de sens à garder même s'ils ressemblent à des mots vides */
  const KEEP = new Set(["quand", "combien", "trop", "plus", "faire", "mettre"]);
  ["quand", "combien", "trop", "plus", "qui", "faire", "mettre", "met"].forEach(w => STOP.delete(w));
  const SYN = {};
  [["prog", "programme", "programmes", "programmation", "programmations", "programmer", "plan", "plans", "planifier", "planification", "planning", "progr", "progs"],
   ["seance", "seances", "session", "sessions", "entrainement", "entrainements", "entrainer", "training", "cours", "entrainment", "seence", "sceance", "seanse"],
   ["echauffement", "echauffements", "warmup", "warm", "echauf", "echauff", "echauffer", "echauffe", "chauffe", "chauffer", "chauffent", "echaufement", "echaufement", "echauffment"],
   ["exo", "exos", "exercice", "exercices", "exercise", "exo's", "exercies"],
   ["joueur", "joueurs", "eleve", "eleves", "enfant", "enfants", "gamin", "gamins", "gosse", "ado", "ados", "jeune", "jeunes", "athlete", "joueuse", "joueuses", "jouer"],
   ["creer", "cree", "creee", "creation", "ajouter", "ajoute", "rajouter", "nouveau", "nouvelle", "inscrire", "rentrer", "saisir", "faire", "fabriquer", "preparer", "monter", "mettre", "met", "mets"],
   ["supprimer", "supprime", "suppression", "effacer", "efface", "enlever", "enleve", "virer", "delete"],
   ["bilan", "bilans", "evaluation", "evaluer", "evalue", "batterie"],
   ["test", "tests", "tester", "teste"],
   ["imprimer", "imprime", "impression", "pdf", "print"],
   ["sauvegarder", "sauvegarde", "sauvegardes", "backup", "sauver", "exporter", "export"],
   ["groupe", "groupes", "equipe", "equipes", "collectif", "collective"],
   ["blessure", "blessures", "blesse", "blessee"],
   ["pliometrie", "plio", "plyo", "pliometrique", "plyometrie", "pliometri"],
   ["musculation", "muscu", "musculaire"],
   ["sommeil", "dormir", "dort", "dors", "dodo"],
   ["tournoi", "tournois", "competition", "competitions", "compet", "compete"],
   ["recuperation", "recup", "recuperer", "recupere", "recuperation"],
   ["veille", "document", "documents", "doc", "docs", "article", "articles"],
   ["croissance", "grandit", "grandir", "grandi", "poussee", "puberte", "phv", "aphv"],
   ["modifier", "modif", "changer", "change", "editer", "corriger"],
   ["lancer", "lance", "demarrer", "demarre", "commencer", "start"],
   ["imprimer", "imprimante"],
   ["telephone", "iphone", "portable", "smartphone"],
   ["vitesse", "rapidite", "sprint", "sprints", "vite"],
   ["fille", "filles", "feminine"],
   ["garcon", "garcons", "gars"],
   ["douleur", "douleurs", "mal", "souffre"],
   ["voir", "afficher", "consulter", "regarder"],
   ["envoyer", "envoie", "partager", "partage", "transmettre"],
   ["mode", "modes"],
   ["sombre", "nuit", "dark", "noir"],
   ["reglages", "reglage", "parametres", "parametre", "settings", "options"],
   ["exo", "jeux"],
   ["grille", "grilles", "griles"],
   ["radar", "toile"],
   ["favori", "favoris", "prefere", "preferes", "coeur", "etoile"],
   ["boire", "hydratation", "hydrater", "boisson"],
   ["manger", "nutrition", "alimentation", "repas", "collation"],
   ["genou", "genoux"],
   ["osgood", "osgoodschlatter", "osgod", "osgoud"],
   ["referentiel", "reference", "references"],
   ["fatigue", "fatigu", "creve", "crevee", "epuise", "epuisee", "naze", "cuit", "lessive"],
   ["minute", "minutes", "min", "mn", "mins"],
   ["restaurer", "restauration", "remettre", "recharger", "reimporter"],
   ["appel", "presences", "presence", "absent", "absents", "assiduite"]
  ].forEach(g => g.forEach(w => { if (!SYN[w]) SYN[w] = g[0]; }));
  const deacc = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/œ/g, "oe").replace(/æ/g, "ae");
  const racine = w => { if (/^\d+$/.test(w) || w.length <= 4) return w; const r = w.replace(/(ements|ement|ees|ee|es|er|ez|ent|e|s|x)$/, ""); return r.length >= 4 ? r : w; };
  function mots(s) {
    return deacc(s).replace(/['’`]/g, " ").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(w => w && !STOP.has(w) && (w.length > 1 || /\d/.test(w)))
      .map(w => racine(SYN[w] || SYN[racine(w)] || w)).map(w => SYN[w] || w);
  }

  /* ---------- similarité de deux mots (fautes de frappe) ---------- */
  function lev(a, b, max) { if (Math.abs(a.length - b.length) > max) return max + 1; let p = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) { const c = [i]; let m = i; for (let j = 1; j <= b.length; j++) { c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); if (c[j] < m) m = c[j]; } if (m > max) return max + 1; p = c; } return p[b.length]; }
  function sim(a, b) { if (a === b) return 1; const n = Math.min(a.length, b.length);
    if (n >= 4 && (a.startsWith(b) || b.startsWith(a))) return n / Math.max(a.length, b.length) >= 0.6 ? 0.85 : 0.6;
    if (/\d/.test(a) || /\d/.test(b)) return 0;
    if (n >= 4) { const d = lev(a, b, 2); if (d === 1) return 0.8; if (d === 2 && n >= 7) return 0.65; }
    return 0; }

  /* ---------- index ---------- */
  let HORS = [];
  let BASE = null, PROM = null, VOC = null, IDF = null, N = 1;
  const W_Q = 1, W_M = 0.85, W_R = 0.35;
  function indexer(E) {
    const df = {}; VOC = new Set();
    for (const e of E) {
      const vs = [e.q, ...(e.variantes || [])].map(mots);
      e._v = vs.map(t => [...new Set(t)]); e._vn = vs.map(t => t.join(" ")); e._q = new Set(vs.flat()); e._m = new Set((e.mots || []).flatMap(mots)); e._r = new Set(mots(e.reponse));
      for (const w of new Set([...e._q, ...e._m])) df[w] = (df[w] || 0) + 1;
      for (const w of [...e._q, ...e._m, ...e._r]) VOC.add(w);
      e._byId = null;
    }
    N = E.length; IDF = {}; for (const w in df) IDF[w] = Math.log(1 + N / df[w]);
    BASE = E; BASE.byId = Object.fromEntries(E.map(e => [e.id, e]));
  }
  const idf = w => IDF[w] != null ? IDF[w] : Math.log(1 + N / 1.5);
  G.assistant = {};
  const charger = () => PROM || (PROM = fetch("assistant.json").then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(d => { indexer(d.e || []); HORS = (d.hors || []).map(deacc); return BASE; }).catch(e => { PROM = null; throw e; }));

  /* prénoms des joueurs dans la question (« tester Tom ») : retirés de la recherche, repris pour les actions */
  function prenomsDans(q) { const n = deacc(q); let jid = null; let reste = q;
    try { for (const j of G.joueurs.all()) { const p = deacc((j.nom || "").split(" ")[0]); if (p.length >= 2 && new RegExp("\\b" + p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").test(n)) { jid = j.id; reste = deacc(reste).replace(new RegExp("\\b" + p + "\\b", "g"), " joueur "); break; } } } catch (e) {}
    return { jid, reste }; }

  function chercher(q, o = {}) {
    if (!BASE) return [];
    const T = [...new Set(mots(q))]; if (!T.length) return [];
    const qn = mots(q).join(" ");
    /* similarité de chaque mot de la question avec le vocabulaire */
    const S = T.map(t => { const m = new Map(); for (const v of VOC) { const s = sim(t, v); if (s > 0) m.set(v, s); } return m; });
    const wt = T.map((t, i) => { let best = 0, w = null; for (const [v, s] of S[i]) if (s > best || (s === best && idf(v) > idf(w || v))) { best = s; w = v; } return w ? idf(w) : idf(t) * 0.6; });
    const tot = wt.reduce((a, b) => a + b, 0) || 1;
    const R = [];
    for (const e of BASE) {
      let cov = 0;
      T.forEach((t, i) => { let b = 0; for (const [v, s] of S[i]) { const f = e._q.has(v) ? W_Q : e._m.has(v) ? W_M : e._r.has(v) ? W_R : 0; if (f * s > b) b = f * s; } cov += b * wt[i]; });
      cov /= tot;
      let vb = 0;   /* couverture de la meilleure variante par la question */
      for (const V of e._v) { if (!V.length) continue; let num = 0, den = 0;
        for (const v of V) { const w = idf(v); den += w; let b = 0; T.forEach((t, i) => { const s = S[i].get(v) || 0; if (s > b) b = s; }); num += w * (b >= 0.65 ? b : 0); }
        const c = num / den; if (c > vb) vb = c; }
      let sc = 0.62 * cov + 0.38 * vb;
      if (e._vn[0] === qn) sc += 0.06; else if (e._vn.includes(qn)) sc += 0.05;   /* question identique à la question ou à une variante */
      if (o.ecran && e._ctx && e._ctx.includes(o.ecran)) sc += 0.02;
      if (sc > 0.08) R.push({ id: e.id, score: Math.round(sc * 1000) / 1000, e });
    }
    R.sort((a, b) => b.score - a.score);
    /* question hors sujet (réserver un court, prix d'une raquette…) : pas de réponse sûre, sauf correspondance quasi exacte */
    const qd = " " + deacc(q).replace(/[^a-z0-9]+/g, " ") + " ";
    if (R.length && R[0].score < 0.9 && HORS.some(h => qd.includes(" " + h + " "))) R.forEach(r => { r.score = Math.min(r.score, 0.3); });
    return R.slice(0, o.n || 8);
  }

  /* ---------- contexte : joueur, groupe, jokers des actions ---------- */
  const prenomDe = j => (j && j.nom || "").split(" ")[0];
  function ctx(jidForce) {
    let jid = jidForce || null, gid = null; try { jid = jid || G.courant.jid(); gid = G.courant.gid(); } catch (e) {}
    const j = jid && G.joueurs.get(jid); let age = null;
    if (j) { try { age = G.grilleConseillee(j); } catch (e) {} if (age == null) age = G.ageCiv(j.naissance); if (age != null) age = Math.max(4, Math.min(18, age)); }
    const sx = j ? j.sexe : null, saison = j && age ? sx + String(age).padStart(2, "0") : null;
    return { jid: j ? j.id : null, gid, j, prenom: j ? prenomDe(j) : null, age, sexe: sx, saison, grille: saison ? saison + "_PP" : null };
  }
  const besoin = s => [...String(s || "").matchAll(/\{(\w+)\}/g)].map(m => m[1]);
  const remplir = (s, c) => String(s || "").replace(/\{(\w+)\}/g, (m, k) => c[k] != null ? encodeURIComponent(c[k]) : "");
  const libelle = (s, c) => texte(s, c).replace(/ de \{prenom\}/g, c.prenom ? " de " + c.prenom : " du joueur").replace(/ pour \{prenom\}/g, c.prenom ? " pour " + c.prenom : "").replace(/\{prenom\}/g, c.prenom || "ton joueur");
  /* code de grille dans la question (« grille fille 12 ans » → F12, « G14 ») ; sinon celui du joueur en cours, sinon F12 */
  function codeDans(q) { const n = " " + deacc(q).replace(/[^a-z0-9]+/g, " ") + " ";
    let m = n.match(/ ([fg]) ?(\d{1,2}) /); if (m && +m[2] >= 4 && +m[2] <= 18) return m[1].toUpperCase() + m[2].padStart(2, "0");
    const sx = / (fille|filles|feminin\w*|joueuse|joueuses) /.test(n) ? "F" : / (garcon|garcons|gars|masculin\w*) /.test(n) ? "G" : null;
    m = n.match(/ (\d{1,2}) ?ans /) || n.match(/ (\d{1,2}) /); const a = m ? +m[1] : null;
    return sx && a >= 4 && a <= 18 ? sx + String(a).padStart(2, "0") : null; }
  const codeTexte = k => k ? (k[0] === "F" ? "une fille de " : "un garçon de ") + (+k.slice(1)) + " ans" : "";
  const texte = (s, c) => String(s || "").replace(/\{code\}/g, c.code || "F12").replace(/\{codeTexte\}/g, codeTexte(c.code || "F12"));
  const modCourant = () => (document.querySelector('meta[name="grun-module"]') || {}).content || "accueil";

  /* choisir un joueur (ou un groupe) quand l'action en a besoin */
  function choisir(type, fn) {
    if (type === "g") { const gs = G.groupes.all(); if (!gs.length) { G.ui.toast("Crée d'abord un groupe", { action: "Créer", fn: () => G.plus.faire("groupe") }); return; }
      const sh = G.ui.sheet({ titre: "Quel groupe ?", html: `<div class="gs-chips big">${gs.map(g => `<button type="button" class="gs-chip g" data-ag="${esc(g.id)}">${esc(g.nom)}</button>`).join("")}</div>` });
      sh.el.addEventListener("click", e => { const b = e.target.closest("[data-ag]"); if (!b) return; sh.fermer(); G.courant.set("g", b.dataset.ag); fn(b.dataset.ag); }); return; }
    G.ui.choisirJoueur("Pour quel joueur ?", (jid) => { if (jid) fn(jid); }, { toujours: true, groupes: false });
  }
  function faire(a, c) {
    const need = new Set([...besoin(a.hash), ...(/^(completer)$/.test(a.fonction || "") ? ["jid"] : []), ...(a.fonction === "bilan.groupe" ? ["gid"] : [])]);
    if (need.has("jid") || ["saison", "grille", "age", "sexe"].some(k => need.has(k))) { if (!c.jid) return choisir("j", jid => faire(a, ctx(jid))); if (["saison", "grille", "age", "sexe"].some(k => need.has(k)) && !c.age) { G.ui.toast("Il manque la date de naissance de " + c.prenom); return G.ui.completerProfil(c.jid); } }
    if (need.has("gid") && !c.gid) return choisir("g", gid => faire(a, { ...c, gid }));
    if (a.fonction) return FN[a.fonction] ? FN[a.fonction](c) : null;
    location.href = G.href(a.mod, remplir(a.hash, c));
  }
  const FN = {
    plus: () => G.plus.ouvrir(), courant: () => G.ui.choisirCourant(), visite: () => G.visite(), aide: () => G.aide.montrer(),
    completer: c => G.ui.completerProfil(c.jid),
    export: () => { G.sauvegarder(); G.ui.toast("Sauvegarde créée : enregistre-la dans Fichiers (iCloud Drive)."); },
    "expert.on": () => xp(true), "expert.off": () => xp(false),
    "guide.prog": c => guideProg({ jid: c.jid, gid: c.gid }),
    "guide.tournoi": c => guideProg({ jid: c.jid, gid: c.gid, obj: "Préparer un tournoi", per: "4" }),
    "bilan.groupe": c => { if (G.groupes.get(c.gid)) G.ui.bilanGroupe(c.gid); }
  };
  /* Simple / Expert : réglage + classes de la page tout de suite (les éléments .xp apparaissent sans recharger) */
  function xp(on) { G.setExpert(on); const h = document.documentElement; h.classList.toggle("grun-expert", on); h.classList.toggle("grun-simple", !on);
    G.ui.toast(on ? "Mode Expert : tout est visible" : "Mode Simple : l'essentiel", { action: on ? "Revenir en Simple" : "Passer en Expert", fn: () => xp(!on) }); }
  ["joueur", "joueurs", "groupe", "session", "test", "exo", "note", "wu"].forEach(k => { FN["plus." + k] = () => G.plus.faire(k); });
  G.assistant.FONCTIONS = Object.keys(FN);

  /* ---------- questions envoyées (base qui grandit) ---------- */
  function garderQuestion(q, o) { const s = G.load(G.K.questions, { q: [] }) || {}; s.q = Array.isArray(s.q) ? s.q : [];
    s.q.push({ id: G.uid(), q: String(q).slice(0, 400), date: G.today(), ecran: o.ecran || modCourant(), meilleur: o.meilleur || null, v: G.version }); G.save(G.K.questions, s); return s.q.length; }
  G.assistant.questions = () => (G.load(G.K.questions, { q: [] }) || {}).q || [];

  /* ---------- suggestions selon l'écran et le joueur en cours ---------- */
  const SUG = {
    "accueil": ["accueil-jour", "joueur-creer", "seance-creer", "prog-creer", "sauvegarder", "visite"],
    "accueil/joueurs": ["joueur-creer", "joueur-plusieurs", "groupe-creer", "joueur-archiver"],
    "accueil/j": ["bilan-faire", "joueur-retour", "joueur-rapport", "joueur-completer", "mode-joueur", "joueur-supprimer"],
    "accueil/g": ["groupe-presences", "bilan-groupe", "seance-groupe", "groupe-ajouter"],
    "accueil/reglages": ["sauvegarder", "transferer", "theme", "reglages-coach", "demo"],
    "accueil/recherche": ["recherche", "banque-trouver", "grille-voir"],
    "accueil/pole": ["poles", "seance-creer", "bilan-faire", "banque-trouver"],
    "accueil/comment": ["poles", "poupee", "methode", "confidentialite"],
    "prog": ["prog-creer", "prog-compet", "prog-coupure", "prog-construire", "prog-ajustement"],
    "seances": ["seance-lancer", "seance-exo-changer", "seance-echauffement", "seance-modeles", "envoyer-joueur"],
    "warmup": ["wu-choisir", "wu-match", "wu-retour-calme", "wu-creer", "wu-favori"],
    "grilles": ["bilan-faire", "bilan-groupe", "radar", "test-creer", "grille-voir"],
    "banque": ["banque-trouver", "exo-creer", "exo-proposer", "exo-collections", "exo-video"],
    "veille": ["veille-essentiel", "veille-pratique", "veille-age", "sources"],
    "saisons": ["saison-voir", "prog-saison-base", "saison-semaine", "saison-4-7"]
  };
  function suggestions(ecran, c) {
    const k = String(ecran || modCourant()); const base = SUG[k] || SUG[k.split("/")[0]] || SUG.accueil;
    const pour = [];
    if (c.j) { const j = c.j, a = G.ageCiv(j.naissance); let m = null; try { m = G.maturite(j); } catch (e) {}
      const bless = (j.blessures || []).some(b => b && b.statut !== "gueri" && !b.fin);
      let ch = null; try { ch = G.journal.charge(j.id); } catch (e) {}
      if (bless) pour.push("douleur-coaching");
      if (ch && (ch.alerte === "haute" || ch.alerte === "attention")) pour.push("charge-coaching");
      if (a != null && a <= 7) pour.push("age-4-7");
      if ((m && /autour/.test(m.statut)) || (!m && a != null && (j.sexe === "F" ? a >= 11 && a <= 13 : a >= 13 && a <= 15))) pour.push("pic-croissance");
      if (j.sexe === "F" && a != null && a >= 11) pour.push("genou-fille");
      if (a != null && a >= 8 && pour.length < 2) pour.push("pliometrie");
      if (pour.length < 2) pour.push("echauffement-match"); }
    return { ecran: base.filter(id => BASE.byId[id]).slice(0, 5), pour: [...new Set(pour)].filter(id => BASE.byId[id]).slice(0, 2) };
  }

  /* ---------- styles propres à l'assistant (mêmes jetons que grun.css) ---------- */
  function styles() { if (document.getElementById("ga-css")) return; const s = document.createElement("style"); s.id = "ga-css"; s.textContent = `
.ga .gs-b{gap:12px}
.ga-aide{border:1px solid var(--line,#D9DDE3);background:var(--soft,#ECEFF3);border-radius:13px;padding:10px 12px;font-size:15px;line-height:1.45}
.ga-aide b{display:block;font-size:12.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--mute,#5D6675);margin-bottom:3px}
.ga-f{display:flex;gap:8px;align-items:stretch;position:sticky;top:-12px;background:var(--panel,#fff);padding:4px 0;z-index:1}
.ga-f .gs-inp{flex:1;min-width:0;font-size:17px}
.ga-mic{width:52px;min-width:52px;border-radius:13px;border:1px solid var(--line,#D9DDE3);background:var(--panel,#fff);color:var(--ink,#16202E);cursor:pointer;display:flex;align-items:center;justify-content:center}
.ga-mic svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
.ga-mic.on{background:#B91C1C;border-color:#B91C1C;color:#fff;animation:gaPulse 1.2s infinite}
@keyframes gaPulse{50%{opacity:.7}}
.ga-h{font-size:12.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--mute,#5D6675);margin:4px 0 -4px}
.ga-rep{border:1.5px solid var(--grun-hi);border-radius:15px;padding:12px 14px;display:flex;flex-direction:column;gap:10px;background:var(--panel,#fff)}
.ga-rep h3{margin:0;font-size:18px;line-height:1.25}
.ga-rep .gs-p{font-size:16px}
.ga-acts{display:flex;flex-wrap:wrap;gap:8px}
.ga-acts .gs-btn{flex:1 1 auto;min-height:50px}
.ga-acts .gs-btn.main{flex:1 1 100%}
.ga-src{font-size:13.5px;color:var(--mute,#5D6675);margin:0}
.ga-src a{color:var(--grun-hi);font-weight:600}
.ga-lies{display:flex;flex-wrap:wrap;gap:6px}
.ga-lies .gs-chip{min-height:38px;font-size:14px}
.ga-it{display:flex;flex-direction:column;align-items:flex-start;gap:2px;min-height:52px;width:100%;text-align:left;padding:9px 12px;border:1px solid var(--line,#D9DDE3);border-radius:13px;background:var(--panel,#fff);color:var(--ink,#16202E);font:inherit;cursor:pointer}
.ga-it b{font-size:15.5px;font-weight:650}
.ga-it span{font-size:13px;color:var(--mute,#5D6675)}
.ga-it:active{background:var(--soft,#ECEFF3)}
.ga-tag{font-size:11.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--grun-hi)}
.ga-rien{border:1px dashed var(--line,#D9DDE3);border-radius:13px;padding:12px 14px;display:flex;flex-direction:column;gap:10px}
.ga-ok{color:var(--grun-hi);font-weight:700;margin:0}
.ga-steps{display:flex;gap:6px}.ga-steps i{flex:1;height:5px;border-radius:3px;background:var(--line,#D9DDE3)}.ga-steps i.on{background:var(--grun-hi)}
.ga-num{display:flex;align-items:center;gap:10px}.ga-num b{min-width:2.2em;text-align:center;font-size:22px;font-variant-numeric:tabular-nums}
.ga-num button{width:48px;height:48px;border-radius:12px;border:1px solid var(--line,#D9DDE3);background:var(--panel,#fff);color:var(--ink,#16202E);font-size:24px;cursor:pointer}
`; document.head.appendChild(s); }

  const CAT = { app: "Dans l'appli", joueur: "Pour ton joueur", grun: "Comprendre GRÜN" };
  const ICO_MIC = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8"/></svg>';

  /* ---------- la feuille ---------- */
  let SH = null;
  G.assistant.close = () => { if (SH) { SH.fermer(); SH = null; } };
  G.assistant.open = (q, opts = {}) => {
    styles(); if (SH) SH.fermer();
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const sh = SH = G.ui.sheet({ titre: "Assistant GRÜN", html: `${opts.aide ? `<div class="ga-aide"><b>Cet écran</b>${esc(opts.aide)}</div>` : ""}
      <form class="ga-f" role="search" autocomplete="off"><input class="gs-inp" type="search" name="q" enterkeyhint="search" placeholder="Pose ta question…" aria-label="Ta question" value="${esc(q || "")}">${SR ? `<button type="button" class="ga-mic" aria-label="Poser la question à voix haute">${ICO_MIC}</button>` : ""}</form>
      <div class="ga-out" aria-live="polite"><p class="gs-m">Chargement…</p></div>`, fermer: () => { if (SH === sh) SH = null; if (rec) try { rec.abort(); } catch (e) {} } });
    sh.el.querySelector(".grun-sheet").classList.add("ga");
    const inp = sh.$("[name=q]"), out = sh.$(".ga-out"); let rec = null, T = null, ecran = opts.ecran || null;
    let jidQ = null, codeQ = null;
    const rendre = () => { const v = inp.value.trim(); if (!v) return accueil(); const P = prenomsDans(v); jidQ = P.jid; codeQ = codeDans(v); const R = chercher(P.reste, { ecran, n: 6 }); reponse(v, R); };
    function accueil() { const c = ctx(); const S = suggestions(ecran, c);
      out.innerHTML = `${S.pour.length && c.prenom ? `<div class="ga-h">Pour ${esc(c.prenom)}</div><div class="gs-menu">${S.pour.map(it).join("")}</div>` : ""}
        <div class="ga-h">Questions fréquentes ici</div><div class="gs-menu">${S.ecran.map(it).join("")}</div>
        <p class="gs-m">Écris avec tes mots, même avec des fautes${SR ? ", ou touche le micro" : ""}.</p>`; }
    const it = (id) => { const e = BASE.byId[id]; return e ? `<button type="button" class="ga-it" data-ga="${esc(id)}"><span class="ga-tag">${CAT[e.cat] || ""}</span><b>${esc(e.q)}</b></button>` : ""; };
    function carte(e, c) {
      const acts = (e.actions || []).map((a, i) => `<button type="button" class="gs-btn ${i ? "sec" : "main"}" data-act="${i}">${i ? "" : "Faire maintenant · "}${esc(libelle(a.label, c))}</button>`).join("");
      const src = (e.sources || []).length ? `<p class="ga-src">D'après la veille : ${e.sources.map(s => `<a href="${esc(G.href("veille", "#d/" + s.doc))}">${esc(s.titre)}</a>`).join(" · ")}</p>` : "";
      const lies = (e.lies || []).map(id => BASE.byId[id]).filter(Boolean).slice(0, 4);
      return `<div class="ga-rep" data-id="${esc(e.id)}"><span class="ga-tag">${CAT[e.cat] || ""}</span><h3>${esc(e.q)}</h3><p class="gs-p">${esc(texte(e.reponse, c))}</p>
        ${acts ? `<div class="ga-acts">${acts}</div>` : ""}${src}${lies.length ? `<div class="ga-lies">${lies.map(x => `<button type="button" class="gs-chip" data-ga="${esc(x.id)}">${esc(x.q)}</button>`).join("")}</div>` : ""}</div>`; }
    let COUR = null;
    function montrer(e, autres) { const c = ctx(jidQ); c.code = codeQ || c.saison || "F12"; COUR = { e, c };
      out.innerHTML = carte(e, c) + (autres && autres.length ? `<div class="ga-h">Autres réponses</div><div class="gs-menu">${autres.map(r => it(r.id)).join("")}</div>` : ""); }
    function reponse(v, R) {
      const best = R[0];
      if (best && best.score >= 0.42) { const autres = R.slice(1).filter(r => r.score >= Math.max(0.25, best.score * 0.55)).slice(0, 3); montrer(best.e, autres);
        /* réponse peu sûre : on le dit, et on propose la recherche et l'envoi à Eliot */
        if (best.score < 0.55) out.insertAdjacentHTML("beforeend", `<div class="ga-rien"><p class="gs-m">Je ne suis pas sûr d'avoir compris. Ce n'est pas ça ?</p><div class="ga-acts"><a class="gs-btn sec" href="${esc(G.href("accueil", "#/recherche/" + encodeURIComponent(v)))}">Chercher partout</a><button type="button" class="gs-btn sec" data-envoi="1">Envoyer ma question à Eliot</button></div></div>`);
        return; }
      COUR = null;
      out.innerHTML = `<div class="ga-rien"><p class="gs-p"><b>Je n'ai pas de réponse sûre à cette question.</b></p>
        ${R.length ? `<p class="gs-m">Tu cherchais peut-être :</p><div class="gs-menu">${R.slice(0, 3).map(r => it(r.id)).join("")}</div>` : `<p class="gs-m">Essaie avec d'autres mots, ou :</p>`}
        <div class="ga-acts"><a class="gs-btn sec" href="${esc(G.href("accueil", "#/recherche/" + encodeURIComponent(v)))}">Chercher partout dans GRÜN</a>
        <button type="button" class="gs-btn main" data-envoi="1">Envoyer ma question à Eliot</button></div></div>`; }
    sh.el.addEventListener("click", e => {
      const g = e.target.closest("[data-ga]"); if (g) { const x = BASE.byId[g.dataset.ga]; if (x) { montrer(x, []); sh.body.scrollTop = 0; } return; }
      const b = e.target.closest("[data-act]"); if (b && COUR) { const a = COUR.e.actions[+b.dataset.act]; const c = COUR.c; sh.fermer(); setTimeout(() => faire(a, c), 170); return; }
      if (e.target.closest("[data-envoi]")) { const v = inp.value.trim(); if (!v) return; const R = chercher(v); garderQuestion(v, { ecran: ecran || modCourant(), meilleur: R[0] ? R[0].id : null });
        out.innerHTML = `<div class="ga-rien"><p class="ga-ok">✓ Question gardée.</p><p class="gs-m">Elle est sur ton appareil et part avec ta prochaine sauvegarde (Réglages › Tout sauvegarder), pour enrichir l'assistant.</p></div>`; return; }
      if (e.target.closest(".ga-src a, .ga-acts a")) sh.fermer();
    });
    inp.addEventListener("input", () => { clearTimeout(T); T = setTimeout(() => BASE && rendre(), 140); });
    sh.$("form").addEventListener("submit", e => { e.preventDefault(); clearTimeout(T); if (BASE) rendre(); inp.blur(); });
    const mic = sh.$(".ga-mic");
    if (mic) mic.onclick = () => { if (rec) { try { rec.stop(); } catch (e) {} return; }
      try { rec = new SR(); rec.lang = "fr-FR"; rec.interimResults = true; rec.maxAlternatives = 1; mic.classList.add("on");
        rec.onresult = ev => { inp.value = [...ev.results].map(r => r[0].transcript).join(" "); if (BASE) rendre(); };
        rec.onerror = ev => { G.ui.toast(ev.error === "not-allowed" ? "Micro refusé : autorise-le dans les réglages du téléphone." : ev.error === "network" ? "Dictée indisponible hors connexion : écris ta question." : "Je n'ai pas entendu : réessaie ou écris."); };
        rec.onend = () => { mic.classList.remove("on"); rec = null; };
        rec.start(); } catch (e) { mic.classList.remove("on"); rec = null; G.ui.toast("Micro indisponible : écris ta question."); } };
    charger().then(() => { if (SH !== sh) return; rendre(); }).catch(() => { out.innerHTML = `<p class="gs-m">L'assistant n'est pas encore chargé. Ouvre GRÜN une fois avec une connexion.</p><a class="gs-btn sec" href="${esc(G.href("accueil", "#/recherche/" + encodeURIComponent(inp.value || "")))}">Chercher dans GRÜN</a>`; });
    if (!q && !/iPhone|iPad/.test(navigator.userAgent)) setTimeout(() => inp.focus(), 80);
    return sh;
  };
  G.assistant.ctx = ctx;
  G.assistant.lien = (a, c) => { c = c || ctx(); if (!c.code) c.code = c.saison || "F12"; return a && a.mod ? G.href(a.mod, remplir(a.hash, c)) : null; };   /* adresse d'une action (tests) */
  G.assistant.faire = (a, c) => faire(a, c || ctx());
  G.assistant.chercher = (q, o) => { const P = prenomsDans(q); return chercher(P.reste, o); };
  G.assistant.code = codeDans;
  G.assistant.charger = charger;

  /* ---------- Créer une programmation en 4 questions : qui, quand, objectif, séances par semaine ----------
     → écrit sur la fiche du joueur ses disponibilités (dispo.pp / dispo.tennis) et l'objectif général s'il est vide,
       puis ouvre Create my prog : prog.html#/nouveau/<jid>[?base=<saison>] (groupe : #/nouveau/?gid=<gid>).
       Période et objectif choisis sont aussi laissés dans sessionStorage « grun_prog_prefill » (à lire par Create my prog). */
  const PER = [["saison", "Toute la saison"], ["12", "3 mois"], ["4", "4 semaines"], ["1", "Une semaine"]];
  const OBJ = ["Progresser dans toutes les qualités", "Préparer un tournoi", "Reprendre après une coupure", "Prévenir les blessures", "Garder la forme en saison"];
  function guideProg(o = {}) {
    styles();
    const st = { jid: o.jid || null, gid: o.jid ? null : (o.gid || null), per: PER.some(x => x[0] === o.per) ? o.per : "saison", base: false, obj: o.obj || "", pp: 2, ten: 3, i: 0 };
    if (!st.jid && !st.gid) { try { st.jid = G.courant.jid(); st.gid = st.jid ? null : G.courant.gid(); } catch (e) {} }
    const js = G.joueurs.all(), gs = G.groupes.all();
    const sh = G.ui.sheet({ titre: "Créer une programmation", html: `<div class="ga-steps">${[0, 1, 2, 3].map(k => `<i data-k="${k}"></i>`).join("")}</div><div class="ga-q"></div>`,
      secondaire: [{ t: "Retour", fn: () => { if (st.i > 0) { st.i--; draw(); } return false; } }],
      principal: { t: "Suivant", fn: () => suivant() } });
    sh.el.querySelector(".grun-sheet").classList.add("ga");
    const zone = sh.$(".ga-q");
    const chip = (attr, v, t, on, g) => `<button type="button" class="gs-chip${g ? " g" : ""}" ${attr}="${esc(v)}" aria-pressed="${!!on}">${esc(t)}</button>`;
    function prefDispo() { const j = st.jid && G.joueurs.get(st.jid); if (j && j.dispo) { if (j.dispo.pp != null) st.pp = +j.dispo.pp; if (j.dispo.tennis != null) st.ten = +j.dispo.tennis; } }
    function draw() {
      sh.$$(".ga-steps i").forEach((x, k) => x.classList.toggle("on", k <= st.i));
      const btn = sh.$('[data-gs="p"]'); btn.textContent = st.i < 3 ? "Suivant" : "Créer la programmation"; sh.$('[data-gs="0"]').style.visibility = st.i ? "visible" : "hidden";
      const j = st.jid && G.joueurs.get(st.jid), nom = j ? prenomDe(j) : st.gid ? (G.groupes.get(st.gid) || {}).nom : "";
      if (st.i === 0) zone.innerHTML = `<h3 style="margin:0">1 · Pour qui ?</h3>
        ${js.length ? `<div class="gs-l">Joueurs<div class="gs-chips big">${js.map(x => chip("data-pj", x.id, x.nom, x.id === st.jid)).join("")}</div></div>` : `<p class="gs-m">Aucun joueur pour l'instant.</p>`}
        ${gs.length ? `<div class="gs-l">Groupes<div class="gs-chips big">${gs.map(x => chip("data-pg", x.id, x.nom, x.id === st.gid, 1)).join("")}</div></div>` : ""}
        <button type="button" class="gs-lien" data-nj="1">+ Nouveau joueur</button>`;
      if (st.i === 1) zone.innerHTML = `<h3 style="margin:0">2 · Sur quelle période${nom ? " pour " + esc(nom) : ""} ?</h3>
        <div class="gs-chips big">${PER.map(([k, t]) => chip("data-per", k, t, st.per === k)).join("")}</div>
        ${st.per === "saison" ? `<label class="gs-c"><input type="checkbox" data-base="1"${st.base ? " checked" : ""}> Partir de la saison de référence de son âge<small>&nbsp;(tournois, bilans et thèmes de la saison type ; sa semaine type remplace les séances par semaine)</small></label>` : `<p class="gs-m">Le plan s'ouvre sur ses données : touche « ${esc((PER.find(x => x[0] === st.per) || [, ""])[1])} » à l'étape Période.</p>`}`;
      if (st.i === 2) zone.innerHTML = `<h3 style="margin:0">3 · Quel objectif ?</h3><div class="gs-chips big">${OBJ.map(t => chip("data-obj", t, t, st.obj === t)).join("")}</div>
        <label class="gs-l">Ou avec tes mots<input class="gs-inp" name="objl" value="${esc(OBJ.includes(st.obj) ? "" : st.obj)}" placeholder="Ex. : passer 15/4 en fin de saison"></label>`;
      if (st.i === 3) zone.innerHTML = `<h3 style="margin:0">4 · Combien de séances par semaine ?</h3>
        ${st.gid ? `<p class="gs-m">Pour un groupe, la semaine type part de l'âge du groupe ; tu la règles à l'étape 2 du plan.</p>` : st.base ? `<p class="gs-m">La semaine type de la saison de référence sera reprise ; tu pourras la changer à l'étape 2 du plan.</p>` : ""}
        <div class="gs-l">Préparation physique<div class="ga-num"><button type="button" data-n="pp" data-d="-1" aria-label="Moins">−</button><b data-v="pp">${st.pp}</b><button type="button" data-n="pp" data-d="1" aria-label="Plus">+</button></div></div>
        <div class="gs-l">Tennis<div class="ga-num"><button type="button" data-n="ten" data-d="-1" aria-label="Moins">−</button><b data-v="ten">${st.ten}</b><button type="button" data-n="ten" data-d="1" aria-label="Plus">+</button></div></div>`;
    }
    sh.el.addEventListener("click", e => { const b = e.target.closest("[data-pj],[data-pg],[data-per],[data-obj],[data-n],[data-nj]"); if (!b) return;
      if (b.dataset.nj) { G.ui.nouveauJoueur({ courant: true }).then(j => { if (j) { st.jid = j.id; st.gid = null; js.push(j); prefDispo(); st.i = 1; draw(); } }); return; }
      if (b.dataset.pj) { st.jid = b.dataset.pj; st.gid = null; prefDispo(); }
      if (b.dataset.pg) { st.gid = b.dataset.pg; st.jid = null; }
      if (b.dataset.per) st.per = b.dataset.per;
      if (b.dataset.obj) st.obj = b.dataset.obj;
      if (b.dataset.n) { const k = b.dataset.n, mx = k === "pp" ? 7 : 14; st[k] = Math.max(0, Math.min(mx, st[k] + +b.dataset.d)); }
      draw(); });
    sh.el.addEventListener("change", e => { if (e.target.dataset.base) st.base = e.target.checked; });
    sh.el.addEventListener("input", e => { if (e.target.name === "objl") st.obj = e.target.value; });
    function suivant() {
      if (st.i === 0 && !st.jid && !st.gid) { G.ui.toast("Choisis un joueur ou un groupe"); return false; }
      if (st.i < 3) { st.i++; draw(); return false; }
      const c = ctx(st.jid);
      try { sessionStorage.setItem("grun_prog_prefill", JSON.stringify({ per: st.per, obj: st.obj, pp: st.pp, tennis: st.ten, jid: st.jid, gid: st.gid, t: Date.now() })); } catch (e) {}
      if (st.jid) { const j = G.joueurs.get(st.jid); const patch = {}; if (!st.base) patch.dispo = { ...(j.dispo || {}), pp: st.pp, tennis: st.ten };
        if (st.obj && !String(j.objectifs || "").trim()) patch.objectifs = st.obj; if (Object.keys(patch).length) G.joueurs.update(st.jid, patch);
        G.courant.set("j", st.jid);
        const qs = [st.base && c.saison ? "base=" + c.saison : "", "per=" + st.per, st.obj ? "obj=" + encodeURIComponent(st.obj) : "", "pp=" + st.pp, "tennis=" + st.ten].filter(Boolean).join("&");
        location.href = G.href("prog", "#/nouveau/" + st.jid + "?" + qs); }
      else { G.courant.set("g", st.gid); location.href = G.href("prog", "#/nouveau/?gid=" + st.gid + "&per=" + st.per + (st.obj ? "&obj=" + encodeURIComponent(st.obj) : "")); }
      return true;
    }
    if (st.jid) prefDispo(); draw(); return sh;
  }
  G.assistant.guideProg = guideProg;
})();
