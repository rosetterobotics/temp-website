/* Copyright 2026 Rosette Robotics Inc. All rights reserved. 
Unauthorized copying, distribution, or commercial use via any medium is strictly prohibited. */


import {subscribe, getClassColors, getClassVisibility, getClassFrequencies} from './prediction_store.js';

let unsubscribeStore = null;

let myPieChart = null;
let myChart = null;

let pc = null;
let bc = null;

let container = null;

let mountPointBarChart = null;
let mountPointPieChart = null;

let cleanupFns = [];

export async function mount(mountPoint, config) {

    container = mountPoint;
    container.innerHTML = '';
    container.appendChild(chartsMarkup());

    unsubscribeStore = subscribe(handleStoreEvent);

    mountPointBarChart = container.querySelector('#bar-chart');
    mountPointPieChart = container.querySelector('#pie-chart');

    bc = mountPointBarChart.getContext('2d');    
    pc = mountPointPieChart.getContext('2d');

    load_figs()
}

export function unmount() {
    unsubscribeStore?.();
    unsubscribeStore = null;

    container = null;
    mountPointBarChart = null;
    mountPointPieChart = null;
    pc = null;
    bc = null;

    cleanupFns.forEach(fn => fn());
    cleanupFns = [];
}

function handleStoreEvent(event) {
    if (event.type === 'prediction-changed') {
        load_figs();
    } else if (event.type === 'seed-added') {
        load_figs();
    } else if (event.type === 'prediction-merge') {
        load_figs();
    }  else if (event.type === 'class-color-changed') {
        load_figs();
    }
}

const load_figs = () => {
    if (myPieChart) {
        myPieChart.destroy();
    }

    if (myChart) {
        myChart.destroy();
    }

    const classFrequencies = getClassFrequencies()

    const classColors = getClassColors();

    const sortedColors = Object.keys(getClassFrequencies())
        .map(className => classColors[className]);
    console.log(sortedColors);

    const chartTextColor = '#e5e7eb';

    const anchorBottomPlugin = {
        id: 'anchorBottom',
        afterLayout(chart) {
            const area = chart.chartArea;
            const size = Math.min(area.right - area.left, area.bottom - area.top);
            // push the usable area down so the circle's vertical center sits near the bottom
            const extra = (area.bottom - area.top) - size;
            area.top += extra;
        }
    };

    const pc_options = {
        events: ['mousemove', 'mouseout', 'click'],
        responsive: true,
        plugins: {
            responsive: true,
            maintainAspectRatio: false,
            legend: {
                labels: {
                    font: {
                        size: 16,
                    },
                    padding: 16,
                    generateLabels: (chart) => {
                        const data = chart.data;
                        if (data.labels.length && data.datasets.length) {
                            const dataset = data.datasets[0];
                            const total = dataset.data.reduce((sum, val) => sum + val, 0);

                            return data.labels.map((label, i) => {
                                const value = dataset.data[i];
                                const percentage = ((value / total) * 100).toFixed(1) + '%';

                                return {
                                    text: `${label}: ${percentage}`,
                                    fillStyle: dataset.backgroundColor[i],
                                    fontColor: chartTextColor,
                                    hidden: chart.getDatasetMeta(0).data[i].hidden,
                                    index: i
                                };
                            });
                        }
                        return [];
                    }
                }
            },
            title: {
                display: true,
                text: 'Pie Chart',
                color: chartTextColor,
                font: {
                    size: 20,
                    weight: 'bold'
                },
                padding: {
                    top: 10,
                    bottom: 30
                }
            },
        }
    };

    myPieChart = new Chart(pc, {
        type: 'pie', // Specifies the chart type
        data: {
            labels: Object.keys(classFrequencies), // Labels for each segment
            datasets: [{
                label: 'Seed Frequencies',
                data: Object.values(classFrequencies), // The numerical values for the slices
                backgroundColor: sortedColors,
                hoverOffset: 4
            }]
        },
        options: pc_options,
        plugins: [anchorBottomPlugin]
    });

    const bc_options = {
        events: ['mousemove', 'mouseout', 'click'],
        responsive: true,
        maintainAspectRatio: false,
        layout: {
            padding: {
                left: 0,
                right: 0
            }
        },
        plugins: {
            responsive: true,
            legend: {
                labels: {
                    font: {
                        size: 16,
                    },
                    padding: 16,
                    generateLabels: (chart) => {
                        const data = chart.data;
                        if (data.labels.length && data.datasets.length) {
                            const dataset = data.datasets[0];
                            const total = dataset.data.reduce((sum, val) => sum + val, 0);

                            return data.labels.map((label, i) => {
                                const value = dataset.data[i];

                                return {
                                    text: `${label}: ${value}`,
                                    fillStyle: dataset.backgroundColor[i],
                                    fontColor: chartTextColor,
                                    hidden: chart.getDatasetMeta(0).data[i].hidden,
                                    index: i
                                };
                            });
                        }
                        return [];
                    }
                }
            },
            title: {
                display: true,
                text: 'Bar Chart',
                color: chartTextColor,
                font: {
                    size: 20,
                    weight: 'bold'
                },
                padding: {
                    top: 10,
                    bottom: 30
                }
            },
        },
        scales: {
            x: {
                ticks: { color: chartTextColor },
                grid: { color: 'rgba(255,255,255,0.1)' }
            },
            y: {
                ticks: { color: chartTextColor },
                grid: { color: 'rgba(255,255,255,0.1)' }
            }
        }
    };

    myChart = new Chart(bc, {
        type: 'bar', // Sets the chart type to bar
        data: {
            labels: Object.keys(classFrequencies), // X-axis labels
            datasets: [{
                label: 'Seed Frequencies',
                data: Object.values(classFrequencies), // Numerical data
                backgroundColor: sortedColors,
                borderWidth: 0
            }]
        },
        options: bc_options
    });

}

function chartsMarkup() {
    const template = document.getElementById('chart-view-template');
    return template.content.cloneNode(true);
}