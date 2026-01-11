(() => {
  const DB_NAME = "shiol_calls_db";
  const DB_VER = 4; // nueva versión por cambios de campos

  const CATALOG = {
    modulos: ["VENTAS","COMPRAS","TESORERIA","REPORTES","CONTABILIDAD","TABLAS","CONFIGURACION"],
    tipos: ["CONSULTA","INCIDENCIA","DESARROLLO"],
    estados: ["CREADO","SEGUIMIENTO","FINALIZADO"],
    canales: ["LLAMADA","WHATSAPP","CORREO","PRESENCIAL","OTRO"],
    prioridades: ["BAJA","MEDIA","ALTA","URGENTE"]
  };

  // ---------- IndexedDB ----------
  function openDB(){
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);

      req.onupgradeneeded = () => {
        const db = req.result;

        if(!db.objectStoreNames.contains("cases")){
          const s = db.createObjectStore("cases", { keyPath: "id" });
          s.createIndex("fecha","fecha");
          s.createIndex("estado","estado");
          s.createIndex("modulo","modulo");
          s.createIndex("empresaId","empresaId");
        }

        if(!db.objectStoreNames.contains("followups")){
          const s = db.createObjectStore("followups", { keyPath: "fid" });
          s.createIndex("caseId","caseId");
          s.createIndex("fecha","fecha");
        }

        if(!db.objectStoreNames.contains("meta")){
          db.createObjectStore("meta", { keyPath: "k" });
        }

        if(!db.objectStoreNames.contains("companies")){
          const s = db.createObjectStore("companies", { keyPath: "cid" });
          s.createIndex("name","name");
        }

        if(!db.objectStoreNames.contains("responsibles")){
          const s = db.createObjectStore("responsibles", { keyPath: "rid" });
          s.createIndex("name","name");
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function tx(db, store, mode="readonly"){
    return db.transaction(store, mode).objectStore(store);
  }

  async function getAll(db, store){
    return new Promise((resolve) => {
      const req = tx(db,store).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }

  async function put(db, store, data){
    return new Promise((resolve, reject) => {
      const req = tx(db,store,"readwrite").put(data);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  async function del(db, store, key){
    return new Promise((resolve) => {
      const req = tx(db,store,"readwrite").delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(true);
    });
  }

  async function getOne(db, store, key){
    return new Promise((resolve) => {
      const req = tx(db,store).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    });
  }

  async function getMeta(db, k){
    const r = await getOne(db, "meta", k);
    return r?.v;
  }

  async function setMeta(db, k, v){
    return put(db, "meta", {k, v});
  }

  async function seedCounter(db){
    const v = await getMeta(db, "nextId");
    if(!v) await setMeta(db, "nextId", 1);
  }

  async function nextId(db){
    const v = (await getMeta(db, "nextId")) || 1;
    await setMeta(db, "nextId", v + 1);
    return String(v).padStart(5, "0");
  }

  async function listFollowups(db, caseId){
    return new Promise((resolve) => {
      const store = tx(db,"followups");
      const idx = store.index("caseId");
      const req = idx.getAll(caseId);
      req.onsuccess = () => {
        const arr = req.result || [];
        arr.sort((a,b) => (a.fecha||"").localeCompare(b.fecha||""));
        resolve(arr);
      };
      req.onerror = () => resolve([]);
    });
  }

  async function deleteCase(db, id){
    const follow = await listFollowups(db, id);
    await del(db, "cases", id);
    await Promise.all(follow.map(f => del(db, "followups", f.fid)));
  }

  // ---------- Helpers UI ----------
  const $ = (id) => document.getElementById(id);
  const tbodyCases = () => document.querySelector("#casesTable tbody");
  const tbodyCompanies = () => document.querySelector("#companiesTable tbody");
  const tbodyResp = () => document.querySelector("#respTable tbody");

  function fillSelect(el, items, placeholder){
    el.innerHTML = "";
    if(placeholder){
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = placeholder;
      el.appendChild(opt);
    }
    items.forEach(v => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      el.appendChild(opt);
    });
  }

  function fillSelectObjects(el, items, placeholder, getValue, getText){
    el.innerHTML = "";
    if(placeholder){
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = placeholder;
      el.appendChild(opt);
    }
    items.forEach(it => {
      const opt = document.createElement("option");
      opt.value = getValue(it);
      opt.textContent = getText(it);
      el.appendChild(opt);
    });
  }

  function badge(text){
    const s = document.createElement("span");
    s.className = "badge badge--" + text;
    s.textContent = text;
    return s;
  }

  async function fileToDataURL(file){
    if(!file) return null;
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  function escapeHtml(s){
    return (s ?? "").replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }

  function fmtDT(iso){
    try{ return new Date(iso).toLocaleString(); }catch{ return iso; }
  }

  function registerSW(){
    if("serviceWorker" in navigator){
      navigator.serviceWorker.register("./sw.js").catch(()=>{});
    }
  }

  function debounce(fn, wait){
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
  }

  // ---------- State ----------
  let db;
  let companiesCache = [];
  let respCache = [];

  async function refreshCompaniesCache(){
    companiesCache = await getAll(db, "companies");
    companiesCache.sort((a,b) => (a.name||"").localeCompare(b.name||""));
  }
  async function refreshRespCache(){
    respCache = await getAll(db, "responsibles");
    respCache.sort((a,b) => (a.name||"").localeCompare(b.name||""));
  }
  function companyById(cid){ return companiesCache.find(c => c.cid === cid); }
  function respById(rid){ return respCache.find(r => r.rid === rid); }

  async function fillCompanySelect(){
    await refreshCompaniesCache();
    fillSelectObjects($("empresaSelect"), companiesCache, "-- Selecciona empresa --", c => c.cid, c => c.name);
  }

  async function fillRespSelects(){
    await refreshRespCache();
    fillSelectObjects($("respCrear"), respCache, "-- Selecciona --", r => r.rid, r => r.name);
    fillSelectObjects($("followResp"), respCache, "-- Selecciona --", r => r.rid, r => r.name);
  }

  function onEmpresaChange(){
    const cid = $("empresaSelect").value;
    const c = companyById(cid);
    if(!c) return;
    if(!$("contacto").value) $("contacto").value = c.contact || "";
    if(!$("telefono").value) $("telefono").value = c.phone || "";
    if(!$("correo").value) $("correo").value = c.email || "";
  }

  // ---------- EMPRESAS ----------
  function clearCompanyForm(){
    $("companyId").value = "";
    $("companyForm").reset();
  }

  function loadCompanyToForm(cid){
    const c = companyById(cid);
    if(!c) return;
    $("companyId").value = c.cid;
    $("empresaNombre").value = c.name || "";
    $("empresaContacto").value = c.contact || "";
    $("empresaTelefono").value = c.phone || "";
    $("empresaCorreo").value = c.email || "";
    $("empresaNotas").value = c.notes || "";
  }

  async function onCompanySubmit(e){
    e.preventDefault();
    const cid = $("companyId").value || crypto.randomUUID();
    const data = {
      cid,
      name: ($("empresaNombre").value || "").trim(),
      contact: ($("empresaContacto").value || "").trim(),
      phone: ($("empresaTelefono").value || "").trim(),
      email: ($("empresaCorreo").value || "").trim(),
      notes: ($("empresaNotas").value || "").trim(),
      updatedAt: new Date().toISOString(),
      createdAt: (await getOne(db,"companies",cid))?.createdAt || new Date().toISOString()
    };
    if(!data.name){ alert("La empresa es obligatoria."); return; }
    await put(db, "companies", data);
    clearCompanyForm();
    await renderCompanies();
    await fillCompanySelect();
  }

  async function renderCompanies(){
    await refreshCompaniesCache();

    const q = ($("qEmpresa").value || "").trim().toLowerCase();
    let list = companiesCache;
    if(q){
      list = list.filter(c => ([c.name,c.contact,c.phone,c.email,c.notes].join(" ").toLowerCase()).includes(q));
    }

    const tb = tbodyCompanies();
    tb.innerHTML = "";

    list.forEach((c, idx) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${idx+1}</td>
        <td><strong>${escapeHtml(c.name||"")}</strong></td>
        <td>${escapeHtml(c.contact||"")}</td>
        <td>${escapeHtml(c.phone||"")}</td>
        <td>${escapeHtml(c.email||"")}</td>
        <td></td>
      `;

      const acc = document.createElement("div");
      acc.className = "actions";

      const btnEdit = document.createElement("button");
      btnEdit.className = "iconBtn iconBtn--edit";
      btnEdit.textContent = "Editar";
      btnEdit.onclick = () => loadCompanyToForm(c.cid);

      const btnDel = document.createElement("button");
      btnDel.className = "iconBtn iconBtn--del";
      btnDel.textContent = "Eliminar";
      btnDel.onclick = async () => {
        if(confirm(`¿Eliminar empresa "${c.name}"?`)){
          await del(db, "companies", c.cid);
          await renderCompanies();
          await fillCompanySelect();
        }
      };

      acc.append(btnEdit, btnDel);
      tr.children[5].appendChild(acc);
      tb.appendChild(tr);
    });
  }

  // ---------- RESPONSABLES ----------
  function clearRespForm(){
    $("respId").value = "";
    $("respForm").reset();
  }

  function loadRespToForm(rid){
    const r = respById(rid);
    if(!r) return;
    $("respId").value = r.rid;
    $("respNombre").value = r.name || "";
    $("respRol").value = r.role || "";
    $("respTelefono").value = r.phone || "";
    $("respCorreo").value = r.email || "";
  }

  async function onRespSubmit(e){
    e.preventDefault();
    const rid = $("respId").value || crypto.randomUUID();
    const data = {
      rid,
      name: ($("respNombre").value || "").trim(),
      role: ($("respRol").value || "").trim(),
      phone: ($("respTelefono").value || "").trim(),
      email: ($("respCorreo").value || "").trim(),
      updatedAt: new Date().toISOString(),
      createdAt: (await getOne(db,"responsibles",rid))?.createdAt || new Date().toISOString()
    };
    if(!data.name){ alert("El nombre del responsable es obligatorio."); return; }
    await put(db, "responsibles", data);
    clearRespForm();
    await renderResponsables();
    await fillRespSelects();
  }

  async function renderResponsables(){
    await refreshRespCache();

    const q = ($("qResp").value || "").trim().toLowerCase();
    let list = respCache;
    if(q){
      list = list.filter(r => ([r.name,r.role,r.phone,r.email].join(" ").toLowerCase()).includes(q));
    }

    const tb = tbodyResp();
    tb.innerHTML = "";

    list.forEach((r, idx) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${idx+1}</td>
        <td><strong>${escapeHtml(r.name||"")}</strong></td>
        <td>${escapeHtml(r.role||"")}</td>
        <td>${escapeHtml(r.phone||"")}</td>
        <td>${escapeHtml(r.email||"")}</td>
        <td></td>
      `;

      const acc = document.createElement("div");
      acc.className = "actions";

      const btnEdit = document.createElement("button");
      btnEdit.className = "iconBtn iconBtn--edit";
      btnEdit.textContent = "Editar";
      btnEdit.onclick = () => loadRespToForm(r.rid);

      const btnDel = document.createElement("button");
      btnDel.className = "iconBtn iconBtn--del";
      btnDel.textContent = "Eliminar";
      btnDel.onclick = async () => {
        if(confirm(`¿Eliminar responsable "${r.name}"?`)){
          await del(db, "responsibles", r.rid);
          await renderResponsables();
          await fillRespSelects();
        }
      };

      acc.append(btnEdit, btnDel);
      tr.children[5].appendChild(acc);
      tb.appendChild(tr);
    });
  }

  // ---------- CASOS ----------
  function clearCaseForm(){
    $("caseForm").reset();
    $("caseForm").dataset.editing = "";
    $("fecha").valueAsDate = new Date();
    $("canal").value = "LLAMADA";
    $("prioridad").value = "MEDIA";
  }

  async function loadCaseToForm(id){
    const c = await getOne(db, "cases", id);
    if(!c) return;

    $("fecha").value = c.fecha || "";
    $("modulo").value = c.modulo || "";
    $("tipo").value = c.tipo || "";
    $("canal").value = c.canal || "LLAMADA";
    $("prioridad").value = c.prioridad || "MEDIA";

    $("respCrear").value = c.respCrearRid || "";
    $("empresaSelect").value = c.empresaId || "";
    $("contacto").value = c.contacto || "";
    $("telefono").value = c.telefono || "";
    $("correo").value = c.correo || "";
    $("sla").value = c.sla || "";
    $("ticketExterno").value = c.ticketExterno || "";
    $("observacion").value = c.observacion || "";

    $("caseForm").dataset.editing = id;
    window.scrollTo({top: 0, behavior:"smooth"});
  }

  async function onCaseSubmit(e){
    e.preventDefault();

    const editingId = $("caseForm").dataset.editing;

    const payload = {
      fecha: $("fecha").value,
      modulo: $("modulo").value,
      tipo: $("tipo").value,
      canal: $("canal").value,
      prioridad: $("prioridad").value,

      respCrearRid: $("respCrear").value || "",
      empresaId: $("empresaSelect").value || "",
      contacto: ($("contacto").value || "").trim(),
      telefono: ($("telefono").value || "").trim(),
      correo: ($("correo").value || "").trim(),

      sla: $("sla").value || "",
      ticketExterno: ($("ticketExterno").value || "").trim(),
      observacion: ($("observacion").value || "").trim(),

      updatedAt: new Date().toISOString()
    };

    const imgFile = $("imagen").files?.[0];
    if(imgFile) payload.imagen = await fileToDataURL(imgFile);

    if(editingId){
      const prev = await getOne(db, "cases", editingId);
      await put(db, "cases", {
        ...prev,
        ...payload,
        imagen: payload.imagen ?? prev?.imagen ?? null
      });
    } else {
      const id = await nextId(db);
      await put(db, "cases", {
        id,
        ...payload,
        estado: "CREADO",
        respFinalizarRid: "",
        createdAt: new Date().toISOString(),
        imagen: payload.imagen ?? null
      });
    }

    clearCaseForm();
    await renderCases();
  }

  async function renderCases(){
    const q = ($("q").value || "").trim().toLowerCase();
    const fE = $("fEstado").value;
    const fM = $("fModulo").value;

    let cases = await getAll(db, "cases");

    if(fE) cases = cases.filter(c => (c.estado || "CREADO") === fE);
    if(fM) cases = cases.filter(c => c.modulo === fM);

    if(q){
      cases = cases.filter(c => {
        const empresaName = companyById(c.empresaId)?.name || "";
        const respCrea = respById(c.respCrearRid)?.name || "";
        const respFin = respById(c.respFinalizarRid)?.name || "";
        const blob = [
          c.id, empresaName, respCrea, respFin,
          c.observacion,
          c.modulo, c.tipo, c.estado,
          c.canal, c.prioridad,
          c.contacto, c.telefono, c.correo,
          c.ticketExterno
        ].join(" ").toLowerCase();
        return blob.includes(q);
      });
    }

    cases.sort((a,b) => (b.createdAt||"").localeCompare(a.createdAt||""));

    const tb = tbodyCases();
    tb.innerHTML = "";

    for(let i=0;i<cases.length;i++){
      const c = cases[i];
      const followCount = (await listFollowups(db, c.id)).length;

      const empresaName = companyById(c.empresaId)?.name || "";
      const respCrea = respById(c.respCrearRid)?.name || "";
      const respFin = respById(c.respFinalizarRid)?.name || "";

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${i+1}</td>
        <td><strong>${c.id}</strong></td>
        <td>${c.fecha || ""}</td>
        <td>${escapeHtml(empresaName)}</td>
        <td>${c.modulo || ""}</td>
        <td>${c.tipo || ""}</td>
        <td>${c.canal || ""}</td>
        <td>${c.prioridad || ""}</td>
        <td>${escapeHtml(respCrea)}</td>
        <td>${escapeHtml(respFin)}</td>
        <td></td>
        <td>${followCount}</td>
        <td>${c.imagen ? "📎" : ""}</td>
        <td></td>
      `;

      tr.children[10].appendChild(badge(c.estado || "CREADO"));

      const acc = document.createElement("div");
      acc.className = "actions";

      const btnFollow = document.createElement("button");
      btnFollow.className = "iconBtn iconBtn--follow";
      btnFollow.textContent = "Seguimiento";
      btnFollow.onclick = () => openFollow(c.id);

      const btnEdit = document.createElement("button");
      btnEdit.className = "iconBtn iconBtn--edit";
      btnEdit.textContent = "Editar";
      btnEdit.onclick = () => loadCaseToForm(c.id);

      const btnImg = document.createElement("button");
      btnImg.className = "iconBtn";
      btnImg.textContent = "Ver Img";
      btnImg.disabled = !c.imagen;
      btnImg.onclick = () => showImage(c.imagen);

      const btnDel = document.createElement("button");
      btnDel.className = "iconBtn iconBtn--del";
      btnDel.textContent = "Eliminar";
      btnDel.onclick = async () => {
        if(confirm(`¿Eliminar el caso ${c.id} y sus seguimientos?`)){
          await deleteCase(db, c.id);
          await renderCases();
          closeFollow();
        }
      };

      acc.append(btnFollow, btnEdit, btnImg, btnDel);
      tr.children[13].appendChild(acc);
      tb.appendChild(tr);
    }
  }

  // ---------- Seguimiento (estado automático + finalizador) ----------
  async function openFollow(caseId){
    const c = await getOne(db, "cases", caseId);
    if(!c) return;

    const empresaName = companyById(c.empresaId)?.name || "";
    $("followCard").hidden = false;
    $("followCaseId").value = caseId;
    $("followMeta").textContent = `Caso ${c.id} • ${empresaName} • ${c.modulo} • ${c.tipo} • Estado: ${c.estado || "CREADO"}`;

    $("followFecha").value = new Date().toISOString().slice(0,16);
    $("followResp").value = c.respFinalizarRid || c.respCrearRid || "";

    await renderTimeline(caseId);
    window.scrollTo({ top: $("followCard").offsetTop - 10, behavior:"smooth" });
  }

  function closeFollow(){
    $("followCard").hidden = true;
    $("followForm").reset();
    $("followCaseId").value = "";
    $("followMeta").textContent = "";
  }

  async function onFollowSubmit(e){
    e.preventDefault();
    const caseId = $("followCaseId").value;
    if(!caseId) return;

    const nota = ($("followNota").value || "").trim();
    if(!nota) return alert("Escribe una nota/acción.");

    const accion = $("followAccion").value; // SEGUIMIENTO o FINALIZAR
    const responsableRid = $("followResp").value || "";

    if(accion === "FINALIZAR" && !responsableRid){
      alert("Para FINALIZAR, selecciona un responsable.");
      return;
    }

    const f = {
      fid: crypto.randomUUID(),
      caseId,
      fecha: $("followFecha").value,
      responsableRid,
      accion,
      nota,
      proximo: ($("followProx").value || "").trim()
    };

    await put(db, "followups", f);

    const c = await getOne(db, "cases", caseId);
    if(c){
      if(accion === "FINALIZAR"){
        c.estado = "FINALIZADO";
        c.respFinalizarRid = responsableRid; // ✅ guarda finalizador
        c.fechaFinalizado = new Date().toISOString();
      } else {
        if(c.estado !== "FINALIZADO") c.estado = "SEGUIMIENTO";
      }
      c.updatedAt = new Date().toISOString();
      await put(db, "cases", c);

      const empresaName = companyById(c.empresaId)?.name || "";
      $("followMeta").textContent = `Caso ${c.id} • ${empresaName} • ${c.modulo} • ${c.tipo} • Estado: ${c.estado}`;
    }

    $("followForm").reset();
    $("followFecha").value = new Date().toISOString().slice(0,16);
    $("followAccion").value = "SEGUIMIENTO";

    await renderTimeline(caseId);
    await renderCases();
  }

  async function renderTimeline(caseId){
    const list = await listFollowups(db, caseId);
    const host = $("timeline");
    host.innerHTML = "";

    if(list.length === 0){
      host.innerHTML = `<div class="tItem"><div class="tTop"><strong>Sin seguimientos</strong></div><div class="tMeta">Agrega el primero para iniciar el historial.</div></div>`;
      return;
    }

    list.slice().reverse().forEach(item => {
      const respName = respById(item.responsableRid)?.name || "(sin responsable)";
      const div = document.createElement("div");
      div.className = "tItem";
      div.innerHTML = `
        <div class="tTop">
          <strong>${escapeHtml(respName)} • ${escapeHtml(item.accion || "SEGUIMIENTO")}</strong>
          <span class="tMeta">${fmtDT(item.fecha)}</span>
        </div>
        <div style="margin:8px 0;">${escapeHtml(item.nota).replace(/\n/g,"<br>")}</div>
        <div class="tMeta">${item.proximo ? `Próximo: ${escapeHtml(item.proximo)}` : ""}</div>
      `;
      host.appendChild(div);
    });
  }

  // ---------- Imagen ----------
  function showImage(dataUrl){
    $("dlgImgEl").src = dataUrl;
    $("dlgImg").showModal();
  }

  // ---------- Export / Import ----------
  async function exportAll(){
    const payload = {
      exportedAt: new Date().toISOString(),
      catalog: CATALOG,
      companies: await getAll(db, "companies"),
      responsibles: await getAll(db, "responsibles"),
      cases: await getAll(db, "cases"),
      followups: await getAll(db, "followups")
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {type:"application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `control-llamadas-shiol-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
  }

  async function importAll(file){
    const payload = JSON.parse(await file.text());

    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });

    db = await openDB();
    await seedCounter(db);

    await Promise.all((payload.companies || []).map(c => put(db,"companies",c)));
    await Promise.all((payload.responsibles || []).map(r => put(db,"responsibles",r)));
    await Promise.all((payload.cases || []).map(c => put(db,"cases",c)));
    await Promise.all((payload.followups || []).map(f => put(db,"followups",f)));

    await renderCompanies();
    await renderResponsables();
    await fillCompanySelect();
    await fillRespSelects();
    await renderCases();

    alert("Importación lista ✅");
  }

  async function resetAll(){
    if(!confirm("Esto borrará TODO (casos, seguimientos, empresas y responsables). ¿Continuar?")) return;

    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });

    db = await openDB();
    await seedCounter(db);

    await renderCompanies();
    await renderResponsables();
    await fillCompanySelect();
    await fillRespSelects();
    await renderCases();
  }

  // ---------- Filtros ----------
  function setupFilters(){
    fillSelect($("fEstado"), ["", ...CATALOG.estados], "");
    $("fEstado").options[0].textContent = "Estado (todos)";
    fillSelect($("fModulo"), ["", ...CATALOG.modulos], "");
    $("fModulo").options[0].textContent = "Módulo (todos)";
  }

  // ---------- Init ----------
  async function init(){
    db = await openDB();
    await seedCounter(db);

    fillSelect($("modulo"), CATALOG.modulos, "-- Selecciona módulo --");
    fillSelect($("tipo"), CATALOG.tipos, "-- Selecciona tipo --");
    fillSelect($("canal"), CATALOG.canales, "-- Selecciona canal --");
    fillSelect($("prioridad"), CATALOG.prioridades, "-- Selecciona --");
    setupFilters();

    $("fecha").valueAsDate = new Date();
    $("canal").value = "LLAMADA";
    $("prioridad").value = "MEDIA";

    await renderCompanies();
    await renderResponsables();
    await fillCompanySelect();
    await fillRespSelects();
    await renderCases();

    // dialogs
    $("btnEmpresas").addEventListener("click", () => $("dlgEmpresas").showModal());
    $("btnResponsables").addEventListener("click", () => $("dlgResponsables").showModal());
    $("dlgEmpClose").addEventListener("click", () => $("dlgEmpresas").close());
    $("dlgRespClose").addEventListener("click", () => $("dlgResponsables").close());

    // empresa
    $("companyForm").addEventListener("submit", onCompanySubmit);
    $("btnClearCompany").addEventListener("click", clearCompanyForm);
    $("btnRefreshEmp").addEventListener("click", renderCompanies);
    $("qEmpresa").addEventListener("input", debounce(renderCompanies, 200));

    // responsables
    $("respForm").addEventListener("submit", onRespSubmit);
    $("btnClearResp").addEventListener("click", clearRespForm);
    $("btnRefreshResp").addEventListener("click", renderResponsables);
    $("qResp").addEventListener("input", debounce(renderResponsables, 200));

    // caso
    $("caseForm").addEventListener("submit", onCaseSubmit);
    $("btnClearForm").addEventListener("click", clearCaseForm);
    $("empresaSelect").addEventListener("change", onEmpresaChange);

    // historial filtros
    $("btnRefresh").addEventListener("click", renderCases);
    $("q").addEventListener("input", debounce(renderCases, 200));
    $("fEstado").addEventListener("change", renderCases);
    $("fModulo").addEventListener("change", renderCases);

    // seguimiento
    $("followForm").addEventListener("submit", onFollowSubmit);
    $("btnCloseFollow").addEventListener("click", closeFollow);
    $("btnPrint").addEventListener("click", () => window.print());

    // export/import/reset
    $("btnExport").addEventListener("click", exportAll);
    $("importFile").addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      if(f) await importAll(f);
      e.target.value = "";
    });
    $("btnReset").addEventListener("click", resetAll);

    // image dialog
    $("dlgClose").addEventListener("click", () => $("dlgImg").close());

    registerSW();
  }

  init();
})();
