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
                        addEventListener: vi.fn(),
                        getPlayerManager: () => ({
                            setMediaElement: vi.fn(),
                            addEventListener: (event, cb) => {
                                // Save callbacks to trigger them in tests
                                if (event === 'PAUSE') global.mockPauseCb = cb;
                                if (event === 'PLAYING') global.mockPlayingCb = cb;
                                if (event === 'MEDIA_STATUS') global.mockMediaStatusCb = cb;
                            },
                            setMessageInterceptor: vi.fn()
                        }),
                        start: vi.fn()
                    })
                }
            }
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should reject LOAD request if url is missing', async () => {
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
    it('should fallback when fetch responds with non-ok status', async () => {
        global.fetch.mockResolvedValue({ ok: false, status: 500 });
        const originalUrl = 'http://192.168.1.5:8080/audio/brown_noise.opus';
        mockRequest.media.contentUrl = originalUrl;
        await handleLoadRequest(mockRequest, 'dummy.mp4', true);
        const expectedFallbackUrl = 'https://blackbirdworks.github.io/bswn-cast-receiver/assets/brown_noise.opus';
        expect(gaplessPlayer.addTrack).toHaveBeenCalledWith(expectedFallbackUrl);
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
});
