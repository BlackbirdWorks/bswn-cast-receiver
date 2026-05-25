import { Gapless5 } from '@regosen/gapless-5';

// UI Element for Loading
export const loadingEl = document.createElement('div');
loadingEl.id = 'loading-text';

// Track the current network request so we can abort it if the user spams next/prev
let currentAbortController = null;

export const gaplessPlayer = new Gapless5({
    tracks: [],
    loop: true,
    singleMode: true,
    useWebAudio: true,
    crossfade: 100 // Smooth out any Opus decoding gaps by crossfading the loop point
});

export const getFallbackUrl = (url, filename) => {
    return `https://blackbirdworks.github.io/bswn-cast-receiver/assets/${filename}`;
};

export const handleLoadRequest = async (request, dummyUrl, isLocal = false) => {
    // Abort any pending fetch request to prevent network congestion
    if (currentAbortController) {
        currentAbortController.abort();
    }
    const abortController = new AbortController();
    currentAbortController = abortController;

    console.log(`[BSWN] LOAD intercepted`);
    // Media3 puts the URI in contentId (and possibly contentUrl for newer SDK versions)
    let url = request.media.contentUrl || request.media.contentId;
    const trackName = (request.media.metadata && request.media.metadata.title) || '';

    console.log('[BSWN] LOAD intercepted');
    console.log('[BSWN]   contentId:  ' + request.media.contentId);
    console.log('[BSWN]   contentUrl: ' + request.media.contentUrl);
    console.log('[BSWN]   resolved:   ' + url);
    console.log('[BSWN]   title:      ' + trackName);

    if (!url) {
      console.error('[BSWN] No URL in LOAD request — aborting');
      return null; // Reject the LOAD
    }

    // Hybrid Fallback: If this is a local phone URL, check if the phone is actually reachable.
    if (url.includes(':8080/audio/') || isLocal) { // isLocal is mainly for testing purposes
        const filename = url.substring(url.lastIndexOf('/') + 1);
        const fallbackUrl = getFallbackUrl(url, filename);
        
        try {
            const timeoutId = setTimeout(() => abortController.abort(), 2000);
            const testResponse = await fetch(url, { method: 'HEAD', signal: abortController.signal });
            clearTimeout(timeoutId);
            if (!testResponse.ok) throw new Error(`HTTP ${testResponse.status}`);
            console.log(`[BSWN] Local server is reachable! Using local network.`);
        } catch (e) {
            if (e.name === 'AbortError' && abortController !== currentAbortController) {
                console.log(`[BSWN] Load request superseded by newer request. Aborting.`);
            } else {
                console.warn(`[BSWN] Local server unreachable (network/CORS/timeout). Using fallback:`, e.message);
                url = fallbackUrl;
            }
        }
    }

    const isAudioOnly = request.media.contentType && request.media.contentType.startsWith('audio/');
    const finalDummyUrl = isAudioOnly ? 'assets/dummy.mp3' : (dummyUrl || 'assets/dummy-v2.mp4');

    // If a newer LOAD request came in while we were testing the network, abort this one
    if (abortController !== currentAbortController) {
        request.media.contentId = finalDummyUrl;
        request.media.contentUrl = finalDummyUrl;
        request.media.contentType = isAudioOnly ? 'audio/mp3' : 'video/mp4';
        return request;
    }

    // Pass the lightweight dummy video to CAF to save memory, while Gapless5 handles the real audio
    request.media.contentId = finalDummyUrl;
    request.media.contentUrl = finalDummyUrl;
    request.media.contentType = isAudioOnly ? 'audio/mp3' : 'video/mp4';
    console.log(`[BSWN] Final playback URL (Gapless5): ${url}. Dummy for CAF: ${finalDummyUrl}`);

    loadingEl.innerText = `Loading ${trackName || 'Audio'}...`;
    loadingEl.style.display = 'block';

    // Let Gapless5 handle the actual gapless Web Audio playback
    gaplessPlayer.removeAllTracks();
    gaplessPlayer.addTrack(url);
    gaplessPlayer.play();

    const el = document.getElementById('stealth-audio-player');
    if (el) {
      el.loop = true;
      el.volume = 0; // Mute the CAF element
    }

    // Also set repeatMode on the request so CAF tracks it correctly
    if (cast && cast.framework && cast.framework.messages) {
        request.media.streamType = cast.framework.messages.StreamType.BUFFERED;
    }

    return request;
};

// Initialize the app
export const initApp = () => {
    document.body.appendChild(loadingEl);

    gaplessPlayer.onplay = () => {
        loadingEl.style.display = 'none';
    };

    const isAndroidTV = navigator.userAgent.includes('Android') || navigator.userAgent.includes('BRAVIA');

    // Dynamically insert players if they do not exist
    let stealthPlayer = document.getElementById('stealth-audio-player');
    if (!stealthPlayer) {
        if (isAndroidTV) {
            stealthPlayer = document.createElement('video');
            stealthPlayer.style.cssText = 'opacity:0; position:absolute; top:0; left:0; width:1px; height:1px; pointer-events:none;';
        } else {
            stealthPlayer = document.createElement('audio');
            stealthPlayer.style.display = 'none';
        }
        stealthPlayer.id = 'stealth-audio-player';
        stealthPlayer.preload = 'auto';
        document.body.appendChild(stealthPlayer);
    }

    let dummyVideo = document.getElementById('dummy-video');
    if (isAndroidTV && !dummyVideo) {
        dummyVideo = document.createElement('video');
        dummyVideo.id = 'dummy-video';
        dummyVideo.autoplay = true;
        dummyVideo.loop = true;
        dummyVideo.muted = true;
        dummyVideo.playsInline = true;
        dummyVideo.style.display = 'none';
        dummyVideo.src = 'assets/dummy-v2.mp4';
        document.body.appendChild(dummyVideo);
    }

    if (typeof cast !== 'undefined' && cast.framework) {
        const context = cast.framework.CastReceiverContext.getInstance();
        const playerManager = context.getPlayerManager();

        // CRITICAL: Set media element FIRST before any interceptors or context.start().
        if (stealthPlayer) {
            playerManager.setMediaElement(stealthPlayer);
        }

        // Sync CAF play/pause state with Gapless5 safely via PAUSE and PLAYING events
        playerManager.addEventListener(
            cast.framework.events.EventType.PAUSE,
            () => {
                console.log('[BSWN] CAF state PAUSED, pausing Gapless5');
                gaplessPlayer.pause();
            }
        );
        
        playerManager.addEventListener(
            cast.framework.events.EventType.PLAYING,
            () => {
                console.log('[BSWN] CAF state PLAYING, playing Gapless5');
                gaplessPlayer.play();
            }
        );

        playerManager.setMessageInterceptor(
            cast.framework.messages.MessageType.LOAD,
            (request) => {
                const dummyVideo = document.getElementById('dummy-video');
                const dummyUrl = dummyVideo ? dummyVideo.src : '';
                return handleLoadRequest(request, dummyUrl);
            }
        );

        // When the player actually starts playing, re-enforce loop
        playerManager.addEventListener(
            cast.framework.events.EventType.MEDIA_STATUS,
            () => {
                const el = document.getElementById('stealth-audio-player');
                if (el && !el.loop) {
                    el.loop = true;
                    console.log('[BSWN] Re-enforced loop=true on media element');
                }
            }
        );

        // Prevent the receiver ever going idle (would disconnect after 5 min of silence)
        const options = new cast.framework.CastReceiverOptions();
        options.disableIdleTimeout = true;
        context.start(options);

        // Handle TV visibility and standby changes properly using Cast SDK events
        context.addEventListener(
            cast.framework.system.EventType.VISIBILITY_CHANGED,
            (event) => {
                console.log('[BSWN] App visibility changed. isVisible:', event.isVisible);
                if (!event.isVisible) {
                    gaplessPlayer.pause();
                    playerManager.pause();
                }
            }
        );

        // Fallback for Android TV OS backgrounding (Home button)
        document.addEventListener('visibilitychange', () => {
            console.log('[BSWN] Document visibility changed. hidden:', document.hidden);
            if (document.hidden) {
                // User explicitly requested to disconnect the cast entirely if the app is backgrounded
                context.stop();
            }
        });


    }

    // Wake Lock: keep the screen on (works on some Cast devices/browsers)
    async function keepAwake() {
        try {
            if ('wakeLock' in navigator) {
                const wakeLock = await navigator.wakeLock.request('screen');
                wakeLock.addEventListener('release', () => keepAwake());
            }
        } catch {
            // Expected on devices that don't support the Wake Lock API — silent fail
        }
    }
    keepAwake();
};

// Auto-init if we are in the browser
if (typeof window !== 'undefined') {
    window.addEventListener('load', () => {
        initApp();
    });
}
