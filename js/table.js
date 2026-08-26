/* Copyright 2026 Rosette Robotics Inc. All rights reserved. 
Unauthorized copying, distribution, or commercial use via any medium is strictly prohibited. */


import {subscribe, getClassColors, getClassVisibility, getClassFrequencies, getAllSeeds} from './prediction_store.js';

let unsubscribeStore = null;

let tableContainer = null;

let container = null;

let cleanupFns = [];

export async function mount(mountPoint, config) {

    container = mountPoint;
    container.innerHTML = '';
    container.appendChild(tableMarkup());

    unsubscribeStore = subscribe(handleStoreEvent);

    tableContainer = container.querySelector('#table-container');

    renderSeedTable();
}


export function unmount() {
    unsubscribeStore?.();
    unsubscribeStore = null;

    tableContainer = null;
    container = null;

    cleanupFns.forEach(fn => fn());
    cleanupFns = [];
}

function handleStoreEvent(event) {
    if (event.type === 'prediction-changed') {
        renderSeedTable();
    } else if (event.type === 'seed-added') {
        renderSeedTable();
    } else if (event.type === 'prediction-merge') {
        renderSeedTable();
    }
}

const renderSeedTable = function() {
    const frequencies = getClassFrequencies();
    const total = getAllSeeds().length;

    const rows = Object.entries(frequencies)
        .map(([label, count]) => ({ label, count, proportion: total > 0 ? count / total : 0 }))
        .sort((a, b) => b.count - a.count);

    const rowsHtml = rows.map(row => `
                <tr class="border-b border-white/10">
                    <td class="px-4 py-2">${row.label}</td>
                    <td class="px-4 py-2 text-right">${row.count.toLocaleString()}</td>
                    <td class="px-4 py-2 text-right text-l">${(row.proportion * 100).toFixed(1)}%</td>
                </tr>
            `).join('');

    tableContainer.innerHTML = `
                <table class="w-full text-l border-collapse">
                    <thead>
                        <tr class="border-b-2 border-white/30">
                            <th class="px-4 py-2 text-left font-bold">Seed Type</th>
                            <th class="px-4 py-2 text-right font-bold">Count</th>
                            <th class="px-4 py-2 text-right font-bold">Proportion</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                    <tfoot>
                        <tr class="border-t-2 border-white/30 font-bold">
                            <td class="px-4 py-2">Total</td>
                            <td class="px-4 py-2 text-right">${total.toLocaleString()}</td>
                            <td class="px-4 py-2 text-right">100.0%</td>
                        </tr>
                    </tfoot>
                </table>
            `;
}

function tableMarkup() {
    const template = document.getElementById('table-view-template');
    return template.content.cloneNode(true);
}