// ======================= Range Poker Trainer - JS unique =======================
if (!window.__RPT_INITED__) {
  window.__RPT_INITED__ = true;

  // Bridge ID: resultPage -> resultsPage (si besoin)
(function fixResultsId(){
  const bad = document.getElementById('resultPage');
  const good = document.getElementById('resultsPage');
  if (bad && !good) {
    bad.id = 'resultsPage';
    console.log('✅ Renommé resultPage -> resultsPage');
  }
})();

  // Logs d'erreurs globales
  window.onerror = function(msg, src, line, col, err){
    console.error("[RPT] JS error:", msg, "at", src+":"+line+":"+col, err || null);
  };
  window.addEventListener("unhandledrejection", e=>{
    console.error("[RPT] Unhandled promise:", e.reason || e);
  });

  /* ============ Constantes ============ */
  const RANKS = ["A","K","Q","J","T","9","8","7","6","5","4","3","2"];
  const ACTIONS = ["fold","open","call","3bet","4bet","shove"];
  const COLORS = { fold:"#ef4444", open:"#60a5fa", call:"#86efac", "3bet":"#fdba74", "4bet":"#f87171", shove:"#a78bfa" };

  /* ============ State global ============ */
  const stateByKey = new Map();      // "i-j" -> allocations
  const rangeStore = new Map();      // cfg -> snapshot(Map)
  const LS_KEY = "rptRanges.v1";

  /* ============ Helpers ============ */
  function serializeSnapshot(snap){ const o={}; for(const [k,v] of snap) o[k]=v; return o; }
  function deserializeSnapshot(o){ const m=new Map(); for(const k in o) m.set(k, o[k]); return m; }
  function saveConfigSnapshot(cfgKey, snap){
    const store = JSON.parse(localStorage.getItem(LS_KEY)||"{}");
    store[cfgKey] = serializeSnapshot(snap);
    localStorage.setItem(LS_KEY, JSON.stringify(store));
    rangeStore.set(cfgKey, snap);
  }
  function getSavedSnapshot(cfgKey){
    const store = JSON.parse(localStorage.getItem(LS_KEY)||"{}");
    return store[cfgKey] ? deserializeSnapshot(store[cfgKey]) : null;
  }
  function hydrateRangeStoreFromLS(){
    const store = JSON.parse(localStorage.getItem(LS_KEY)||"{}");
    for(const k of Object.keys(store)) rangeStore.set(k, deserializeSnapshot(store[k]));
  }

  let selectedHero = "UTG";
  let selectedVillain = "BB";
  let selectedSpot = "rfi";

  let currentPaintAction = "open"; // éditeur
  let currentActionAlloc = "call"; // quizz

  function comboLabel(i,j){
    const r1 = RANKS[i], r2 = RANKS[j];
    return i === j ? r1 + r2 : r1 + r2 + (j > i ? "s" : "o");
  }
  function displayLabel(action){ return action === "shove" ? "AL'IN" : action.toUpperCase(); }

  function emptyState(){ return { fold:0, open:0, call:0, "3bet":0, "4bet":0, shove:0 }; }
  function allocSum(a){ return ACTIONS.reduce((t,k)=> t+(a[k]||0), 0); } // unique

  function ijFromLabel(lbl){
    if (!lbl || typeof lbl !== "string") return {};
    const m = lbl.toUpperCase().match(/^([AKQJT98765432])([AKQJT98765432])(S|O)?$/);
    if(!m) return {};
    return { i: RANKS.indexOf(m[1]), j: RANKS.indexOf(m[2]) };
  }
  function clampPct(v){ return Math.max(0, Math.min(100, Math.round(v*10)/10)); }
  function normalizeAlloc(a){
    const x = { fold:0, open:0, call:0, "3bet":0, "4bet":0, shove:0, ...(a||{}) };
    let total = allocSum(x);
    if (total === 0) return x;
    if (total < 100){ x.fold = clampPct(x.fold + (100 - total)); return x; }
    const factor = 100 / total;
    ACTIONS.forEach(k => { x[k] = clampPct((x[k]||0) * factor); });
    const drift = Math.round((100 - allocSum(x))*10)/10;
    if (Math.abs(drift) >= 0.1){
      const nf = ["open","call","3bet","4bet","shove"];
      let maxKey = nf[0];
      for (const k of nf){ if ((x[k]||0) > (x[maxKey]||0)) maxKey = k; }
      x[maxKey] = clampPct((x[maxKey]||0) + drift);
    }
    return x;
  }
  function isClose(user, target, tol = 8){
    const u = normalizeAlloc(user);
    const t = normalizeAlloc(target);
    return ACTIONS.every(k => Math.abs((u[k]||0) - (t[k]||0)) <= tol);
  }
  function nonFoldSum(s){ return (s.open||0)+(s.call||0)+(s["3bet"]||0)+(s["4bet"]||0)+(s.shove||0); }

  function clearAll(){
    document.querySelectorAll(".card-cell").forEach(cell=>{
      const z = emptyState();
      stateByKey.set(`${cell.dataset.i}-${cell.dataset.j}`, z);
      paintCell(cell, z);
    });
  }

  function importFlopzilla(str, action = "open", percent = 100){
    if(!str) return;
    if (!document.querySelector(".card-cell")) buildGrid();
    const tokens = str.split(/[, \n]+/).map(t=>t.trim()).filter(Boolean);
    const hands = new Set();
    for(const tok of tokens){ expandToken(tok).forEach(h => hands.add(h)); }
    hands.forEach(lbl=>{
      const ij = ijFromLabel(lbl);
      if(!ij || ij.i==null) return;
      const key = `${ij.i}-${ij.j}`;
      const s = stateByKey.get(key) || emptyState();
      ACTIONS.forEach(a => s[a] = 0);
      s[action] = Math.max(1, Math.min(100, percent));
      stateByKey.set(key, s);
      const cell = document.querySelector(`.card-cell[data-i="${ij.i}"][data-j="${ij.j}"]`);
      if(cell) paintCell(cell, s);
    });
  }

  function expandToken(tok){
    tok = tok.replace(/\s+/g, "").toUpperCase();
    const isPairPlus   = /^([AKQJT98765432])\1\+$/;
    const isSuitedPlus = /^([AKQJT98765432])([AKQJT98765432])S\+$/;
    const isOffsPlus   = /^([AKQJT98765432])([AKQJT98765432])O\+$/;
    const isRangeANY   = /^([AKQJT98765432]{2}[SO]?)-([AKQJT98765432]{2}[SO]?)$/;
    const isOneHand    = /^([AKQJT98765432])([AKQJT98765432])(S|O)?$/;
    if(isPairPlus.test(tok)){ const r = tok[0]; const start = RANKS.indexOf(r); return RANKS.slice(start).map(x=>x+x); }
    if(isSuitedPlus.test(tok)){ const [,hi,lo] = tok.match(isSuitedPlus); const iHi = RANKS.indexOf(hi), iLo = RANKS.indexOf(lo); const out=[]; for(let j=iLo;j<RANKS.length;j++){ if(j===iHi) continue; if(j>iHi) out.push(hi + RANKS[j] + "S"); } return out; }
    if(isOffsPlus.test(tok)){ const [,hi,lo] = tok.match(isOffsPlus); const iHi = RANKS.indexOf(hi), iLo = RANKS.indexOf(lo); const out=[]; for(let j=iLo;j<RANKS.length;j++){ if(j===iHi) continue; if(j<iHi) out.push(hi + RANKS[j] + "O"); } return out; }
    if(isRangeANY.test(tok)){ const [,a,b] = tok.match(isRangeANY); const seq = handOrderList(); const ia=seq.indexOf(a), ib=seq.indexOf(b); if(ia>-1&&ib>-1&&ia<=ib) return seq.slice(ia,ib+1); if(ia>-1&&ib>-1&&ia>ib) return seq.slice(ib,ia+1); }
    if(isOneHand.test(tok)){ const [,x,y,suff] = tok.match(isOneHand); if(x===y) return [x+y]; if(suff==="S"||suff==="O") return [x+y+suff]; return [x+y]; }
    return [];
  }
  function handOrderList(){
    const arr=[]; for(let i=0;i<13;i++){ for(let j=0;j<13;j++){ arr.push(comboLabel(i,j).toUpperCase()); } } return arr;
  }

  /* ============ Grille & painter ============ */
  function buildGrid(){
    const chart = document.getElementById("chartContainer");
    if (!chart) { console.error("[GRID] chartContainer introuvable"); return; }
    chart.innerHTML = "";
    for(let i=0;i<13;i++){
      for(let j=0;j<13;j++){
        const key = `${i}-${j}`;
        const cell = document.createElement("div");
        cell.className = "card-cell";
        cell.textContent = comboLabel(i,j);
        cell.dataset.i = i; cell.dataset.j = j;
        stateByKey.set(key, emptyState());
        cell.addEventListener("click", ()=> togglePaint(cell));
        cell.addEventListener("contextmenu", e=>{ e.preventDefault(); clearCell(cell); });
        chart.appendChild(cell);
      }
    }
  }
  function togglePaint(cell){
    const key = `${cell.dataset.i}-${cell.dataset.j}`;
    const s = { ...(stateByKey.get(key) || emptyState()) };
    const p = Math.max(1, Math.min(100, parseInt(document.getElementById("actionPercent").value)||100));
    s[currentPaintAction] = (s[currentPaintAction] > 0 ? 0 : p);
    stateByKey.set(key, s);
    paintCell(cell, s);
  }
  function paintCell(cell, s){
    const total = ACTIONS.reduce((t,k)=> t + (s[k]||0), 0);
    if(total === 0){ cell.style.background = "var(--panel2)"; return; }
    let start = 0; const grads = [];
    for(const a of ACTIONS){
      const v = s[a] || 0; if(v <= 0) continue;
      grads.push(`${COLORS[a]} ${start}% ${start+v}%`); start += v;
    }
    cell.style.background = `linear-gradient(90deg, ${grads.join(",")})`;
  }

  /* ============ Action bar & slider ============ */
  function buildActionBar(){
    const bar = document.getElementById("actionBar");
    if (!bar) return;
    bar.innerHTML = "";
    ACTIONS.forEach(a=>{
      const b = document.createElement("button");
      b.className = "abtn";
      b.textContent = displayLabel(a);
      if(a === currentPaintAction) b.classList.add("active");
      b.onclick = ()=>{
        currentPaintAction = a;
        [...bar.children].forEach(x=>x.classList.remove("active"));
        b.classList.add("active");
      };
      bar.appendChild(b);
    });
    const rng = document.getElementById("actionPercent");
    const out = document.getElementById("percentOut");
    const sync = ()=> { if(out && rng) out.textContent = rng.value; };
    if (rng) rng.addEventListener("input", sync);
    sync();
  }

  /* ============ Snapshot & Store ============ */
  function snapshotCurrentRange(){
    const snap = new Map();
    for(let i=0;i<13;i++){
      for(let j=0;j<13;j++){
        const key = `${i}-${j}`;
        snap.set(key, { ...(stateByKey.get(key) || emptyState()) });
      }
    }
    return snap;
  }
  function loadSnapshotIntoGrid(snap){
    for(let i=0;i<13;i++){
      for(let j=0;j<13;j++){
        const key = `${i}-${j}`;
        const s = snap.get(key) || emptyState();
        stateByKey.set(key, { ...s });
        const cell = document.querySelector(`.card-cell[data-i="${i}"][data-j="${j}"]`);
        if(cell) paintCell(cell, s);
      }
    }
  }
  function cfgKey(h,v,s){ return `${h}|${v}|${s}`; }

  /* ===================== QUIZZ ===================== */
  let quizSnapshot = new Map();
  let quizDeck = [];
  let quizIndex = 0;
  let quizScore = 0;
  let quizAnswers = new Map();
  let mistakesDeck = [];

  /* ===== Progress bar ===== */
  function setProgress(pct) {
    const el = document.getElementById('quizProgress');
    if (!el) return;
    const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
    el.style.width = clamped + '%';
  }

  function buildDeckFromSnapshot(snapshot) {
    const deck = [];
    for (let i = 0; i < 13; i++) {
      for (let j = 0; j < 13; j++) {
        const s = snapshot.get(`${i}-${j}`) || emptyState();
        if (nonFoldSum(s) > 0) deck.push(comboLabel(i, j));
      }
    }
    return deck;
  }

  /* ===== Affichage ===== */
  window.showPage = function showPage(id) {
    document.querySelectorAll('.page').forEach(p => {
      p.classList.add('hidden');
      p.setAttribute('aria-hidden', 'true');
      p.style.display = 'none';
    });
    const target = document.getElementById(id);
    if (!target) { console.error('[RPT] showPage: cible introuvable:', id); return; }
    target.classList.remove('hidden');
    target.removeAttribute('aria-hidden');
    target.style.display = 'block';
    window.scrollTo(0, 0);
  };

  /* ===== Saisie d’allocations ===== */
  function resetAlloc() { return { fold:0, open:0, call:0, "3bet":0, "4bet":0, shove:0 }; }
  let currentAlloc = resetAlloc();

  function renderChips() {
    const chips = document.getElementById("allocChips");
    chips.innerHTML = "";
    ACTIONS.forEach(act => {
      const v = currentAlloc[act] || 0;
      if (v <= 0) return;
      const el = document.createElement("div");
      el.className = "chip-alloc";
      el.innerHTML = `
        <span style="width:12px;height:12px;border-radius:50%;display:inline-block;background:${COLORS[act]}"></span>
        ${act} <b>${v}%</b>
        <span class="del" title="retirer">✕</span>`;
      el.querySelector(".del").onclick = () => { currentAlloc[act] = 0; renderChips(); };
      chips.appendChild(el);
    });
    document.getElementById("allocSum").textContent = String(allocSum(currentAlloc));
  }

  /* ===== Flow ===== */
  function startQuiz() {
    quizSnapshot = snapshotCurrentRange();
    quizDeck = buildDeckFromSnapshot(quizSnapshot);

    if (quizDeck.length === 0) { alert("Ta range est vide."); return; }

    quizIndex = 0;
    quizScore = 0;
    setProgress(0);
    document.getElementById("quizScore").textContent = "0";
    currentAlloc = resetAlloc();
    renderChips();
    quizAnswers.clear();
    mistakesDeck = [];

    currentActionAlloc = "call";
    document.querySelectorAll(".a-btn").forEach(x => x.classList.remove("active"));
    document.querySelector('.a-btn[data-act="call"]')?.classList.add("active");

    showPage("quizPage");
    showQuestion();
  }

  function showQuestion() {
    const label = quizDeck[quizIndex];
    document.getElementById("quizHandLabel").textContent = label;
    currentAlloc = resetAlloc();
    renderChips();
  }

  function submitAnswer() {
    if (!Array.isArray(quizDeck) || quizDeck.length === 0) return;
    if (quizIndex >= quizDeck.length) { endQuiz(); return; }

    const label = quizDeck[quizIndex];
    const ij = ijFromLabel(label);
    if (!ij || ij.i == null || ij.j == null) {
      quizIndex++; setProgress(Math.round((quizIndex / quizDeck.length) * 100));
      if (quizIndex < quizDeck.length) showQuestion(); else endQuiz();
      return;
    }

    const key = `${ij.i}-${ij.j}`;
    const target = quizSnapshot.get(key) || emptyState();

    quizAnswers.set(label, { ...currentAlloc });

    const ok = isClose(currentAlloc, target, 8);
    if (ok) quizScore++; else mistakesDeck.push(label);

    const scoreEl = document.getElementById("quizScore");
    if (scoreEl) scoreEl.textContent = String(quizScore);

    quizIndex++;
    setProgress(Math.round((quizIndex / quizDeck.length) * 100));

    if (quizIndex < quizDeck.length) showQuestion(); else endQuiz();
  }

  function endQuiz() {
    buildDetailedResults();
    showPage("resultsPage");
  }

function ensureResultsRangeContainer(){
  let host = document.getElementById('resultsRange');
  if (host) return host;
  const resultsPage = document.getElementById('resultsPage');
  if (!resultsPage) return null;
  const card = document.createElement('div');
  card.className = 'sb-card';
  card.innerHTML = `
    <div class="sb-title" style="text-transform:none;color:var(--fg)">Ta range jouée</div>
    <div id="resultsRange" class="range-grid"></div>
    <div class="muted" style="margin-top:8px">Contour rouge = erreur</div>
  `;
  resultsPage.appendChild(card);
  return card.querySelector('#resultsRange');
}


  function renderResultsGrid(containerId, snapshot, errorsSet, oksSet) {
    const cont = document.getElementById(containerId);
    cont.innerHTML = "";
    for (let i = 0; i < 13; i++) {
      for (let j = 0; j < 13; j++) {
        const key = `${i}-${j}`;
        const cell = document.createElement("div");
        cell.className = "card-cell";
        cell.textContent = comboLabel(i, j);
        const s = snapshot.get(key) || emptyState();
        paintCell(cell, s);
        const lbl = comboLabel(i, j);
        if (errorsSet.has(lbl)) cell.classList.add("cell-error");
        else if (oksSet.has(lbl)) cell.classList.add("cell-ok");
        cont.appendChild(cell);
      }
    }
  }

  function buildDetailedResults() {
    const total = quizDeck.length;
    document.getElementById("finalScore").textContent = String(quizScore);
    document.getElementById("finalTotal").textContent = String(total);
    const errSet = new Set(mistakesDeck);
    const okSet = new Set(quizDeck.filter(lbl => !errSet.has(lbl)));
    renderResultsGrid("resultChart", quizSnapshot, errSet, okSet);
    const ul = document.getElementById("mistakesList");
    ul.innerHTML = "";
    if (mistakesDeck.length === 0) { const li = document.createElement("li"); li.textContent = "Aucune erreur 🎯"; ul.appendChild(li); }
    else { mistakesDeck.forEach(lbl => { const li = document.createElement("li"); li.textContent = lbl; ul.appendChild(li); }); }
  }

  /* ===== Range recap (13x13) avec erreurs encerclées ===== */

// Utilise ta constante si déjà définie
const RPT_RANKS = (typeof RANKS !== 'undefined' && RANKS.length===13)
  ? RANKS
  : ['A','K','Q','J','T','9','8','7','6','5','4','3','2'];

/**
 * Normalise un libellé de main à la clé standard: 'AKs', 'AJo', 'TT'
 */
function handKey(i, j){
  const hi = RPT_RANKS[i], lo = RPT_RANKS[j];
  if(i === j) return hi + hi;
  // convention: matrice i (ligne) = high rank; j (colonne) = low rank
  return (i < j) ? (hi + lo + 's') : (hi + lo + 'o');
}

/**
 * Construit un map { 'AKs': {given, expected, correct} } à partir de state.quiz.answers
 */
function buildAnswerMap(state){
  const map = {};
  const ids = state.quiz.order || [];
  ids.forEach(id=>{
    const a = state.quiz.answers[id];
    if(!a) return;
    const key = (a.hand || id).toUpperCase();
    map[key] = a;
  });
  return map;
}

/**
 * Rendu de la grille: badge = action choisie; contour rouge si erreur
 */
function renderResultsRange(state){
  const host = document.getElementById('resultsRange');
  if(!host) return;

  const ansMap = buildAnswerMap(state);
  host.innerHTML = ''; // reset

  // 13x13: lignes = hi rank (RPT_RANKS index i), colonnes = lo rank (index j)
  for(let i=0;i<13;i++){
    for(let j=0;j<13;j++){
      const key = handKey(i,j);        // 'AKs' / 'AJo' / 'TT'
      const a = ansMap[key];           // {given, expected, correct, ...} ou undefined
      const cell = document.createElement('div');
      cell.className = 'range-cell';
      if(a && a.correct === false) cell.classList.add('err');

      // Label lisible
      const lab = document.createElement('span');
      lab.className = 'lab';
      lab.textContent = key;
      cell.appendChild(lab);

      // Petit point coloré = action choisie (si une action a été donnée)
      if(a && a.given){
        const b = document.createElement('i');
        b.className = 'badge ' + a.given.replace('3','\\33 ').replace('4','\\34 ');
        cell.appendChild(b);
      }

      host.appendChild(cell);
    }
  }
}

  /* ============ Events & Boot ============ */
  window.addEventListener("DOMContentLoaded", ()=> {
    hydrateRangeStoreFromLS();
    buildGrid();
    buildActionBar();

    // Import Flopzilla
    document.getElementById("importBtn")?.addEventListener("click", ()=>{
      const txt = document.getElementById("flopzillaInput")?.value.trim() || "";
      const action = document.getElementById("importAction")?.value || "open";
      const pct = Math.max(1, Math.min(100, parseInt(document.getElementById("importPercent")?.value)||100));
      const replace = !!document.getElementById("replaceBeforeImport")?.checked;
      if(!txt){ alert("Colle du texte Flopzilla (ex: AA, AKo, KQs+, …)"); return; }
      if(replace) clearAll();
      importFlopzilla(txt, action, pct);
    });

    document.getElementById("clearAllBtn")?.addEventListener("click", clearAll);

    function bindPosGroup(containerId, setter){
      const el = document.getElementById(containerId); if(!el) return;
      el.addEventListener("click", (e)=>{
        const b = e.target.closest(".pos-btn"); if(!b) return;
        [...el.querySelectorAll(".pos-btn")].forEach(x=>x.classList.remove("active"));
        b.classList.add("active");
        setter(b.dataset.pos);
        const key = cfgKey(selectedHero, selectedVillain, selectedSpot);
        const snap = rangeStore.get(key) || getSavedSnapshot(key);
        if(snap){ loadSnapshotIntoGrid(snap); }
      });
    }
    bindPosGroup("posGroup", (v)=> selectedHero = v);
    bindPosGroup("villainGroup", (v)=> selectedVillain = v);

    const spotSel = document.getElementById("spotSelect");
    if (spotSel) spotSel.addEventListener("change", ()=>{
      selectedSpot = spotSel.value;
      const key = cfgKey(selectedHero, selectedVillain, selectedSpot);
      const snap = rangeStore.get(key) || getSavedSnapshot(key);
      if(snap){ loadSnapshotIntoGrid(snap); } else { clearAll(); }
    });

    const applyBtn = document.getElementById("applyConfigBtn");
    if (applyBtn) applyBtn.onclick = ()=>{
      // tu peux utiliser testFilters/testCount ici si tu ajoutes la logique côté buildDeck
      applyBtn.textContent = "✅ Config validée";
      applyBtn.disabled = true; setTimeout(()=>{ applyBtn.textContent = "Valider la configuration"; applyBtn.disabled = false; }, 900);
    };

    const manualAddBtn = document.getElementById("manualAddBtn");
    if (manualAddBtn) manualAddBtn.onclick = ()=>{
      const snap = snapshotCurrentRange();
      let has = false; for (const v of snap.values()){ if (nonFoldSum(v) > 0){ has = true; break; } }
      if(!has){ alert("Ta range est vide : peins ou importe d’abord 😉"); return; }
      const key = cfgKey(selectedHero, selectedVillain, selectedSpot);
      saveConfigSnapshot(key, snap);
      manualAddBtn.textContent = `✅ Range enregistrée (${selectedHero} vs ${selectedVillain} • ${selectedSpot})`;
      manualAddBtn.disabled = true; setTimeout(()=>{ manualAddBtn.textContent="Ajouter la range"; manualAddBtn.disabled=false; }, 1200);
    };

    document.getElementById("startQuizBtn")?.addEventListener("click", startQuiz);
    document.getElementById("restartBtn")  ?.addEventListener("click", startQuiz);
    document.getElementById("backBtn")     ?.addEventListener("click", ()=> showPage("editorPage"));

    document.getElementById("practiceBtn")?.addEventListener("click", ()=>{
      if(!mistakesDeck.length){ alert("Il n’y a aucune erreur. Bravo !"); return; }
      quizDeck = [...new Set(mistakesDeck)];
      quizIndex = 0; quizScore = 0; setProgress(0);
      const sc = document.getElementById("quizScore"); if (sc) sc.textContent = "0";
      currentAlloc = resetAlloc(); renderChips();
      mistakesDeck = [];
      showPage("quizPage");
      showQuestion();
    });

    document.querySelectorAll(".a-btn").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        document.querySelectorAll(".a-btn").forEach(x=>x.classList.remove("active"));
        btn.classList.add("active");
        currentActionAlloc = btn.dataset.act;
      });
    });

    document.getElementById("allocAddBtn")?.addEventListener("click", ()=>{
      const raw = parseInt(document.getElementById("allocPct").value, 10);
      const v = Math.max(1, Math.min(100, isNaN(raw) ? 0 : raw));
      currentAlloc[currentActionAlloc] = Math.min(100, (currentAlloc[currentActionAlloc]||0) + v);
      renderChips();
    });

    document.getElementById("quizClearAlloc")?.addEventListener("click", ()=>{
      currentAlloc = resetAlloc(); renderChips();
    });

    document.getElementById("quizSubmitBtn")?.addEventListener("click", submitAnswer);
  });

  // --- RESCUE: remet #quizPage et #resultsPage comme SŒURS de #editorPage ---
(function fixPages() {
  const editor = document.getElementById('editorPage');
  const quiz   = document.getElementById('quizPage');
  const results= document.getElementById('resultsPage');
  if (!editor) return;

  const root = editor.parentElement || document.body;

  if (quiz && editor.contains(quiz))   root.appendChild(quiz);
  if (results && editor.contains(results)) root.appendChild(results);
})();

function showPage(id){
  document.querySelectorAll('.page').forEach(el => el.classList.add('hidden'));
  const p = document.getElementById(id);
  if (p) p.classList.remove('hidden');
}

const startBtn = document.getElementById('startQuizBtn');
if (startBtn && !startBtn._wired){
  startBtn._wired = true;
  startBtn.addEventListener('click', () => {
    // ton startQuiz existant si tu en as un :
    if (typeof startQuiz === 'function') return startQuiz();
    // fallback : au moins on affiche la page
    showPage('quizPage');
  });
}
(function ensureSiblingPages(){


// 1) Crée #resultsPage si manquant
let resultsPage = document.getElementById('resultsPage');
if (!resultsPage) {
resultsPage = document.createElement('section');
resultsPage.id = 'resultsPage';
resultsPage.className = 'page hidden';
resultsPage.innerHTML = `
<div class="sb-card">
<div class="sb-title" style="text-transform:none;color:var(--fg)">Résultats</div>
<div id="resultsSummary" class="muted" style="margin-bottom:8px"></div>
<div id="resultsTable"></div>
<div class="row center" style="margin-top:12px;gap:8px">
<button id="backToEditorBtn" class="btn">Retour à l'éditeur</button>
<button id="retryQuizBtn" class="btn primary">Rejouer le quizz</button>
</div>
</div>`;
root.appendChild(resultsPage);
}

renderResultsRange(state);


// 2) Bouton "Voir les résultats" sur la page quizz (ajouté une fois)
if (!document.getElementById('showResultsBtn')){
const container = quizPage.querySelector('.quizfs') || quizPage;
const row = document.createElement('div');
row.className = 'row center';
row.style.marginTop = '12px';
const btn = document.createElement('button');
btn.id = 'showResultsBtn';
btn.className = 'btn';
btn.textContent = 'Voir les résultats';
row.appendChild(btn);
container.appendChild(row);
btn.addEventListener('click', () => { renderResults(); showPage('resultsPage'); });
}


// 3) Câblage des boutons de la page résultats
const back = document.getElementById('backToEditorBtn');
if (back && !back._wired){ back._wired = true; back.addEventListener('click', () => showPage('editorPage')); }
const retry = document.getElementById('retryQuizBtn');
if (retry && !retry._wired){ retry._wired = true; retry.addEventListener('click', () => {
if (typeof window.startQuiz === 'function') { try{ startQuiz(); }catch(e){ console.error(e); showPage('quizPage'); } }
else { showPage('quizPage'); }
}); }


// 4) Rendu simple des résultats (best-effort)
window.renderResults = window.renderResults || function renderResults(){
const summaryEl = document.getElementById('resultsSummary');
const tableEl = document.getElementById('resultsTable');
if (!summaryEl || !tableEl) return;
let total = 0, correct = 0, rows = '';
try {
const q = (window.state && state.quiz) ? state.quiz : null;
if (q) {
const keys = Object.keys(q.answers || {});
total = keys.length || (q.order?.length || 0);
correct = q.correct || keys.filter(k => q.answers[k]?.correct).length;
rows = keys.slice(0, 300).map(k => {
const a = q.answers[k] || {}; const hand = a.hand || k;
const given = a.given ?? '-'; const expected = a.expected ?? '-'; const ok = !!a.correct;
return `
<div style="display:grid;grid-template-columns:100px 1fr 1fr 60px;gap:8px;padding:6px 8px;border:1px solid var(--stroke);border-radius:8px;background:var(--panel2);margin-bottom:6px">
<div style="font-weight:800">${hand}</div>
<div class="muted">Réponse: ${given}</div>
<div class="muted">Attendu: ${expected}</div>
<div style="text-align:right;font-weight:800;color:${ok?'#16a34a':'#ef4444'}">${ok?'✔':'✘'}</div>
</div>`;
}).join('');
}
} catch(e){ console.warn('[RESULTS] fallback', e); }
summaryEl.innerHTML = `<div>Score: <b>${correct}</b> / <b>${total}</b></div>`;
tableEl.innerHTML = rows || `<div class="muted">Aucun détail d'items disponible.</div>`;
};


// 5) Raccourci clavier: R pour Résultats depuis la page quizz
document.addEventListener('keydown', (e) => {
if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey) {
renderResults();
showPage('resultsPage');
}
});
})();


// Utilitaire debug rapide: nav('quiz'), nav('results'), nav('editor')
window.nav = window.nav || function(which){ const map={editor:'editorPage',quiz:'quizPage',results:'resultsPage'}; showPage(map[which]||'editorPage'); };

renderResults();
showPage('resultsPage');



}