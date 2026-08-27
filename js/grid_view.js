/* Copyright 2026 Rosette Robotics Inc. All rights reserved. 
Unauthorized copying, distribution, or commercial use via any medium is strictly prohibited. */

// static/js/grid_view.js
import { getAllSeeds, subscribe, applyManualChange, getThumbnailUrl } from './prediction_store.js';
import { getSourceImage } from './source_image_cache.js';

// ---- module-level state, all reset in unmount() ----
let container = null;
let cleanupFns = [];
let unsubscribeStore = null;

let SORT_TYPE = 'type';
let cols = 4;
let scale = 1.0;
let sourceImg = null;
let renderScale = null;
let rowLayout = [];
let rowTops = [];
let totalH = 0;
let rendered = new Map();
let selectedId = null;
let selectedServerId = null;
let drawQueue = [];
let schedulerRunning = false;
let sliderRafId = null;
let rafPending = false;

let csrf_token = null;

// DOM refs, assigned in mount()
let loadingEl, loadingMsg, scrollEl, phantomEl, tilesEl, statsEl, detailEl,
    detailImg, selectedSeedType, selectedSeedConfidence, changeBtn, undoBtn,
    saveBtn, deleteBtn, display, edit, select, sortSelect;

const GAP = 4, PAD = 4, OVERSCAN = 300, HEADER_H = 32;

const rowClass = "absolute left-0 right-0 flex items-center gap-1 px-1 bg-black";
const tileClass = `shrink-0 rounded-[3px] overflow-hidden cursor-pointer border-2 border-transparent transition-colors duration-100 relative leading-none`;
const hoverClass = "shrink-0 rounded-[3px] overflow-hidden cursor-pointer border-2 border-transparent hover:border-[rgba(100,140,200,0.6)] transition-colors duration-100 relative leading-none";
const tileLabelClass = "hidden absolute bottom-0 left-0 right-0 text-[10px] px-1 py-[2px] bg-black/55 text-white whitespace-nowrap overflow-hidden text-ellipsis pointer-events-none";
const tileHoverClass = "group shrink-0 rounded-[3px] overflow-hidden cursor-pointer border-2 border-transparent hover:border-[rgba(100,140,200,0.6)] transition-colors duration-100 relative leading-none";

// ============================================================
// MOUNT
// ============================================================
export async function mount(mountPoint, config) {
    container = mountPoint;
    container.innerHTML = '';
    container.appendChild(gridMarkup());

    csrf_token = config.csrf_token;

    // --- query scoped to container, NOT document ---
    loadingEl = container.querySelector('#sg-loading');
    loadingMsg = container.querySelector('#sg-loading-msg');
    scrollEl = container.querySelector('#sg-scroll-outer');
    phantomEl = container.querySelector('#sg-phantom');
    tilesEl = container.querySelector('#sg-tiles');
    statsEl = container.querySelector('#sg-stats');
    detailEl = container.querySelector('#sg-detail');
    detailImg = container.querySelector('#server-thumbnail-img');
    selectedSeedType = container.querySelector('#selected-seed-type');
    selectedSeedConfidence = container.querySelector('#selected-seed-confidence');
    changeBtn = container.querySelector('#change-prediction-btn');
    undoBtn = container.querySelector('#undo-prediction-btn');
    saveBtn = container.querySelector('#save-prediction-btn');
    deleteBtn = container.querySelector('#delete-prediction-btn');
    display = container.querySelector('#prediction-display');
    edit = container.querySelector('#prediction-edit');
    select = container.querySelector('#prediction-select');
    sortSelect = container.querySelector('#sort-select');

    // reset local state
    SORT_TYPE = 'type';
    cols = 4;
    scale = 1.0;
    rendered = new Map();
    selectedId = null;
    selectedServerId = null;
    drawQueue = [];
    schedulerRunning = false;

    // --- store subscription ---
    unsubscribeStore = subscribe(handleStoreEvent);

    // --- listeners, all cleaned up on unmount ---
    addListener(container.querySelector('#sg-col-slider'), 'input', onColSliderInput);
    addListener(container.querySelector('#sg-scale-slider'), 'input', onScaleSliderInput);
    addListener(sortSelect, 'input', onSortSelectInput);
    addListener(scrollEl, 'scroll', onScroll, { passive: true });
    addListener(window, 'resize', rebuildAndRender);
    addListener(changeBtn, 'click', onChangeBtnClick);
    addListener(undoBtn, 'click', onUndoBtnClick);
    addListener(saveBtn, 'click', onSaveBtnClick);
    addListener(deleteBtn, 'click', onDeleteBtnClick);

    // --- image: shared cache instead of per-view decode ---
    loadingMsg.textContent = "Loading scan image…";
    try {
        sourceImg = await getSourceImage(config.imageUrl);
        loadingEl.style.display = "none";
        scrollEl.style.display = "block";
        buildLayout();
        render();
    } catch (err) {
        console.error(err);
        loadingMsg.textContent = "Failed to load image: " + err.message;
    }
}

// ============================================================
// UNMOUNT
// ============================================================
export function unmount() {
    unsubscribeStore?.();
    unsubscribeStore = null;

    cleanupFns.forEach(fn => fn());
    cleanupFns = [];

    if (sliderRafId !== null) cancelAnimationFrame(sliderRafId);
    sliderRafId = null;
    drawQueue = [];
    schedulerRunning = false;

    rendered.forEach(strip => strip.remove());
    rendered = new Map();
    rowLayout = [];
    rowTops = [];
    sourceImg = null; // just drop the ref — cache module still owns the bitmap

    if (container) container.innerHTML = '';
    container = null;
    selectedId = null;
    selectedServerId = null;
}

function addListener(el, evt, fn, opts) {
    el.addEventListener(evt, fn, opts);
    cleanupFns.push(() => el.removeEventListener(evt, fn, opts));
}

function handleStoreEvent(event) {
    if (event.type !== 'prediction-changed') return;
    rebuildAndRender();
    if (String(event.serverId) === String(selectedServerId)) {
        selectedSeedType.textContent = event.seed.label;
        selectedSeedConfidence.textContent = event.seed.confidence;
        select.value = event.seed.label;
    }
}

function processDrawQueue(deadline) {
    const hasTime = () => deadline ? deadline.timeRemaining() > 0 : true;
    try {
        while (drawQueue.length > 0 && hasTime()) {
            const item = drawQueue.shift();
            if (!rendered.has(item.rowIndex) || !item.cv.isConnected) continue;
            drawSeedThumbnail(item.cv, sourceImg, item.seed, item.tileW, item.tileH);
        }
    } finally {
        schedulerRunning = false;
        if (drawQueue.length > 0) scheduleDrawWork();
    }
}

function scheduleDrawWork() {
    if (schedulerRunning) return;
    schedulerRunning = true;
    if ('requestIdleCallback' in window) {
        requestIdleCallback(processDrawQueue, { timeout: 100 });
    } else {
        // Fallback: manually budget ~8ms per frame
        requestAnimationFrame(() => {
            const start = performance.now();
            processDrawQueue({ timeRemaining: () => Math.max(0, 8 - (performance.now() - start)) });
        });
    }
}

function drawSeedThumbnail(canvas, img, seed, tileW, tileH) {
    const sx = seed.x1;
    const sy = seed.y1;
    const sw = seed.x2 - seed.x1;   // source width  (natural px)
    const sh = seed.y2 - seed.y1;   // source height (natural px)

    canvas.width = tileW;
    canvas.height = tileH;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(
        img,           // source: full scan image
        sx, sy, sw, sh,  // source rectangle = the bbox
        0, 0, tileW, tileH  // destination = the whole canvas, scaled
    );
}


// Binary search: first row index whose bottom edge is >= target
function findFirstRowAtOrAfter(target) {
    let lo = 0, hi = rowLayout.length - 1, ans = rowLayout.length; // default: none found
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const rowBottom = rowTops[mid] + (rowLayout[mid].rowH ?? HEADER_H);
        if (rowBottom >= target) {
            ans = mid;
            hi = mid - 1;
        } else {
            lo = mid + 1;
        }
    }
    return ans;
}

// Binary search: last row index whose top edge is <= target
function findLastRowAtOrBefore(target) {
    let lo = 0, hi = rowLayout.length - 1, ans = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (rowTops[mid] <= target) {
            ans = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return ans;
}

function buildLayout() {
    rowLayout = [];
    rowTops = [];
    totalH = 0;

    const availW = scrollEl.clientWidth - PAD * 2 - GAP * (cols - 1);
    const colW = Math.floor(availW / cols);

    // ── Group seeds if sorting by type or needs_manual_review ──
    let groups;

    let seeds = getAllSeeds()

    // ── Compute ONE global scale from the widest seed across ALL seeds ──
    let maxNativeW = 0;
    for (const s of seeds) {
        const nativeW = s.x2 - s.x1;
        if (nativeW > maxNativeW) maxNativeW = nativeW;
    }
    renderScale = maxNativeW > 0 ? Math.min(scale, colW / maxNativeW) : scale;

    if (SORT_TYPE === 'type') {
        const map = new Map();
        for (const s of seeds) {
            const key = s.label ?? 'Unknown';
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(s);
        }
        groups = [...map.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([label, seeds]) => ({ label, seeds }));
    } else if (SORT_TYPE === 'needs_manual_review') {
        const yes = seeds.filter(s => s.needs_manual_review);
        const no = seeds.filter(s => !s.needs_manual_review);
        groups = [
            { label: 'Requires Manual Review', seeds: yes },
            { label: 'Does Not Require Manual Review', seeds: no },
        ].filter(g => g.seeds.length > 0);

    } else {
        groups = [{ label: null, seeds: seeds }];
    }

    // ── Build rows from each group ──
    for (const group of groups) {
        if (group.label !== null) {
            rowTops.push(PAD + totalH);
            rowLayout.push({ type: 'header', label: group.label, colW });
            totalH += HEADER_H + GAP;
        }

        for (let i = 0; i < group.seeds.length; i += cols) {
            const rowSeeds = group.seeds.slice(i, i + cols);

            // Use the SAME global renderScale for every row
            let maxH = 0;
            for (const s of rowSeeds) {
                const nativeH = s.y2 - s.y1;
                const th = Math.round(nativeH * renderScale);
                if (th > maxH) maxH = th;
            }

            rowTops.push(PAD + totalH);
            rowLayout.push({ type: 'seeds', seeds: rowSeeds, rowH: maxH, colW });
            totalH += maxH + GAP;
        }
    }

    totalH += PAD;
    phantomEl.style.height = totalH + "px";
}

function render() {
    const scrollTop = scrollEl.scrollTop;
    const viewBot = scrollTop + scrollEl.clientHeight;

    if (rowLayout.length === 0) {
        rendered.forEach(strip => strip.remove());
        rendered = new Map();
        statsEl.textContent = `${getAllSeeds().length.toLocaleString()} seeds`;
        return;
    }

    let firstRow = findFirstRowAtOrAfter(scrollTop - OVERSCAN);
    if (firstRow >= rowLayout.length) firstRow = rowLayout.length - 1; // nothing below viewport top edge; clamp

    let lastRow = findLastRowAtOrBefore(viewBot + OVERSCAN);
    if (lastRow < firstRow) lastRow = firstRow; // ensure at least one row renders

    // Build the set of rows we want in the DOM after this frame
    const nextRendered = new Map();

    for (let r = firstRow; r <= lastRow; r++) {
        if (rendered.has(r)) {
            // Already in DOM — just move it to nextRendered, don't touch it
            nextRendered.set(r, rendered.get(r));
            rendered.delete(r);   // remove from old map so it isn't purged below
            continue;
        }

        if (rowLayout[r].type === 'header') {
            const { label } = rowLayout[r];
            const strip = document.createElement('div');
            strip.className = 'absolute left-0 right-0 flex items-center gap-2 px-2 text-xs font-bold uppercase bg-blue-500 tracking-widest text-white';

            strip.style.top = rowTops[r] + 'px';
            strip.style.height = HEADER_H + 'px';

            const text = document.createElement('span');
            text.textContent = label;
            strip.appendChild(text);

            const line = document.createElement('div');
            line.className = 'flex-1 h-px bg-white';
            strip.appendChild(line);

            tilesEl.appendChild(strip);
            nextRendered.set(r, strip);
            continue;
        }

        // ── Build a new row strip ──
        const { seeds: rowSeeds, rowH, colW } = rowLayout[r];

        const strip = document.createElement("div");
        strip.className = rowClass;
        strip.style.top = rowTops[r] + "px";
        strip.style.height = rowH + "px";

        for (const s of rowSeeds) {
            const sw = s.x2 - s.x1;
            const sh = s.y2 - s.y1;
            const tileW = Math.max(1, Math.round(sw * renderScale));
            const tileH = Math.max(1, Math.round(sh * renderScale));


            // ── Tile wrapper ──
            const tile = document.createElement("div");
            tile.className = tileClass + ' group'

            if (selectedId === s.id) {
                tile.classList.remove("border-transparent");
                tile.classList.add("border-red-500");
            }
            tile.style.width = tileW + "px";
            tile.style.height = tileH + "px";
            tile.dataset.id = s.id;

            // ── Canvas: sized immediately, painted now or deferred ──
            const cv = document.createElement("canvas");
            cv.width = tileW;
            cv.height = tileH;
            tile.appendChild(cv);

            const rowTop = rowTops[r];
            const rowBottom = rowTop + rowH;
            const inViewportNow = rowBottom >= scrollTop && rowTop <= viewBot;

            if (inViewportNow) {
                drawSeedThumbnail(cv, sourceImg, s, tileW, tileH);
            } else {
                drawQueue.push({ cv, seed: s, tileW, tileH, rowIndex: r });
            }

            // ── Hover label ──
            const lbl = document.createElement("div");
            lbl.className =
                "hidden group-hover:block absolute bottom-0 left-0 right-0 text-[10px] px-1 py-[2px] bg-black/55 text-white whitespace-nowrap overflow-hidden text-ellipsis pointer-events-none";
            lbl.textContent = s.label || `#${s.id}`;
            tile.appendChild(lbl);

            tile.addEventListener("click", () => selectSeed(s));
            strip.appendChild(tile);
        }

        tilesEl.appendChild(strip);
        nextRendered.set(r, strip);
    }

    // Remove rows that have scrolled out of range
    rendered.forEach(strip => strip.remove());
    rendered = nextRendered;

    if (drawQueue.length > 0) scheduleDrawWork();

    // Update stats readout
    statsEl.textContent =
        `${getAllSeeds().length.toLocaleString()} seeds · rows ${firstRow}–${lastRow} visible`;
}

function rebuildAndRender() {
    // Wipe every rendered strip and rebuild from scratch
    rendered.forEach(strip => strip.remove());
    rendered = new Map();
    buildLayout();
    render();
}

function selectSeed(s) {
    const prevTile = tilesEl.querySelector(`[data-id="${selectedId}"]`);
    if (prevTile) { prevTile.classList.remove("border-red-500"); prevTile.classList.add("border-transparent"); }

    selectedId = s.id;
    selectedServerId = s.server_id;

    const newTile = tilesEl.querySelector(`[data-id="${s.id}"]`);
    if (newTile) { newTile.classList.remove("border-transparent"); newTile.classList.add("border-red-500"); }

    const sw = s.x2 - s.x1;
    const sh = s.y2 - s.y1;

    // Scale the detail preview to fit within 160×160 px
    const MAX = 160;
    const ratio = Math.min(MAX / sw, MAX / sh, 3);
    const pw = Math.round(sw * ratio);
    const ph = Math.round(sh * ratio);

    // drawSeedThumbnail(detailCv, sourceImg, s, pw, ph);
    // Fall back to crop of stitched img

    let thumbnailCtx = detailImg.getContext('2d');

    let thumbnailImg = new Image();

    thumbnailImg.onload = function () {
        detailImg.width = thumbnailImg.width;
        detailImg.height = thumbnailImg.height;
        thumbnailCtx.drawImage(thumbnailImg, 0, 0);
    };

    thumbnailImg.src = `/thumbnails/${selectedServerId}.jpg`;

    // drawSeedThumbnail(detailImg, sourceImg, s, sw, sh);

    selectedSeedType.textContent = s.label;
    selectedSeedConfidence.textContent = s.confidence;
    select.value = s.label;

    detailEl.style.display = "flex";
}

function onColSliderInput(e) {
    cols = parseInt(e.target.value, 10);
    container.querySelector('#sg-col-val').textContent = cols;
    scheduleRebuild();
}

function onScaleSliderInput(e) {
    scale = parseFloat(e.target.value);
    container.querySelector('#sg-scale-val').textContent = scale.toFixed(2) + 'x';
    scheduleRebuild();
}

function onSortSelectInput() {
    SORT_TYPE = sortSelect.value;
    rebuildAndRender();
}

function onScroll() {
    if (!rafPending) {
        rafPending = true;
        requestAnimationFrame(() => { render(); rafPending = false; });
    }
}

function scheduleRebuild() {
    if (sliderRafId !== null) return;
    sliderRafId = requestAnimationFrame(() => {
        sliderRafId = null;
        rebuildAndRender();
    });
}

function onChangeBtnClick() {
    display.classList.add('hidden');
    edit.classList.remove('hidden');
    changeBtn.classList.add('hidden');
}

function onUndoBtnClick() {
    display.classList.remove('hidden');
    edit.classList.add('hidden');
    changeBtn.classList.remove('hidden');
}

// port: onSaveBtnClick / onDeleteBtnClick — CHANGE: replace the old
// manualChange(serverId, finalPrediction) body entirely with:
async function onSaveBtnClick() {
    try {
        await applyManualChange(selectedServerId, select.value);
        display.classList.remove('hidden');
        edit.classList.add('hidden');
        changeBtn.classList.remove('hidden');
        // detailEl.style.display = 'none';
    } catch (err) {
        console.error(err);
    }
}

async function onDeleteBtnClick() {
    try {
        await applyManualChange(selectedServerId, 'deleted');
        detailEl.style.display = 'none';
    } catch (err) {
        console.error(err);
    }
}

function gridMarkup() {
    const template = document.getElementById('grid-view-template');
    return template.content.cloneNode(true);
}