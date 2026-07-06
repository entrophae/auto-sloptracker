// ==UserScript==
// @name         auto-sloptracker
// @namespace    http://tampermonkey.net/
// @author       In work with Gemini AI
// @version      1.2
// @description  checks if spotify tracks on the current site ar ai-generated using sloptracker
// @match        https://open.spotify.com/*
// @match        https://sloptracker.org/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_openInTab
// @grant        unsafeWindow
// @connect      sloptracker.org
// @run-at       document-start
// @icon         https://www.google.com/s2/favicons?sz=64&domain=spotify.com
// @downloadURL https://update.greasyfork.org/scripts/585192/auto-sloptracker.user.js
// @updateURL https://update.greasyfork.org/scripts/585192/auto-sloptracker.meta.js
// ==/UserScript==

/* // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // //
// This code uses the search from sloptracker.org in a loop for the tracks found on the current site  //
// All props go to sloptracker.org                                                                    //
// // How the AI audio analysis works                                                                 //
// //                                                                                                 //
// // Spectral analysis: Examines the frequency spectrum of the audio to find                         //
// //                    patterns characteristic of AI generation vs. human performance.              //
// // Temporal analysis: Analyzes timing patterns, micro-variations, and rhythmic characteristics     //
// //                    that differ between human and AI audio.                                      //
// // Combined prediction: Classifies the track as Human Made, Processed AI, or Pure AI.              //
// // Pure AI detection has 99.9%+ accuracy. Processed or mastered AI audio is harder to detect.      //
// //                                                                                                 //
// // Important: This tool is not perfect. Third-party mastering and processing can affect results.   //
// //            Use this as one data point — not as a final judgment.                                //
// //            We never want real musicians to be wrongly labeled.                                  //
// // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // // */

(function() {
    'use strict';

    const style = `
        .slop-btn-injected {
            background: #1db954;
            color: #000;
            border: none;
            border-radius: 20px;
            padding: 8px 16px;
            font-weight: bold;
            cursor: pointer;
            margin-left: 16px;
        }
        .slop-btn-injected:disabled {
            background: #15873e;
            cursor: not-allowed;
        }
        .slop-badge {
            font-size: 12px;
            margin-left: 8px;
            white-space: nowrap;
            cursor: help;
            padding: 2px 6px;
            border-radius: 4px;
            font-weight: bold;
        }
        .slop-badge-pending {
            background-color: #535353;
            color: #ffffff;
        }
        .slop-badge-ai {
            background-color: #e91429;
            color: #ffffff;
        }
        .slop-badge-human {
            background-color: #1db954;
            color: #000000;
        }
        .slop-badge-error {
            background-color: #8c8c8c;
            color: #ffffff;
        }
        .slop-badge-queued {
            background-color: #e5a50a;
            color: #000000;
        }
        .slop-toast {
            position: fixed;
            bottom: 10%;
            left: 50%;
            transform: translate(-50%, 10%);
            background: #121212;
            color: #fff;
            padding: 14px 24px;
            border: 2px solid #1db954;
            border-radius: 8px;
            z-index: 999999;
            font-family: sans-serif;
            font-size: 14px;
            font-weight: bold;
            box-shadow: 0 20px 50px rgba(0,0,0,0.8);
            text-align: center;
            white-space: pre-line;
            transition: opacity 0.3s ease;
            pointer-events: none;
        }
    `;

    // SLOPTRACKER HASH UPDATER
    function updateStatus(message) {
        document.getElementById('slop-status').innerText = message;
    }
    if (window.location.hostname === 'sloptracker.org') {

        if (!window.location.search.includes('_ext=1')) {
            return;
        }

        const win = unsafeWindow;
        const originalFetch = win.fetch;
        win.fetch = async function(...args) {
            let reqMethod = 'GET';
            let headersObj = {};
            let reqUrl = '';

            if (args[0] instanceof Request) {
                reqMethod = args[0].method;
                reqUrl = args[0].url;
                args[0].headers.forEach((value, key) => { headersObj[key.toLowerCase()] = value; });
            } else {
                reqUrl = typeof args[0] === 'string' ? args[0] : '';
            }

            const requestOptions = args[1] || {};
            if (requestOptions.method) reqMethod = requestOptions.method;

            if (requestOptions.headers instanceof Headers) {
                requestOptions.headers.forEach((value, key) => { headersObj[key.toLowerCase()] = value; });
            } else if (requestOptions.headers) {
                Object.entries(requestOptions.headers).forEach(([k, v]) => { headersObj[k.toLowerCase()] = v; });
            }

            if (reqMethod.toUpperCase() === 'POST' && (headersObj['next-action'] || reqUrl.includes('_ext=1'))) {
                const nextActionHash = headersObj['next-action'];
                if (nextActionHash) {
                    console.log('--- Extracted hash from Fetch ---', nextActionHash);
                    updateStatus("Hash Found: " + nextActionHash);

                    GM_setValue('slop_hash_value', nextActionHash);
                    GM_setValue('slop_hash_timestamp', Date.now());
                    setTimeout(() => win.close(), 500);

                    return Promise.resolve(new Response(
                        "0:[]",
                        { status: 200, headers: new Headers({'content-type': 'text/x-component'}) }
                    ));
                }
            }
            return originalFetch.apply(this, args);
        };

        window.addEventListener('DOMContentLoaded', () => {
            // Create the overlay like this, cause the website does not allow injecting css GM_add_style
            const overlay = document.createElement('div');
            overlay.id = 'slop-automation-overlay';
            overlay.style.position = 'fixed';
            overlay.style.top = '0';
            overlay.style.left = '0';
            overlay.style.width = '100vw';
            overlay.style.height = '100vh';
            overlay.style.backgroundColor = 'rgba(18, 18, 18, 0.95)';
            overlay.style.color = '#121212';
            overlay.style.display = 'flex';
            overlay.style.flexDirection = 'column';
            overlay.style.alignItems = 'center';
            overlay.style.justifyContent = 'center';
            overlay.style.zIndex = '9999999999';
            overlay.style.fontFamily = 'sans-serif';
            overlay.innerHTML = `
                <h2 style="margin:0">SlopTracker Automator</h2>
                <p id="slop-status">Loading application...</p>
                <div style="width:50px; height:50px; border:5px solid #333; border-top:5px solid #1db954; border-radius:50%; animation: spin 1s linear infinite;"></div>
                <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
            `;
            document.body.appendChild(overlay);

            setTimeout(() => {
                updateStatus('Starting hash update...');
                const input = document.querySelector('input[placeholder*="Spotify"]');
                const button = document.querySelector('button[type="submit"]');

                if (input && button) {
                    const dummyLink = "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT";
                    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value").set;
                    nativeInputValueSetter.call(input, dummyLink);
                    input.dispatchEvent(new Event('input', { bubbles: true }));

                    updateStatus('Submitting for hash...');
                    setTimeout(() => button.click(), 500);
                } else {
                    updateStatus('Waiting for elements...');
                }
            }, 1500);
        });

        return;
    }

    // SPOTIFY MAIN PART
    function showToast(message, durationMs = 4000) {
        const toast = document.createElement('div');
        toast.className = 'slop-toast';
        toast.innerText = message;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, durationMs);
    }
    if (window.location.hostname.includes('spotify.com')) {
        GM_addStyle(style);

        let currentNextAction = null;
        let fetchHashPromise = null;

        function sendSlopRequest(hash, payloadArray, onload, onerror) {
            GM_xmlhttpRequest({
                method: "POST",
                url: "https://sloptracker.org/",
                headers: {
                    "Accept": "text/x-component",
                    "Content-Type": "text/plain;charset=UTF-8",
                    "next-action": hash,
                    "Referer": "https://sloptracker.org/"
                },
                data: JSON.stringify(payloadArray),
                onload: onload,
                onerror: onerror
            });
        }
        // Tests if a hash is still valid
        async function validateHash(hash) {
            return new Promise(resolve => {
                sendSlopRequest(hash, ["headless_hash_test"],
                    (response) => {
                        const text = response.responseText.trim();
                        if (response.status === 200 && !text.startsWith('<html') && !text.startsWith('<!DOCTYPE html>')) {
                            resolve(true);
                        } else {
                            resolve(false);
                        }
                    },
                    () => resolve(false)
                );
            });
        }

        async function fetchNextActionHash() {
            if (fetchHashPromise) return fetchHashPromise;

            fetchHashPromise = new Promise(async (resolve) => {
                const savedHash = GM_getValue('slop_hash_value', null);

                if (savedHash) {
                    console.log("Checking if cached hash is still valid...");
                    const isRightHash = await validateHash(savedHash);

                    if (isRightHash) {
                        currentNextAction = savedHash;
                        console.log("✅ Using valid cached hash:", currentNextAction);
                        return resolve(currentNextAction);
                    } else {
                        console.warn("❌ Cached hash is dead. Fetching a new one.");
                    }
                }


                // Open as a small popup window centered on the screen
                console.log("Opening SlopTracker popup to extract new hash...");
                showToast("Opening SlopTracker popup to grab session hash...");
                GM_setValue('slop_hash_timestamp', 0);

                openPopup(resolve,450, 350);

                const checkInterval = setInterval(() => {
                    const timestamp = GM_getValue('slop_hash_timestamp', 0);
                    const hash = GM_getValue('slop_hash_value', null);

                    if (hash && timestamp > Date.now() - 30000) {
                        clearInterval(checkInterval);
                        currentNextAction = hash;
                        console.log("✅ Received hash from popup:", currentNextAction);
                        showToast("Hash secured! Resuming scan...");

                        resolve(currentNextAction);
                    }
                }, 500);
            });

            return fetchHashPromise;
        }

        function openPopup(resolve, width, height){
            const left = (screen.width - width) / 2;
            const top = (screen.height - height) / 2;
            const popupWindow = window.open(
                'https://sloptracker.org/?_ext=1',
                'SlopTrackerExtractor',
                `width=${width},height=${height},top=${top},left=${left}`
            );
            if (!popupWindow) {
                alert("⚠️ Popup blocked! Please allow popups for Spotify so the script can fetch the SlopTracker authentication hash.");
                return resolve(null);
            }

        }

        let savedCache = [];
        try {
            savedCache = JSON.parse(GM_getValue('sloptracker_cache', '[]'));
        } catch(e) {
            console.error("Failed to load sloptracker cache", e);
        }
        const slopCache = new Map(savedCache);
        function updateCache(url, value) {
            slopCache.set(url, value);

            // Only save to disk if it's a successful, completed result (ignore 'pending', 'error', 'rate_limited')
            if (typeof value === 'object' && value.probabilityAiGenerated !== undefined) {
                let entriesToSave = Array.from(slopCache.entries())
                .filter(([k, v]) => typeof v === 'object' && v.probabilityAiGenerated !== undefined);

                if (entriesToSave.length > 10000) {
                    entriesToSave = entriesToSave.slice(-10000);
                }

                GM_setValue('sloptracker_cache', JSON.stringify(entriesToSave));
            }
        }

        const batchSize = 1;
        const maxPasses = 3; // ammount of times the site will rescan

        // Global state to keep both buttons synced if Spotify re-renders the top bar
        let scanState = {
            isScanning: false,
            text: '🤖 scan (auto-scroll)'
        };

        function updateButtons(text, disabled) {
            scanState.text = text;
            scanState.isScanning = disabled;
            document.querySelectorAll('.slop-btn-injected').forEach(btn => {
                btn.innerText = text;
                btn.disabled = disabled;
            });
        }

        // 1. MutationObserver: Watches the DOM to apply/update badges when scrolling
        let observerTimeout = null;
        const observer = new MutationObserver(() => {
            if (observerTimeout) return;
            observerTimeout = setTimeout(() => {
                document.querySelectorAll('main a[href*="/track/"]').forEach(link => {
                    const trackUrl = link.href.split('?')[0];
                    const cacheData = slopCache.get(trackUrl);

                    if (cacheData) {
                        // Determine target state string to avoid redundant DOM updates
                        let targetState = 'done';
                        if (cacheData === 'pending') targetState = 'pending';
                        if (cacheData === 'rate_limited') targetState = 'rate_limited';

                        if (link.dataset.slopState !== targetState) {
                            applyBadge(link, trackUrl);
                        }
                    }
                });
                observerTimeout = null;
            }, 300);
        });

        // Wait for <main> to render before observing
        const initObserver = () => {
            const mainElement = document.querySelector('main');
            if (mainElement) {
                observer.observe(mainElement, { childList: true, subtree: true });
            } else {
                setTimeout(initObserver, 500);
            }
        };
        initObserver();

        // Interval to inject buttons into the action bar AND the sticky top bar
        setTimeout(() => {
            document.querySelectorAll('main a[href*="/track/"]').forEach(link => {
                const trackUrl = link.href.split('?')[0];
                if (slopCache.has(trackUrl)) applyBadge(link, trackUrl);
            });
        }, 1500);

        // Interval to inject buttons
        setInterval(() => {
            const actionBar = document.querySelector('[data-testid="action-bar-row"]');
            const topBar = document.querySelector('[data-testid="topbar-content"]');

            if (actionBar && !actionBar.querySelector('.slop-btn-injected')) {
                const moreBtn = actionBar.querySelector('[data-testid="more-button"]');
                if (moreBtn) moreBtn.after(createButton());
            }
            if (topBar && !topBar.querySelector('.slop-btn-injected')) {
                topBar.appendChild(createButton());
            }
        }, 1000);

        function createButton() {
            const btn = document.createElement('button');
            btn.className = 'slop-btn-injected';
            btn.innerText = scanState.text;
            btn.disabled = scanState.isScanning;
            btn.addEventListener('click', startScrollScan);
            return btn;
        }

        // 3. Main function: Auto-scroll the page and process tracks
        async function startScrollScan() {
            updateButtons('scrolling...', true);

            let checkedUrls = new Set();
            let unchangedCount = 0;

            try {
                while (true) {
                    const trackLinks = Array.from(document.querySelectorAll('main a[href*="/track/"]'));
                    if (trackLinks.length === 0) break;

                    const newUrls = [];

                    trackLinks.forEach(link => {
                        const url = link.href.split('?')[0];
                        if (!checkedUrls.has(url)) {
                            checkedUrls.add(url);
                            newUrls.push(url);
                        }
                    });

                    if (newUrls.length > 0) {
                        let processed = 0;
                        for (let i = 0; i < newUrls.length; i += batchSize) {
                            updateButtons(`checking ${processed}/${newUrls.length} on screen...`, true);
                            const batch = newUrls.slice(i, i + batchSize);
                            await Promise.all(batch.map(url => checkTrack(url)));
                            processed += batch.length;

                            await new Promise(r => setTimeout(r, 1000));
                        }
                        updateButtons(`checking ${processed}/${newUrls.length} on screen...`, true);
                    } else {
                        updateButtons('scrolling...', true);
                    }

                    const viewportHeight = window.innerHeight;
                    let lastVisibleTrack = null;

                    for (const link of trackLinks) {
                        const rect = link.getBoundingClientRect();
                        if (rect.top >= 0 && rect.bottom <= viewportHeight) {
                            lastVisibleTrack = link;
                        }
                    }

                    const targetElement = lastVisibleTrack || trackLinks[trackLinks.length - 1];
                    const lastDomElementBeforeScroll = trackLinks[trackLinks.length - 1];

                    targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

                    await new Promise(r => setTimeout(r, 1200));

                    const newTrackLinks = Array.from(document.querySelectorAll('main a[href*="/track/"]'));
                    if (newTrackLinks.length === 0) break;

                    const lastDomElementAfterScroll = newTrackLinks[newTrackLinks.length - 1];

                    if (lastDomElementBeforeScroll === lastDomElementAfterScroll) {
                        unchangedCount++;
                        if (unchangedCount >= 2) {
                            break;
                        }
                    } else {
                        unchangedCount = 0;
                    }
                }

                // --- RETRY PHASE ---
                let pass = 1;

                while (pass <= maxPasses) {
                    const retryUrls = Array.from(slopCache.entries())
                    .filter(([url, state]) => state === 'rate_limited')
                    .map(([url, state]) => url);

                    if (retryUrls.length === 0) break;

                    if (pass === 1) {
                        showToast(`Finished scrolling the playlist.\n\n${retryUrls.length} tracks were skipped due to rate limits.\n\nThe script will now slowly retry them in the background.`);
                    }

                    for (let i = 0; i < retryUrls.length; i++) {
                        updateButtons(`retrying ${i+1}/${retryUrls.length}...`, true);
                        await checkTrack(retryUrls[i]);
                        await new Promise(r => setTimeout(r, 2500));
                    }
                    pass++;
                }

                // If any somehow survived 3 retry passes, mark them as permanently failed
                for (const [url, state] of slopCache.entries()) {
                    if (state === 'rate_limited') {
                        slopCache.set(url, { error: true, message: "Max retries exhausted for rate limits." });
                        updateVisibleBadges(url);
                    }
                }

                updateButtons('🤖 scan complete', true);
            } catch (err) {
                console.error("sloptracker scan error:", err);
                updateButtons('⚠️ error scanning', true);
            }

            setTimeout(() => {
                updateButtons('🤖 scan (auto-scroll)', false);
            }, 3000);
        }

        // 4. Fetch wrapper for SlopTracker (With Rate-Limit Counter & Alert)
        async function checkTrack(url, retries = 3) {
            if (currentNextAction==null) {
                showToast("searching for Hash");
                await fetchNextActionHash();
            }
            const currentCache = slopCache.get(url);
            if (currentCache && currentCache !== 'pending' && currentCache !== 'rate_limited') {
                return Promise.resolve();
            }

            slopCache.set(url, 'pending');
            updateVisibleBadges(url);

            return new Promise((resolve) => {
                sendSlopRequest(
                    currentNextAction,
                    [url],
                    function(response) {
                        let foundResult = false;
                        let isRateLimited = false;
                        let errorMessage = "No AI data found in 200 OK response.";

                        if (response.status === 200) {
                            const lines = response.responseText.split('\n');

                            for (const line of lines) {
                                const match = line.match(/^\d+:(.*)$/);
                                if (match) {
                                    try {
                                        const data = JSON.parse(match[1]);

                                        if (data.result && data.result.probabilityAiGenerated !== undefined) {
                                            slopCache.set(url, data.result);
                                            updateVisibleBadges(url);
                                            foundResult = true;
                                            break;
                                        } else if (data.error && data.error.includes("Rate limit")) {
                                            isRateLimited = true;
                                            errorMessage = data.error;
                                        } else if (data.error) {
                                            errorMessage = `SlopTracker Error: ${data.error}`;
                                        }
                                    } catch (e) {
                                        // Ignore lines that aren't valid JSON
                                    }
                                }
                            }

                            if (!foundResult && response.responseText.includes('<html')) {
                                errorMessage = "Blocked by Cloudflare (HTML returned)";
                            }
                        } else {
                            errorMessage = `Server returned HTTP ${response.status}:\n${response.responseText}`;
                        }

                        if (foundResult) {
                            resolve();
                        } else if (isRateLimited) {
                            updateCache(url, 'rate_limited');
                            updateVisibleBadges(url);
                            resolve();
                        } else {
                            console.error(`[SlopTracker Error] for ${url}:`, errorMessage);
                            updateCache(url, { error: true, message: errorMessage });
                            updateVisibleBadges(url);
                            resolve();
                        }
                    },
                    function() {
                        slopCache.set(url, { error: true, message: "Network request totally failed" });
                        updateVisibleBadges(url);
                        resolve();
                    }
                );
            });
        }

        // Helper to find visible links for a specific URL and update them
        function updateVisibleBadges(url) {
            document.querySelectorAll('main a[href*="/track/"]').forEach(linkNode => {
                if (linkNode.href.split('?')[0] === url) {
                    applyBadge(linkNode, url);
                }
            });
        }

        // 5. Applies or updates the visual badge for a DOM node
        function applyBadge(linkNode, url) {
            const cacheData = slopCache.get(url);
            if (!cacheData) return;

            let stateString = 'done';
            if (cacheData === 'pending') stateString = 'pending';
            if (cacheData === 'rate_limited') stateString = 'rate_limited';

            linkNode.dataset.slopState = stateString;

            const parent = linkNode.parentNode.parentNode;
            const existingBadge = parent.querySelector('.slop-badge');
            if (existingBadge) existingBadge.remove();

            const badge = document.createElement('span');
            badge.className = 'slop-badge';

            if (stateString === 'pending') {
                badge.innerText = `⏳ checking...`;
                badge.classList.add('slop-badge-pending');
            } else if (stateString === 'rate_limited') {
                badge.innerText = `⏸️ queued`;
                badge.classList.add('slop-badge-queued');
                badge.title = "Rate limit hit. This will be retried automatically at the end.";
            } else if (cacheData.error) {
                badge.innerText = `⚠️ failed`;
                badge.classList.add('slop-badge-error');
                badge.title = cacheData.message;
            } else {
                const result = cacheData;
                const details = [
                    `Prediction: ${result.prediction}`,
                    `Confidence Score: ${result.confidenceScore}%`,
                    `Most Likely Type: ${result.mostLikelyAiType}`,
                    `Spectral Probabilities = Human: ${result.spectralProbabilities?.human}% / Processed AI: ${result.spectralProbabilities?.processedAi}% / Pure AI: ${result.spectralProbabilities?.pureAi}%`,
                    `Temporal Probabilities = Human: ${result.temporalProbabilities?.human}% / Processed AI: ${result.temporalProbabilities?.processedAi}% / Pure AI: ${result.temporalProbabilities?.pureAi}%`,
                    `Cached: ${result.cached} | Agree: ${result.agreeCount} | Disagree: ${result.disagreeCount}`
                ].join('\n');
                badge.title = details;

                if (result.probabilityAiGenerated > 50) {
                    badge.innerText = `🤖 ${result.probabilityAiGenerated.toFixed(1)}% AI (${result.mostLikelyAiType})`;
                    badge.classList.add('slop-badge-ai');
                } else {
                    badge.innerText = `✅ human`;
                    badge.classList.add('slop-badge-human');
                }
            }

            parent.appendChild(badge);
        }
    }

})();
