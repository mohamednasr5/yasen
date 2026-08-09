/* ========================================================================
   مدير الطباعة - المنطق الرئيسي
   ======================================================================== */
"use strict";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

/* ---------------- State ---------------- */
const state = {
  files: [],       // {id, name, type, ext, file, pages:[{dataUrl}] , docHtml, sheets, selected}
  nextId: 1,
  currentViewFileId: null,
  currentPageIndex: 0,
  printOpts: {
    paper: "A4",
    orientation: "portrait",
    nup: 1,
    duplex: false,
    duplexMode: "same-page", // none, normal, same-page
    copies: 1,               // number of copies (1-99)
    color: true,
    fitMode: "width",      // none, width, height, page
    scalePercent: 100,
    quality: "normal",     // draft, normal, high, max
    margins: { top: 10, bottom: 10, left: 10, right: 10 },
    printBgImages: true
  },
  previewState: {
    zoomLevel: 100,
    currentPage: 0,
    totalPages: 0,
    pageImages: [],
    fitMode: "fit-height"
  },
  usb: { device: null, endpointOut: null },
};

// ID Card State (moved here to fix initialization order)
const idCardState = {
  frontImage: null,      // Data URL of front image
  backImage: null,       // Data URL of back image
  frontUploaded: false,  // Whether front is uploaded to R2
  backUploaded: false,   // Whether back is uploaded to R2
  frontUrl: null,        // R2 URL for front
  backUrl: null,         // R2 URL for back
  layoutMode: 'stacked', // 'stacked' or 'duplex'
  cameraStream: null,    // Current camera stream
};

// OCR State (moved here to fix initialization order)
const ocrState = {
  capturedImage: null,        // Base64 data URL of captured image (current/single page)
  cameraStream: null,         // MediaStream from camera
  isProcessing: false,        // Processing state flag
  extractedText: '',          // Extracted text result
  jsonData: null,             // JSON structured data
  detectedLanguage: 'AR/EN',  // Detected language
  workerUrl: 'https://orders.usastud42.workers.dev', // Worker endpoint for OCR
  documentOrientation: 'portrait', // Document orientation: portrait or landscape (A4)
  
  // Multi-page support
  capturedPages: [],          // Array of {image: dataUrl, text: '', pageNumber: n}
  currentPageNumber: 0,       // Current page being captured (1-based)
  isMultiPageMode: true,      // Enable multi-page capture by default
  allPagesText: [],           // Array of extracted texts per page
  
  // Processing mode: 'server' (AI) or 'local' (offline)
  processingMode: 'server',
};

// R2 Configuration
const R2_CONFIG = {
  workerUrl: 'https://orders.usastud42.workers.dev',
  publicUrl: 'https://pub-edc4c80125a74d37b7f5fbdb576a4ecf.r2.dev',
  bucket: 'orders'
};

const PAPER_MM = {
  A4: [210, 297],
  A5: [148, 210],
  Letter: [216, 279],
  Legal: [216, 356],
  B5: [176, 250],
};

/* ---------------- Helpers ---------------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2200);
}

function extOf(name) {
  return (name.split(".").pop() || "").toLowerCase();
}

function typeMeta(ext) {
  if (ext === "pdf") return { cls: "ft-pdf", label: "PDF" };
  if (["doc", "docx"].includes(ext)) return { cls: "ft-docx", label: "Word" };
  if (["xls", "xlsx"].includes(ext)) return { cls: "ft-xlsx", label: "Excel" };
  return { cls: "ft-img", label: "صورة" };
}

function fileIconSvg(ext) {
  if (ext === "pdf")
    return '<svg viewBox="0 0 24 24"><path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M14 2v6h6"/></svg>';
  if (["doc", "docx"].includes(ext))
    return '<svg viewBox="0 0 24 24"><path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M9 13l1.5 5L12 14l1.5 4L15 13"/></svg>';
  if (["xls", "xlsx"].includes(ext))
    return '<svg viewBox="0 0 24 24"><path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M9 13l6 6M15 13l-6 6"/></svg>';
  return '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';
}

/* ---------------- Navigation ---------------- */
$$(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

function switchView(name) {
  $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  $$(".view").forEach((v) => v.classList.remove("active"));
  const targetView = $("#view-" + name);
  if (targetView) {
    targetView.classList.add("active");
  } else {
    console.warn('[Navigation] View not found:', name);
  }
  if (name === "viewer") refreshViewerSelect();
  if (name === "print") refreshPrintQueue();
  if (name === "idcard") {
    console.log('[Navigation] Switched to ID Card view');
    setTimeout(() => {
      if (typeof setupIdCardModule === 'function') setupIdCardModule();
      // Auto-start camera for front side if no image captured
      if (!idCardState.frontImage) {
        setTimeout(() => startCamera('front'), 300);
      }
    }, 100);
  }
  if (name === "ocr") {
    console.log('[Navigation] Switched to OCR view');
    setTimeout(() => {
      if (typeof setupOcrModule === 'function') setupOcrModule();
    }, 100);
  }
  if (name === "cloud") {
    console.log('[Navigation] Switched to Cloud view');
    setTimeout(() => {
      // Initialize cloud tabs if not already done
      if (typeof initCloudTabs === 'function') initCloudTabs();
    }, 100);
  }
  if (name === "ocr") {
    console.log('[Navigation] Switched to OCR view');
    setTimeout(() => {
      if (typeof setupOcrModule === 'function') setupOcrModule();
      // Auto-start camera if no image captured
      if (!ocrState.capturedImage) {
        setTimeout(() => startOcrCamera(), 300);
      }
    }, 100);
  }
}

/* ---------------- File import ---------------- */
$("#fileInput").addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  for (const f of files) {
    await addFile(f);
  }
  e.target.value = "";
  renderFileList();
  updateQueueBadge();
});

async function addFile(file) {
  const ext = extOf(file.name);
  const entry = {
    id: state.nextId++,
    name: file.name,
    ext,
    file,
    selected: true,
    pages: null,   // for pdf/images: array of dataURLs
    docHtml: null, // for docx
    sheetsHtml: null, // for xlsx
    loaded: false,
  };
  state.files.push(entry);
}

function renderFileList() {
  const list = $("#fileList");
  const empty = $("#emptyFiles");
  list.innerHTML = "";
  if (!state.files.length) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  state.files.forEach((f) => {
    const meta = typeMeta(f.ext);
    const row = document.createElement("div");
    row.className = "file-row";
    row.draggable = true;
    row.dataset.id = f.id;
    row.innerHTML = `
      <span class="handle">
        <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none">
          <circle cx="8" cy="6" r="1.2"/><circle cx="8" cy="12" r="1.2"/><circle cx="8" cy="18" r="1.2"/>
          <circle cx="16" cy="6" r="1.2"/><circle cx="16" cy="12" r="1.2"/><circle cx="16" cy="18" r="1.2"/>
        </svg>
      </span>
      <div class="chk ${f.selected ? "checked" : ""}" data-act="toggle">
        <svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6"/></svg>
      </div>
      <div class="file-icon ${meta.cls}">${fileIconSvg(f.ext)}</div>
      <div class="file-meta">
        <div class="fname">${f.name}</div>
        <div class="fsub">${meta.label} · ${(f.file.size / 1024).toFixed(0)} كيلوبايت</div>
      </div>
      <div class="file-actions">
        <button class="icon-btn" data-act="view" title="عرض">
          <svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
        <button class="icon-btn danger" data-act="remove" title="حذف">
          <svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6h12z"/></svg>
        </button>
      </div>
    `;
    list.appendChild(row);
  });
}

$("#fileList").addEventListener("click", (e) => {
  const row = e.target.closest(".file-row");
  if (!row) return;
  const id = Number(row.dataset.id);
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (act === "toggle") {
    const f = state.files.find((x) => x.id === id);
    f.selected = !f.selected;
    renderFileList();
  } else if (act === "remove") {
    state.files = state.files.filter((x) => x.id !== id);
    renderFileList();
    updateQueueBadge();
  } else if (act === "view") {
    state.currentViewFileId = id;
    switchView("viewer");
  }
});

/* drag reorder */
let dragEl = null;
$("#fileList").addEventListener("dragstart", (e) => {
  dragEl = e.target.closest(".file-row");
  dragEl?.classList.add("dragging");
});
$("#fileList").addEventListener("dragend", () => {
  dragEl?.classList.remove("dragging");
  dragEl = null;
  const order = $$(".file-row").map((r) => Number(r.dataset.id));
  state.files.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
});
$("#fileList").addEventListener("dragover", (e) => {
  e.preventDefault();
  const after = getDragAfterElement($("#fileList"), e.clientY);
  const dragging = document.querySelector(".dragging");
  if (!dragging) return;
  if (after == null) $("#fileList").appendChild(dragging);
  else $("#fileList").insertBefore(dragging, after);
});
function getDragAfterElement(container, y) {
  const els = [...container.querySelectorAll(".file-row:not(.dragging)")];
  return els.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) return { offset, element: child };
      return closest;
    },
    { offset: -Infinity }
  ).element;
}

function updateQueueBadge() {
  const n = state.files.length;
  $("#queueBadge").textContent = n ? `${n} ملف${n > 1 ? "ات" : ""}` : "لا توجد ملفات";
  const badge = $("#navFilesBadge");
  if (n) {
    badge.style.display = "flex";
    badge.textContent = n;
  } else {
    badge.style.display = "none";
  }
}

/* ---------------- Viewer ---------------- */
function refreshViewerSelect() {
  const sel = $("#viewerFileSelect");
  sel.innerHTML = "";
  if (!state.files.length) {
    sel.innerHTML = "<option>لا توجد ملفات</option>";
    $("#viewerBody").innerHTML = '<div class="empty">أضف ملفات من تبويب الملفات أولًا</div>';
    $("#pageNav").style.display = "none";
    return;
  }
  state.files.forEach((f) => {
    const opt = document.createElement("option");
    opt.value = f.id;
    opt.textContent = f.name;
    sel.appendChild(opt);
  });
  if (state.currentViewFileId && state.files.some((f) => f.id === state.currentViewFileId)) {
    sel.value = state.currentViewFileId;
  } else {
    state.currentViewFileId = Number(sel.value);
  }
  loadIntoViewer(state.currentViewFileId);
}
$("#viewerFileSelect").addEventListener("change", (e) => {
  state.currentViewFileId = Number(e.target.value);
  loadIntoViewer(state.currentViewFileId);
});

async function loadIntoViewer(id) {
  const f = state.files.find((x) => x.id === id);
  if (!f) return;
  const body = $("#viewerBody");
  body.innerHTML = '<div class="empty">جاري التحميل…</div>';
  $("#pageNav").style.display = "none";

  try {
    if (f.ext === "pdf") {
      if (!f.pages) f.pages = await renderPdfPages(f.file);
      state.currentPageIndex = 0;
      showPdfPage(f);
    } else if (["doc", "docx"].includes(f.ext)) {
      if (!f.docHtml) f.docHtml = await renderDocx(f.file);
      body.innerHTML = `<div class="docx-content">${f.docHtml}</div>`;
    } else if (["xls", "xlsx"].includes(f.ext)) {
      if (!f.sheetsHtml) f.sheetsHtml = await renderXlsx(f.file);
      body.innerHTML = f.sheetsHtml;
    } else {
      if (!f.pages) f.pages = [await fileToDataUrl(f.file)];
      body.innerHTML = `<img class="plain-img" src="${f.pages[0]}">`;
    }
  } catch (err) {
    console.error(err);
    body.innerHTML = `<div class="empty">تعذّر عرض هذا الملف: ${err.message || err}</div>`;
  }
}

function showPdfPage(f) {
  const body = $("#viewerBody");
  body.innerHTML = `<img class="page-canvas" src="${f.pages[state.currentPageIndex]}">`;
  if (f.pages.length > 1) {
    $("#pageNav").style.display = "flex";
    $("#pageIndicator").textContent = `${state.currentPageIndex + 1} / ${f.pages.length}`;
  } else {
    $("#pageNav").style.display = "none";
  }
}
$("#prevPage").addEventListener("click", () => {
  const f = state.files.find((x) => x.id === state.currentViewFileId);
  if (!f || !f.pages) return;
  state.currentPageIndex = (state.currentPageIndex - 1 + f.pages.length) % f.pages.length;
  showPdfPage(f);
});
$("#nextPage").addEventListener("click", () => {
  const f = state.files.find((x) => x.id === state.currentViewFileId);
  if (!f || !f.pages) return;
  state.currentPageIndex = (state.currentPageIndex + 1) % f.pages.length;
  showPdfPage(f);
});

async function renderPdfPages(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.6 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    pages.push(canvas.toDataURL("image/jpeg", 0.88));
  }
  return pages;
}

async function renderDocx(file) {
  const buf = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer: buf });
  return result.value;
}

async function renderXlsx(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  return wb.SheetNames.map((name) => {
    const html = XLSX.utils.sheet_to_html(wb.Sheets[name], { header: "" });
    return `<div class="section-title" style="color:#7a6a3a">${name}</div>${html}`;
  }).join("");
}

function fileToDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

/* ---------------- Print options UI ---------------- */
// Safe event listener helper - only adds if element exists
function safeAddEventListener(selector, event, handler) {
  const el = $(selector);
  if (el) {
    el.addEventListener(event, handler);
  }
}

function safeAddEventListenerAll(selector, event, handler) {
  $$(selector).forEach(el => el.addEventListener(event, handler));
}

safeAddEventListener("#paperSize", "change", (e) => {
  state.printOpts.paper = e.target.value;
  updateSheetPreview();
});
safeAddEventListener("#orientation", "change", (e) => {
  state.printOpts.orientation = e.target.value;
  updateSheetPreview();
});
safeAddEventListenerAll("#nupPills .pill", "click", function() {
  $$("#nupPills .pill").forEach((x) => x.classList.remove("active"));
  this.classList.add("active");
  state.printOpts.nup = Number(this.dataset.n);
  updateSheetPreview();
});
// Duplex switch (legacy - kept for compatibility)
safeAddEventListener("#duplexSwitch", "click", (e) => {
  state.printOpts.duplex = !state.printOpts.duplex;
  e.target.classList.toggle("on", state.printOpts.duplex);
  updateSheetPreview();
});

// New: Duplex Mode selector
safeAddEventListener("#duplexMode", "change", (e) => {
  state.printOpts.duplexMode = e.target.value;
  state.printOpts.duplex = e.target.value !== "none";
  
  // Show/hide info box
  const infoBox = $("#duplexInfo");
  if (e.target.value === "same-page") {
    infoBox.style.display = "block";
  } else {
    infoBox.style.display = "none";
  }
  
  updateSheetPreview();
});

// New: Copies count handler
$("#copiesCount").addEventListener("input", (e) => {
  let val = parseInt(e.target.value) || 1;
  val = Math.max(1, Math.min(99, val));
  state.printOpts.copies = val;
  e.target.value = val; // Ensure valid value
});

$("#copiesCount").addEventListener("change", (e) => {
  let val = parseInt(e.target.value) || 1;
  val = Math.max(1, Math.min(99, val));
  state.printOpts.copies = val;
  e.target.value = val;
});
$("#colorSwitch").addEventListener("click", (e) => {
  state.printOpts.color = !state.printOpts.color;
  e.target.classList.toggle("on", state.printOpts.color);
});

// Advanced Options Event Listeners
$("#fitMode").addEventListener("change", (e) => {
  state.printOpts.fitMode = e.target.value;
  updateSheetPreview();
});

$("#scalePercent").addEventListener("input", (e) => {
  let val = parseInt(e.target.value) || 100;
  val = Math.max(10, Math.min(400, val));
  state.printOpts.scalePercent = val;
});

$("#printQuality").addEventListener("change", (e) => {
  state.printOpts.quality = e.target.value;
});

// Margins handlers
const marginInputs = ["marginTop", "marginBottom", "marginLeft", "marginRight"];
marginInputs.forEach(id => {
  $(`#${id}`).addEventListener("input", (e) => {
    let val = parseInt(e.target.value) || 0;
    val = Math.max(0, Math.min(50, val));
    const key = id.replace("margin", "").toLowerCase();
    state.printOpts.margins[key] = val;
    updateMarginDisplay();
  });
});

function updateMarginDisplay() {
  const m = state.printOpts.margins;
  $("#marginValueDisplay").textContent = `${m.top}, ${m.bottom}, ${m.left}, ${m.right}`;
}

$("#bgImagesSwitch").addEventListener("click", (e) => {
  state.printOpts.printBgImages = !state.printOpts.printBgImages;
  e.target.classList.toggle("on", state.printOpts.printBgImages);
});

function nupGrid(n) {
  if (n === 1) return [1, 1];
  if (n === 2) return [1, 2];
  if (n === 4) return [2, 2];
  if (n === 6) return [2, 3];
  if (n === 9) return [3, 3];
  return [1, 1];
}

function updateSheetPreview() {
  const mini = $("#sheetPreview");
  mini.classList.toggle("landscape", state.printOpts.orientation === "landscape");
  const [rows, cols] = nupGrid(state.printOpts.nup);
  const grid = $("#sheetGrid");
  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  grid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
  grid.innerHTML = "";
  for (let i = 0; i < rows * cols; i++) {
    const c = document.createElement("div");
    c.className = "cell";
    grid.appendChild(c);
  }
  $("#duplexMark").style.display = state.printOpts.duplex ? "block" : "none";
}
updateSheetPreview();

function refreshPrintQueue() {
  const list = $("#printQueueList");
  list.innerHTML = "";
  const sel = state.files.filter((f) => f.selected);
  $("#selectedCount").textContent = sel.length;
  const hasFiles = sel.length > 0;
  $("#printBtn").disabled = !hasFiles;
  $("#previewBtn").disabled = !hasFiles;
  sel.forEach((f) => {
    const meta = typeMeta(f.ext);
    const row = document.createElement("div");
    row.className = "file-row";
    row.innerHTML = `
      <div class="file-icon ${meta.cls}">${fileIconSvg(f.ext)}</div>
      <div class="file-meta">
        <div class="fname">${f.name}</div>
        <div class="fsub">${meta.label}</div>
      </div>
    `;
    list.appendChild(row);
  });
}

/* ---------------- Print engine with Preview ---------------- */
$("#previewBtn").addEventListener("click", async () => {
  const sel = state.files.filter((f) => f.selected);
  if (!sel.length) return toast("اختر ملفًا واحدًا على الأقل من تبويب الملفات");
  
  await openPrintPreview(sel);
});

$("#printBtn").addEventListener("click", async () => {
  const sel = state.files.filter((f) => f.selected);
  if (!sel.length) return toast("اختر ملفًا واحدًا على الأقل من تبويب الملفات");

  $("#printBtn").disabled = true;
  $("#printBtn").innerHTML = 'جارٍ التجهيز…';
  try {
    await buildPrintRoot(sel);
    applyPrintCss();
    setTimeout(() => {
      window.print();
      resetPrintButton();
    }, 300);
  } catch (err) {
    console.error(err);
    toast("حدث خطأ أثناء تجهيز الطباعة");
    resetPrintButton();
  }
});

function resetPrintButton() {
  $("#printBtn").disabled = false;
  $("#printBtn").innerHTML =
    '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><path d="M6 9V4h12v5M6 18h12v-6H6v6zM6 14H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-2"/></svg> طباعة الآن';
}

async function openPrintPreview(selFiles) {
  const modal = $("#printPreviewModal");
  
  // Show loading state
  $("#previewImage").src = "";
  $("#previewPageInfo").textContent = "جارٍ التحميل…";
  modal.classList.add("active");
  
  try {
    // Build all preview images
    const images = await buildPreviewImages(selFiles);
    state.previewState.pageImages = images;
    state.previewState.totalPages = images.length;
    state.previewState.currentPage = 0;
    
    // Populate page selector
    const select = $("#previewPageSelect");
    select.innerHTML = "";
    images.forEach((_, i) => {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = `صفحة ${i + 1}`;
      select.appendChild(opt);
    });
    
    // Show first page
    showPreviewPage(0);
    
  } catch (err) {
    console.error(err);
    toast("خطأ في تحميل المعاينة: " + err.message);
    modal.classList.remove("active");
  }
}

async function buildPreviewImages(selFiles) {
  const allImages = [];
  
  for (const f of selFiles) {
    if (f.ext === "pdf") {
      if (!f.pages) f.pages = await renderPdfPages(f.file);
      allImages.push(...f.pages);
    } else if (!["doc", "docx", "xls", "xlsx"].includes(f.ext)) {
      if (!f.pages) f.pages = [await fileToDataUrl(f.file)];
      allImages.push(...f.pages);
    } else {
      // For docx/xlsx, render to canvas then to image
      const canvas = await renderDocumentToCanvas(f);
      allImages.push(canvas.toDataURL("image/png"));
    }
  }
  
  return allImages;
}

async function renderDocumentToCanvas(f) {
  const canvas = document.createElement("canvas");
  canvas.width = 794;  // A4 width at 96 DPI
  canvas.height = 1123; // A4 height at 96 DPI
  const ctx = canvas.getContext("2d");
  
  // White background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // Draw content
  if (["doc", "docx"].includes(f.ext)) {
    if (!f.docHtml) f.docHtml = await renderDocx(f.file);
    
    // Create temporary container to render HTML
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = `<div class="docx-content" style="background:#fff;color:#000;padding:20px;font-size:12px;line-height:1.6;">${f.docHtml}</div>`;
    tempDiv.style.position = "absolute";
    tempDiv.style.left = "-9999px";
    tempDiv.style.width = `${canvas.width - 40}px`;
    document.body.appendChild(tempDiv);
    
    try {
      // Use html2canvas-like approach with foreignObject for SVG
      const data = new XMLSerializer().serializeToString(tempDiv);
      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}">
          <foreignObject width="100%" height="100%">
            <div xmlns="http://www.w3.org/1999/xhtml">${data}</div>
          </foreignObject>
        </svg>`;
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
      });
      ctx.drawImage(img, 0, 0);
    } finally {
      document.body.removeChild(tempDiv);
    }
  } else if (["xls", "xlsx"].includes(f.ext)) {
    if (!f.sheetsHtml) f.sheetsHtml = await renderXlsx(f.file);
    
    ctx.fillStyle = "#000";
    ctx.font = "14px Tajawal, sans-serif";
    ctx.fillText(f.name, 20, 30);
    
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = f.sheetsHtml;
    const tables = tempDiv.querySelectorAll("table");
    let y = 60;
    tables.forEach(table => {
      const rows = table.querySelectorAll("tr");
      rows.slice(0, 30).forEach(row => {
        const cells = row.querySelectorAll("td, th");
        let x = 20;
        cells.forEach(cell => {
          const text = cell.textContent.trim().substring(0, 25);
          ctx.font = "11px monospace";
          ctx.fillText(text, x, y);
          x += 150;
        });
        y += 18;
      });
      y += 20;
    });
  }
  
  return canvas;
}

function showPreviewPage(index) {
  const { pageImages, totalPages } = state.previewState;
  if (index < 0 || index >= totalPages) return;
  
  state.previewState.currentPage = index;
  const img = $("#previewImage");
  
  // Apply grayscale filter if needed
  img.style.filter = state.printOpts.color ? "none" : "grayscale(100%) contrast(1.1)";
  img.src = pageImages[index];
  
  // Update navigation
  $("#previewPageInfo").textContent = `صفحة ${index + 1} من ${totalPages}`;
  $("#previewPageSelect").value = index;
  
  // Apply zoom and fit mode
  applyPreviewTransform();
}

function applyPreviewTransform() {
  const page = $("#previewPage");
  const zoom = state.previewState.zoomLevel;
  const fitMode = $("#previewFitMode").value;
  
  // Reset classes
  page.classList.remove("fit-width", "fit-height", "actual-size");
  
  switch (fitMode) {
    case "fit-width":
      page.classList.add("fit-width");
      break;
    case "fit-height":
      page.classList.add("fit-height");
      break;
    case "actual":
      page.classList.add("actual-size");
      break;
  }
  
  // Apply zoom transform
  page.style.transform = `scale(${zoom / 100})`;
  $("#zoomLevel").textContent = `${zoom}%`;
}

// Preview Navigation Events
$("#zoomIn").addEventListener("click", () => {
  state.previewState.zoomLevel = Math.min(400, state.previewState.zoomLevel + 25);
  applyPreviewTransform();
});

$("#zoomOut").addEventListener("click", () => {
  state.previewState.zoomLevel = Math.max(25, state.previewState.zoomLevel - 25);
  applyPreviewTransform();
});

$("#previewFitMode").addEventListener("change", () => {
  applyPreviewTransform();
});

$("#previewPageSelect").addEventListener("change", (e) => {
  showPreviewPage(Number(e.target.value));
});

$("#previewPrevPage").addEventListener("click", () => {
  showPreviewPage(state.previewState.currentPage - 1);
});

$("#previewNextPage").addEventListener("click", () => {
  showPreviewPage(state.previewState.currentPage + 1);
});

// Modal Controls
$("#closePreviewModal").addEventListener("click", closePreviewModal);
$("#cancelPrintBtn").addEventListener("click", closePreviewModal);

$("#printPreviewModal").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closePreviewModal();
});

function closePreviewModal() {
  $("#printPreviewModal").classList.remove("active");
  state.previewState.zoomLevel = 100;
}

// Confirm Print from Preview
$("#confirmPrintBtn").addEventListener("click", async () => {
  const sel = state.files.filter((f) => f.selected);
  if (!sel.length) return;
  
  closePreviewModal();
  
  $("#printBtn").disabled = true;
  $("#printBtn").innerHTML = 'جارٍ الطباعة…';
  
  try {
    await buildPrintRoot(sel);
    applyPrintCss();
    setTimeout(() => {
      window.print();
      resetPrintButton();
    }, 300);
  } catch (err) {
    console.error(err);
    toast("حدث خطأ في الطباعة");
    resetPrintButton();
  }
});

// Keyboard shortcuts for preview
document.addEventListener("keydown", (e) => {
  if (!$("#printPreviewModal").classList.contains("active")) return;
  
  switch (e.key) {
    case "Escape":
      closePreviewModal();
      break;
    case "ArrowLeft":
      showPreviewPage(state.previewState.currentPage - 1);
      break;
    case "ArrowRight":
      showPreviewPage(state.previewState.currentPage + 1);
      break;
    case "+":
    case "=":
      state.previewState.zoomLevel = Math.min(400, state.previewState.zoomLevel + 25);
      applyPreviewTransform();
      break;
    case "-":
      state.previewState.zoomLevel = Math.max(25, state.previewState.zoomLevel - 25);
      applyPreviewTransform();
      break;
  }
});

function applyPrintCss() {
  let style = document.getElementById("dynamicPrintStyle");
  if (!style) {
    style = document.createElement("style");
    style.id = "dynamicPrintStyle";
    document.head.appendChild(style);
  }
  
  const [w, h] = PAPER_MM[state.printOpts.paper];
  const size =
    state.printOpts.orientation === "landscape" ? `${h}mm ${w}mm` : `${w}mm ${h}mm`;
  const [rows, cols] = nupGrid(state.printOpts.nup);
  
  // Get margins
  const m = state.printOpts.margins;
  const marginStr = `${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm`;
  
  // Quality-based DPI settings
  const qualityDpi = {
    draft: 72,
    normal: 150,
    high: 300,
    max: 600
  };
  
  // Build CSS rules
  let cssRules = `
    @page { size: ${size}; margin: ${marginStr}; }
    #printRoot .p-sheet { grid-template-columns: repeat(${cols}, 1fr); grid-template-rows: repeat(${rows}, 1fr); width:100%; height:100%; }
  `;
  
  // Add grayscale rule if color is disabled
  if (!state.printOpts.color) {
    cssRules += ` #printRoot { filter: grayscale(100%) contrast(1.05); } `;
  }
  
  // Add fit-to-page styles based on mode
  if (state.printOpts.fitMode !== "none") {
    switch (state.printOpts.fitMode) {
      case "width":
        cssRules += ` #printRoot .p-sheet img { max-width: 100% !important; width: auto !important; height: auto !important; } `;
        break;
      case "height":
        cssRules += ` #printRoot .p-sheet img { max-height: 100vh !important; width: auto !important; height: auto !important; } `;
        break;
      case "page":
        cssRules += ` #printRoot .p-sheet img { width: 100% !important; height: 100% !important; object-fit: contain !important; } `;
        break;
    }
  }
  
  // Add scale transform
  if (state.printOpts.scalePercent !== 100) {
    const scale = state.printOpts.scalePercent / 100;
    cssRules += ` #printRoot .p-sheet { transform: scale(${scale}); transform-origin: top center; } `;
  }
  
  // Background images setting
  if (!state.printOpts.printBgImages) {
    cssRules += ` #printRoot * { background-image: none !important; background-color: white !important; } `;
  }
  
  style.textContent = cssRules;
}

async function buildPrintRoot(selFiles) {
  const root = $("#printRoot");
  root.innerHTML = "";
  const [rows, cols] = nupGrid(state.printOpts.nup);
  const perSheet = rows * cols;

  // Collect flat list of page-images (pdf pages + image files) and flowing docs (docx/xlsx) separately,
  // but keep overall order as in the queue.
  let imgBuffer = [];

  const flushImages = () => {
    while (imgBuffer.length) {
      const chunk = imgBuffer.splice(0, perSheet);
      const sheet = document.createElement("div");
      sheet.className = "p-sheet";
      chunk.forEach((src) => {
        const img = document.createElement("img");
        img.src = src;
        sheet.appendChild(img);
      });
      root.appendChild(sheet);
    }
  };

  for (const f of selFiles) {
    if (f.ext === "pdf") {
      if (!f.pages) f.pages = await renderPdfPages(f.file);
      imgBuffer.push(...f.pages);
    } else if (!["doc", "docx", "xls", "xlsx"].includes(f.ext)) {
      if (!f.pages) f.pages = [await fileToDataUrl(f.file)];
      imgBuffer.push(...f.pages);
    } else {
      // flush any pending images as their own sheets before a flowing document
      flushImages();
      const flow = document.createElement("div");
      flow.className = "p-flow";
      if (["doc", "docx"].includes(f.ext)) {
        if (!f.docHtml) f.docHtml = await renderDocx(f.file);
        flow.innerHTML = `<div class="docx-content">${f.docHtml}</div>`;
      } else {
        if (!f.sheetsHtml) f.sheetsHtml = await renderXlsx(f.file);
        flow.innerHTML = f.sheetsHtml;
      }
      root.appendChild(flow);
    }
  }
  flushImages();
}

/* ---------------- WebUSB (experimental) ---------------- */
const usbLog = (msg) => {
  const box = $("#usbLog");
  box.textContent += "\n" + msg;
  box.scrollTop = box.scrollHeight;
};
const setUsbStatus = (ok, text) => {
  $("#usbStatusDot").className = "status-dot" + (ok === true ? " ok" : ok === false ? " err" : "");
  $("#usbStatusText").textContent = text;
};

$("#usbConnectBtn").addEventListener("click", async () => {
  if (!("usb" in navigator)) {
    setUsbStatus(false, "المتصفح لا يدعم WebUSB");
    usbLog("هذا المتصفح لا يدعم WebUSB. جرّب Chrome على أندرويد مع كابل OTG.");
    return;
  }
  try {
    usbLog("جارٍ فتح قائمة اختيار الأجهزة…");
    const device = await navigator.usb.requestDevice({ filters: [] });
    await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);

    // find the printer interface (class 7) and its OUT endpoint
    let ifaceNum = 0;
    let epOut = null;
    for (const cfg of device.configurations) {
      for (const iface of cfg.interfaces) {
        for (const alt of iface.alternates) {
          if (alt.interfaceClass === 7 || !epOut) {
            const out = alt.endpoints.find((e) => e.direction === "out");
            if (out) {
              ifaceNum = iface.interfaceNumber;
              epOut = out.endpointNumber;
            }
          }
        }
      }
    }
    if (epOut == null) throw new Error("لم يتم العثور على منفذ إرسال بيانات (Printer class)");

    await device.claimInterface(ifaceNum);
    state.usb.device = device;
    state.usb.endpointOut = epOut;
    setUsbStatus(true, `متصل: ${device.productName || "طابعة USB"}`);
    usbLog(`تم الاتصال. الواجهة #${ifaceNum}, منفذ الإرسال #${epOut}`);
    $("#usbTestPrintBtn").disabled = false;
  } catch (err) {
    setUsbStatus(false, "فشل الاتصال");
    usbLog("خطأ: " + (err.message || err));
  }
});

$("#usbTestPrintBtn").addEventListener("click", async () => {
  const { device, endpointOut } = state.usb;
  if (!device) return;
  try {
    usbLog("جارٍ إرسال صفحة اختبار (PCL خام)…");
    const enc = new TextEncoder();
    // Minimal PCL: reset, plain text line, form feed (page eject)
    const pcl =
      "\x1bE" + // PCL reset
      "مرحبًا - صفحة اختبار من مدير الطباعة\n" +
      "المهندس محمد حماد\n" +
      "\x0c"; // form feed
    const data = enc.encode(pcl);
    await device.transferOut(endpointOut, data);
    usbLog("تم إرسال البيانات. إن لم تطبع الصفحة، فالطابعة غالبًا تنتظر لغة طباعة مختلفة (PostScript) أو المنفذ محجوز لتعريف النظام.");
  } catch (err) {
    usbLog("فشل الإرسال: " + (err.message || err));
  }
});

/* ==================== ID CARD SCANNER ==================== */

// Initialize ID Card View
function initIdCardView() {
  setupCameraControls();
  setupLayoutOptions();
  setupPrintButton();
}

// Setup Camera Controls
function setupCameraControls() {
  // Front card controls
  $('#captureFrontBtn').addEventListener('click', () => captureImage('front'));
  $('#uploadFrontBtn').addEventListener('click', () => $('#fileFrontInput').click());
  $('#fileFrontInput').addEventListener('change', (e) => handleFileSelect(e, 'front'));
  $('#retakeFrontBtn').addEventListener('click', () => retakeImage('front'));
  
  // Back card controls
  $('#captureBackBtn').addEventListener('click', () => captureImage('back'));
  $('#uploadBackBtn').addEventListener('click', () => $('#fileBackInput').click());
  $('#fileBackInput').addEventListener('change', (e) => handleFileSelect(e, 'back'));
  $('#retakeBackBtn').addEventListener('click', () => retakeImage('back'));
}

// Setup ID Card Module (called once on init)
function setupIdCardModule() {
  console.log('[ID Card] Setting up module...');
  
  // Verify all required elements exist
  const requiredElements = [
    'view-idcard', 'stepFront', 'stepBack',
    'videoFront', 'canvasFront', 'cameraFront',
    'videoBack', 'canvasBack', 'cameraBack',
    'captureFrontBtn', 'captureBackBtn',
    'uploadFrontBtn', 'uploadBackBtn',
    'retakeFrontBtn', 'retakeBackBtn',
    'fileFrontInput', 'fileBackInput',
    'previewFront', 'previewBack',
    'imgFront', 'imgBack',
    'layoutOptions', 'printIdCardBtn',
    'idcardPrintPreview', 'idcardPreviewImg'
  ];
  
  const missingElements = [];
  requiredElements.forEach(id => {
    if (!$('#' + id)) {
      missingElements.push(id);
    }
  });
  
  if (missingElements.length > 0) {
    console.error('[ID Card] Missing elements:', missingElements);
    return;
  }
  
  // Setup controls
  setupCameraControls();
  setupLayoutOptions();
  setupPrintButton();
  
  console.log('[ID Card] Module initialized successfully!');
}

// Start camera when switching to ID card view
const originalSwitchView = switchView;
switchView = function(name) {
  console.log(`[Navigation] Switching to view: ${name}`);
  
  try {
    originalSwitchView(name);
  } catch (err) {
    console.error('[Navigation] Error in switchView:', err);
  }
  
  if (name === 'idcard') {
    console.log('[ID Card] Activating ID Card view');
    
// Initialize if not done yet
    if (!$('#captureFrontBtn')?.onclick) {
      setupIdCardModule();
    }
    
    // Start camera with small delay to ensure view is visible
    setTimeout(() => {
      startCamera('front').catch(err => {
        console.warn('[ID Card] Camera failed:', err.message);
        toast('لا يمكن فتح الكاميرا - استخدم رفع الصورة');
      });
    }, 300);
  } else {
    stopCamera();
  }
};

// Start Camera
async function startCamera(side) {
  const videoId = side === 'front' ? 'videoFront' : 'videoBack';
  const video = $('#' + videoId);
  
  if (!video) {
    console.error(`[ID Card] Video element #${videoId} not found!`);
    throw new Error('Video element not found: ' + videoId);
  }
  
  console.log(`[ID Card] Starting camera for ${side}...`);
  
  try {
    // Stop any existing stream
    if (idCardState.cameraStream) {
      idCardState.cameraStream.getTracks().forEach(track => track.stop());
    }
    
    // Request camera access (prefer back camera)
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    });
    
    idCardState.cameraStream = stream;
    video.srcObject = stream;
    
    // Show video, hide canvas and overlay
    video.style.display = 'block';
    const canvasId = side === 'front' ? 'canvasFront' : 'canvasBack';
    $('#' + canvasId).style.display = 'none';
    const overlayId = side === 'front' ? 'overlayFront' : 'overlayBack';
    $('#' + overlayId).style.display = 'flex';
    
    console.log(`[ID Card] Camera started for ${side} side`);
    
  } catch (err) {
    console.error('[ID Card] Camera error:', err);
    toast('لا يمكن الوصول للكاميرا - استخدم خيار رفع الصورة');
    
    // Show fallback message
    const overlayId = side === 'front' ? 'overlayFront' : 'overlayBack';
    const overlay = $('#' + overlayId);
    overlay.innerHTML = '<div style="text-align:center;padding:20px;color:#f2f0ea;"><p>لا يمكن الوصول للكاميرا</p><p style="font-size:12px;color:#9aa0ab;margin-top:8px;">استخدم زر "رفع صورة" بدلاً من ذلك</p></div>';
  }
}

// Stop Camera
function stopCamera() {
  if (idCardState.cameraStream) {
    idCardState.cameraStream.getTracks().forEach(track => track.stop());
    idCardState.cameraStream = null;
  }
}

// Capture Image from Camera
function captureImage(side) {
  const videoId = side === 'front' ? 'videoFront' : 'videoBack';
  const canvasId = side === 'front' ? 'canvasFront' : 'canvasBack';
  const previewId = side === 'front' ? 'previewFront' : 'previewBack';
  const imgId = side === 'front' ? 'imgFront' : 'imgBack';
  const overlayId = side === 'front' ? 'overlayFront' : 'overlayBack';
  const controlsId = side === 'front' ? 'controlsFront' : 'controlsBack';
  
  const video = $('#' + videoId);
  const canvas = $('#' + canvasId);
  const preview = $('#' + previewId);
  const img = $('#' + imgId);
  const overlay = $('#' + overlayId);
  
  // Set canvas size to match video
  canvas.width = video.videoWidth || 854;
  canvas.height = video.videoHeight || 540;
  
  // Draw current video frame to canvas
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  
  // Get image data
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  
  // Store in state
  if (side === 'front') {
    idCardState.frontImage = dataUrl;
  } else {
    idCardState.backImage = dataUrl;
  }
  
  // Show captured image
  img.src = dataUrl;
  preview.classList.add('show');
  overlay.style.display = 'none';
  
  // Hide video, show canvas
  video.style.display = 'none';
  canvas.style.display = 'block';
  
  // Hide controls after capture
  $('#' + controlsId).style.display = 'none';
  
  // Mark step as completed
  const stepId = side === 'front' ? 'stepFront' : 'stepBack';
  $('#' + stepId).classList.add('completed');
  $('#' + stepId).classList.remove('active');
  
  // Upload to R2
  uploadToR2(dataUrl, side);
  
  // Move to next step or show options
  if (side === 'front') {
    $('#stepBack').classList.add('active');
    startCamera('back');
  } else {
    // Both sides captured, show layout options
    showLayoutOptions();
  }
  
  toast(`تم تصوير ${side === 'front' ? 'الوجه' : 'الضهر'} بنجاح`);
  
  // Play capture sound effect (visual feedback)
  flashCaptureEffect(side);
}

// Flash effect on capture
function flashCaptureEffect(side) {
  const containerId = side === 'front' ? 'cameraFront' : 'cameraBack';
  const container = $('#' + containerId);
  
  const flash = document.createElement('div');
  flash.style.cssText = `
    position: absolute; inset: 0; background: white; opacity: 0.8;
    pointer-events: none; animation: flashOut 0.3s ease-out forwards;
  `;
  container.appendChild(flash);
  
  setTimeout(() => flash.remove(), 300);
}

// Add flash animation to CSS dynamically
const flashStyle = document.createElement('style');
flashStyle.textContent = '@keyframes flashOut{from{opacity:0.8}to{opacity:0}}';
document.head.appendChild(flashStyle);

// Handle File Selection (Upload from Gallery)
function handleFileSelect(event, side) {
  const file = event.target.files[0];
  if (!file) return;
  
  if (!file.type.startsWith('image/')) {
    toast('يرجى اختيار ملف صورة صالح');
    return;
  }
  
  const reader = new FileReader();
  reader.onload = async (e) => {
    const dataUrl = e.target.result;
    
    // Store in state
    if (side === 'front') {
      idCardState.frontImage = dataUrl;
    } else {
      idCardState.backImage = dataUrl;
    }
    
    // Show preview
    const previewId = side === 'front' ? 'previewFront' : 'previewBack';
    const imgId = side === 'front' ? 'imgFront' : 'imgBack';
    const controlsId = side === 'front' ? 'controlsFront' : 'controlsBack';
    const overlayId = side === 'front' ? 'overlayFront' : 'overlayBack';
    const videoId = side === 'front' ? 'videoFront' : 'videoBack';
    const canvasId = side === 'front' ? 'canvasFront' : 'canvasBack';
    
    $('#' + imgId).src = dataUrl;
    $('#' + previewId).classList.add('show');
    $('#' + controlsId).style.display = 'none';
    $('#' + overlayId).style.display = 'none';
    $('#' + videoId).style.display = 'none';
    $('#' + canvasId).style.display = 'block';
    
    // Draw image to canvas
    const canvas = $('#' + canvasId);
    const img = new window.Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
    };
    img.src = dataUrl;
    
    // Mark step as completed
    const stepId = side === 'front' ? 'stepFront' : 'stepBack';
    $('#' + stepId).classList.add('completed');
    $('#' + stepId).classList.remove('active');
    
    // Upload to R2
    await uploadToR2(dataUrl, side);
    
    // Move to next step or show options
    if (side === 'front') {
      $('#stepBack').classList.add('active');
      startCamera('back');
    } else {
      showLayoutOptions();
    }
    
    toast(`تم رفع صورة ${side === 'front' ? 'الوجه' : 'الضهر'} بنجاح`);
  };
  reader.readAsDataURL(file);
  
  // Reset input
  event.target.value = '';
}

// Retake Image
function retakeImage(side) {
  const previewId = side === 'front' ? 'previewFront' : 'previewBack';
  const controlsId = side === 'front' ? 'controlsFront' : 'controlsBack';
  const overlayId = side === 'front' ? 'overlayFront' : 'overlayBack';
  const videoId = side === 'front' ? 'videoFront' : 'videoBack';
  const canvasId = side === 'front' ? 'canvasFront' : 'canvasBack';
  const stepId = side === 'front' ? 'stepFront' : 'stepBack';
  const statusId = side === 'front' ? 'uploadStatusFront' : 'uploadStatusBack';
  
  // Hide preview
  $('#' + previewId).classList.remove('show');
  $('#' + statusId).classList.remove('show');
  
  // Show controls
  $('#' + controlsId).style.display = 'flex';
  $('#' + overlayId).style.display = 'flex';
  $('#' + videoId).style.display = 'block';
  $('#' + canvasId).style.display = 'none';
  
  // Remove completed state
  $('#' + stepId).classList.remove('completed');
  $('#' + stepId).classList.add('active');
  
  // Clear state
  if (side === 'front') {
    idCardState.frontImage = null;
    idCardState.frontUploaded = false;
    idCardState.frontUrl = null;
  } else {
    idCardState.backImage = null;
    idCardState.backUploaded = false;
    idCardState.backUrl = null;
  }
  
  // Hide layout options and disable print
  $('#layoutOptions').style.display = 'none';
  $('#printIdCardBtn').disabled = true;
  $('#idcardPrintPreview').classList.remove('show');
  
  // Restart camera
  startCamera(side);
}

// Upload to R2 Storage
async function uploadToR2(dataUrl, side) {
  const statusId = side === 'front' ? 'uploadStatusFront' : 'uploadStatusBack';
  const statusEl = $('#' + statusId);
  
  if (!statusEl) {
    console.warn(`[ID Card] Status element #${statusId} not found, skipping upload display`);
  }
  
  console.log(`[ID Card] Uploading ${side} image to R2...`);
  
  try {
    if (statusEl) {
      statusEl.classList.add('show');
      statusEl.classList.remove('error');
      const span = statusEl.querySelector('span');
      if (span) span.textContent = '⏳ جاري الرفع على السيرفر...';
    }
    
    // Convert data URL to Blob
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    
    // Create form data
    const formData = new FormData();
    const fileName = `idcard_${side}_${Date.now()}.jpg`;
    formData.append('file', blob, fileName);
    formData.append('side', side);
    
    // Upload to worker
    const uploadResponse = await fetch(R2_CONFIG.workerUrl + '/upload', {
      method: 'POST',
      body: formData
    });
    
    if (!uploadResponse.ok) {
      throw new Error(`HTTP ${uploadResponse.status}: ${uploadResponse.statusText}`);
    }
    
    const result = await uploadResponse.json();
    
    if (result.success) {
      // Store URL
      if (side === 'front') {
        idCardState.frontUrl = result.url;
        idCardState.frontUploaded = true;
      } else {
        idCardState.backUrl = result.url;
        idCardState.backUploaded = true;
      }
      
      if (statusEl) {
        const span = statusEl.querySelector('span');
        if (span) span.textContent = '✅ تم الرفع على السيرفر';
      }
      console.log(`[ID Card] ${side} uploaded:`, result.url);
      
    } else {
      throw new Error(result.error || 'Upload failed');
    }
    
  } catch (err) {
    console.error('[ID Card] Upload error:', err);
    if (statusEl) {
      statusEl.classList.add('error');
      const span = statusEl.querySelector('span');
      if (span) span.textContent = '❌ فشل الرفع: ' + err.message;
    }
    
    // Don't block the user - they can still print locally
    toast('فشل رفع السيرفر لكن يمكنك الطباعة محلياً');
  }
}

// Show Layout Options
function showLayoutOptions() {
  if (idCardState.frontImage && idCardState.backImage) {
    $('#layoutOptions').style.display = 'block';
    $('#printIdCardBtn').disabled = false;
    
    // Generate initial preview
    generatePrintPreview();
  }
}

// Setup Layout Options
function setupLayoutOptions() {
  $$('.layout-option').forEach(option => {
    option.addEventListener('click', () => {
      $$('.layout-option').forEach(o => o.classList.remove('selected'));
      option.classList.add('selected');
      idCardState.layoutMode = option.dataset.layout;
      
      // Update preview
      generatePrintPreview();
    });
  });
}

// Generate Print Preview
function generatePrintPreview() {
  if (!idCardState.frontImage || !idCardState.backImage) return;
  
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  // A4 dimensions at 150 DPI for good quality
  const dpi = 150;
  const a4Width = 8.27 * dpi;  // ~1240px
  const a4Height = 11.69 * dpi; // ~1754px
  
  if (idCardState.layoutMode === 'stacked') {
    // Stacked mode: Front on top, Back below with ~1cm gap
    canvas.width = a4Width;
    canvas.height = a4Height;
    
    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Load images and draw
    const imgFront = new window.Image();
    const imgBack = new window.Image();
    
    imgFront.onload = () => {
      imgBack.onload = () => {
        // Calculate sizes to fit half page with margins
        const margin = 40; // pixels margin
        const gap = 60; // ~1cm gap at 150 DPI
        const availableHeight = (canvas.height - margin * 2 - gap) / 2;
        const availableWidth = canvas.width - margin * 2;
        
        // Calculate aspect ratio to fit
        const frontRatio = imgFront.width / imgFront.height;
        const backRatio = imgBack.width / imgBack.height;
        
        let frontW, frontH, backW, backH;
        
        // Front image (top)
        if (availableWidth / availableHeight < frontRatio) {
          frontW = availableWidth;
          frontH = availableWidth / frontRatio;
        } else {
          frontH = availableHeight;
          frontW = availableHeight * frontRatio;
        }
        
        // Center front image horizontally
        const frontX = (canvas.width - frontW) / 2;
        const frontY = margin;
        
        // Back image (bottom)
        if (availableWidth / availableHeight < backRatio) {
          backW = availableWidth;
          backH = availableWidth / backRatio;
        } else {
          backH = availableHeight;
          backW = availableHeight * backRatio;
        }
        
        const backX = (canvas.width - backW) / 2;
        const backY = frontY + frontH + gap;
        
        // Draw images
        ctx.drawImage(imgFront, frontX, frontY, frontW, frontH);
        ctx.drawImage(imgBack, backX, backY, backW, backH);
        
        // Add subtle border
        ctx.strokeStyle = '#e0e0e0';
        ctx.lineWidth = 1;
        ctx.strokeRect(frontX - 2, frontY - 2, frontW + 4, frontH + 4);
        ctx.strokeRect(backX - 2, backY - 2, backW + 4, backH + 4);
        
        // Labels
        ctx.fillStyle = '#666666';
        ctx.font = '12px Tajawal, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('وجه البطاقة (الأمام)', canvas.width / 2, frontY - 10);
        ctx.fillText('ضهر البطاقة (الخلف)', canvas.width / 2, backY - 10);
        
        // Show preview
        const previewImg = $('#idcardPreviewImg');
        previewImg.src = canvas.toDataURL('image/png');
        $('#idcardPrintPreview').classList.add('show');
      };
      imgBack.src = idCardState.backImage;
    };
    imgFront.src = idCardState.frontImage;
    
  } else {
    // Duplex mode: Single image (printer handles duplex)
    canvas.width = a4Width;
    canvas.height = a4Height;
    
    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // For duplex, we only show the front image (back will be printed on reverse)
    const imgFront = new window.Image();
    
    imgFront.onload = () => {
      // Calculate size to fit page with margins
      const margin = 60;
      const availableWidth = canvas.width - margin * 2;
      const availableHeight = canvas.height - margin * 2;
      
      const ratio = imgFront.width / imgFront.height;
      let drawW, drawH;
      
      if (availableWidth / availableHeight < ratio) {
        drawW = availableWidth;
        drawH = availableWidth / ratio;
      } else {
        drawH = availableHeight;
        drawW = availableHeight * ratio;
      }
      
      const x = (canvas.width - drawW) / 2;
      const y = (canvas.height - drawH) / 2;
      
      // Draw front image centered
      ctx.drawImage(imgFront, x, y, drawW, drawH);
      
      // Border
      ctx.strokeStyle = '#e0e0e0';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 2, y - 2, drawW + 4, drawH + 4);
      
      // Label
      ctx.fillStyle = '#666666';
      ctx.font = '12px Tajawal, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('وجه البطاقة - سيتم طباعة الضهر في الخلف (Duplex)', canvas.width / 2, y - 10);
      
      // Show preview
      const previewImg = $('#idcardPreviewImg');
      previewImg.src = canvas.toDataURL('image/png');
      $('#idcardPrintPreview').classList.add('show');
    };
    imgFront.src = idCardState.frontImage;
  }
}

// Setup Print Button
function setupPrintButton() {
  $('#printIdCardBtn').addEventListener('click', printIdCard);
}

// Print ID Card
async function printIdCard() {
  console.log('[ID Card] Print button clicked');
  
  if (!idCardState.frontImage || !idCardState.backImage) {
    console.warn('[ID Card] Missing images:', { front: !!idCardState.frontImage, back: !!idCardState.backImage });
    toast('⚠️ يرجى تصوير وجه وظهر البطاقة أولاً');
    return;
  }
  
  const btn = $('#printIdCardBtn');
  if (!btn) {
    console.error('[ID Card] Print button not found!');
    return;
  }
  
  btn.disabled = true;
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><path d="M12 4v16m8-8H4"/></svg> جارٍ التجهيز...';
  
  try {
    // Create print content based on layout mode
    const root = $('#printRoot');
    root.innerHTML = '';
    
    if (idCardState.layoutMode === 'stacked') {
      // Stacked: Create a single page with both images
      const sheet = document.createElement('div');
      sheet.className = 'p-sheet';
      sheet.style.gridTemplateColumns = '1fr';
      sheet.style.gridTemplateRows = '1fr auto 1fr';
      
      // Front image
      const frontImg = document.createElement('img');
      frontImg.src = idCardState.frontImage;
      frontImg.style.maxWidth = '100%';
      frontImg.style.height = 'auto';
      
      // Gap element
      const gap = document.createElement('div');
      gap.style.height = '1cm';
      gap.style.background = '#fff';
      
      // Back image
      const backImg = document.createElement('img');
      backImg.src = idCardState.backImage;
      backImg.style.maxWidth = '100%';
      backImg.style.height = 'auto';
      
      sheet.appendChild(frontImg);
      sheet.appendChild(gap);
      sheet.appendChild(backImg);
      root.appendChild(sheet);
      
    } else {
      // Duplex: Two separate pages (or one with note about duplex)
      // Page 1: Front
      const frontSheet = document.createElement('div');
      frontSheet.className = 'p-sheet';
      const frontImg = document.createElement('img');
      frontImg.src = idCardState.frontImage;
      frontImg.style.maxWidth = '100%';
      frontImg.style.maxHeight = '100%';
      frontImg.style.objectFit = 'contain';
      frontSheet.appendChild(frontImg);
      root.appendChild(frontSheet);
      
      // Page 2: Back (for manual duplex printing)
      const backSheet = document.createElement('div');
      backSheet.className = 'p-sheet';
      const backImg = document.createElement('img');
      backImg.src = idCardState.backImage;
      backImg.style.maxWidth = '100%';
      backImg.style.maxHeight = '100%';
      backImg.style.objectFit = 'contain';
      backSheet.appendChild(backImg);
      root.appendChild(backSheet);
    }
    
    // Apply print CSS
    applyPrintCss();
    
    // Small delay then print
    setTimeout(() => {
      window.print();
      
      // Reset button
      $('#printIdCardBtn').disabled = false;
      $('#printIdCardBtn').innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><path d="M6 9V4h12v5M6 18h12v-6H6v6zM6 14H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-2"/></svg> طباعة البطاقة الآن';
      
      toast('🖨️ تم إرسال البطاقة للطباعة');
    }, 300);
    
  } catch (err) {
    console.error('[ID Card] Print error:', err);
    toast('حدث خطأ أثناء الطباعة: ' + err.message);
    
    $('#printIdCardBtn').disabled = false;
    $('#printIdCardBtn').innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><path d="M6 9V4h12v5M6 18h12v-6H6v6zM6 14H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-2"/></svg> طباعة البطاقة الآن';
  }
}

/* ========================================================================
   OCR Document Scanner Module
   Uses OpenRouter API with Qwen2.5-VL-7B for text extraction
   ======================================================================== */

// Initialize OCR Module (called once on init and view switch)
function setupOcrModule() {
  console.log('[OCR] Setting up module...');
  
  const elements = {
    video: $('#ocrVideo'),
    canvas: $('#ocrCanvas'),
    captureBtn: $('#ocrCaptureBtn'),
    uploadBtn: $('#ocrUploadBtn'),
    fileInput: $('#ocrFileInput'),
    previewArea: $('#ocrPreviewArea'),
    previewImg: $('#ocrPreviewImg'),
    retakeBtn: $('#ocrRetakeBtn'),
    processing: $('#ocrProcessing'),
    results: $('#ocrResults'),
    textOutput: $('#ocrTextOutput'),
    langBadge: $('#ocrLangBadge'),
    jsonSection: $('#ocrJsonSection'),
    jsonToggle: $('#ocrJsonToggle'),
    jsonContent: $('#ocrJsonContent'),
    copyBtn: $('#ocrCopyBtn'),
    pdfBtn: $('#ocrPdfBtn'),
    printPdfBtn: $('#ocrPrintPdfBtn'),
    newDocBtn: $('#ocrNewDocBtn'),
    whatsappBtn: $('#ocrWhatsAppBtn'),
    copyToast: $('#ocrCopyToast'),
    captureStep: $('#ocrCaptureStep'),
    pdfPreview: $('#ocrPdfPreview'),
    pdfIframe: $('#ocrPdfIframe'),
    closePdfPreview: $('#ocrClosePdfPreview'),
    // Orientation selection elements
    orientationStep: $('#ocrOrientationStep'),
    portraitBtn: $('#ocrPortraitBtn'),
    landscapeBtn: $('#ocrLandscapeBtn'),
    cameraWrapper: $('#ocrCameraWrapper'),
    documentFrame: $('.ocr-document-frame'),
    // Multi-page elements
    pageCounter: $('#ocrPageCounter'),
    currentPageNum: $('#ocrCurrentPageNum'),
    totalPages: $('#ocrTotalPages'),
    pagesThumbnails: $('#ocrPagesThumbnails'),
    primaryActions: $('#ocrPrimaryActions'),
    multiPageActions: $('#ocrMultiPageActions'),
    addPageBtn: $('#ocrAddPageBtn'),
    finishCaptureBtn: $('#ocrFinishCaptureBtn'),
    previewPageBadge: $('#ocrPreviewPageBadge'),
  };
  
  // Check for missing elements (allow optional ones)
  const requiredElements = ['video', 'canvas', 'captureStep'];
  const missingElements = requiredElements.filter(key => !elements[key]);
  
  if (missingElements.length > 0) {
    console.error('[OCR] Missing required elements:', missingElements);
    return;
  }
  
  // Setup orientation selection if available
  if (elements.orientationStep) {
    setupOcrOrientationSelection(elements);
    
    // Show orientation step, hide capture step initially
    elements.orientationStep.classList.add('active');
    elements.captureStep.classList.remove('active');
  } else {
    // No orientation step - show capture directly
    elements.captureStep.classList.add('active');
  }
  
  // Initialize multi-page UI
  updateMultiPageUI(elements);
}

// Setup OCR Document Orientation Selection
function setupOcrOrientationSelection(elements) {
  // Portrait button click
  if (elements.portraitBtn) {
    elements.portraitBtn.addEventListener('click', () => {
      selectDocumentOrientation('portrait', elements);
    });
  }
  
  // Landscape button click
  if (elements.landscapeBtn) {
    elements.landscapeBtn.addEventListener('click', () => {
      selectDocumentOrientation('landscape', elements);
    });
  }
  
  // Set default selection
  if (elements.portraitBtn && ocrState.documentOrientation === 'portrait') {
    elements.portraitBtn.classList.add('selected');
  } else if (elements.landscapeBtn && ocrState.documentOrientation === 'landscape') {
    elements.landscapeBtn.classList.add('selected');
  }
}

// Select document orientation and proceed to capture
function selectDocumentOrientation(orientation, elements) {
  console.log('[OCR] Selected orientation:', orientation);
  
  // Update state
  ocrState.documentOrientation = orientation;
  
  // Update UI - selected state
  if (elements.portraitBtn) {
    elements.portraitBtn.classList.toggle('selected', orientation === 'portrait');
  }
  if (elements.landscapeBtn) {
    elements.landscapeBtn.classList.toggle('selected', orientation === 'landscape');
  }
  
  // Update camera wrapper aspect ratio
  if (elements.cameraWrapper) {
    elements.cameraWrapper.classList.remove('portrait-mode', 'landscape-mode');
    elements.cameraWrapper.classList.add(orientation + '-mode');
  }
  
  // Update document frame
  if (elements.documentFrame) {
    elements.documentFrame.classList.remove('portrait-frame', 'landscape-frame');
    elements.documentFrame.classList.add(orientation + '-frame');
  }
  
  // Setup event listeners for OCR buttons
  setupOcrEventListeners();
  
  // Small delay then switch to capture step
  setTimeout(() => {
    if (elements.orientationStep) {
      elements.orientationStep.classList.remove('active');
      elements.orientationStep.classList.add('completed');
    }
    if (elements.captureStep) {
      elements.captureStep.classList.add('active');
    }
    
    // Start camera after switching to capture step
    setTimeout(() => {
      startOcrCamera();
    }, 200);
    
    toast(`تم اختيار المستند ${orientation === 'portrait' ? 'العمودي' : 'الأفقي'} A4`);
  }, 300);
}

// Reset OCR module to show orientation step again
function resetOcrToOrientation() {
  const orientationStep = $('#ocrOrientationStep');
  const captureStep = $('#ocrCaptureStep');
  const portraitBtn = $('#ocrPortraitBtn');
  const landscapeBtn = $('#ocrLandscapeBtn');
  
  if (orientationStep) {
    orientationStep.classList.remove('completed');
    orientationStep.classList.add('active');
  }
  if (captureStep) {
    captureStep.classList.remove('active');
  }
  
  // Reset selection buttons
  if (portraitBtn) portraitBtn.classList.remove('selected');
  if (landscapeBtn) landscapeBtn.classList.remove('selected');
  
  // Re-select default
  if (ocrState.documentOrientation === 'portrait' && portraitBtn) {
    portraitBtn.classList.add('selected');
  } else if (ocrState.documentOrientation === 'landscape' && landscapeBtn) {
    landscapeBtn.classList.add('selected');
  }
}

// Continue OCR Module Setup (Event Listeners)
function setupOcrEventListeners() {
  const elements = {
    captureBtn: $('#ocrCaptureBtn'),
    uploadBtn: $('#ocrUploadBtn'),
    fileInput: $('#ocrFileInput'),
    retakeBtn: $('#ocrRetakeBtn'),
    copyBtn: $('#ocrCopyBtn'),
    pdfBtn: $('#ocrPdfBtn'),
    printPdfBtn: $('#ocrPrintPdfBtn'),
    newDocBtn: $('#ocrNewDocBtn'),
    whatsappBtn: $('#ocrWhatsAppBtn'),
    jsonToggle: $('#ocrJsonToggle'),
    closePdfPreview: $('#ocrClosePdfPreview'),
    jsonSection: $('#ocrJsonSection'),
    pdfPreview: $('#ocrPdfPreview'),
    addPageBtn: $('#ocrAddPageBtn'),
    finishCaptureBtn: $('#ocrFinishCaptureBtn'),
    // Mode selection buttons
    modeServer: $('#ocrModeServer'),
    modeLocal: $('#ocrModeLocal'),
  };
  
  // Remove old listeners to prevent duplicates
  Object.values(elements).forEach(el => {
    if (el) el.replaceWith(el.cloneNode(true));
  });
  
  // Re-get after clone
  const btns = {
    capture: $('#ocrCaptureBtn'),
    upload: $('#ocrUploadBtn'),
    retake: $('#ocrRetakeBtn'),
    copy: $('#ocrCopyBtn'),
    pdf: $('#ocrPdfBtn'),
    printPdf: $('#ocrPrintPdfBtn'),
    newDoc: $('#ocrNewDocBtn'),
    whatsapp: $('#ocrWhatsAppBtn'),
    jsonTgl: $('#ocrJsonToggle'),
    closePdf: $('#ocrClosePdfPreview'),
    addPage: $('#ocrAddPageBtn'),
    finishCapture: $('#ocrFinishCaptureBtn'),
    modeServer: $('#ocrModeServer'),
    modeLocal: $('#ocrModeLocal'),
  };
  
  // Capture button - now captures and adds to pages array
  if (btns.capture) btns.capture.addEventListener('click', () => { captureOcrImageForMultiPage(); });
  
  // Upload button
  if (btns.upload) btns.upload.addEventListener('click', () => { $('#ocrFileInput').click(); });
  
  // File input change
  if ($('#ocrFileInput')) {
    $('#ocrFileInput').addEventListener('change', handleOcrFileSelectForMultiPage);
  }
  
  // Retake button
  if (btns.retake) btns.retake.addEventListener('click', () => { retakeCurrentPage(); });
  
  // Copy button
  if (btns.copy) btns.copy.addEventListener('click', () => { copyOcrText(); });
  
  // PDF Download button
  if (btns.pdf) btns.pdf.addEventListener('click', () => { downloadOcrPdf(); });
  
  // Print PDF button
  if (btns.printPdf) btns.printPdf.addEventListener('click', () => { printOcrPdf(); });
  
  // New document button
  if (btns.newDoc) btns.newDoc.addEventListener('click', () => { resetOcrFull(); });
  
  // WhatsApp share button
  if (btns.whatsapp) btns.whatsapp.addEventListener('click', () => { shareViaWhatsApp(); });
  
  // Add next page button
  if (btns.addPage) btns.addPage.addEventListener('click', () => { addNextPage(); });
  
  // Finish capture & generate PDF button
  if (btns.finishCapture) btns.finishCapture.addEventListener('click', () => { finishMultiPageCapture(); });
  
  // Mode selection buttons
  if (btns.modeServer) btns.modeServer.addEventListener('click', () => { switchOcrMode('server'); });
  if (btns.modeLocal) btns.modeLocal.addEventListener('click', () => { switchOcrMode('local'); });
  
  // JSON toggle
  if (btns.jsonTgl && elements.jsonSection) {
    btns.jsonTgl.addEventListener('click', () => {
      elements.jsonSection.classList.toggle('show');
      const icon = btns.jsonTgl.querySelector('svg');
      if (icon) icon.style.transform = elements.jsonSection.classList.contains('show') ? 'rotate(180deg)' : '';
    });
  }
  
  // Close PDF Preview
  if (btns.closePdf && elements.pdfPreview) {
    btns.closePdf.addEventListener('click', () => { elements.pdfPreview.style.display = 'none'; });
  }
  
  console.log('[OCR] Event listeners initialized with multi-page + mode support!');
}

// Start OCR Camera
async function startOcrCamera() {
  console.log('[OCR] Starting camera...');
  
  const video = $('#ocrVideo');
  if (!video) {
    console.error('[OCR] Video element not found!');
    return;
  }
  
  // Stop existing stream
  if (ocrState.cameraStream) {
    ocrState.cameraStream.getTracks().forEach(track => track.stop());
  }
  
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    });
    
    ocrState.cameraStream = stream;
    video.srcObject = stream;
    
    console.log('[OCR] Camera started successfully');
  } catch (err) {
    console.error('[OCR] Camera error:', err.message);
    toast('خطأ في الوصول للكاميرا: ' + err.message);
  }
}

// Stop OCR Camera
function stopOcrCamera() {
  if (ocrState.cameraStream) {
    ocrState.cameraStream.getTracks().forEach(track => track.stop());
    ocrState.cameraStream = null;
  }
  const video = $('#ocrVideo');
  if (video) {
    video.srcObject = null;
  }
}

/* ===== Multi-Page OCR Functions ===== */

// Update multi-page UI elements (counter, thumbnails)
function updateMultiPageUI(elements) {
  const currentPageNum = $('#ocrCurrentPageNum');
  const totalPagesEl = $('#ocrTotalPages');
  
  if (currentPageNum) {
    currentPageNum.textContent = ocrState.capturedPages.length + 1;
  }
  if (totalPagesEl) {
    totalPagesEl.textContent = ocrState.capturedPages.length;
  }
  
  console.log('[OCR] Multi-page UI updated:', ocrState.capturedPages.length, 'pages captured');
}

// Update thumbnails display
function updateThumbnailsDisplay() {
  const thumbnailsContainer = $('#ocrPagesThumbnails');
  if (!thumbnailsContainer) return;
  
  // Clear existing content
  thumbnailsContainer.innerHTML = '';
  
  if (ocrState.capturedPages.length === 0) {
    thumbnailsContainer.innerHTML = '<p class="thumbnails-hint">سيتم عرض الصفحات المصورة هنا...</p>';
    return;
  }
  
  // Add thumbnail for each captured page
  ocrState.capturedPages.forEach((page, index) => {
    const thumb = document.createElement('div');
    thumb.className = 'page-thumbnail';
    thumb.innerHTML = `
      <img src="${page.image}" alt="صفحة ${index + 1}">
      <span class="thumb-number">${index + 1}</span>
    `;
    thumb.addEventListener('click', () => {
      showPagePreview(index);
    });
    thumbnailsContainer.appendChild(thumb);
  });
  
  console.log('[OCR] Thumbnails updated:', ocrState.capturedPages.length, 'thumbnails');
}

// Show specific page preview from thumbnails
function showPagePreview(pageIndex) {
  if (pageIndex < 0 || pageIndex >= ocrState.capturedPages.length) return;
  
  const page = ocrState.capturedPages[pageIndex];
  const previewImg = $('#ocrPreviewImg');
  const previewArea = $('#ocrPreviewArea');
  const previewBadge = $('#ocrPreviewPageBadge');
  
  if (previewImg) previewImg.src = page.image;
  if (previewBadge) previewBadge.textContent = `صفحة ${pageIndex + 1}`;
  if (previewArea) previewArea.classList.add('show');
}

// Capture OCR Image for multi-page mode
function captureOcrImageForMultiPage() {
  console.log('[OCR-Multi] Capturing image for page...', ocrState.capturedPages.length + 1);
  
  const video = $('#ocrVideo');
  const canvas = $('#ocrCanvas');
  
  if (!video || !canvas) {
    console.error('[OCR] Video or Canvas element not found!');
    return;
  }
  
  // Set canvas dimensions to match video
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  
  // Draw current video frame to canvas
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  
  // Get as data URL
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  
  // Add to pages array
  const pageInfo = {
    image: dataUrl,
    text: '',
    pageNumber: ocrState.capturedPages.length + 1,
    processed: false
  };
  ocrState.capturedPages.push(pageInfo);
  ocrState.currentPageNumber = ocrState.capturedPages.length;
  
  // Also set as current captured image for compatibility
  ocrState.capturedImage = dataUrl;
  
  console.log('[OCR-Multi] Page', ocrState.currentPageNumber, 'captured, total pages:', ocrState.capturedPages.length);
  
  // Update UI
  showOcrPreviewForMultiPage(dataUrl, ocrState.currentPageNumber);
  updateThumbnailsDisplay();
  updateMultiPageUI();
  
  toast(`✅ تم التقاط الصفحة ${ocrState.currentPageNumber}`);
}

// Handle file select for multi-page OCR
function handleOcrFileSelectForMultiPage(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  
  console.log('[OCR-Multi] Processing uploaded file:', file.name);
  
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    
    // Add to pages array
    const pageInfo = {
      image: dataUrl,
      text: '',
      pageNumber: ocrState.capturedPages.length + 1,
      processed: false
    };
    ocrState.capturedPages.push(pageInfo);
    ocrState.currentPageNumber = ocrState.capturedPages.length;
    
    // Also set as current captured image
    ocrState.capturedImage = dataUrl;
    
    console.log('[OCR-Multi] File added as page', ocrState.currentPageNumber);
    
    // Update UI
    showOcrPreviewForMultiPage(dataUrl, ocrState.currentPageNumber);
    updateThumbnailsDisplay();
    updateMultiPageUI();
    
    toast(`✓ تم إضافة الصفحة ${ocrState.currentPageNumber} من الملف`);
  };
  reader.readAsDataURL(file);
  
  // Reset input
  event.target.value = '';
}

// Show captured image preview with page badge (multi-page)
function showOcrPreviewForMultiPage(dataUrl, pageNumber) {
  const previewArea = $('#ocrPreviewArea');
  const previewImg = $('#ocrPreviewImg');
  const cameraWrapper = $('#ocrCameraWrapper');
  const primaryActions = $('#ocrPrimaryActions');
  const multiPageActions = $('#ocrMultiPageActions');
  const previewBadge = $('#ocrPreviewPageBadge');
  
  if (previewImg) {
    previewImg.src = dataUrl;
  }
  if (previewBadge) {
    previewBadge.textContent = `صفحة ${pageNumber || ocrState.currentPageNumber}`;
  }
  if (previewArea) {
    previewArea.classList.add('show');
  }
  
  // Hide camera and primary actions, show multi-page actions
  if (cameraWrapper) cameraWrapper.style.display = 'none';
  if (primaryActions) primaryActions.style.display = 'none';
  if (multiPageActions) multiPageActions.style.display = '';
  
  // Stop camera to save resources
  stopOcrCamera();
}

// Add next page - reset UI for new capture
function addNextPage() {
  console.log('[OCR-Multi] Preparing for next page...');
  
  const previewArea = $('#ocrPreviewArea');
  const cameraWrapper = $('#ocrCameraWrapper');
  const primaryActions = $('#ocrPrimaryActions');
  const multiPageActions = $('#ocrMultiPageActions');
  
  // Hide preview and multi-page actions
  if (previewArea) previewArea.classList.remove('show');
  if (multiPageActions) multiPageActions.style.display = 'none';
  
  // Show camera and primary actions again
  if (cameraWrapper) cameraWrapper.style.display = '';
  if (primaryActions) primaryActions.style.display = '';
  
  // Restart camera
  setTimeout(() => startOcrCamera(), 300);
  
  toast(`📄 جاهز لتصوير الصفحة ${ocrState.capturedPages.length + 1}`);
}

// Retake current (last) page
function retakeCurrentPage() {
  console.log('[OCR-Multi] Retaking current page...');
  
  // Remove last page from array
  if (ocrState.capturedPages.length > 0) {
    ocrState.capturedPages.pop();
    ocrState.currentPageNumber = ocrState.capturedPages.length;
    
    toast('🔄 تم حذف آخر صفحة - يمكنك إعادة التصوير');
  }
  
  // Reset to capture mode
  const previewArea = $('#ocrPreviewArea');
  const cameraWrapper = $('#ocrCameraWrapper');
  const primaryActions = $('#ocrPrimaryActions');
  const multiPageActions = $('#ocrMultiPageActions');
  
  if (previewArea) previewArea.classList.remove('show');
  if (multiPageActions) multiPageActions.style.display = 'none';
  if (cameraWrapper) cameraWrapper.style.display = '';
  if (primaryActions) primaryActions.style.display = '';
  
  // Update thumbnails
  updateThumbnailsDisplay();
  updateMultiPageUI();
  
  // Restart camera
  setTimeout(() => startOcrCamera(), 300);
}

// Finish multi-page capture and process all pages
async function finishMultiPageCapture() {
  console.log('[OCR-Multi] Finishing capture, processing', ocrState.capturedPages.length, 'pages...');
  
  if (ocrState.capturedPages.length === 0) {
    toast('⚠️ لم يتم التقاط أي صفحات بعد!');
    return;
  }
  
  // Show processing indicator
  const processing = $('#ocrProcessing');
  const captureStep = $('#ocrCaptureStep');
  const multiPageActions = $('#ocrMultiPageActions');
  
  if (processing) processing.classList.add('show');
  if (captureStep) captureStep.classList.remove('active');
  if (multiPageActions) multiPageActions.style.display = 'none';
  
  ocrState.isProcessing = true;
  
  try {
    // Process each page with OCR
    let allExtractedTexts = [];
    
    for (let i = 0; i < ocrState.capturedPages.length; i++) {
      const page = ocrState.capturedPages[i];
      
      // Update processing message
      if (processing) {
        const msg = processing.querySelector('p');
        if (msg) msg.textContent = `جارٍ معالجة الصفحة ${i + 1} من ${ocrState.capturedPages.length}...`;
      }
      
      // Mark thumbnail as processing
      markThumbnailProcessing(i, true);
      
      try {
        // Send to OCR worker
        const text = await processSinglePage(page.image);
        page.text = text;
        page.processed = true;
        allExtractedTexts.push(`--- صفحة ${i + 1} ---\n${text}`);
        
        console.log('[OCR-Multi] Page', i + 1, 'processed successfully');
      } catch (pageErr) {
        console.error('[OCR-Multi] Error processing page', i + 1, ':', pageErr);
        page.text = `[خطأ في معالجة هذه الصفحة: ${pageErr.message}]`;
        page.processed = false;
        allExtractedTexts.push(`--- صفحة ${i + 1} ---\n[خطأ في المعالجة]`);
      }
      
      // Unmark thumbnail
      markThumbnailProcessing(i, false);
    }
    
    // Combine all texts
    ocrState.allPagesText = allExtractedTexts;
    ocrState.extractedText = allExtractedTexts.join('\n\n');
    
    console.log('[OCR-Multi] All pages processed, displaying results...');
    
    // Display combined results
    const result = {
      success: true,
      text: ocrState.extractedText,
      json: { 
        totalPages: ocrState.capturedPages.length,
        orientation: ocrState.documentOrientation,
        pages: ocrState.capturedPages.map(p => ({ processed: p.processed }))
      }
    };
    
    displayOcrResults(result);
    
  } catch (err) {
    console.error('[OCR-Multi] Processing error:', err);
    toast('خطأ في معالجة المستند: ' + err.message);
    
    if (processing) processing.classList.remove('show');
    if (captureStep) captureStep.classList.add('active');
  } finally {
    ocrState.isProcessing = false;
  }
}

// Process a single page image through OCR (supports server/local)
async function processSinglePage(imageDataUrl) {
  console.log('[OCR-Multi] Processing page... Mode:', ocrState.processingMode);
  
  if (ocrState.processingMode === 'local') {
    // Local mode
    return await processOcrLocal(imageDataUrl);
  } else {
    // Server mode
    try {
      return await processOcrServer(imageDataUrl);
    } catch (serverErr) {
      console.warn('[OCR-Multi] Server failed for page, trying local:', serverErr);
      // Auto-fallback to local for multi-page
      ocrState.processingMode = 'local';
      toast('⚠️ السيرفر فشل - التحويل للوضع المحلي');
      return await processOcrLocal(imageDataUrl);
    }
  }
}

// Mark/unmark thumbnail as processing
function markThumbnailProcessing(pageIndex, isProcessing) {
  const thumbnailsContainer = $('#ocrPagesThumbnails');
  if (!thumbnailsContainer) return;
  
  const thumbs = thumbnailsContainer.querySelectorAll('.page-thumbnail');
  if (thumbs[pageIndex]) {
    thumbs[pageIndex].classList.toggle('processing', isProcessing);
  }
}

// Share via WhatsApp
async function shareViaWhatsApp() {
  console.log('[OCR] Sharing via WhatsApp...');
  
  if (!ocrState.extractedText) {
    toast('⚠️ لا يوجد نص لمشاركته!');
    return;
  }
  
  try {
    // Generate PDF first if not already generated
    const pdfBlob = await generateMultiPagePdfBlob();
    
    // Convert blob to base64 for WhatsApp
    const reader = new FileReader();
    reader.onload = async () => {
      const base64data = reader.result;
      
      // Create WhatsApp message with document info
      const message = `📄 *مستند OCR*\n` +
        `📑 عدد الصفحات: ${ocrState.capturedPages.length}\n` +
        `📐 الاتجاه: ${ocrState.documentOrientation === 'portrait' ? 'عمودي' : 'أفقي'}\n` +
        `📅 التاريخ: ${new Date().toLocaleDateString('ar-EG')}\n\n` +
        `_تم إنشاؤه بواسطة مدير الطباعة_`;
      
      // For mobile: use WhatsApp API with file
      // Note: Direct file sharing via WhatsApp Web API is limited
      // We'll open WhatsApp with a message and offer download
      
      // Try Web Share API first (works on mobile)
      if (navigator.share && navigator.canShare) {
        const file = new File([pdfBlob], 'document-ocr.pdf', { type: 'application/pdf' });
        const shareData = {
          title: 'مستند OCR',
          text: message,
          files: [file]
        };
        
        if (navigator.canShare(shareData)) {
          try {
            await navigator.share(shareData);
            toast('✅ تم فتح خيارات المشاركة!');
            return;
          } catch (shareErr) {
            console.log('[OCR] Share cancelled or failed:', shareErr);
            // Fall back to WhatsApp web
          }
        }
      }
      
      // Fallback: Open WhatsApp with message (file needs manual upload)
      const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message + '\n\n📎 ملف PDF جاهز للتحميل من التطبيق')}`;
      window.open(whatsappUrl, '_blank');
      
      toast('📱 تم فتح واتساب - يمكنك تحميل الملف وإرساله');
    };
    
    reader.readAsDataURL(pdfBlob);
    
  } catch (err) {
    console.error('[OCR] WhatsApp share error:', err);
    toast('خطأ في المشاركة: ' + err.message);
  }
}

/* ===== End Multi-Page OCR Functions ===== */

// Capture OCR Image (legacy single-page - kept for compatibility)
function captureOcrImage() {
  console.log('[OCR] Capturing image...');
  
  const video = $('#ocrVideo');
  const canvas = $('#ocrCanvas');
  
  if (!video || !canvas) {
    console.error('[OCR] Video or Canvas element not found!');
    return;
  }
  
  // Set canvas dimensions to match video
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  
  // Draw current video frame to canvas
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  
  // Get as data URL
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  ocrState.capturedImage = dataUrl;
  
  // Update UI
  showOcrPreview(dataUrl);
  
  console.log('[OCR] Image captured successfully');
}

// Handle file select for OCR
function handleOcrFileSelect(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  
  console.log('[OCR] Processing uploaded file:', file.name);
  
  const reader = new FileReader();
  reader.onload = (e) => {
    ocrState.capturedImage = e.target.result;
    showOcrPreview(e.target.result);
    console.log('[OCR] File loaded successfully');
  };
  reader.readAsDataURL(file);
  
  // Reset input
  event.target.value = '';
}

// Show captured image preview
function showOcrPreview(dataUrl) {
  const previewArea = $('#ocrPreviewArea');
  const previewImg = $('#ocrPreviewImg');
  const cameraWrapper = $('#ocrCameraWrapper');
  const actions = $('.ocr-actions');
  
  if (previewImg) {
    previewImg.src = dataUrl;
  }
  if (previewArea) {
    previewArea.classList.add('show');
  }
  
  // Hide camera, show preview
  if (cameraWrapper) {
    cameraWrapper.style.display = 'none';
  }
  if (actions) {
    actions.style.display = 'none';
  }
  
  // Stop camera to save resources
  stopOcrCamera();
  
  // Auto-start OCR processing
  setTimeout(() => processOcrImage(), 500);
}

// Reset OCR capture (for retake)
function resetOcrCapture() {
  console.log('[OCR] Resetting capture...');
  
  const previewArea = $('#ocrPreviewArea');
  const cameraWrapper = $('#ocrCameraWrapper');
  const actions = $('.ocr-actions');
  const results = $('#ocrResults');
  const processing = $('#ocrProcessing');
  
  // Hide preview and results
  if (previewArea) previewArea.classList.remove('show');
  if (results) results.classList.remove('show');
  if (processing) processing.classList.remove('show');
  
  // Show camera again
  if (cameraWrapper) cameraWrapper.style.display = '';
  if (actions) actions.style.display = '';
  
  // Clear state
  ocrState.capturedImage = null;
  ocrState.extractedText = '';
  ocrState.jsonData = null;
  
  // Restart camera
  setTimeout(() => startOcrCamera(), 300);
}

// Full reset (new document)
function resetOcrFull() {
  console.log('[OCR] Full reset...');
  
  // Reset back to orientation selection
  resetOcrToOrientation();
  
  // Clear results
  const textOutput = $('#ocrTextOutput');
  const jsonContent = $('#ocrJsonContent');
  const jsonSection = $('#ocrJsonSection');
  const results = $('#ocrResults');
  const pdfPreview = $('#ocrPdfPreview');
  const multiPageActions = $('#ocrMultiPageActions');
  const primaryActions = $('#ocrPrimaryActions');
  const previewArea = $('#ocrPreviewArea');
  const thumbnailsContainer = $('#ocrPagesThumbnails');
  
  if (textOutput) textOutput.textContent = '';
  if (jsonContent) jsonContent.textContent = '';
  if (jsonSection) jsonSection.classList.remove('show');
  if (results) results.classList.remove('active');
  if (pdfPreview) pdfPreview.style.display = 'none';
  if (multiPageActions) multiPageActions.style.display = 'none';
  if (primaryActions) primaryActions.style.display = '';
  if (previewArea) previewArea.classList.remove('show');
  
  // Reset thumbnails
  if (thumbnailsContainer) {
    thumbnailsContainer.innerHTML = '<p class="thumbnails-hint">سيتم عرض الصفحات المصورة هنا...</p>';
  }
  
  // Reset multi-page state
  ocrState.capturedPages = [];
  ocrState.currentPageNumber = 0;
  ocrState.allPagesText = [];
  
  // Reset single-page state
  ocrState.capturedImage = null;
  ocrState.extractedText = '';
  ocrState.jsonData = null;
  ocrState.isProcessing = false;
  
  // Update counter UI
  updateMultiPageUI();
  
  toast('🔄 تم إعادة تعيين المستند');
}

// Process image with OCR - supports server and local modes
async function processOcrImage() {
  if (!ocrState.capturedImage || ocrState.isProcessing) {
    console.warn('[OCR] Cannot process: no image or already processing');
    return;
  }
  
  console.log('[OCR] Starting image processing... Mode:', ocrState.processingMode);
  ocrState.isProcessing = true;
  
  // Show processing UI
  const processing = $('#ocrProcessing');
  const captureStep = $('#ocrCaptureStep');
  const results = $('#ocrResults');
  
  if (processing) processing.classList.add('show');
  if (captureStep) captureStep.classList.remove('active');
  if (results) results.classList.remove('show');
  
  try {
    let result;
    
    if (ocrState.processingMode === 'local') {
      // Local/Offline mode - use Tesseract.js or basic extraction
      result = await processOcrLocal(ocrState.capturedImage);
    } else {
      // Server/AI mode - send to Cloudflare Worker
      result = await processOcrServer(ocrState.capturedImage);
    }
    
    if (result.success) {
      displayOcrResults(result);
    } else {
      throw new Error(result.error || 'Unknown error from processor');
    }
    
  } catch (err) {
    console.error('[OCR] Processing error:', err);
    
    // If server failed, offer to try local mode
    if (ocrState.processingMode === 'server') {
      console.log('[OCR] Server failed, offering local fallback...');
      
      const tryLocal = confirm(
        '⚠️ فشل الاتصال بالسيرفر!\n\n' +
        'هل تريد المحاولة بالوضع المحلي؟\n\n' +
        '(الوضع المحلي يعمل بدون إنترنت لكن بأقل دقة)'
      );
      
      if (tryLocal) {
        ocrState.processingMode = 'local';
        
        // Retry with local mode
        ocrState.isProcessing = false;
        if (processing) processing.classList.remove('show');
        
        toast('🔄 التحويل للوضع المحلي...');
        setTimeout(() => processOcrImage(), 500);
        return;
      }
    }
    
    toast('خطأ في معالجة الصورة: ' + err.message);
    
    // Hide processing, show capture step again
    if (processing) processing.classList.remove('show');
    if (captureStep) captureStep.classList.add('active');
  } finally {
    ocrState.isProcessing = false;
  }
}

// Process OCR using Server (Cloudflare Worker -> OpenRouter)
async function processOcrServer(imageDataUrl) {
  console.log('[OCR-Server] Sending to worker...');
  
  // Convert base64 to blob for upload
  const response = await fetch(imageDataUrl);
  const blob = await response.blob();
  
  // Create form data
  const formData = new FormData();
  formData.append('file', blob, 'document.jpg');
  formData.append('type', 'ocr');
  
  console.log('[OCR-Server] Sending to worker:', ocrState.workerUrl);
  
  // Send to worker with timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout
  
  try {
    const workerResponse = await fetch(ocrState.workerUrl + '/ocr', {
      method: 'POST',
      body: formData,
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!workerResponse.ok) {
      throw new Error(`خطأ السيرفر: ${workerResponse.status} ${workerResponse.statusText}`);
    }
    
    const result = await workerResponse.json();
    console.log('[OCR-Server] Response:', result);
    
    return result;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('انتهت مهلة الاتصال بالسيرفر (30 ثانية)');
    }
    throw err;
  }
}

// Process OCR Locally (Offline mode)
async function processOcrLocal(imageDataUrl) {
  console.log('[OCR-Local] Processing locally...');
  
  // Update processing message
  const processing = $('#ocrProcessing');
  if (processing) {
    const msg = processing.querySelector('p');
    if (msg) msg.textContent = 'جارٍ المعالجة المحلية... (قد يستغرق وقتاً أطول)';
  }
  
  try {
    // Try to use Tesseract.js if available
    if (typeof Tesseract !== 'undefined') {
      return await processWithTesseract(imageDataUrl);
    }
    
    // Fallback: Basic text extraction simulation
    // In production, you'd integrate Tesseract.js properly
    return await simulateLocalExtraction(imageDataUrl);
    
  } catch (err) {
    console.error('[OCR-Local] Error:', err);
    throw new Error('فشل المعالجة المحلية: ' + err.message);
  }
}

// Process using Tesseract.js
async function processWithTesseract(imageDataUrl) {
  console.log('[OCR-Tesseract] Using Tesseract.js...');
  
  const result = await Tesseract.recognize(
    imageDataUrl,
    'ara+eng', // Arabic + English
    {
      logger: m => {
        if (m.status === 'recognizing text') {
          const progress = Math.round(m.progress * 100);
          const processing = $('#ocrProcessing');
          if (processing) {
            const msg = processing.querySelector('p');
            if (msg) msg.textContent = `جارٍ المعالجة: ${progress}%`;
          }
        }
      }
    }
  );
  
  console.log('[OCR-Tesseract] Result:', result.data.text);
  
  return {
    success: true,
    text: result.data.text,
    json: { 
      confidence: result.data.confidence,
      words: result.data.words?.length || 0,
      lines: result.data.lines?.length || 0,
      mode: 'local-tesseract'
    },
    language: result.data.script || 'AR/EN'
  };
}

// Simulate local extraction (fallback when Tesseract not available)
async function simulateLocalExtraction(imageDataUrl) {
  console.log('[OCR-Simulate] Using simulated extraction...');
  
  // Simulate processing delay
  await new Promise(resolve => setTimeout(resolve, 1500));
  
  // Return a helpful message explaining the limitation
  return {
    success: true,
    text: `[وضع المعالجة المحلية]\n\n` +
           `⚠️ ملاحظة: لاستخراج النصوص بدقة عالية، يرجى:\n\n` +
           `1. تثبيت Tesseract.js لمعالجة محلية حقيقية\n` +
           `أو\n` +
           `2. استخدام وضع السيرفر مع اتصال إنترنت\n\n` +
           `--- معلومات الصورة ---\n` +
           `الحجم: ${Math.round(imageDataUrl.length / 1024)} KB\n` +
           `الاتجاه: ${ocrState.documentOrientation === 'portrait' ? 'عمودي' : 'أفقي'}\n` +
           `التاريخ: ${new Date().toLocaleString('ar-EG')}\n\n` +
           `[تم حفظ الصورة - يمكنك تحميلها كـ PDF]`,
    json: {
      mode: 'local-simulated',
      imageSize: `${Math.round(imageDataUrl.length / 1024)} KB`,
      orientation: ocrState.documentOrientation
    },
    language: 'AR'
  };
}

// Switch OCR processing mode
function switchOcrMode(mode) {
  ocrState.processingMode = mode;
  
  const serverBtn = $('#ocrModeServer');
  const localBtn = $('#ocrModeLocal');
  
  if (serverBtn && localBtn) {
    serverBtn.classList.toggle('selected', mode === 'server');
    localBtn.classList.toggle('selected', mode === 'local');
  }
  
  console.log('[OCR] Mode switched to:', mode);
  toast(`✅ تم اختيار الوضع: ${mode === 'server' ? 'السيرفر (AI)' : 'محلي (Offline)'}`);
}

// Display OCR results
function displayOcrResults(result) {
  console.log('[OCR] Displaying results...');
  
  const processing = $('#ocrProcessing');
  const results = $('#ocrResults');
  const textOutput = $('#ocrTextOutput');
  const langBadge = $('#ocrLangBadge');
  const jsonContent = $('#ocrJsonContent');
  const captureStep = $('#ocrCaptureStep');
  
  // Hide processing
  if (processing) processing.classList.remove('show');
  
  // Update text output
  if (result.text) {
    ocrState.extractedText = result.text;
    if (textOutput) {
      textOutput.textContent = result.text;
      
      // Detect direction based on content
      const arabicPattern = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
      if (arabicPattern.test(result.text)) {
        textOutput.classList.remove('ltr');
        ocrState.detectedLanguage = 'AR';
        if (langBadge) langBadge.textContent = 'عربي';
      } else {
        textOutput.classList.add('ltr');
        ocrState.detectedLanguage = 'EN';
        if (langBadge) langBadge.textContent = 'English';
      }
    }
  }
  
  // Update JSON if available
  if (result.json) {
    ocrState.jsonData = result.json;
    if (jsonContent) {
      jsonContent.textContent = JSON.stringify(result.json, null, 2);
    }
  }
  
  // Mark step as completed
  if (captureStep) {
    captureStep.classList.add('completed');
    captureStep.classList.remove('active');
  }
  
  // Show results
  if (results) {
    results.classList.add('show');
  }
  
  console.log('[OCR] Results displayed successfully');
  toast('تم استخراج النص بنجاح!');
}

// Copy OCR text to clipboard
async function copyOcrText() {
  if (!ocrState.extractedText) {
    toast('لا يوجد نص لنسخه');
    return;
  }
  
  try {
    await navigator.clipboard.writeText(ocrState.extractedText);
    
    // Show copy toast
    const copyToast = $('#ocrCopyToast');
    if (copyToast) {
      copyToast.classList.add('show');
      setTimeout(() => copyToast.classList.remove('show'), 2000);
    }
    
    console.log('[OCR] Text copied to clipboard');
  } catch (err) {
    console.error('[OCR] Copy error:', err);
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = ocrState.extractedText;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    
    const copyToast = $('#ocrCopyToast');
    if (copyToast) {
      copyToast.classList.add('show');
      setTimeout(() => copyToast.classList.remove('show'), 2000);
    }
  }
}

// Generate and Download OCR PDF
function downloadOcrPdf() {
  if (!ocrState.extractedText && ocrState.capturedPages.length === 0) {
    toast('لا يوجد نص لتحويله إلى PDF');
    return;
  }
  
  console.log('[OCR] Generating PDF...', ocrState.capturedPages.length, 'pages');
  
  try {
    // Check if jsPDF is available
    if (typeof window.jspdf === 'undefined') {
      toast('مكتبة PDF غير محملة - جارٍ التحميل...');
      loadJsPdfAndGenerate('download');
      return;
    }
    
    // Use multi-page PDF if we have captured pages, otherwise use single-page
    const pdfGenerator = (ocrState.capturedPages && ocrState.capturedPages.length > 0)
      ? generateMultiPagePdfBlob()
      : generateOcrPdfBlob();
    
    pdfGenerator.then(blob => {
      // Create download link
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ocr-document-${ocrState.capturedPages.length || 1}-pages-${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast(`✅ تم تحميل PDF (${ocrState.capturedPages.length || 1} صفحة)!`);
      console.log('[OCR] PDF downloaded successfully');
    });
    
  } catch (err) {
    console.error('[OCR] PDF generation error:', err);
    toast('خطأ في إنشاء PDF: ' + err.message);
  }
}

// Print OCR PDF directly
function printOcrPdf() {
  if (!ocrState.extractedText) {
    toast('لا يوجد نص لطباعته');
    return;
  }
  
  console.log('[OCR] Preparing PDF for printing...');
  
  try {
    // Check if jsPDF is available
    if (typeof window.jspdf === 'undefined') {
      toast('جارٍ تحميل مكتبة PDF...');
      loadJsPdfAndGenerate('print');
      return;
    }
    
    generateOcrPdfBlob().then(blob => {
      // Create object URL for iframe
      const url = URL.createObjectURL(blob);
      
      // Show in preview iframe
      const pdfPreview = $('#ocrPdfPreview');
      const pdfIframe = $('#ocrPdfIframe');
      
      if (pdfIframe && pdfPreview) {
        pdfIframe.src = url;
        pdfPreview.classList.add('show');
        pdfPreview.style.display = 'block';
        
        // Auto-print after loading
        pdfIframe.onload = () => {
          setTimeout(() => {
            try {
              pdfIframe.contentWindow.print();
              toast('جارٍ فتح نافذة الطباعة...');
            } catch (printErr) {
              console.warn('[OCR] Direct print failed, showing preview:', printErr);
              toast('اضغط Ctrl+P للطباعة من المعاينة');
            }
          }, 500);
        };
      } else {
        // Fallback: open in new tab
        const newWindow = window.open(url, '_blank');
        if (newWindow) {
          newWindow.onload = () => {
            newWindow.print();
          };
        }
      }
      
      console.log('[OCR] PDF prepared for printing');
    });
    
  } catch (err) {
    console.error('[OCR] Print PDF error:', err);
    toast('خطأ في إعداد الطباعة: ' + err.message);
  }
}

// Generate PDF Blob from extracted text
async function generateOcrPdfBlob() {
  const { jsPDF } = window.jspdf;
  
  // Create PDF document
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });
  
  // Page dimensions
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const maxWidth = pageWidth - (margin * 2);
  const lineHeight = 7;
  let yPosition = margin;
  
  // Add header
  doc.setFontSize(18);
  doc.setTextColor(40, 40, 40);
  doc.text('مستند OCR - نص مستخرج', pageWidth / 2, yPosition, { align: 'center' });
  yPosition += 15;
  
  // Add date
  doc.setFontSize(10);
  doc.setTextColor(120, 120, 120);
  const dateStr = new Date().toLocaleString('ar-EG', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  doc.text(`تاريخ الاستخراج: ${dateStr}`, pageWidth / 2, yPosition, { align: 'center' });
  yPosition += 15;
  
  // Add separator line
  doc.setDrawColor(198, 156, 74);
  doc.setLineWidth(0.5);
  doc.line(margin, yPosition, pageWidth - margin, yPosition);
  yPosition += 10;
  
  // Add content text
  doc.setFontSize(12);
  doc.setTextColor(30, 30, 30);
  
  // Detect language for font selection
  const arabicPattern = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  const isArabic = arabicPattern.test(ocrState.extractedText);
  
  // Split text into lines that fit the page width
  const lines = doc.splitTextToSize(ocrState.extractedText, maxWidth);
  
  for (let i = 0; i < lines.length; i++) {
    // Check if we need a new page
    if (yPosition > pageHeight - margin) {
      doc.addPage();
      yPosition = margin;
      
      // Add header on new pages
      doc.setFontSize(10);
      doc.setTextColor(150, 150, 150);
      doc.text('مستند OCR - صفحة ' + (doc.internal.getNumberOfPages()), pageWidth / 2, yPosition, { align: 'center' });
      yPosition += 10;
      
      doc.setFontSize(12);
      doc.setTextColor(30, 30, 30);
    }
    
    doc.text(lines[i], margin, yPosition, { 
      align: isArabic ? 'right' : 'left',
      maxWidth: maxWidth
    });
    yPosition += lineHeight;
  }
  
  // Add footer on last page
  const finalPageHeight = doc.internal.pageSize.getHeight();
  doc.setFontSize(8);
  doc.setColor(150, 150, 150);
  doc.text(
    'تم إنشاء هذا المستند بواسطة مدير الطباعة - OCR Module',
    pageWidth / 2,
    finalPageHeight - 10,
    { align: 'center' }
  );
  
  // Return as blob
  return doc.output('blob');
}

// Generate Multi-Page PDF Blob (with images and text for each page)
async function generateMultiPagePdfBlob() {
  const { jsPDF } = window.jspdf;
  
  // Use document orientation from state
  const orientation = ocrState.documentOrientation || 'portrait';
  
  // Create PDF document
  const doc = new jsPDF({
    orientation: orientation,
    unit: 'mm',
    format: 'a4'
  });
  
  // Page dimensions
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  
  // If we have captured pages, create a page for each
  if (ocrState.capturedPages && ocrState.capturedPages.length > 0) {
    
    for (let pageIndex = 0; pageIndex < ocrState.capturedPages.length; pageIndex++) {
      const page = ocrState.capturedPages[pageIndex];
      
      // Add new page (except for first)
      if (pageIndex > 0) {
        doc.addPage();
      }
      
      let yPosition = margin;
      
      // Add page header
      doc.setFontSize(14);
      doc.setTextColor(40, 40, 40);
      doc.text(`مستند OCR - الصفحة ${pageIndex + 1} من ${ocrState.capturedPages.length}`, pageWidth / 2, yPosition, { align: 'center' });
      yPosition += 10;
      
      // Add separator line
      doc.setDrawColor(198, 156, 74);
      doc.setLineWidth(0.5);
      doc.line(margin, yPosition, pageWidth - margin, yPosition);
      yPosition += 8;
      
      // Add page image if available
      if (page.image) {
        try {
          // Calculate image dimensions to fit page
          const imgWidth = pageWidth - (margin * 2);
          const imgHeight = (pageHeight * 0.5); // Use half page height for image
          
          // Add image centered
          doc.addImage(page.image, 'JPEG', margin, yPosition, imgWidth, imgHeight, '', 'MEDIUM', 0);
          yPosition += imgHeight + 5;
          
          // Add image border/label
          doc.setFontSize(8);
          doc.setTextColor(120, 120, 120);
          doc.text(`صورة الصفحة ${pageIndex + 1}`, pageWidth / 2, yPosition - 2, { align: 'center' });
          
        } catch (imgErr) {
          console.warn('[OCR-PDF] Could not add image for page', pageIndex + 1, ':', imgErr);
        }
        
        yPosition += 3;
        
        // Add another separator
        doc.setDrawColor(200, 200, 200);
        doc.setLineWidth(0.3);
        doc.line(margin, yPosition, pageWidth - margin, yPosition);
        yPosition += 6;
      }
      
      // Add extracted text for this page
      if (page.text) {
        doc.setFontSize(10);
        doc.setTextColor(30, 30, 30);
        
        // Detect language
        const arabicPattern = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
        const isArabic = arabicPattern.test(page.text);
        
        const maxWidth = pageWidth - (margin * 2);
        const lineHeight = 5.5;
        
        const lines = doc.splitTextToSize(page.text, maxWidth);
        
        for (let i = 0; i < lines.length && yPosition < pageHeight - margin; i++) {
          doc.text(lines[i], margin, yPosition, { 
            align: isArabic ? 'right' : 'left',
            maxWidth: maxWidth
          });
          yPosition += lineHeight;
        }
      }
    }
    
  } else {
    // Fallback to single-page mode (original behavior)
    let yPosition = margin;
    
    // Add header
    doc.setFontSize(18);
    doc.setTextColor(40, 40, 40);
    doc.text('مستند OCR - نص مستخرج', pageWidth / 2, yPosition, { align: 'center' });
    yPosition += 15;
    
    // Add date
    doc.setFontSize(10);
    doc.setTextColor(120, 120, 120);
    const dateStr = new Date().toLocaleString('ar-EG', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    doc.text(`تاريخ الاستخراج: ${dateStr}`, pageWidth / 2, yPosition, { align: 'center' });
    yPosition += 15;
    
    // Add separator line
    doc.setDrawColor(198, 156, 74);
    doc.setLineWidth(0.5);
    doc.line(margin, yPosition, pageWidth - margin, yPosition);
    yPosition += 10;
    
    // Add content text
    doc.setFontSize(12);
    doc.setTextColor(30, 30, 30);
    
    const arabicPattern = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
    const isArabic = arabicPattern.test(ocrState.extractedText);
    
    const maxWidth = pageWidth - (margin * 2);
    const lineHeight = 7;
    
    const lines = doc.splitTextToSize(ocrState.extractedText || '', maxWidth);
    
    for (let i = 0; i < lines.length; i++) {
      if (yPosition > pageHeight - margin) {
        doc.addPage();
        yPosition = margin;
        
        doc.setFontSize(10);
        doc.setTextColor(150, 150, 150);
        doc.text('مستند OCR - صفحة ' + (doc.internal.getNumberOfPages()), pageWidth / 2, yPosition, { align: 'center' });
        yPosition += 10;
        
        doc.setFontSize(12);
        doc.setTextColor(30, 30, 30);
      }
      
      doc.text(lines[i], margin, yPosition, { 
        align: isArabic ? 'right' : 'left',
        maxWidth: maxWidth
      });
      yPosition += lineHeight;
    }
  }
  
  // Add footer on last page
  const finalPageHeight = doc.internal.pageSize.getHeight();
  doc.setFontSize(8);
  doc.setColor(150, 150, 150);
  doc.text(
    `تم إنشاء هذا المستند بواسطة مدير الطباعة - OCR Module | ${ocrState.capturedPages.length || 1} صفحة`,
    pageWidth / 2,
    finalPageHeight - 10,
    { align: 'center' }
  );
  
  console.log('[OCR-PDF] Generated multi-page PDF with', ocrState.capturedPages.length, 'pages');
  
  // Return as blob
  return doc.output('blob');
}

// Load jsPDF dynamically if not loaded
function loadJsPdfAndGenerate(action) {
  const script = document.createElement('script');
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  script.onload = () => {
    console.log('[OCR] jsPDF loaded successfully');
    if (action === 'download') {
      downloadOcrPdf();
    } else if (action === 'print') {
      printOcrPdf();
    }
  };
  script.onerror = () => {
    toast('فشل تحميل مكتبة PDF - تحقق من اتصال الإنترنت');
  };
  document.head.appendChild(script);
}

/* ---------------- Enhanced Error Handling & Debugging ---------------- */
window.addEventListener('error', function(e) {
  console.error('[Global Error]', e.message, e.filename, e.lineno);
});

window.addEventListener('unhandledrejection', function(e) {
  console.error('[Unhandled Promise Rejection]', e.reason);
});

/* ---------------- init ---------------- */
console.log('[App] Initializing Print Manager...');

// Wait for DOM to be fully ready
document.addEventListener('DOMContentLoaded', function() {
  console.log('[App] DOM Ready - Initializing components');
  
  renderFileList();
  updateQueueBadge();
  updateMarginDisplay();
  
  // Initialize ID Card module if elements exist
  if ($('#view-idcard')) {
    console.log('[App] ID Card view found - initializing');
    setupIdCardModule();
  } else {
    console.warn('[App] ID Card view NOT found!');
  }
  
  // Initialize OCR module if elements exist
  if ($('#view-ocr')) {
    console.log('[App] OCR view found - initializing');
    setupOcrModule();
  } else {
    console.warn('[App] OCR view NOT found!');
  }
  
  // Verify navigation buttons exist
  const navBtns = $$('.nav-btn');
  console.log(`[App] Found ${navBtns.length} navigation buttons`);
  navBtns.forEach(btn => {
    console.log(`[App] Nav button: ${btn.dataset.view || 'unknown'}`);
  });
});

// Fallback initialization (in case DOMContentLoaded already fired)
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  renderFileList();
  updateQueueBadge();
  updateMarginDisplay();
}

/* ==================== PWA INSTALL BANNER ==================== */
let deferredPrompt = null;
let installBannerDismissed = false;
const installBanner = $("#installBanner");

// Check if app is already installed (standalone mode)
function isAppInstalled() {
  return window.matchMedia("(display-mode: standalone)").matches || 
         window.navigator.standalone === true ||
         document.referrer.includes("android-app://");
}

// Show install banner after a delay if not installed and prompt available
function showInstallBanner() {
  if (isAppInstalled() || installBannerDismissed || !deferredPrompt) return;
  
  // Check if user dismissed before (localStorage)
  const dismissed = localStorage.getItem("pwa-install-dismissed");
  if (dismissed) {
    const dismissTime = parseInt(dismissed);
    const now = Date.now();
    // Don't show again for 7 days after dismissal
    if (now - dismissTime < 7 * 24 * 60 * 60 * 1000) return;
  }
  
  // Show banner after 3 seconds of user interaction
  setTimeout(() => {
    if (!isAppInstalled() && deferredPrompt && !installBannerDismissed) {
      installBanner.classList.add("active");
    }
  }, 3000);
}

// Listen for beforeinstallprompt event
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  console.log("[PWA] Install prompt can be shown");
  
  // Show banner after delay
  showInstallBanner();
});

// Install button click handler
$("#installAppBtn").addEventListener("click", async () => {
  if (!deferredPrompt) {
    toast("التثبيت غير متاح حاليًا");
    return;
  }
  
  // Hide banner
  installBanner.classList.remove("active");
  
  // Show the native install prompt
  deferredPrompt.prompt();
  
  // Wait for user response
  const { outcome } = await deferredPrompt.userChoice;
  console.log(`[PWA] User response: ${outcome}`);
  
  if (outcome === "accepted") {
    toast("✅ تم تثبيت التطبيق بنجاح!");
  } else {
    toast("تم إلغاء التثبيت");
  }
  
  deferredPrompt = null;
});

// Dismiss banner handler
$("#dismissInstall").addEventListener("click", () => {
  installBanner.classList.remove("active");
  installBannerDismissed = true;
  localStorage.setItem("pwa-install-dismissed", Date.now().toString());
});

// Listen for successful installation
window.addEventListener("appinstalled", () => {
  console.log("[PWA] App was installed!");
  deferredPrompt = null;
  installBanner.classList.remove("active");
  
  // Show success message
  setTimeout(() => {
    toast("🎉 شكرًا لتثبيت مدير الطباعة!");
  }, 500);
});

// Show banner on page load if conditions met
if (!isAppInstalled()) {
  window.addEventListener("load", () => {
    // Small delay to ensure everything is loaded
    setTimeout(showInstallBanner, 2000);
  });
}

/* ==================== PRINT RANGE LOGIC ==================== */
$("#printRangeMode").addEventListener("change", (e) => {
  const mode = e.target.value;
  const rangeInputs = $("#rangeInputs");
  
  if (mode === "range") {
    rangeInputs.style.display = "flex";
    updateTotalPagesHint();
  } else {
    rangeInputs.style.display = "none";
  }
});

// Update total pages hint when files are selected
function updateTotalPagesHint() {
  const sel = state.files.filter((f) => f.selected);
  let totalPages = 0;
  
  sel.forEach(f => {
    if (f.pages) {
      totalPages += f.pages.length;
    } else if (f.ext === "pdf") {
      // Will be calculated later
      totalPages += 1; // Placeholder
    } else {
      totalPages += 1; // Single page for other types
    }
  });
  
  $("#totalPagesHint").textContent = `إجمالي ${totalPages} صفحة`;
  $("#rangeTo").max = Math.max(1, totalPages);
  $("#rangeFrom").max = Math.max(1, totalPages);
}

// Filter pages based on print range settings
async function filterPagesByRange(allImages) {
  const mode = $("#printRangeMode").value;
  
  switch (mode) {
    case "all":
      return allImages;
      
    case "range": {
      const from = parseInt($("#rangeFrom").value) || 1;
      const to = parseInt($("#rangeTo").value) || allImages.length;
      // Convert to 0-based index
      return allImages.slice(Math.max(0, from - 1), to);
    }
    
    case "current": {
      // Return only first page or current preview page
      const currentPage = state.previewState.currentPage || 0;
      return [allImages[currentPage]] || [allImages[0]];
    }
    
    case "odd":
      // Odd pages (1, 3, 5...) - index 0, 2, 4...
      return allImages.filter((_, i) => i % 2 === 0);
      
    case "even":
      // Even pages (2, 4, 6...) - index 1, 3, 5...
      return allImages.filter((_, i) => i % 2 === 1);
      
    default:
      return allImages;
  }
}

// Override buildPreviewImages to apply range filter, copies and duplex
const originalBuildPreviewImages = buildPreviewImages;
buildPreviewImages = async function(selFiles) {
  const allImages = await originalBuildPreviewImages(selFiles);
  
  // Apply range filter
  const filteredImages = await filterPagesByRange(allImages);
  
  // Apply copies and duplex for preview (show what will be printed)
  const copies = state.printOpts.copies || 1;
  const duplexMode = state.printOpts.duplexMode || "none";
  let previewImages = [];
  
  filteredImages.forEach(src => {
    for (let c = 0; c < copies; c++) {
      if (duplexMode === "same-page") {
        // Show same page twice for front/back preview
        previewImages.push({ src, label: `نسخة ${c+1} - وجه` });
        previewImages.push({ src, label: `نسخة ${c+1} - ضهر` });
      } else {
        previewImages.push({ src, label: copies > 1 ? `نسخة ${c+1}` : `صفحة` });
      }
    }
  });
  
  console.log(`[Preview] Original: ${allImages.length}, Filtered: ${filteredImages.length}, Preview pages: ${previewImages.length}`);
  
  // Return just the sources for preview display
  return previewImages.map(p => p.src);
};

// Also apply range filter when building for actual printing
const originalBuildPrintRoot = buildPrintRoot;
buildPrintRoot = async function(selFiles) {
  const root = $("#printRoot");
  root.innerHTML = "";
  
  const [rows, cols] = nupGrid(state.printOpts.nup);
  const perSheet = rows * cols;
  const copies = state.printOpts.copies || 1;
  const duplexMode = state.printOpts.duplexMode || "none";
  
  let imgBuffer = [];
  
  // Helper: flush images to sheets
  const flushImages = () => {
    while (imgBuffer.length) {
      const chunk = imgBuffer.splice(0, perSheet);
      const sheet = document.createElement("div");
      sheet.className = "p-sheet";
      chunk.forEach((src) => {
        const img = document.createElement("img");
        img.src = src;
        sheet.appendChild(img);
      });
      root.appendChild(sheet);
    }
  };
  
  // Helper: process images with copies and duplex support
  const processImagesWithCopies = (images) => {
    let processedImages = [];
    
    images.forEach((src, index) => {
      // For each copy
      for (let c = 0; c < copies; c++) {
        if (duplexMode === "same-page") {
          // Same page on front and back - add the page TWICE
          processedImages.push(src); // Front side
          processedImages.push(src); // Back side (same page)
        } else if (duplexMode === "normal") {
          // Normal duplex - add page once (printer handles duplex)
          processedImages.push(src);
        } else {
          // No duplex - single sided
          processedImages.push(src);
        }
      }
    });
    
    return processedImages;
  };
  
  // Collect all image pages first
  let allImagePages = [];
  
  for (const f of selFiles) {
    if (f.ext === "pdf") {
      if (!f.pages) f.pages = await renderPdfPages(f.file);
      f.pages.forEach(pageImg => allImagePages.push(pageImg));
    } else if (!["doc", "docx", "xls", "xlsx"].includes(f.ext)) {
      if (!f.pages) f.pages = [await fileToDataUrl(f.file)];
      f.pages.forEach(pageImg => allImagePages.push(pageImg));
    } else {
      // Flow content (docx/xlsx) - flush images first, then add flow
      // Apply range filter to current images before flushing
      let filteredCurrent = await filterPagesByRange(allImagePages);
      let processedCurrent = processImagesWithCopies(filteredCurrent);
      processedCurrent.forEach(src => imgBuffer.push(src));
      flushImages(); // Flush before adding flow content
      allImagePages = []; // Reset for next batch
      
      const flow = document.createElement("div");
      flow.className = "p-flow";
      
      // For flow documents, add copies as separate flows
      for (let c = 0; c < copies; c++) {
        const flowCopy = document.createElement("div");
        flowCopy.className = "p-flow";
        if (["doc", "docx"].includes(f.ext)) {
          if (!f.docHtml) f.docHtml = await renderDocx(f.file);
          flowCopy.innerHTML = `<div class="docx-content">${f.docHtml}</div>`;
        } else {
          if (!f.sheetsHtml) f.sheetsHtml = await renderXlsx(f.file);
          flowCopy.innerHTML = f.sheetsHtml;
        }
        root.appendChild(flowCopy);
      }
    }
  }
  
  // Process remaining image pages with range filter, copies and duplex
  let filteredImages = await filterPagesByRange(allImagePages);
  let finalImages = processImagesWithCopies(filteredImages);
  
  // Add to buffer and flush
  finalImages.forEach(src => imgBuffer.push(src));
  flushImages();
  
  // Log summary
  console.log(`[Print Job] Pages: ${filteredImages.length}, Copies: ${copies}, Duplex: ${duplexMode}, Total sheets: ${root.children.length}`);
  
  return root.children.length; // Return total number of sheets
};

/* ========================================================================
   Firebase Realtime Database Integration
   ======================================================================== */

// Firebase Configuration - استبدل هذه القيم بمشروعك
const firebaseConfig = {
  apiKey: "AIzaSyDNWeuRszXCZgmyIEyRwdKK1KaTp1SLn_I",
  authDomain: "orders-8f568.firebaseapp.com",
  databaseURL: "https://orders-8f568-default-rtdb.firebaseio.com",
  projectId: "orders-8f568",
  storageBucket: "orders-8f568.firebasestorage.app",
  messagingSenderId: "1029204669334",
  appId: "1:1029204669334:web:7df3d26ebd51d353abe3b7",
  measurementId: "G-FDZ9DHF6PL"
};

// Database State
const dbState = {
  firebase: null,
  database: null,
  auth: null,
  user: null,
  isConnected: false,
  listeners: [],
  lastSyncTime: null
};

/* ---------------- Firebase Initialization ---------------- */
function initFirebase() {
  try {
    // Check if Firebase is loaded
    if (typeof firebase === 'undefined') {
      console.warn('[Firebase] SDK not loaded. Loading from CDN...');
      loadFirebaseSDK();
      return;
    }
    
    // Initialize Firebase if not already initialized
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    
    dbState.firebase = firebase;
    dbState.auth = firebase.auth();
    dbState.database = firebase.database();
    
    // Setup auth state listener
    dbState.auth.onAuthStateChanged(handleAuthStateChanged);
    
    // Setup connection monitoring
    setupConnectionMonitoring();
    
    console.log('[Firebase] Initialized successfully');
    updateDatabaseUI();
    
  } catch (error) {
    console.error('[Firebase] Initialization error:', error);
    toast('خطأ في تهيئة Firebase: ' + error.message);
  }
}

function loadFirebaseSDK() {
  const script = document.createElement('script');
  script.src = 'https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js';
  script.onload = () => {
    const authScript = document.createElement('script');
    authScript.src = 'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js';
    authScript.onload = () => {
      const dbScript = document.createElement('script');
      dbScript.src = 'https://www.gstatic.com/firebasejs/9.22.0/firebase-database-compat.js';
      dbScript.onload = () => initFirebase();
      document.head.appendChild(dbScript);
    };
    document.head.appendChild(authScript);
  };
  document.head.appendChild(script);
}

function handleAuthStateChanged(user) {
  dbState.user = user;
  
  if (user) {
    console.log('[Firebase] User signed in:', user.uid);
    showToastDB('تم تسجيل الدخول بنجاح', 'success');
    startDatabaseSync();
  } else {
    console.log('[Firebase] User signed out');
    stopDatabaseSync();
  }
  
  updateDatabaseUI();
  updateAuthUI();
}

function setupConnectionMonitoring() {
  const connectedRef = dbState.database.ref('.info/connected');
  connectedRef.on('value', (snap) => {
    dbState.isConnected = snap.val() === true;
    updateConnectionStatus();
    
    if (dbState.isConnected) {
      console.log('[Firebase] Connected');
    } else {
      console.warn('[Firebase] Disconnected');
    }
  });
}

/* ---------------- Authentication ---------------- */
async function signInAnonymously() {
  try {
    const result = await dbState.auth.signInAnonymously();
    console.log('[Firebase] Anonymous sign-in successful:', result.user.uid);
    return result.user;
  } catch (error) {
    console.error('[Firebase] Anonymous sign-in error:', error);
    throw error;
  }
}

async function signInWithEmail(email, password) {
  try {
    const result = await dbState.auth.signInWithEmailAndPassword(email, password);
    console.log('[Firebase] Email sign-in successful:', result.user.uid);
    return result.user;
  } catch (error) {
    console.error('[Firebase] Email sign-in error:', error);
    throw error;
  }
}

async function signUpWithEmail(email, password) {
  try {
    const result = await dbState.auth.createUserWithEmailAndPassword(email, password);
    console.log('[Firebase] Sign-up successful:', result.user.uid);
    
    // Create default settings for new user
    await createUserDefaultSettings(result.user.uid);
    
    return result.user;
  } catch (error) {
    console.error('[Firebase] Sign-up error:', error);
    throw error;
  }
}

async function signOut() {
  try {
    await dbState.auth.signOut();
    console.log('[Firebase] Signed out successfully');
    showToastDB('تم تسجيل الخروج', 'info');
  } catch (error) {
    console.error('[Firebase] Sign-out error:', error);
    throw error;
  }
}

async function createUserDefaultSettings(uid) {
  const settingsRef = dbState.database.ref(`settings/${uid}`);
  await settingsRef.set({
    defaultPaper: 'A4',
    defaultOrientation: 'portrait',
    defaultCopies: 1,
    defaultColor: true,
    autoSaveOCR: true,
    cloudSync: true,
    createdAt: firebase.database.ServerValue.TIMESTAMP,
    updatedAt: firebase.database.ServerValue.TIMESTAMP
  });
}

/* ---------------- Database CRUD Operations ---------------- */

// ===== PRINT JOBS =====
async function savePrintJob(jobData) {
  if (!dbState.user) throw new Error('يجب تسجيل الدخول أولاً');
  
  const jobRef = dbState.database.ref('printJobs').push();
  const job = {
    id: jobRef.key,
    ...jobData,
    userId: dbState.user.uid,
    userEmail: dbState.user.email || 'anonymous',
    status: jobData.status || 'pending',
    createdAt: firebase.database.ServerValue.TIMESTAMP,
    updatedAt: firebase.database.ServerValue.TIMESTAMP
  };
  
  await jobRef.set(job);
  console.log('[DB] Print job saved:', jobRef.key);
  showToastDB('تم حفظ مهمة الطباعة', 'success');
  return job;
}

async function updatePrintJobStatus(jobId, status, extraData = {}) {
  const jobRef = dbState.database.ref(`printJobs/${jobId}`);
  await jobRef.update({
    status,
    ...extraData,
    updatedAt: firebase.database.ServerValue.TIMESTAMP
  });
  console.log('[DB] Print job updated:', jobId, status);
}

async function deletePrintJob(jobId) {
  const jobRef = dbState.database.ref(`printJobs/${jobId}`);
  await jobRef.remove();
  console.log('[DB] Print job deleted:', jobId);
  showToastDB('تم حذف مهمة الطباعة', 'info');
}

async function getUserPrintJobs(limit = 50) {
  if (!dbState.user) return [];
  
  const snapshot = await dbState.database.ref('printJobs')
    .orderByChild('userId')
    .equalTo(dbState.user.uid)
    .limitToLast(limit)
    .once('value');
  
  const jobs = [];
  snapshot.forEach((child) => {
    jobs.push({ id: child.key, ...child.val() });
  });
  
  return jobs.reverse(); // Newest first
}

async function getAllPrintJobs(status = null, limit = 100) {
  let query = dbState.database.ref('printJobs').limitToLast(limit);
  
  const snapshot = await query.once('value');
  const jobs = [];
  snapshot.forEach((child) => {
    const job = { id: child.key, ...child.val() };
    if (!status || job.status === status) {
      jobs.push(job);
    }
  });
  
  return jobs.reverse();
}

// Listen to real-time print job updates
function listenToPrintJobs(callback) {
  const ref = dbState.database.ref('printJobs').orderByChild('createdAt').limitToLast(50);
  
  const listener = ref.on('value', (snapshot) => {
    const jobs = [];
    snapshot.forEach((child) => {
      jobs.push({ id: child.key, ...child.val() });
    });
    callback(jobs.reverse());
  });
  
  dbState.listeners.push({ ref, listener, type: 'printJobs' });
  return listener;
}

// ===== OCR RESULTS =====
async function saveOcrResult(ocrData) {
  if (!dbState.user) throw new Error('يجب تسجيل الدخول أولاً');
  
  const resultRef = dbState.database.ref(`ocrResults/${dbState.user.uid}`).push();
  const result = {
    id: resultRef.key,
    text: ocrData.text,
    jsonData: ocrData.jsonData || null,
    detectedLanguage: ocrData.detectedLanguage || 'ar',
    imageUrl: ocrData.imageUrl || null,
    confidence: ocrData.confidence || null,
    createdAt: firebase.database.ServerValue.TIMESTAMP
  };
  
  await resultRef.set(result);
  console.log('[DB] OCR result saved:', resultRef.key);
  showToastDB('تم حفظ نتيجة OCR', 'success');
  return result;
}

async function getUserOcrResults(limit = 30) {
  if (!dbState.user) return [];
  
  const snapshot = await dbState.database.ref(`ocrResults/${dbState.user.uid}`)
    .orderByChild('createdAt')
    .limitToLast(limit)
    .once('value');
  
  const results = [];
  snapshot.forEach((child) => {
    results.push({ id: child.key, ...child.val() });
  });
  
  return results.reverse();
}

async function deleteOcrResult(resultId) {
  if (!dbState.user) return;
  
  const ref = dbState.database.ref(`ocrResults/${dbState.user.uid}/${resultId}`);
  await ref.remove();
  console.log('[DB] OCR result deleted:', resultId);
  showToastDB('تم حذف نتيجة OCR', 'info');
}

// ===== DOCUMENTS / FILES =====
async function saveDocumentMetadata(docData) {
  if (!dbState.user) throw new Error('يجب تسجيل الدخول أولاً');
  
  const docRef = dbState.database.ref(`documents/${dbState.user.uid}`).push();
  const doc = {
    id: docRef.key,
    name: docData.name,
    type: docData.type,
    size: docData.size,
    pageCount: docData.pageCount || 1,
    tags: docData.tags || [],
    isFavorite: docData.isFavorite || false,
    lastPrinted: docData.lastPrinted || null,
    createdAt: firebase.database.ServerValue.TIMESTAMP,
    updatedAt: firebase.database.ServerValue.TIMESTAMP
  };
  
  await docRef.set(doc);
  console.log('[DB] Document saved:', docRef.key);
  return doc;
}

async function getUserDocuments() {
  if (!dbState.user) return [];
  
  const snapshot = await dbState.database.ref(`documents/${dbState.user.uid}`).once('value');
  const docs = [];
  snapshot.forEach((child) => {
    docs.push({ id: child.key, ...child.val() });
  });
  
  return docs;
}

async function toggleDocumentFavorite(docId, isFavorite) {
  if (!dbState.user) return;
  
  const ref = dbState.database.ref(`documents/${dbState.user.uid}/${docId}/isFavorite`);
  await ref.set(isFavorite);
  console.log('[DB] Document favorite toggled:', docId, isFavorite);
}

// ===== SHARED DOCUMENTS =====
async function shareDocument(docId, sharedWith = []) {
  if (!dbState.user) throw new Error('يجب تسجيل الدخول أولاً');
  
  const shareRef = dbState.database.ref('sharedDocuments').push();
  const shareData = {
    id: shareRef.key,
    documentId: docId,
    sharedBy: dbState.user.uid,
    sharedByEmail: dbState.user.email || 'anonymous',
    sharedWith: sharedWith,
    createdAt: firebase.database.ServerValue.TIMESTAMP
  };
  
  await shareRef.set(shareData);
  console.log('[DB] Document shared:', shareRef.key);
  showToastDB('تم مشاركة المستند', 'success');
  return shareData;
}

// ===== USER SETTINGS =====
async function saveUserSettings(settings) {
  if (!dbState.user) throw new Error('يجب تسجيل الدخول أولاً');
  
  const ref = dbState.database.ref(`settings/${dbState.user.uid}`);
  await ref.update({
    ...settings,
    updatedAt: firebase.database.ServerValue.TIMESTAMP
  });
  console.log('[DB] Settings saved');
  showToastDB('تم حفظ الإعدادات', 'success');
}

async function getUserSettings() {
  if (!dbState.user) return null;
  
  const snapshot = await dbState.database.ref(`settings/${dbState.user.uid}`).once('value');
  return snapshot.val();
}

/* ---------------- Real-time Sync ---------------- */
function startDatabaseSync() {
  if (!dbState.user) return;
  
  console.log('[DB] Starting real-time sync...');
  dbState.lastSyncTime = new Date().toISOString();
  
  // Listen for print jobs changes
  listenToPrintJobs((jobs) => {
    updatePrintJobsUI(jobs);
  });
  
  // Listen for OCR results changes
  const ocrRef = dbState.database.ref(`ocrResults/${dbState.user.uid}`)
    .orderByChild('createdAt')
    .limitToLast(20);
  
  ocrRef.on('value', (snapshot) => {
    const results = [];
    snapshot.forEach((child) => {
      results.push({ id: child.key, ...child.val() });
    });
    updateOcrHistoryUI(results.reverse());
  });
  
  dbState.listeners.push({ ref: ocrRef, type: 'ocrResults' });
}

function stopDatabaseSync() {
  console.log('[DB] Stopping real-time sync...');
  
  dbState.listeners.forEach(({ ref, type }) => {
    ref.off();
    console.log(`[DB] Removed listener: ${type}`);
  });
  
  dbState.listeners = [];
}

/* ---------------- UI Components ---------------- */
function updateDatabaseUI() {
  const statusEl = document.getElementById('db-status');
  if (statusEl) {
    statusEl.className = `db-status ${dbState.isConnected ? 'connected' : 'disconnected'}`;
    statusEl.textContent = dbState.isConnected ? 'متصل' : 'غير متصل';
  }
  
  const syncBtn = document.getElementById('btn-sync-now');
  if (syncBtn) {
    syncBtn.disabled = !dbState.isConnected || !dbState.user;
  }
}

function updateConnectionStatus() {
  const indicator = document.getElementById('connection-indicator');
  if (indicator) {
    indicator.className = `connection-indicator ${dbState.isConnected ? 'online' : 'offline'}`;
    indicator.title = dbState.isConnected ? 'متصل بالسحابة' : 'غير متصل - يعمل بدون اتصال';
  }
  
  updateDatabaseUI();
}

function updateAuthUI() {
  const userInfo = document.getElementById('user-info');
  const authButtons = document.getElementById('auth-buttons');
  
  if (dbState.user) {
    if (userInfo) {
      userInfo.innerHTML = `
        <div class="user-avatar">
          ${dbState.user.email ? dbState.user.email[0].toUpperCase() : '?'}
        </div>
        <span class="user-email">${dbState.user.email || 'مستخدم مجهول'}</span>
      `;
      userInfo.style.display = 'flex';
    }
    if (authButtons) {
      authButtons.innerHTML = `
        <button onclick="handleSignOut()" class="btn btn-outline btn-sm">
          <svg viewBox="0 0 24 24" width="16" height="16"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>
          خروج
        </button>
      `;
    }
  } else {
    if (userInfo) userInfo.style.display = 'none';
    if (authButtons) {
      authButtons.innerHTML = `
        <button onclick="showSignInModal()" class="btn btn-primary btn-sm">
          <svg viewBox="0 0 24 24" width="16" height="16"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>
          دخول
        </button>
      `;
    }
  }
}

function updatePrintJobsUI(jobs) {
  const container = document.getElementById('cloud-jobs-list');
  if (!container) return;
  
  if (jobs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" width="48" height="48"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
        <p>لا توجد مهام طباعة في السحابة</p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = jobs.map(job => `
    <div class="cloud-job-item" data-id="${job.id}">
      <div class="job-icon">${getJobIcon(job.status)}</div>
      <div class="job-info">
        <h4>${escapeHtml(job.name || 'بدون اسم')}</h4>
        <div class="job-meta">
          <span class="job-status status-${job.status}">${getStatusLabel(job.status)}</span>
          <span class="job-date">${formatDate(job.createdAt)}</span>
        </div>
      </div>
      <div class="job-actions">
        <button onclick="viewCloudJob('${job.id}')" title="عرض" class="btn-icon">
          <svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
        </button>
        <button onclick="reprintCloudJob('${job.id}')" title="إعادة طباعة" class="btn-icon">
          <svg viewBox="0 0 24 24" width="18" height="18"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>
        </button>
        <button onclick="handleDeleteCloudJob('${job.id}')" title="حذف" class="btn-icon danger">
          <svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
        </button>
      </div>
    </div>
  `).join('');
}

function updateOcrHistoryUI(results) {
  const container = document.getElementById('cloud-ocr-history');
  if (!container) return;
  
  if (results.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" width="48" height="48"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13zM6 20V4h5v7h7v9H6z"/></svg>
        <p>لا توجد نتائج OCR محفوظة</p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = results.map(result => `
    <div class="ocr-history-item" data-id="${result.id}">
      <div class="ocr-preview">
        ${result.imageUrl ? `<img src="${result.imageUrl}" alt="OCR Preview">` : '<div class="ocr-text-icon">📄</div>'}
      </div>
      <div class="ocr-info">
        <h4>${escapeHtml(result.text ? result.text.substring(0, 50) + '...' : 'بدون نص')}</h4>
        <div class="ocr-meta">
          <span class="lang-badge lang-${result.detectedLanguage}">${getLanguageLabel(result.detectedLanguage)}</span>
          <span class="ocr-date">${formatDate(result.createdAt)}</span>
        </div>
      </div>
      <div class="ocr-actions">
        <button onclick="viewOcrResult('${result.id}')" title="عرض النص" class="btn-icon">
          <svg viewBox="0 0 24 24" width="18" height="18"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg>
        </button>
        <button onclick="downloadOcrPdfFromCloud('${result.id}')" title="تحميل PDF" class="btn-icon">
          <svg viewBox="0 0 24 24" width="18" height="18"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
        </button>
        <button onclick="deleteOcrResult('${result.id}')" title="حذف" class="btn-icon danger">
          <svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
        </button>
      </div>
    </div>
  `).join('');
}

/* ---------------- Helper Functions ---------------- */
function getJobIcon(status) {
  const icons = {
    pending: '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>',
    printing: '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>',
    completed: '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
    failed: '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>'
  };
  return icons[status] || icons.pending;
}

function getStatusLabel(status) {
  const labels = {
    pending: 'قيد الانتظار',
    printing: 'جاري الطباعة',
    completed: 'مكتمل',
    failed: 'فشل'
  };
  return labels[status] || status;
}

function getLanguageLabel(lang) {
  const labels = {
    ar: 'عربي',
    en: 'إنجليزي',
    fr: 'فرنسي',
    de: 'ألماني',
    es: 'إسباني'
  };
  return labels[lang] || lang || 'غير معروف';
}

function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  
  if (diff < 60000) return 'الآن';
  if (diff < 3600000) return `منذ ${Math.floor(diff / 60000)} دقيقة`;
  if (diff < 86400000) return `منذ ${Math.floor(diff / 3600000)} ساعة`;
  
  return date.toLocaleDateString('ar-EG', { 
    day: 'numeric', 
    month: 'short', 
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showToastDB(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast-db toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ'}</span>
    <span class="toast-message">${message}</span>
  `;
  
  document.body.appendChild(toast);
  
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/* ---------------- Event Handlers ---------------- */
async function handleSignIn(event) {
  event.preventDefault();
  
  const email = document.getElementById('signin-email')?.value;
  const password = document.getElementById('signin-password')?.value;
  const mode = document.getElementById('auth-mode')?.value || 'anonymous';
  
  try {
    if (mode === 'email' && email && password) {
      await signInWithEmail(email, password);
    } else {
      await signInAnonymously();
    }
    
    closeModal('auth-modal');
  } catch (error) {
    showToastDB('خطأ في تسجيل الدخول: ' + error.message, 'error');
  }
}

async function handleSignUp(event) {
  event.preventDefault();
  
  const email = document.getElementById('signup-email')?.value;
  const password = document.getElementById('signup-password')?.value;
  const confirm = document.getElementById('signup-confirm')?.value;
  
  if (password !== confirm) {
    showToastDB('كلمة المرور غير متطابقة', 'error');
    return;
  }
  
  if (password.length < 6) {
    showToastDB('كلمة المرور يجب أن تكون 6 أحرف على الأقل', 'error');
    return;
  }
  
  try {
    await signUpWithEmail(email, password);
    closeModal('auth-modal');
  } catch (error) {
    showToastDB('خطأ في إنشاء الحساب: ' + error.message, 'error');
  }
}

async function handleSignOut() {
  try {
    await signOut();
  } catch (error) {
    showToastDB('خطأ في تسجيل الخروج: ' + error.message, 'error');
  }
}

function showSignInModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) {
    modal.classList.add('active');
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('active');
  }
}

async function viewCloudJob(jobId) {
  const snapshot = await dbState.database.ref(`printJobs/${jobId}`).once('value');
  const job = snapshot.val();
  if (!job) return;
  
  // Show job details in a modal or panel
  console.log('[Cloud Job]', job);
  showToastDB('جاري تحميل تفاصيل المهمة...', 'info');
}

async function reprintCloudJob(jobId) {
  const snapshot = await dbState.database.ref(`printJobs/${jobId}`).once('value');
  const job = snapshot.val();
  if (!job) return;
  
  // Update status to printing
  await updatePrintJobStatus(jobId, 'printing');
  
  // Trigger print (implementation depends on your print system)
  console.log('[Reprint Job]', job);
  showToastDB('جاري إعادة الطباعة...', 'info');
}

async function handleDeleteCloudJob(jobId) {
  if (!confirm('هل أنت متأكد من حذف هذه المهمة؟')) return;
  
  try {
    await deletePrintJob(jobId);
  } catch (error) {
    showToastDB('خطأ في الحذف: ' + error.message, 'error');
  }
}

async function viewOcrResult(resultId) {
  const snapshot = await dbState.database.ref(`ocrResults/${dbState.user.uid}/${resultId}`).once('value');
  const result = snapshot.val();
  if (!result) return;
  
  // Display the OCR text (could open in a modal or copy to clipboard)
  if (result.text) {
    navigator.clipboard.writeText(result.text).then(() => {
      showToastDB('تم نسخ النص إلى الحافظة', 'success');
    }).catch(() => {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = result.text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      showToastDB('تم نسخ النص إلى الحافظة', 'success');
    });
  }
}

async function downloadOcrPdfFromCloud(resultId) {
  const snapshot = await dbState.database.ref(`ocrResults/${dbState.user.uid}/${resultId}`).once('value');
  const result = snapshot.val();
  if (!result || !result.text) return;
  
  // Generate PDF from stored text
  if (typeof jsPDF !== 'undefined') {
    const doc = new jsPDF();
    const lines = doc.splitTextToSize(result.text, 180);
    doc.text(lines, 15, 15);
    doc.save(`ocr-${resultId}.pdf`);
    showToastDB('تم تحميل ملف PDF', 'success');
  }
}

/* ---------------- Auto-save Features ---------------- */
async function autoSaveCurrentPrintJob() {
  if (!dbState.user || state.files.length === 0) return;
  
  const jobData = {
    name: `طباعة ${state.files.length} ملف`,
    fileCount: state.files.length,
    files: state.files.map(f => ({ name: f.name, type: f.type })),
    options: { ...state.printOpts },
    status: 'saved'
  };
  
  try {
    await savePrintJob(jobData);
  } catch (error) {
    console.warn('[Auto-save] Failed:', error);
  }
}

async function autoSaveOcrResult() {
  if (!dbState.user || !ocrState.extractedText) return;
  
  const ocrData = {
    text: ocrState.extractedText,
    jsonData: ocrState.jsonData,
    detectedLanguage: ocrState.detectedLanguage,
    imageUrl: ocrState.capturedImage
  };
  
  try {
    await saveOcrResult(ocrData);
  } catch (error) {
    console.warn('[Auto-save OCR] Failed:', error);
  }
}

/* ---------------- Initialize on DOM Ready ---------------- */
document.addEventListener('DOMContentLoaded', () => {
  // Initialize Firebase after a short delay to ensure all scripts are loaded
  setTimeout(() => {
    initFirebase();
  }, 1000);
});

// Export functions for global access
window.DBFunctions = {
  initFirebase,
  signInAnonymously,
  signInWithEmail,
  signUpWithEmail,
  signOut,
  savePrintJob,
  updatePrintJobStatus,
  deletePrintJob,
  getUserPrintJobs,
  saveOcrResult,
  getUserOcrResults,
  deleteOcrResult,
  saveDocumentMetadata,
  getUserDocuments,
  saveUserSettings,
  getUserSettings,
  shareDocument,
  autoSaveCurrentPrintJob,
  autoSaveOcrResult
};

/* ===== Cloud Tab Switching & Auth Modal Helpers ===== */
function initCloudTabs() {
  const tabs = document.querySelectorAll('.cloud-tab[data-tab]');
  const contents = document.querySelectorAll('.cloud-tab-content');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.tab;
      
      // Update tab buttons
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      // Update content
      contents.forEach(c => c.classList.remove('active'));
      const targetContent = document.getElementById(`tab-${targetTab}`);
      if (targetContent) targetContent.classList.add('active');
    });
  });
}

function switchAuthMode(mode) {
  document.getElementById('auth-mode').value = mode;
  
  // Update tab buttons
  document.getElementById('btn-auth-email').classList.toggle('active', mode === 'email');
  document.getElementById('btn-auth-anon').classList.toggle('active', mode === 'anonymous');
  
  // Show/hide sections
  document.getElementById('signin-form').style.display = mode === 'email' ? 'flex' : 'none';
  document.getElementById('anonymous-section').style.display = mode === 'anonymous' ? 'block' : 'none';
}

let isSignUpMode = false;
function toggleSignUpMode() {
  isSignUpMode = !isSignUpMode;
  
  const signupFields = document.getElementById('signup-fields');
  const submitBtn = document.getElementById('btn-signin-submit');
  const toggleLink = document.getElementById('toggle-auth-link');
  const form = document.getElementById('signin-form');
  
  if (isSignUpMode) {
    signupFields.style.display = 'block';
    submitBtn.textContent = 'إنشاء حساب جديد';
    toggleLink.textContent = 'لديك حساب بالفعل؟ تسجيل الدخول';
    form.onsubmit = handleSignUp;
  } else {
    signupFields.style.display = 'none';
    submitBtn.textContent = 'تسجيل الدخول';
    toggleLink.textContent = 'ليس لديك حساب؟ إنشاء حساب جديد';
    form.onsubmit = handleSignIn;
  }
}

async function handleAnonymousSignIn() {
  try {
    await signInAnonymously();
    closeModal('auth-modal');
  } catch (error) {
    showToastDB('خطأ: ' + error.message, 'error');
  }
}

async function saveCurrentDocuments() {
  if (!dbState.user || state.files.length === 0) {
    showToastDB('لا توجد ملفات لحفظها', 'info');
    return;
  }
  
  let savedCount = 0;
  for (const f of state.files) {
    try {
      await saveDocumentMetadata({
        name: f.name,
        type: f.type || extOf(f.name),
        size: f.file ? f.file.size : 0,
        pageCount: f.pages ? f.pages.length : 1
      });
      savedCount++;
    } catch (e) {
      console.warn('[DB] Failed to save doc:', f.name, e);
    }
  }
  
  showToastDB(`تم مزامنة ${savedCount} مستند`, 'success');
}

// Initialize cloud tabs when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    initCloudTabs();
  }, 100);
});
