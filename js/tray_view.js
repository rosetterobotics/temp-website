/* Copyright 2026 Rosette Robotics Inc. All rights reserved. 
Unauthorized copying, distribution, or commercial use via any medium is strictly prohibited. */

// static/js/tray_view.js
import { getAllSeeds, subscribe, applyManualChange, createDetection,
         getClassColors, getClassVisibility, setClassVisibility,
         isClassVisible, getThumbnailUrl, mergeDetections,
         getShowBoxes,
         getShowLabels,
         getShowConfidence} from './prediction_store.js';
import { getSourceImage } from './source_image_cache.js';

let container = null;
let cleanupFns = [];
let unsubscribeStore = null;

let stage = null;
let stageContainer = null;
let imageLayer = null;
let hoverLayer = null;
let overlayCanvas = null;
let overlayCtx = null;

let displayScale = 1;
let displayedImageWidth = 0;
let displayedImageHeight = 0;
let hoveredDet = null;
let originalWidth = null;
let originalHeight = null;

let sourceImg = null;
let det_list_page = 1;
let det_list_items_per_page = 100;
let pagination_footer = null;
let isPanning = false;
let lastPointerPos = null;
let currentModalServerId = null; // was implicit via closures in openModal()

// Create vars
let createAnchor = null;
let createRafId = null;

// Merge vars
let mergeFirst = null;  // first detection selected for merge
let mergeSecond = null;

let allSeedTypes = [];
let seedClasses = [];
let lastChosenSeedType = null;
let lastChosenSeedClass = null;

let csrftoken = null;

const MIN_SCALE = 0.1, MAX_SCALE = 10, ZOOM_SENSITIVITY = 1.1;

// DOM refs assigned in mount()
let viewerEl, listEl, prevPageBtn, nextPageBtn, pageIndicator,
    resetZoomBtn, applyBtn, classSettingsBody, modeSelector;

export async function mount(mountPoint, config) {
    container = mountPoint;
    container.innerHTML = '';
    container.appendChild(trayMarkup());

    csrftoken = config.csrftoken;

    viewerEl = container.querySelector('#viewer');
    stageContainer = viewerEl;
    console.log('stageContainer size:', stageContainer.clientWidth, stageContainer.clientHeight);
    listEl = container.querySelector('#prediction-list');
    prevPageBtn = container.querySelector('#prev-page-btn');
    nextPageBtn = container.querySelector('#next-page-btn');
    pageIndicator = container.querySelector('#page-indicator');
    // resetZoomBtn = container.querySelector('#reset-zoom-btn');
    // applyBtn = container.querySelector('#apply-btn');
    classSettingsBody = container.querySelector('#class-settings-body');
    modeSelector = container.querySelector('#mode-selector');

    det_list_page = 1;
    isPanning = false;

    unsubscribeStore = subscribe(handleStoreEvent);

    originalWidth = config.originalWidth;
    originalHeight = config.originalHeight;

    allSeedTypes = config.allSeedTypes;
    seedClasses = config.seedClasses;
    lastChosenSeedType = null;

    // --- image via shared cache ---
    sourceImg = await getSourceImage(config.imageUrl);

    stage = new Konva.Stage({
        container: stageContainer,   // was 'viewer' by ID string — pass the
        // element itself since it's not
        // guaranteed unique in the DOM anymore
        width: stageContainer.clientWidth,
        height: stageContainer.clientHeight,
        preventDefault: false,
    });

    imageLayer = new Konva.Layer({ listening: false });
    hoverLayer = new Konva.Layer({ listening: false });
    stage.add(imageLayer);
    stage.add(hoverLayer);

    overlayCanvas = document.createElement('canvas');
    overlayCanvas.style.position = 'absolute';
    overlayCanvas.style.top = '0';
    overlayCanvas.style.left = '0';
    overlayCanvas.style.pointerEvents = 'none';
    stageContainer.style.position = 'relative';
    stageContainer.appendChild(overlayCanvas);
    overlayCtx = overlayCanvas.getContext('2d');

    const scaleX = stageContainer.clientWidth / config.originalWidth;
    const scaleY = stageContainer.clientHeight / config.originalHeight;

    createAnchor = null;
    createRafId = null;

    drawImage();       // draws sourceImg into imageLayer
    console.log('drew image');
    resizeOverlayCanvas();
    render();          // initial overlay draw
    console.log('rendered');

    // --- listeners: same events, now tracked for cleanup ---
    addListener(stageContainer, 'wheel', onWheel, { passive: false });
    addListener(stageContainer, 'mousedown', onMouseDown);
    addListener(window, 'mousemove', onMouseMove);
    addListener(window, 'mouseup', onMouseUp);
    addListener(stageContainer, 'contextmenu', e => e.preventDefault());
    // addListener(resetZoomBtn, 'click', resetView);
    addListener(prevPageBtn, 'click', onPrevPage);
    addListener(nextPageBtn, 'click', onNextPage);
    // addListener(applyBtn, 'click', onApplyFilters);

    addListener(stageContainer, 'mousemove', onStageMouseMove);
    addListener(stageContainer, 'click', onStageClick);
    // radio mode selector, class toggle checkboxes, etc. same pattern

    renderPredictionsList(det_list_page, det_list_items_per_page);

    const resizeObserver = new ResizeObserver(() => {
        const width = stageContainer.clientWidth;
        const height = stageContainer.clientHeight;
        stage.width(width);
        stage.height(height);

        stage.position({
            x: 0,
            y: 0,
        });

        resizeOverlayCanvas();
        redrawOverlay();
    });
    resizeObserver.observe(stageContainer);
}

export function unmount() {
    unsubscribeStore?.();
    unsubscribeStore = null;

    cleanupFns.forEach(fn => fn());
    cleanupFns = [];

    if (createRafId) cancelAnimationFrame(createRafId);
    createAnchor = null;
    createRafId = null;

    stage?.destroy(); // Konva's own teardown — frees internal canvas layers
    stage = null;
    sourceImg = null;

    if (container) container.innerHTML = '';
    container = null;
    currentModalServerId = null;
    isPanning = false;
}

function addListener(el, evt, fn, opts) {
    el.addEventListener(evt, fn, opts);
    cleanupFns.push(() => el.removeEventListener(evt, fn, opts));
}

function handleStoreEvent(event) {
    if (event.type === 'prediction-changed') {
        render();
        renderPredictionsList(det_list_page, det_list_items_per_page);
    } else if (event.type === 'seed-added') {
        render();
        renderPredictionsList(det_list_page, det_list_items_per_page);
    } else if (event.type === 'prediction-merge') {
        render();
        renderPredictionsList(det_list_page, det_list_items_per_page);
    } else if (event.type === 'box-visibility-changed') {
        render();
    } else if (event.type === 'label-visibility-changed') {
        render();
    } else if (event.type === 'confidence-visibility-changed') {
        render();
    } else if (event.type === 'class-color-changed') {
        render();
    } else if (event.type === 'class-visibility-changed') {
        render();
    }
}

function getMode() {
    const el = document.querySelector('input[name="viewer_mode"]:checked');
    return el ? el.value : 'pan';
}

function openModal(title, detection_server_id) {
    const modal = document.getElementById("imageModal");
    const modalTitle = document.getElementById("modalTitle");
    const modalImg = document.getElementById("modalImage");
    const changeBtn = document.getElementById("change-prediction-btn");
    const undoBtn = document.getElementById("undo-prediction-btn");

    currentModalServerId = detection_server_id;

    const nextBtn = document.getElementById("next-btn");

    const newNextBtn = nextBtn.cloneNode(true);
    nextBtn.parentNode.replaceChild(newNextBtn, nextBtn);

    const deleteBtn = document.getElementById('delete-prediction-btn')
    const newDelBtn = deleteBtn.cloneNode(true);
    deleteBtn.parentNode.replaceChild(newDelBtn, deleteBtn);

    const edit = document.getElementById("prediction-edit");

    const select = document.getElementById("prediction-select");

    // 1. Set title and clear previous image/show placeholder
    modalTitle.textContent = title;
    modalImg.src = ""; // Clear old image
    modalImg.classList.add('opacity-0'); // Hide until loaded for a smooth fade-in
    edit.classList.add("hidden");
    changeBtn.classList.remove("hidden");
    newNextBtn.textContent = 'Verify & Next';
    newNextBtn.classList.add("hidden");
    select.value = "";

    changeBtn.addEventListener("click", () => {
        edit.classList.remove("hidden");
        changeBtn.classList.add("hidden");
        newNextBtn.classList.remove("hidden");
        newNextBtn.textContent = 'Save & Next';
    });

    undoBtn.addEventListener("click", () => {
        edit.classList.add("hidden");
        changeBtn.classList.remove("hidden");
        newNextBtn.textContent = 'Verify & Next';
        newNextBtn.classList.add("hidden");
        select.value = "";
    });

    newNextBtn.addEventListener('click', async () => {
        await applyManualChange(currentModalServerId, select.value)
        modal.close();
    })

    newDelBtn.addEventListener('click', async () => {
        await applyManualChange(currentModalServerId, 'deleted')
        modal.close();
    })

    // 2. Open modal immediately so the user knows something is happening
    modal.showModal();

  
    modalImg.src = `/thumbnails/${detection_server_id}.jpg`;
    modalImg.onload = () => {
        modalImg.classList.remove('opacity-0');
        modalImg.classList.add('opacity-100');
    }
}

function resizeOverlayCanvas() {
    const width = stage.width();
    const height = stage.height();

    overlayCanvas.width = width;
    overlayCanvas.height = height;
    overlayCanvas.style.width = width + 'px';
    overlayCanvas.style.height = height + 'px';
}

function drawLabel(ctx, det, x, y, color, fontSize, stageScale) {
    const text = getShowConfidence()
        ? `${det.label} (${det.confidence.toFixed(1)}%)`
        : det.label;
    const padding = 4 / stageScale;
    const bgH = fontSize + padding * 2;

    ctx.font = `bold ${fontSize}px sans-serif`;
    const textWidth = ctx.measureText(text).width;

    ctx.fillStyle = color;
    ctx.globalAlpha = 0.75;
    ctx.fillRect(x, y - bgH, textWidth + padding * 2, bgH);
    ctx.globalAlpha = 1;

    ctx.fillStyle = 'white';
    ctx.fillText(text, x + padding, y - padding);
}

function redrawOverlay() {
    resizeOverlayCanvas();
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    const stageScale = stage.scaleX();
    const stageX = stage.x();
    const stageY = stage.y();

    overlayCtx.save();
    overlayCtx.translate(stageX, stageY);
    overlayCtx.scale(stageScale, stageScale);

    for (const det of getAllSeeds()) {
        if (!shouldShow(det)) continue;

        const x = det.x1 * displayScale;
        const y = det.y1 * displayScale;
        const w = (det.x2 - det.x1) * displayScale;
        const h = (det.y2 - det.y1) * displayScale;

        // Convert this box to screen space to test against the visible canvas
        const screenX = x * stageScale + stageX;
        const screenY = y * stageScale + stageY;
        const screenW = w * stageScale;
        const screenH = h * stageScale;

        const isVisible =
            screenX + screenW >= 0 &&
            screenY + screenH >= 0 &&
            screenX <= overlayCanvas.width &&
            screenY <= overlayCanvas.height;

        if (!isVisible) continue;

        const color = getColor(det);

        overlayCtx.strokeStyle = color;
        overlayCtx.lineWidth = 2 / stageScale;
        overlayCtx.strokeRect(x, y, w, h);

        if (getShowLabels()) {
            drawLabel(overlayCtx, det, x, y, color, 14 / stageScale, stageScale);
        }
    }

    overlayCtx.restore();
}

function shouldShow(det) {
    if (det.label === 'deleted') return false;
    if (!getShowBoxes()) return false;
    if (!getClassVisibility()[det.label]) return false;
    return true;
}

function getColor(det) {
    return getClassColors()[det.label] || '#00FF00';
}

function onDetectionClick(det) {
    if (getMode() == 'review' && is_home) {

    } else if (getMode() == 'pan') {
        openModal(`${det.label}: ${det.confidence}`, det.server_id);
    }
}

function onDetectionHover(det, entering) {
    hoverLayer.destroyChildren();

    // Always redraw the merge-first highlight underneath hover content
    if (getMode() === 'merge' && mergeFirst) {
        const stageScale = stage.scaleX();
        const color = getColor(mergeFirst);
        hoverLayer.add(new Konva.Rect({
            x: mergeFirst.x1 * displayScale,
            y: mergeFirst.y1 * displayScale,
            width: (mergeFirst.x2 - mergeFirst.x1) * displayScale,
            height: (mergeFirst.y2 - mergeFirst.y1) * displayScale,
            stroke: color,
            strokeWidth: 3 / stageScale,
            dash: [8 / stageScale, 4 / stageScale],
            shadowColor: color,
            shadowBlur: 8 / stageScale,
            shadowOpacity: 0.9,
            listening: false,
        }));
    }

    if (!entering) {
        hoveredDet = null;
        hoverLayer.batchDraw();
        return;
    }

    hoveredDet = det;
    const stageScale = stage.scaleX();
    const x = det.x1 * displayScale;
    const y = det.y1 * displayScale;
    const w = (det.x2 - det.x1) * displayScale;
    const h = (det.y2 - det.y1) * displayScale;
    const color = getColor(det);
    const strokeWidth = 1 / stageScale;
    const fontSize = 14 / stageScale;
    const padding = 4 / stageScale;
    const bgH = fontSize + padding * 2;
    const text = getShowConfidence()
        ? `${det.label} (${det.confidence.toFixed(1)}%)`
        : det.label;
    const bgW = text.length * (fontSize * 0.6) + padding * 2;

    hoverLayer.add(new Konva.Rect({
        x, y, width: w, height: h,
        stroke: color,
        strokeWidth,
        shadowColor: color,
        shadowBlur: 6 / stageScale,
        shadowOpacity: 0.8,
        fill: color,
        opacity: 0.08,
        listening: false,
        perfectDrawEnabled: false,
    }));

    hoverLayer.add(new Konva.Rect({
        x, y: y - bgH,
        width: bgW, height: bgH,
        fill: color, opacity: 0.85,
        listening: false, perfectDrawEnabled: false,
    }));

    hoverLayer.add(new Konva.Text({
        x: x + padding, y: y - bgH + padding,
        text, fontSize,
        fill: 'white',
        listening: false, perfectDrawEnabled: false,
    }));

    hoverLayer.batchDraw();
}

function render() {
    redrawOverlay();
}

function drawImage() {
    const containerWidth  = stageContainer.clientWidth;
    const containerHeight = stageContainer.clientHeight;  
    const scaleX = containerWidth  / originalWidth;        
    const scaleY = containerHeight / originalHeight;       

    displayScale = Math.min(scaleX, scaleY);
    displayedImageWidth  = originalWidth  * displayScale;
    displayedImageHeight = originalHeight * displayScale;  

    // Stage fills the whole container, not just the image
    stage.width(containerWidth);
    stage.height(containerHeight);

    const konvaImage = new Konva.Image({
        image: sourceImg,           
        x: 0, y: 0,
        width:  displayedImageWidth,
        height: displayedImageHeight,
        listening: false,
    });

    imageLayer.destroyChildren();
    imageLayer.add(konvaImage);
    imageLayer.draw();
}

// CREATE MODE 

function toImageSpace(e) {
    const rect = stageContainer.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left - stage.x()) / stage.scaleX();
    const mouseY = (e.clientY - rect.top - stage.y()) / stage.scaleX();
    return {
        x: mouseX / displayScale,
        y: mouseY / displayScale,
    };
}

function drawCreatePreview(anchor, current) {
    hoverLayer.destroyChildren();
    const stageScale = stage.scaleX();
    const x1 = Math.min(anchor.x, current.x) * displayScale;
    const y1 = Math.min(anchor.y, current.y) * displayScale;
    const x2 = Math.max(anchor.x, current.x) * displayScale;
    const y2 = Math.max(anchor.y, current.y) * displayScale;

    hoverLayer.add(new Konva.Rect({
        x: x1, y: y1,
        width: x2 - x1,
        height: y2 - y1,
        stroke: '#FFFFFF',
        strokeWidth: 2 / stageScale,
        dash: [6 / stageScale, 3 / stageScale],
        fill: 'rgba(255,255,255,0.08)',
        listening: false,
    }));
    hoverLayer.batchDraw();
}
function openLabelPickerModal(x1, y1, x2, y2, e) {
    const modal = container.querySelector('#labelPickerModal');       
    const select = container.querySelector('#labelPickerSelect');    
    const confirm = container.querySelector('#labelPickerConfirm');   
    const cancel = container.querySelector('#labelPickerCancel');    
    const classSelect = container.querySelector('#classPickerSelect');


    classSelect.innerHTML = '';
    for (const seedClass of seedClasses) {
        const opt = document.createElement('option');
        opt.value = seedClass.id;
        opt.textContent = seedClass.class;
        classSelect.appendChild(opt);
    }

    if (lastChosenSeedClass) {
        classSelect.value = lastChosenSeedClass;
    }

    let build_select = () => {
        select.innerHTML = '';
        for (const seed_type of allSeedTypes) {
            if (seed_type.class == classSelect.value){ 
                const opt = document.createElement('option');
            opt.value = seed_type.common_name;
            opt.textContent = `${seed_type.common_name} | ${seed_type.scientific_name}`;
            select.appendChild(opt);
            }
        }

        if (lastChosenSeedType) {
            select.value = lastChosenSeedType;
        }
    }

    addListener(classSelect, 'input', build_select);

    build_select();

    const newConfirm = confirm.cloneNode(true);
    const newCancel = cancel.cloneNode(true);
    confirm.parentNode.replaceChild(newConfirm, confirm);
    cancel.parentNode.replaceChild(newCancel, cancel);

    newConfirm.addEventListener('click', async () => {
        const label = select.value;
        if (!label) return;
        modal.close();
        lastChosenSeedClass = classSelect.value;
        lastChosenSeedType = label;
        await submitNewDetection(x1, y1, x2, y2, label); 
    });

    newCancel.addEventListener('click', () => {
        modal.close();
        hoverLayer.destroyChildren();
        hoverLayer.batchDraw();
    });

    modal.style.position = 'fixed';
    modal.style.margin = '0';
    modal.showModal();

    const OFFSET = 12;
    const mw = modal.offsetWidth;
    const mh = modal.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = e.clientX + OFFSET;
    let top = e.clientY + OFFSET;

    if (left + mw > vw) left = e.clientX - mw - OFFSET;
    if (top + mh > vh) top = e.clientY - mh - OFFSET;

    modal.style.left = `${left}px`;
    modal.style.top = `${top}px`;
}

async function submitNewDetection(x1, y1, x2, y2, label) {
    try {
        await createDetection(x1, y1, x2, y2, label);
        
        renderPredictionsList(det_list_page, det_list_items_per_page);
    } catch (err) {
        console.error('Create detection error:', err);
    } finally {
        hoverLayer.destroyChildren();
        hoverLayer.batchDraw();
        redrawOverlay();
    }
}

function clearMergeState() {
    mergeFirst = null;
    mergeSecond = null;
    redrawMergeHighlight();
}

function redrawMergeHighlight() {
    // Re-use hoverLayer to show the first selected box in merge mode
    if (getMode() !== 'merge') return;
    hoverLayer.destroyChildren();
    if (!mergeFirst) { hoverLayer.batchDraw(); return; }

    const stageScale = stage.scaleX();
    const color = getColor(mergeFirst);
    hoverLayer.add(new Konva.Rect({
        x: mergeFirst.x1 * displayScale,
        y: mergeFirst.y1 * displayScale,
        width: (mergeFirst.x2 - mergeFirst.x1) * displayScale,
        height: (mergeFirst.y2 - mergeFirst.y1) * displayScale,
        stroke: color,
        strokeWidth: 3 / stageScale,
        dash: [8 / stageScale, 4 / stageScale],
        shadowColor: color,
        shadowBlur: 8 / stageScale,
        shadowOpacity: 0.9,
        listening: false,
    }));
    hoverLayer.batchDraw();
}

async function handleMergeClick(det) {
    console.log(det);
    if (!mergeFirst) {
        mergeFirst = det;
        redrawMergeHighlight();
        return;
    }

    if (mergeFirst === det) {
        // Clicking the same box deselects
        clearMergeState();
        return;
    }

    mergeSecond = det;
    console.log('second', mergeSecond);
    const merged = {
        x1: Math.min(mergeFirst.x1, mergeSecond.x1),
        y1: Math.min(mergeFirst.y1, mergeSecond.y1),
        x2: Math.max(mergeFirst.x2, mergeSecond.x2),
        y2: Math.max(mergeFirst.y2, mergeSecond.y2),
    };

    try {
        await mergeDetections(mergeFirst.server_id, mergeSecond.server_id, merged);
    } catch (err) {
        console.error('Merge error:', err);
    } finally {
        clearMergeState();
        redrawOverlay();
    }
}

// ZOOM / PAN CODE

function getClampedScale(newScale) {
    return Math.min(Math.max(newScale, MIN_SCALE), MAX_SCALE);
}

function zoomToPoint(pointX, pointY, direction) {
    const oldScale = stage.scaleX();
    const newScale = getClampedScale(
        direction > 0 ? oldScale * ZOOM_SENSITIVITY : oldScale / ZOOM_SENSITIVITY
    );
    const mousePointTo = {
        x: (pointX - stage.x()) / oldScale,
        y: (pointY - stage.y()) / oldScale,
    };
    stage.scale({ x: newScale, y: newScale });
    stage.position({
        x: pointX - mousePointTo.x * newScale,
        y: pointY - mousePointTo.y * newScale,
    });
    stage.batchDraw();
    redrawOverlay();
    updateZoomLabel(newScale);
}

function resetView() {
    stage.scale({ x: 1, y: 1 });
    stage.position({ x: 0, y: 0 });
    stage.batchDraw();
    redrawOverlay();
    updateZoomLabel(1);
}

function updateZoomLabel(scale) {
    // document.getElementById('zoom-level-display').textContent = `${Math.round(scale * 100)}%`;
}

function onWheel(e) {
    e.preventDefault();
    const rect = stageContainer.getBoundingClientRect();
    zoomToPoint(e.clientX - rect.left, e.clientY - rect.top, -e.deltaY);
}

function onMouseDown(e) {
    if (e.button !== 2) return;
    isPanning = true;
    lastPointerPos = { x: e.clientX, y: e.clientY };
    stageContainer.style.cursor = 'grabbing';
}

function onMouseMove(e) {
    if (!isPanning) return;
    stage.position({
        x: stage.x() + (e.clientX - lastPointerPos.x),
        y: stage.y() + (e.clientY - lastPointerPos.y),
    });
    stage.batchDraw();
    redrawOverlay();
    lastPointerPos = { x: e.clientX, y: e.clientY };
}

function onMouseUp(e) {
    if (e.button !== 2 || !isPanning) return;
    isPanning = false;
    stageContainer.style.cursor = 'default';
}

function onStageMouseMove(e) {
    const mode = getMode();

    if (mode === 'create' && createAnchor) {
        const cur = toImageSpace(e);
        cancelAnimationFrame(createRafId);
        createRafId = requestAnimationFrame(() => drawCreatePreview(createAnchor, cur));
        return;
    }

    if (isPanning) return;

    const rect = stageContainer.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left - stage.x()) / stage.scaleX();
    const mouseY = (e.clientY - rect.top - stage.y()) / stage.scaleX();

    const hit = getAllSeeds().find(det =>          // was imageData.detections
        shouldShow(det) &&
        mouseX >= det.x1 * displayScale && mouseX <= det.x2 * displayScale &&
        mouseY >= det.y1 * displayScale && mouseY <= det.y2 * displayScale
    );

    if (hit !== hoveredDet) {
        if (hoveredDet) onDetectionHover(hoveredDet, false);
        if (hit) onDetectionHover(hit, true);
        hoveredDet = hit ?? null;
    }
}

function onStageClick(e) {
    if (e.button !== 0) return;
    const mode = getMode();

    const rect = stageContainer.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left - stage.x()) / stage.scaleX();
    const mouseY = (e.clientY - rect.top - stage.y()) / stage.scaleX();

    if (mode === 'create') {
        const pos = toImageSpace(e);

        if (!createAnchor) {
            createAnchor = pos;
            drawCreatePreview(pos, pos);
        } else {
            const x1 = Math.round(Math.min(createAnchor.x, pos.x));
            const y1 = Math.round(Math.min(createAnchor.y, pos.y));
            const x2 = Math.round(Math.max(createAnchor.x, pos.x));
            const y2 = Math.round(Math.max(createAnchor.y, pos.y));
            createAnchor = null;

            if (x2 - x1 < 5 || y2 - y1 < 5) {
                hoverLayer.destroyChildren();
                hoverLayer.batchDraw();
                return;
            }

            openLabelPickerModal(x1, y1, x2, y2, e);
        }
        return;
    }

    const hit = getAllSeeds().find(det =>          // was imageData.detections
        shouldShow(det) &&
        mouseX >= det.x1 * displayScale && mouseX <= det.x2 * displayScale &&
        mouseY >= det.y1 * displayScale && mouseY <= det.y2 * displayScale
    );
    if (!hit) return;

    if (mode === 'merge') {
        handleMergeClick(hit);
    } else if (mode === 'review' || mode === 'pan') {
        onDetectionClick(hit);
    }
}

// DETECTIONS LIST CODE:

const renderPredictionsList = function (page, dets_per_page) {
    // wipe whats in the list rn
    listEl.innerHTML = '';

    const sortedDetections = getAllSeeds()
        .sort((a, b) => a.confidence - b.confidence); // increasing order

    // edit pagination footer:
    pagination_footer = viewerEl = container.querySelector('#page-indicator');
    pagination_footer.textContent = `Page ${page} of ${Math.trunc(sortedDetections.length / dets_per_page) + 1}`

    let start = (page - 1) * dets_per_page
    for (let i = start; i < Math.min(start + dets_per_page, sortedDetections.length); ++i) {

        let det = sortedDetections[i]

        const li = document.createElement('li');
        li.className = `
                    flex items-stretch bg-base-100 rounded-lg shadow-sm border border-transparent
                    hover:border-primary overflow-hidden transition-all
                `;

        const mainDiv = document.createElement('div');
        mainDiv.className = `
                    flex-1 p-3 cursor-pointer text-sm font-medium hover:bg-base-200
                `;

        const title = document.createElement('span');
        title.className = 'text-primary font-bold';
        title.textContent = det.label;

        const confidence = document.createElement('span');
        confidence.className = 'block text-xs opacity-60';
        confidence.textContent = `${Math.round(det.confidence)}% Confidence`;

        mainDiv.appendChild(title);
        mainDiv.appendChild(confidence);

        const btn = document.createElement('button');
        btn.className = `
                    btn btn-ghost rounded-none border-l border-base-300 px-3
                    hover:bg-primary hover:text-white
                `;

        btn.textContent = 'View';

        btn.addEventListener('click', () => {
            openModal(
                `${det.label}: ${det.confidence}`,
                det.server_id
            );
        });

        // ----- assemble -----
        li.appendChild(mainDiv);
        li.appendChild(btn);

        listEl.appendChild(li);
    }
};

function onPrevPage() {
    det_list_page = Math.max(det_list_page - 1, 1)
    renderPredictionsList(det_list_page, det_list_items_per_page);
}
function onNextPage() {
    det_list_page = Math.min(det_list_page + 1, Math.trunc(getAllSeeds().length / det_list_items_per_page) + 1)
    renderPredictionsList(det_list_page, det_list_items_per_page);
}
function onApplyFilters() {

}

function trayMarkup() {
    const template = document.getElementById('tray-view-template');
    return template.content.cloneNode(true);
}