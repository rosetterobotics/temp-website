/* Copyright 2026 Rosette Robotics Inc. All rights reserved.
Unauthorized copying, distribution, or commercial use via any medium is strictly prohibited. */

// /js/source_image_cache.js

let cachedUrl = null;
let cachedImg = null;
let inflight = null;

/**
 * Returns a decoded HTMLImageElement for the given URL. Decodes once;
 * subsequent calls (from either view, in the same session) return the
 * same element instead of re-fetching/re-decoding.
 */
export async function getSourceImage(url) {
    if (cachedUrl === url && cachedImg) {
        return cachedImg;
    }

    // If a decode for this exact URL is already underway, piggyback on it
    // instead of starting a second decode.
    if (inflight && cachedUrl === url) {
        return inflight;
    }

    cachedUrl = url;
    inflight = (async () => {
        const img = new Image();
        img.src = url;
        try {
            await img.decode();
        } catch (e) {
            cachedUrl = null;
            inflight = null;
            throw e;
        }
        cachedImg = img;
        inflight = null;
        return img;
    })();

    return inflight;
}

/** Call when navigating away from the results page entirely. */
export function releaseSourceImage() {
    cachedUrl = null;
    cachedImg = null;
    inflight = null;
}