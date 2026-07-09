// ==UserScript==
// @name         auto-sloptracker
// @namespace    http://tampermonkey.net/
// @author       In work with Gemini AI
// @version      1.3
// @description  checks if spotify/tidal tracks on the current site are ai-generated using sloptracker
// @match        https://open.spotify.com/*
// @match        https://tidal.com/album/*
// @match        https://tidal.com/track/*
// @match        https://tidal.com/artist/*
// @match        https://tidal.com/playlist/*
// @match        https://tidal.com/view/pages/*
// @match        https://sloptracker.org/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_openInTab
// @grant        unsafeWindow
// @connect      sloptracker.org
// @connect      tidal.com
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

    const CONFIG = {
        batchSize: 1,
        maxRescans: 3,
        pluginClass: 'slop-btn-injected',
        statusId: 'slop-status',
        toastClas: 'slop-toast',
        badgeClass: {
            self: 'slop-badge',
            pending: 'slop-badge-pending',
            rateLimited: 'slop-badge-queued',
            error: 'slop-badge-error',
            ai: 'slop-badge-ai',
            human: 'slop-badge-human'
        },
        state: {
            done: 'done',
            pending: 'pending',
            rateLimited: 'rate_limited',
            error: 'error'
        },
        cacheId: {
            hashValue: 'slop_hash_value',
            hashTime: 'slop_hash_timestamp',
            slopTracker: 'sloptracker_cache'
        },
        mediaItem: {
            spotify: 'main a[href*="/track/"]',
            tidal: 'main [data-track--content-id], main [data-test*="tracklist-id-"]'
        },
        pluginNeighbour: {
            spotify: {
                actionBar : '[data-testid="action-bar-row"]',
                actionMoreBtn : '[data-testid="more-button"]', // .after()
                topBar : '[data-testid="topbar-content"]' // .appendChild()
            },
            tidal: '[data-test="search-popover-container"]' // .before()
        },
        domain: {
            sloptracker: 'sloptracker.org',
            spotify: 'spotify.com',
            tidal: 'tidal.com'
        },
        tidalSpec: {
            divContentId: 'data-track--content-id',
            buttonContentId: 'data-test'
        },
        slopIgnoreParam: '_ext=1',
        slopOverlayId: 'slop-automation-overlay',
        popup: {
            width: 450,
            height: 350
        }

    }
    
    const isSpotify = window.location.href.includes(CONFIG.domain.spotify);
    const isTidal = window.location.hostname.includes(CONFIG.domain.tidal);
    const isSloptracker = window.location.hostname.includes(CONFIG.domain.sloptracker);
    const currentPlatform = isSpotify ? 'spotify' : isTidal ? 'tidal' : null;

    let currentNextActionHash = null;
    let fetchHashPromise = null;
    
    let slopCache;

    let scanState = {
        isScanning: false,
        text: '🤖 scan (auto-scroll)'
    };

    let observer;
    let observerTimeout = null;

    const style = `
        .${CONFIG.pluginClass} {
            background: #1db954;
            color: #000;
            border: none;
            border-radius: 20px;
            padding: 8px 16px;
            font-weight: bold;
            cursor: pointer;
            margin-left: 16px;
        }
        .${CONFIG.pluginClass}:disabled {
            background: #15873e;
            cursor: not-allowed;
        }
        .${CONFIG.badgeClass.self} {
            font-size: 12px;
            margin-left: 8px;
            white-space: nowrap;
            cursor: help;
            padding: 2px 6px;
            border-radius: 4px;
            font-weight: bold;
        }
        .${CONFIG.badgeClass.pending} {
            background-color: #535353;
            color: #ffffff;
        }
        .${CONFIG.badgeClass.ai} {
            background-color: #e91429;
            color: #ffffff;
        }
        .${CONFIG.badgeClass.human} {
            background-color: #1db954;
            color: #000000;
        }
        .${CONFIG.badgeClass.error} {
            background-color: #8c8c8c;
            color: #ffffff;
        }
        .${CONFIG.badgeClass.rateLimited} {
            background-color: #e5a50a;
            color: #000000;
        }
        .${CONFIG.toastClas} {
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
    
    function initiate() {
        initSlopCache();
        setObserver();
        initObserver();
        initialCacheCheck(1500);
        injectButtons(1000);
    }
    
    if (isSloptracker) {
        if (!window.location.search.includes(CONFIG.slopIgnoreParam)) {
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

                    GM_setValue(CONFIG.cacheId.hashValue, nextActionHash);
                    GM_setValue(CONFIG.cacheId.hashTime, Date.now());
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
            overlay.id = CONFIG.slopOverlayId;
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
            const title = document.createElement('h2');
            title.style.margin = '0';
            title.textContent = 'SlopTracker Automator';
            overlay.appendChild(title);
            const status = document.createElement('p');
            status.id = CONFIG.statusId;
            status.textContent = 'Loading application...';
            overlay.appendChild(status);
            const throbber = document.createElement('div');
            throbber.style.width = '50px';
            throbber.style.height = '50px';
            throbber.style.border = '5px solid #333';
            throbber.style.borderTop = '5px solid #1db954';
            throbber.style.borderRadius = '50%';
            throbber.style.animation = 'spin 1s linear infinite';
            overlay.appendChild(throbber);
            const styleNode = document.createElement('style');
            styleNode.textContent = '@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }'
            overlay.appendChild(styleNode);
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
    else { 
        GM_addStyle(style);
        if (currentPlatform) {
            initiate();
        }
    }

    async function getLinks() {
        if (isSpotify) {
            return getSpotifyLinks()
        } else if (isTidal) {
            const tidalTracks = getTidalSmartLinks();
            return await Promise.all(tidalTracks.map( async track => {
                const cachedPointer = slopCache.get(track.tidalSmartLink);
                if (typeof cachedPointer === 'string' && cachedPointer.startsWith('http')) {
                    return { node: track.node, spotifyUrl: cachedPointer, tidalSmartLink: track.tidalSmartLink };
                }

                const spotifyUrl = await fetchSpotifyFromTidalApi(track.tidalSmartLink);
                if (spotifyUrl) {
                    updateCache(track.tidalSmartLink, spotifyUrl);
                }
                return { node: track.node, spotifyUrl: spotifyUrl, tidalSmartLink: track.tidalSmartLink }
            }));
        }
        return [];
    }

    function getSpotifyLinks() {
        return Array.from(document.querySelectorAll(CONFIG.mediaItem.spotify))
        .map(linkNode => {
            const spotifyUrl = linkNode.href.split('?')[0];
            const node = linkNode.parentNode.parentNode;
            return { node: node, spotifyUrl: spotifyUrl, tidalSmartLink: null };
        })
    }

    function getTidalSmartLinks() {
        return Array.from(document.querySelectorAll(CONFIG.mediaItem.tidal))
        .map(item => {
            const contentType = item.getAttribute('data-track--content-type') || 'track';
            const contentId =
                (item.nodeName == 'DIV') ? item.getAttribute(CONFIG.tidalSpec.divContentId) :
                (item.nodeName == 'BUTTON') ? item.getAttribute(CONFIG.tidalSpec.buttonContentId).split('-')[2] :
                ""
            const node =
                (item.nodeName == 'DIV') ? item.querySelector('[data-test="table-row-title"] div') :
                (item.nodeName == 'BUTTON') ? item.closest('tr').querySelector('[class^="_titleColumn"] div') :
                null
            const tidalSmartLink = `https://tidal.com/smart-links/${contentType}-${contentId}`;

            return {node: node, tidalSmartLink: tidalSmartLink};
        });
    }

    async function fetchSpotifyFromTidalApi(smartApiUrl) {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: smartApiUrl,
                headers: {
                    "Accept": "application/json"
                },
                onload: function(response) {
                    if (response.status === 200) {
                        try {
                            const data = JSON.parse(response.responseText);
                            
                            if (data && data.links && Array.isArray(data.links)) {
                                const spotifyLinkObj = data.links.find(link => 
                                    link.storeId === 'spotify' || link.name === 'Spotify'
                                );
                                
                                if (spotifyLinkObj && spotifyLinkObj.url) {
                                    return resolve(spotifyLinkObj.url);
                                }
                            }
                            resolve(null);
                        } catch (e) {
                            console.error("[SlopTracker] Error parsing Tidal JSON:", e);
                            resolve(null);
                        }
                    } else {
                        resolve(null);
                    }
                },
                onerror: function() {
                    resolve(null);
                }
            });
        });
    }

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
            const savedHash = GM_getValue(CONFIG.cacheId.hashValue, null);

            if (savedHash) {
                console.log("Checking if cached hash is still valid...");
                const isRightHash = await validateHash(savedHash);

                if (isRightHash) {
                    currentNextActionHash = savedHash;
                    console.log("✅ Using valid cached hash:", currentNextActionHash);
                    return resolve(currentNextActionHash);
                } else {
                    console.warn("❌ Cached hash is dead. Fetching a new one.");
                }
            }

            // Open as a small popup window centered on the screen
            console.log("Opening SlopTracker popup to extract new hash...");
            showToast("Opening SlopTracker popup to grab session hash...");
            GM_setValue(CONFIG.cacheId.hashTime, 0);

            openPopup(resolve,CONFIG.popup);

            const checkInterval = setInterval(() => {
                const timestamp = GM_getValue(CONFIG.cacheId.hashTime, 0);
                const hash = GM_getValue(CONFIG.cacheId.hashValue, null);

                if (hash && timestamp > Date.now() - 30000) {
                    clearInterval(checkInterval);
                    currentNextActionHash = hash;
                    console.log("✅ Received hash from popup:", currentNextActionHash);
                    showToast("Hash secured! Resuming scan...");

                    resolve(currentNextActionHash);
                }
            }, 500);
        });

        return fetchHashPromise;
    }

    function openPopup(resolve, config){
        const left = (screen.width - config.width) / 2;
        const top = (screen.height - config.height) / 2;
        const popupWindow = window.open(
            `https://${CONFIG.domain.sloptracker}/${CONFIG.slopIgnoreParam}`,
            'SlopTrackerExtractor',
            `width=${config.width},height=${config.height},top=${top},left=${left}`
        );
        if (!popupWindow) {
            alert("⚠️ Popup blocked! Please allow popups for Spotify so the script can fetch the SlopTracker authentication hash.");
            return resolve(null);
        }

    }

    function initSlopCache() {
        let savedCache = [];
        try {
            savedCache = JSON.parse(GM_getValue(CONFIG.cacheId.slopTracker, '[]'));
        } catch(e) {
            console.error("Failed to load sloptracker cache", e);
            savedCache = [];
        }
        slopCache = new Map(savedCache);
    }

    function updateCache(url, value) {
        if (!url) return;
        slopCache.set(url, value);

        let entriesToSave = Array.from(slopCache.entries())
            .filter(([k, v]) => typeof v === 'string' || (typeof v === 'object' && v.probabilityAiGenerated !== undefined));
        
        GM_setValue(CONFIG.cacheId.slopTracker, JSON.stringify(entriesToSave));
    }


    function updateStatus(message) {
        document.getElementById(CONFIG.statusId).innerText = message;
    }

    function updateButtons(text, disabled) {
        scanState.text = text;
        scanState.isScanning = disabled;
        document.querySelectorAll(`.${CONFIG.pluginClass}`).forEach(btn => {
            btn.innerText = text;
            btn.disabled = disabled;
        });
    }

    function checkCacheState(track) {
        const { spotifyUrl, tidalSmartLink } = track;

        let targetState = CONFIG.state.done;

        let cacheData = slopCache.get(tidalSmartLink);
        if (typeof cacheData === 'string') {
            cacheData = slopCache.get(cacheData);
        }

        if (!cacheData && spotifyUrl) {
            cacheData = slopCache.get(spotifyUrl);
        }
        if (cacheData) {
            if (cacheData === CONFIG.state.pending) targetState = CONFIG.state.pending;
            if (cacheData === CONFIG.state.rateLimited) targetState = CONFIG.state.rateLimited;
        }
        return { cacheData, targetState };
    }

    function setObserver() {
        observer = new MutationObserver(async () => {
            if (observerTimeout) return;
            observerTimeout = setTimeout(async () => {
                const observedTracks = await getLinks()
                observedTracks.forEach( track => {
                    const { targetState } = checkCacheState(track);
                    if (track.node.dataset.slopState !== targetState) {
                        applyBadge(track);
                    }
                });
                observerTimeout = null;
            }, 300);
        });
    }
    function initObserver() {
        const mainElement = document.querySelector('main');
        if (mainElement) {
            observer.observe(mainElement, { childList: true, subtree: true });
        } else {
            setTimeout(initObserver, 500);
        }
    };

    function initialCacheCheck(interval) {
        setTimeout(async () => {
            let tracks;
            if (isSpotify) {
                tracks = getSpotifyLinks().map( track => { 
                    return { node: track.node, url: track.spotifyUrl }
                })
            } else if (isTidal) {
                tracks = getTidalSmartLinks().map( track => { 
                    return { node: track.node, url: track.tidalSmartLink }
                })
            }
            tracks.forEach(track => {
                if (slopCache.has(track.url)) applyBadge(track);
            });
        }, interval);
    }

    function injectButtons(interval) {
        setInterval(() => {
            if (isSpotify) {
                const actionBar = document.querySelector(CONFIG.pluginNeighbour.spotify.actionBar);
                const topBar = document.querySelector(CONFIG.pluginNeighbour.spotify.topBar);

                if (actionBar && !actionBar.querySelector(`.${CONFIG.pluginClass}`)) {
                    const moreBtn = actionBar.querySelector(CONFIG.pluginNeighbour.spotify.actionMoreBtn);
                    if (moreBtn) moreBtn.after(createButton());
                }
                if (topBar && !topBar.querySelector(`.${CONFIG.pluginClass}`)) {
                    topBar.appendChild(createButton());
                }
            } else if (isTidal) {
                const searchBar = document.querySelector(CONFIG.pluginNeighbour.tidal);
                if (searchBar && !searchBar.parentNode.querySelector(`.${CONFIG.pluginClass}`)) {
                    searchBar.before(createButton());
                }
            }
        }, interval);
    }
    
    function createButton() {
        const btn = document.createElement('button');
        btn.className = CONFIG.pluginClass;
        btn.innerText = scanState.text;
        btn.disabled = scanState.isScanning;
        btn.addEventListener('click', startScrollScan);
        return btn;
    }
    
    async function startScrollScan() {
        updateButtons('scrolling...', true);

        let checkedUrls = new Set();
        let unchangedCount = 0;

        try {
            while (true) {
                const tracks = await getLinks();
                if (tracks.length === 0) break;

                const newTracks = [];

                tracks.forEach(track => {
                    if (track.spotifyUrl && !checkedUrls.has(track.spotifyUrl)) {
                        checkedUrls.add(track.spotifyUrl);
                        newTracks.push(track);
                    }
                });

                if (newTracks.length > 0) {
                    let processed = 0;
                    for (let i = 0; i < newTracks.length; i += CONFIG.batchSize) {
                        updateButtons(`checking ${processed}/${newTracks.length} on screen...`, true);
                        const batch = newTracks.slice(i, i + CONFIG.batchSize);
                        await Promise.all(batch.map(track => checkTrack(track)));
                        processed += batch.length;

                        await new Promise(r => setTimeout(r, 1000));
                    }
                    updateButtons(`checking ${processed}/${newTracks.length} on screen...`, true);
                } else {
                    updateButtons('scrolling...', true);
                }

                const viewportHeight = window.innerHeight;
                let lastVisibleTrack = null;

                for (const track of tracks) {
                    const rect = track.node.getBoundingClientRect();
                    if (rect.top >= 0 && rect.bottom <= viewportHeight) {
                        lastVisibleTrack = track.node;
                    }
                }

                const targetElement = lastVisibleTrack || tracks[tracks.length - 1].node;
                const lastDomElementBeforeScroll = tracks[tracks.length - 1].node;

                targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });

                await new Promise(r => setTimeout(r, 1200));

                const newerTracks = await getLinks();
                if (newerTracks.length === 0) break;

                const lastDomElementAfterScroll = newerTracks[newerTracks.length - 1].node;

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

            while (pass <= CONFIG.maxRescans) {
                const retryUrls = Array.from(slopCache.entries())
                    .filter(([_, state]) => state === CONFIG.state.rateLimited)
                    .map(([url, _]) => url);

                if (retryUrls.length === 0) break;

                if (pass === 1) {
                    showToast(`Finished scrolling the playlist.\n\n${retryUrls.length} tracks were skipped due to rate limits.\n\nThe script will now slowly retry them in the background.`);
                }

                for (let i = 0; i < retryUrls.length; i++) {
                    updateButtons(`retrying ${i+1}/${retryUrls.length}...`, true);
                    await checkTrack({ spotifyUrl: retryUrls[i] });
                    await new Promise(r => setTimeout(r, 2500));
                }
                pass++;
            }

            // If any somehow survived 3 retry passes, mark them as permanently failed
            for (const [url, state] of slopCache.entries()) {
                if (state === CONFIG.state.rateLimited) {
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

    async function checkTrack(track) {
        const url = track.spotifyUrl;
        if (!url) return Promise.resolve();

        if (currentNextActionHash==null) {
            showToast("searching for Hash");
            await fetchNextActionHash();
        }
        const currentCache = slopCache.get(url);
        if (currentCache && currentCache !== CONFIG.state.pending && currentCache !== CONFIG.state.rateLimited) {
            return Promise.resolve();
        }

        slopCache.set(url, CONFIG.state.pending);
        updateVisibleBadges(url);

        return new Promise((resolve) => {
            sendSlopRequest(
                currentNextActionHash,
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
                                        updateCache(url, data.result);
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
                        updateCache(url, CONFIG.state.rateLimited);
                        updateVisibleBadges(url);
                        resolve();
                    } else {
                        console.error(`[SlopTracker Error] for ${url}:`, errorMessage);
                        const errObj = { error: true, message: errorMessage };
                        updateCache(url, errObj);
                        updateVisibleBadges(url);
                        resolve();
                    }
                },
                function() {
                    const errObj = { error: true, message: "Network request totally failed" };
                    updateCache(url, errObj);
                    updateVisibleBadges(url);
                    resolve();
                }
            );
        });
    }
    
    function showToast(message, durationMs = 4000) {
        const toast = document.createElement('div');
        toast.className = CONFIG.toastClas;
        toast.innerText = message;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, durationMs);
    }

    // Helper to find visible links for a specific URL and update them
    async function updateVisibleBadges(url) {
        const tracks = await getLinks();
        tracks.forEach(track => { 
            if (track.spotifyUrl === url) {
                applyBadge(track); 
            }
        });
    }

    // 5. Applies or updates the visual badge for a DOM node
    function applyBadge(track) {
        const { cacheData, targetState } = checkCacheState(track);
        if (!cacheData) return;

        track.node.slopState = targetState;

        const existingBadge = track.node.querySelector(`.${CONFIG.badgeClass.self}`);
        if (existingBadge) existingBadge.remove();

        const badge = document.createElement('span');
        badge.className = CONFIG.badgeClass.self;

        if (targetState === CONFIG.state.pending) {
            badge.innerText = `⏳ checking...`;
            badge.classList.add('slop-badge-pending');
        } else if (targetState === CONFIG.state.rateLimited) {
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

        track.node.appendChild(badge);
    }

})();
