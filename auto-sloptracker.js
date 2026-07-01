// ==UserScript==
// @name         auto-sloptracker
// @namespace    http://tampermonkey.net/
// @author       In work with Gemini AI
// @version      1.0
// @description  checks if spotify tracks on the current site ar ai-generated using sloptracker
// @match        https://open.spotify.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      sloptracker.org
// @icon         https://www.google.com/s2/favicons?sz=64&domain=spotify.com
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

    GM_addStyle(`
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
    `);

    // Cache to store results so we can apply badges as the user scrolls
    const slopCache = new Map();

    let errorAlertShown = false; // Prevents alert spam if a whole batch fails
    let tracksCheckedSinceLastLimit = 0;
    let rateLimitAlertShown = false;
    const batchSize = 1;

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
    const observer = new MutationObserver(() => {
        document.querySelectorAll('main a[href^="/track/"]').forEach(link => {
            const trackUrl = link.href.split('?')[0];
            const cacheData = slopCache.get(trackUrl);

            if (cacheData) {
                const targetState = cacheData === 'pending' ? 'pending' : 'done';
                if (link.dataset.slopState !== targetState) {
                    applyBadge(link, trackUrl);
                }
            }
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // 2. Interval to inject buttons into the action bar AND the sticky top bar
    setInterval(() => {
        const actionBar = document.querySelector('[data-testid="action-bar-row"]');
        const topBar = document.querySelector('[data-testid="topbar-content"]');

        // Safely check if our button class exists inside these elements
        if (actionBar && !actionBar.querySelector('.slop-btn-injected')) {
            actionBar.querySelector('div:last-of-type').before(createButton());
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
                const trackLinks = Array.from(document.querySelectorAll('main a[href^="/track/"]'));
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

                const newTrackLinks = Array.from(document.querySelectorAll('main a[href^="/track/"]'));
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
    function checkTrack(url, retries = 3) {
        if (slopCache.has(url) && slopCache.get(url) !== 'pending') return Promise.resolve();

        slopCache.set(url, 'pending');
        updateVisibleBadges(url);

        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: "POST",
                url: "https://sloptracker.org/",
                headers: {
                    "Content-Type": "text/plain;charset=UTF-8",
                    "next-action": "60a73caf04508672a53504c8151e230e4b5e092c28", // this is necessary to get the right response
                    "Referer": "https://sloptracker.org/"
                },
                data: JSON.stringify([url]),
                onload: async function(response) {
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
                        errorMessage = `Server returned HTTP ${response.status}`;
                    }

                    // --- HANDLE THE RESULT ---

                    if (foundResult) {
                        tracksCheckedSinceLastLimit++;
                        rateLimitAlertShown = false; // Reset the alert lock because we are succeeding again
                        resolve();
                    } else if (isRateLimited) {
                        if (!rateLimitAlertShown) {
                            rateLimitAlertShown = true;
                            const exactTime = new Date().toLocaleTimeString();
                            alert(
                                `🛑 Rate limit reached at ${exactTime}\n\n` +
                                `Successfully checked ${tracksCheckedSinceLastLimit} tracks before hitting the limit.\n\n` +
                                `The script will now pause and automatically retry.`
                            );
                            tracksCheckedSinceLastLimit = 0; // Reset counter for the next batch
                        }

                        if (retries > 0) {
                            document.querySelectorAll('main a[href^="/track/"]').forEach(linkNode => {
                                if (linkNode.href.split('?')[0] === url) {
                                    const badge = linkNode.parentNode.parentNode.querySelector('.slop-badge');
                                    if (badge) badge.innerText = `⏳ rate limited, waiting...`;
                                }
                            });

                            // Wait 3 seconds, then recursively try again
                            await new Promise(r => setTimeout(r, 3000));
                            resolve(checkTrack(url, retries - 1));
                        } else {
                            slopCache.set(url, { error: true, message: "Rate limit reached (Max retries exhausted)" });
                            updateVisibleBadges(url);
                            resolve();
                        }
                    } else {
                        slopCache.set(url, { error: true, message: errorMessage });
                        updateVisibleBadges(url);
                        resolve();
                    }
                },
                onerror: function() {
                    slopCache.set(url, { error: true, message: "Network request totally failed" });
                    updateVisibleBadges(url);
                    resolve();
                }
            });
        });
    }

    // Helper to find visible links for a specific URL and update them
    function updateVisibleBadges(url) {
        document.querySelectorAll('main a[href^="/track/"]').forEach(linkNode => {
            if (linkNode.href.split('?')[0] === url) {
                applyBadge(linkNode, url);
            }
        });
    }

    // 5. Applies or updates the visual badge for a DOM node
    function applyBadge(linkNode, url) {
        const cacheData = slopCache.get(url);
        if (!cacheData) return;

        const isPending = cacheData === 'pending';
        linkNode.dataset.slopState = isPending ? 'pending' : 'done';

        const parent = linkNode.parentNode.parentNode;
        const existingBadge = parent.querySelector('.slop-badge');
        if (existingBadge) existingBadge.remove();

        const badge = document.createElement('span');
        badge.className = 'slop-badge';

        if (isPending) {
            badge.innerText = `⏳ checking...`;
            badge.classList.add('slop-badge-pending');
            badge.title = "Fetching data from SlopTracker...";
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


})();
