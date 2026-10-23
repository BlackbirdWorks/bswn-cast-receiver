import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { handleLoadRequest, gaplessPlayer, loadingEl, initApp } from '../src/app';

describe('Receiver App Logic', () => {
    let mockRequest;
    
    beforeEach(() => {
        // Reset DOM and Mocks
        document.body.innerHTML = '<video id="stealth-audio-player"></video><video id="dummy-video" src="dummy.mp4"></video>';
        
        mockRequest = {
            media: {
                contentId: 'test-id',
                contentUrl: 'test-url',
                metadata: { title: 'Test Track' }
            }
        };

        // Mock gaplessPlayer methods
        vi.spyOn(gaplessPlayer, 'removeAllTracks').mockImplementation(() => {});
        vi.spyOn(gaplessPlayer, 'addTrack').mockImplementation(() => {});
        vi.spyOn(gaplessPlayer, 'play').mockImplementation(() => {});
        
        // Mock global fetch for local server testing
        global.fetch = vi.fn();
        
        // Mock cast globals
        global.cast = {
            framework: {
                system: {
                    EventType: {
                        VISIBILITY_CHANGED: 'VISIBILITY_CHANGED',
                        STANDBY_CHANGED: 'STANDBY_CHANGED'
                    }
                },
                messages: {
                    StreamType: { BUFFERED: 'BUFFERED' },
                    PlayerState: { PAUSED: 'PAUSED', PLAYING: 'PLAYING' },
                    MessageType: { LOAD: 'LOAD' }
                },
                events: {
                    EventType: {
                        PAUSE: 'PAUSE',
                        PLAYING: 'PLAYING',
                        MEDIA_STATUS: 'MEDIA_STATUS'
                    }
                },
                CastReceiverOptions: class {},
                CastReceiverContext: {
                    getInstance: () => ({
                        addEventListener: (event, cb) => {
                            if (event === 'VISIBILITY_CHANGED') global.mockVisibilityCb = cb;
                        },
                        getPlayerManager: () => ({
                            setMediaElement: vi.fn(),
                            addEventListener: (event, cb) => {
                                // Save callbacks to trigger them in tests
                                if (event === 'PAUSE') global.mockPauseCb = cb;
                                if (event === 'PLAYING') global.mockPlayingCb = cb;
                                if (event === 'MEDIA_STATUS') global.mockMediaStatusCb = cb;
                            },
                            setMessageInterceptor: (type, cb) => {
                                if (type === 'LOAD') global.mockLoadInterceptor = cb;
                            },
                            pause: () => {
                                if (global.mockPlayerManagerPause) global.mockPlayerManagerPause();
                            }
                        }),
                        start: vi.fn(),
                        stop: () => {
                            if (global.mockContextStop) global.mockContextStop();
                        }
                    })
                }
            }
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should reject LOAD request if request or url is missing', async () => {
        expect(await handleLoadRequest(null, 'dummy.mp4', false)).toBeNull();
        expect(await handleLoadRequest({}, 'dummy.mp4', false)).toBeNull();
        mockRequest.media.contentId = null;
        mockRequest.media.contentUrl = null;
        const result = await handleLoadRequest(mockRequest, 'dummy.mp4', false);
        expect(result).toBeNull();
    });

    it('should set dummy video URL on request and play actual URL on Gapless5', async () => {
        const dummyUrl = 'assets/dummy-v2.mp4';
        const expectedUrl = 'test-url';

        const result = await handleLoadRequest(mockRequest, dummyUrl, false);

        // Gapless5 should receive the real URL
        expect(gaplessPlayer.removeAllTracks).toHaveBeenCalled();
        expect(gaplessPlayer.addTrack).toHaveBeenCalledWith(expectedUrl);
        expect(gaplessPlayer.play).toHaveBeenCalled();

        // CAF Request should be modified to the dummy video
        expect(result.media.contentUrl).toBe(dummyUrl);
        expect(result.media.contentId).toBe(dummyUrl);
        expect(result.media.streamType).toBe('BUFFERED');

        // Loading UI should be updated
        expect(loadingEl.style.display).toBe('block');
        expect(loadingEl.innerText).toContain('Test Track');
    });

    it('should set dummy audio URL if contentType indicates audio', async () => {
        mockRequest.media.contentType = 'audio/ogg';
        const expectedUrl = 'test-url';

        const result = await handleLoadRequest(mockRequest, 'assets/dummy-v2.mp4', false);

        // Gapless5 should receive the real URL
        expect(gaplessPlayer.removeAllTracks).toHaveBeenCalled();
        expect(gaplessPlayer.addTrack).toHaveBeenCalledWith(expectedUrl);
        expect(gaplessPlayer.play).toHaveBeenCalled();

        // CAF Request should be modified to the dummy audio
        expect(result.media.contentUrl).toBe('assets/dummy.mp3');
        expect(result.media.contentId).toBe('assets/dummy.mp3');
        expect(result.media.contentType).toBe('audio/mp3');
        
        // Reset for other tests
        mockRequest.media.contentType = 'video/mp4';
    });

    it('should fallback to GitHub Pages URL if local server fetch fails', async () => {
        // Simulate a timeout/error on the HEAD request
        global.fetch.mockRejectedValue(new Error('Network timeout'));
        
        mockRequest.media.contentUrl = 'http://192.168.1.5:8080/audio/pink_noise.opus';
        
        const dummyUrl = 'dummy-v2.mp4';
        await handleLoadRequest(mockRequest, dummyUrl, true);
        
        const expectedFallbackUrl = 'https://blackbirdworks.github.io/bswn-cast-receiver/assets/pink_noise.opus';
        
        // Gapless5 should receive the fallback URL
        expect(gaplessPlayer.addTrack).toHaveBeenCalledWith(expectedFallbackUrl);
    });

    it('should use local URL if local server responds OK', async () => {
        global.fetch.mockResolvedValue({ ok: true, status: 200 });
        
        const originalUrl = 'http://192.168.1.5:8080/audio/brown_noise.opus';
        mockRequest.media.contentUrl = originalUrl;
        
        const dummyUrl = 'dummy-v2.mp4';
        await handleLoadRequest(mockRequest, dummyUrl, true);
        
        // Gapless5 should receive the original local URL
        expect(gaplessPlayer.addTrack).toHaveBeenCalledWith(originalUrl);
    });

    it('should support dynamic ephemeral port in local URL', async () => {
        global.fetch.mockResolvedValue({ ok: true, status: 200 });

        const dynamicPortUrl = 'http://192.168.1.5:45678/audio/brown_noise.opus';
        mockRequest.media.contentUrl = dynamicPortUrl;

        await handleLoadRequest(mockRequest, 'dummy-v2.mp4', false);

        expect(gaplessPlayer.addTrack).toHaveBeenCalledWith(dynamicPortUrl);
    });
    it('should fallback when fetch responds with non-ok status', async () => {
        global.fetch.mockResolvedValue({ ok: false, status: 500 });
        const originalUrl = 'http://192.168.1.5:8080/audio/brown_noise.opus';
        mockRequest.media.contentUrl = originalUrl;
        await handleLoadRequest(mockRequest, 'dummy.mp4', true);
        const expectedFallbackUrl = 'https://blackbirdworks.github.io/bswn-cast-receiver/assets/brown_noise.opus';
        expect(gaplessPlayer.addTrack).toHaveBeenCalledWith(expectedFallbackUrl);
    });

    it('should abort stale LOAD request when superseded by a newer LOAD request', async () => {
        let rejectFirstFetch;
        global.fetch
            .mockImplementationOnce(
                (_url, { signal }) =>
                    new Promise((_resolve, reject) => {
                        rejectFirstFetch = () => {
                            const err = new Error('Aborted');
                            err.name = 'AbortError';
                            reject(err);
                        };
                        signal.addEventListener('abort', rejectFirstFetch);
                    })
            )
            .mockResolvedValueOnce({ ok: true, status: 200 });

        const req1 = {
            media: {
                contentUrl: 'http://192.168.1.5:8080/audio/pink_noise.opus',
                metadata: { title: 'Pink' }
            }
        };
        const req2 = {
            media: {
                contentUrl: 'http://192.168.1.5:8080/audio/rain.opus',
                metadata: { title: 'Rain' }
            }
        };

        const p1 = handleLoadRequest(req1, 'dummy-v2.mp4', true);
        const p2 = handleLoadRequest(req2, 'dummy-v2.mp4', true);

        const [res1, res2] = await Promise.all([p1, p2]);
        expect(res1.media.contentUrl).toBe('dummy-v2.mp4');
        expect(res2.media.contentUrl).toBe('dummy-v2.mp4');
        expect(gaplessPlayer.addTrack).toHaveBeenCalledTimes(1);
        expect(gaplessPlayer.addTrack).toHaveBeenCalledWith('http://192.168.1.5:8080/audio/rain.opus');
    });

    it('should initialize the app correctly', () => {
        initApp();
        expect(document.body.contains(loadingEl)).toBe(true);
    });

    it('should hide loading text when gaplessPlayer plays', () => {
        initApp();
        loadingEl.style.display = 'block';
        gaplessPlayer.onplay();
        expect(loadingEl.style.display).toBe('none');
    });

    it('should retry with fallback URL if gaplessPlayer fails on a local track', () => {
        initApp();
        gaplessPlayer.onerror('http://192.168.1.5:8080/audio/rain.opus', 'Decode error');
        expect(gaplessPlayer.removeAllTracks).toHaveBeenCalled();
        expect(gaplessPlayer.addTrack).toHaveBeenCalledWith(
            'https://blackbirdworks.github.io/bswn-cast-receiver/assets/rain.opus'
        );
        expect(gaplessPlayer.play).toHaveBeenCalled();
    });

    it('should hide loading text if gaplessPlayer fails on a fallback track', () => {
        initApp();
        loadingEl.style.display = 'block';
        gaplessPlayer.onerror(
            'https://blackbirdworks.github.io/bswn-cast-receiver/assets/rain.opus',
            'Network error'
        );
        expect(loadingEl.style.display).toBe('none');
    });

    it('should sync CAF paused/playing states with gaplessPlayer', () => {
        vi.spyOn(gaplessPlayer, 'pause').mockImplementation(() => {});
        initApp();
        
        // Trigger PAUSED
        global.mockPauseCb();
        expect(gaplessPlayer.pause).toHaveBeenCalled();
        
        // Trigger PLAYING
        global.mockPlayingCb();
        expect(gaplessPlayer.play).toHaveBeenCalled();
    });

    it('should reinforce loop=true on MEDIA_STATUS', () => {
        initApp();
        const stealthPlayer = document.getElementById('stealth-audio-player');
        stealthPlayer.loop = false;
        
        global.mockMediaStatusCb();
        expect(stealthPlayer.loop).toBe(true);
    });

    it('should disable HTML5 audio fallback in Gapless5 to prevent duplicate downloads', () => {
        expect(gaplessPlayer.useHTML5Audio).toBe(false);
    });

    it('should acquire wakeLock when visible and re-acquire on visibilitychange after release', async () => {
        let releaseCb = null;
        const mockWakeLockSentinel = {
            addEventListener: vi.fn((event, cb) => {
                if (event === 'release') releaseCb = cb;
            })
        };
        const requestMock = vi.fn().mockResolvedValue(mockWakeLockSentinel);
        Object.defineProperty(navigator, 'wakeLock', {
            value: { request: requestMock },
            configurable: true
        });

        initApp();
        await Promise.resolve();
        expect(requestMock).toHaveBeenCalledTimes(1);

        // Simulate lock release and visibilitychange
        releaseCb();
        document.dispatchEvent(new Event('visibilitychange'));
        await Promise.resolve();
        expect(requestMock).toHaveBeenCalledTimes(2);

        delete navigator.wakeLock;
    });

    it('should dynamically create audio/video elements when missing and handle TV visibility/interceptor callbacks', async () => {
        document.body.innerHTML = '';
        const origUserAgent = navigator.userAgent;
        Object.defineProperty(navigator, 'userAgent', {
            value: 'Mozilla/5.0 (Linux; Android 12; BRAVIA)',
            configurable: true
        });

        vi.spyOn(gaplessPlayer, 'pause').mockImplementation(() => {});
        global.mockPlayerManagerPause = vi.fn();
        global.mockContextStop = vi.fn();

        initApp();

        expect(document.getElementById('stealth-audio-player')?.tagName).toBe('VIDEO');
        expect(document.getElementById('dummy-video')?.tagName).toBe('VIDEO');

        // Invoke LOAD interceptor registered in initApp
        const intercepted = await global.mockLoadInterceptor(mockRequest);
        expect(intercepted.media.contentId).toContain('dummy-v2.mp4');

        // Invoke VISIBILITY_CHANGED callback with isVisible = false
        global.mockVisibilityCb({ isVisible: false });
        expect(gaplessPlayer.pause).toHaveBeenCalled();
        expect(global.mockPlayerManagerPause).toHaveBeenCalled();

        // Simulate document.hidden = true on visibilitychange
        Object.defineProperty(document, 'hidden', { value: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        expect(global.mockContextStop).toHaveBeenCalled();

        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        Object.defineProperty(navigator, 'userAgent', { value: origUserAgent, configurable: true });
    });

    it('should dynamically create audio element on non-Android-TV when missing', () => {
        document.body.innerHTML = '';
        initApp();
        expect(document.getElementById('stealth-audio-player')?.tagName).toBe('AUDIO');
    });
});
