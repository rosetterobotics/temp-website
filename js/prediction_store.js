/* Copyright 2026 Rosette Robotics Inc. All rights reserved.
Unauthorized copying, distribution, or commercial use via any medium is strictly prohibited. */

// /js/prediction_store.js

const state = {
    seeds: new Map(),        // server_id (string) -> seed object
    classColors: {},         // className -> hex color
    classVisibility: {},
    showBoxes: true,
    showConfidence: true,
    showLabels: false
};

const listeners = new Set();

/**
 * Called once by the page controller after the initial page load.
 * seedsArray: same shape currently produced by detections_json / seeds_json
 *   { server_id, label, confidence, x1, y1, x2, y2, needs_manual_review }
 * classSettings: array of { name, color } from class_settings_json
 */
export function hydrate(seedsArray, classSettings, config) {
    state.seeds.clear();
    for (const s of seedsArray) {
        state.seeds.set(String(s.server_id), s);
    }

    state.classColors = {};
    state.classVisibility = {};
    for (const cls of classSettings ?? []) {
        state.classColors[cls.name] = cls.color;
        state.classVisibility[cls.name] = true; // visible by default
    }

}

export function getSeed(serverId) {
    return state.seeds.get(String(serverId));
}

export function getAllSeeds() {
    return [...state.seeds.values()];
}

export function getClassColors() {
    return { ...state.classColors };
}

export function setClassColor(className, color) {
    state.classColors[className] = color;
    notify({ type: 'class-color-changed', className, color });
}

export function getClassVisibility() {
    return { ...state.classVisibility };
}

export function isClassVisible(className) {
    return state.classVisibility[className] ?? true;
}

/** Called when the user toggles a class checkbox. */
export function setClassVisibility(className, visible) {
    state.classVisibility[className] = visible;
    notify({ type: 'class-visibility-changed', className, visible });
}

export function getShowBoxes() {
    return state.showBoxes;
}

export function setShowBoxes(showBoxes) {
    console.log('Updated showBoxes to', showBoxes);
    state.showBoxes = showBoxes;
    notify({ type: 'box-visibility-changed'});
}

export function getShowConfidence() {
    return state.showConfidence;
}

export function setShowConfidence(showConfidence) {
    state.showConfidence = showConfidence;
    notify({ type: 'confidence-visibility-changed'});
}

export function getShowLabels() {
    return state.showLabels;
}

export function setShowLabels(showLabels) {
    state.showLabels = showLabels;
    notify({ type: 'label-visibility-changed'});
}

/** class -> count, used by tray's renderClassSettings / class filter UI */
export function getClassFrequencies() {
    const freq = {};
    for (const seed of state.seeds.values()) {
        if (seed.label === 'deleted') continue;
        freq[seed.label] = (freq[seed.label] ?? 0) + 1;
    }
    return freq;
}

export function getThumbnailUrl(serverId) {
    return `${thumbnailUrlBase}${serverId}`;
}

export function subscribe(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

function notify(event) {
    for (const cb of listeners) cb(event);
}

function randomColor() {
    return '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
}

/**
 * The single write path for prediction edits. Replaces
 * manualPredictionChange() (tray) and manualChange() (grid).
 */
export async function applyManualChange(serverId, finalPrediction) {

    const seed = state.seeds.get(String(serverId));
    if (!seed) {
        console.warn('applyManualChange: no seed found for server_id', serverId);
        return null;
    }

    const oldLabel = seed.label;
    seed.label = finalPrediction;
    seed.confidence = 100;

    if (finalPrediction !== 'deleted' && !(finalPrediction in state.classColors)) {
        state.classColors[finalPrediction] = randomColor();
        state.classVisibility[finalPrediction] = true;
    }
    if (oldLabel !== finalPrediction && !Object.keys(getClassFrequencies()).includes(oldLabel)) {
        delete state.classColors[oldLabel];
        delete state.classVisibility[oldLabel]; 
    }

    notify({ type: 'prediction-changed', serverId: String(serverId), seed, oldLabel });
    return seed;
}

export async function createDetection(x1, y1, x2, y2, label) {

    state.seeds.set(String(data.server_id), data);

    if (data.label !== 'deleted' && !(data.label in state.classColors)) {
        state.classColors[data.label] = randomColor();
        state.classVisibility[data.label] = true;
    }

    notify({ type: 'seed-added', serverId: String(data.server_id), seed: data });
    return data;
}

export async function mergeDetections(keep_id, delete_id, merged) {  // merged is {x1, y1, x2, y2}

    const keepSeed = state.seeds.get(String(keep_id));
    if (!keepSeed) {
        console.warn('merge: no seed found for server_id', keep_id);
        return null;
    }

    const deleteSeed = state.seeds.get(String(delete_id));
    if (!deleteSeed) {
        console.warn('merge: no seed found for server_id', delete_id);
        return null;
    }

    // Update kept detection in-place
    Object.assign(keepSeed, merged);

    // Remove the deleted detection from the array
    let oldLabel = deleteSeed.label;
    state.seeds.delete(delete_id);

    if (oldLabel !== keepSeed.label && !Object.keys(getClassFrequencies()).includes(oldLabel)) {
        delete state.classColors[oldLabel];
        delete state.classVisibility[oldLabel];
    }

    notify({type: 'prediction-merge'});
    return keepSeed;
}