/* Copyright 2026 Rosette Robotics Inc. All rights reserved. 
Unauthorized copying, distribution, or commercial use via any medium is strictly prohibited. */


import {subscribe, getClassColors, getClassVisibility, getClassFrequencies,
    getShowBoxes, getShowConfidence, getShowLabels, setShowBoxes,
    setShowConfidence, setShowLabels,
    setClassVisibility, setClassColor} from './prediction_store.js';

let unsubscribeStore = null;
let cleanupFns = [];

let draftVisibility = null;

let visibilitySettingsDiv = null;

let tbody = null;

export async function mount_settings(visibilitySettingsMountPoint, classSettingsMountPoint, config) {

    unsubscribeStore = subscribe(handleStoreEvent);

    visibilitySettingsDiv = visibilitySettingsMountPoint;

    tbody = classSettingsMountPoint; 

    renderVisibilitySettings();
    renderClassSettings();
}

export function unmount() {
    unsubscribeStore?.();
    unsubscribeStore = null;

    cleanupFns.forEach(fn => fn());
    cleanupFns = [];
}

function handleStoreEvent(event) {
    if (event.type === 'box-visibility-changed') {
        renderVisibilitySettings();
    } else if (event.type === 'label-visibility-changed') {
        renderVisibilitySettings();
    } else if (event.type === 'confidence-visibility-changed') {
        renderVisibilitySettings();
    }
}

function addListener(el, evt, fn, opts) {
    el.addEventListener(evt, fn, opts);
    cleanupFns.push(() => el.removeEventListener(evt, fn, opts));
}

const renderVisibilitySettings = function () {
    visibilitySettingsDiv.innerHTML = '';

    // BBOX visibility settings
    const rowBox = document.createElement('div');
    rowBox.classList.add('flex');
    rowBox.classList.add('items-center');
    rowBox.classList.add('justify-between');

    const labelBox = document.createElement('label');
    labelBox.classList.add('flex-1');
    labelBox.classList.add('label-text');
    labelBox.classList.add('font-medium');

    labelBox.textContent = 'Show Boxes';

    const inpBox = document.createElement('input');
    inpBox.type = 'checkbox';
    inpBox.classList.add('flex-none');
    inpBox.classList.add('checkbox');
    inpBox.classList.add('checkbox-xs');
    inpBox.classList.add('checkbox-primary');
    inpBox.checked = getShowBoxes();
    addListener(inpBox, 'input', () => {setShowBoxes(inpBox.checked);})

    rowBox.appendChild(labelBox);
    rowBox.appendChild(inpBox);

    // Labels visibility settings
    const rowLabels = document.createElement('div');
    rowLabels.classList.add('flex');
    rowLabels.classList.add('items-center');
    rowLabels.classList.add('justify-between');

    const labelLabels = document.createElement('label');

    labelLabels.classList.add('flex-1');
    labelLabels.classList.add('label-text');
    labelLabels.classList.add('font-medium');

    labelLabels.textContent = 'Show Labels';

    const inpLabels = document.createElement('input');
    inpLabels.type = 'checkbox';
    inpLabels.classList.add('flex-none');
    inpLabels.classList.add('checkbox');
    inpLabels.classList.add('checkbox-xs');
    inpLabels.classList.add('checkbox-primary');
    inpLabels.checked = getShowLabels();
    addListener(inpLabels, 'input', () => {setShowLabels(inpLabels.checked);})

    rowLabels.appendChild(labelLabels);
    rowLabels.appendChild(inpLabels);

    // Confidence visibility settings
    const rowConf = document.createElement('div');
    rowConf.classList.add('flex');
    rowConf.classList.add('items-center');
    rowConf.classList.add('justify-between');

    const labelConf = document.createElement('label');
    labelConf.classList.add('flex-1');
    labelConf.classList.add('label-text');
    labelConf.classList.add('font-medium');
    labelConf.textContent = 'Show Confidence';

    const inpConf = document.createElement('input');
    inpConf.type = 'checkbox';
    inpConf.classList.add('flex-none');
    inpConf.classList.add('checkbox');
    inpConf.classList.add('checkbox-xs');
    inpConf.classList.add('checkbox-primary');    
    inpConf.checked = getShowConfidence();
    addListener(inpConf, 'input', () => {setShowConfidence(inpConf.checked);})

    rowConf.appendChild(labelConf);
    rowConf.appendChild(inpConf);

    visibilitySettingsDiv.appendChild(rowBox);
    visibilitySettingsDiv.appendChild(rowLabels);
    visibilitySettingsDiv.appendChild(rowConf);

}

const renderClassSettings = function () {
    
    tbody.innerHTML = '';

    for (const className of Object.keys(getClassColors()).sort()) {

        const row = document.createElement('tr');

        // ----- Name cell -----
        const nameTd = document.createElement('td');
        nameTd.classList.add('font-bold');
        nameTd.textContent = className;

        // ----- Checkbox cell -----
        const checkboxTd = document.createElement('td');

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.classList.add('checkbox', 'checkbox-xs', 'class-toggle');
        checkbox.dataset.class = className;
        checkbox.checked = getClassVisibility()[className];

        addListener(checkbox, 'input', () => {setClassVisibility(className, checkbox.checked);});

        checkboxTd.appendChild(checkbox);

        // ----- Color picker cell -----
        const colorTd = document.createElement('td');

        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.classList.add(
            'w-6',
            'h-6',
            'rounded-full',
            'border-none',
            'p-0',
            'cursor-pointer',
            'class-color'
        );

        colorInput.dataset.class = className;
        colorInput.value = getClassColors()[className];

        addListener(colorInput, 'change', () => {
            setClassColor(className, colorInput.value);
        });

        colorTd.appendChild(colorInput);

        // ----- Assemble row -----
        row.appendChild(nameTd);
        row.appendChild(checkboxTd);
        row.appendChild(colorTd);

        tbody.appendChild(row);
    }
};