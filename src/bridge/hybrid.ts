import type { IBridge } from './index';
import { createHttpBridge, setServerPort } from './http';
import { tauriBridge } from './tauri';

export async function initHybridBridge(): Promise<IBridge> {
  // In Tauri context, prefer Tauri invoke for data.
  // HTTP is only used for the audio engine when the server is explicitly running.
  const isTauri = !!(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;

  if (isTauri) {
    // Try to detect if HTTP server is running (port available)
    const port = await tryGetServerPort();
    if (port) {
      setServerPort(port);
      const httpBridge = createHttpBridge();
      // Only let HTTP override the AUDIO ENGINE methods. File I/O, config,
      // lyrics, sync, and dialogs must stay on Tauri invoke so they work
      // regardless of the HTTP server's audio-only file restrictions.
      return {
        ...tauriBridge,
        audioPlay: httpBridge.audioPlay,
        audioPause: httpBridge.audioPause,
        audioStop: httpBridge.audioStop,
        audioSeek: httpBridge.audioSeek,
        setVolume: httpBridge.setVolume,
        getPosition: httpBridge.getPosition,
        getDuration: httpBridge.getDuration,
        setAudioMode: httpBridge.setAudioMode,
        getAudioMode: httpBridge.getAudioMode,
        listAudioDevices: httpBridge.listAudioDevices,
      } as IBridge;
    }
    // No server running — use Tauri invoke only
    return tauriBridge as unknown as IBridge;
  }

  // Browser dev mode — use HTTP bridge with Tauri stubs
  const port = 3000;
  setServerPort(port);
  const httpBridge = createHttpBridge();
  return {
    ...tauriBridge,
    ...httpBridge,
  };
}

async function tryGetServerPort(): Promise<number> {
  for (let i = 0; i < 10; i++) {
    const port = (window as unknown as Record<string, number>).__MUSICLI_PORT__;
    if (port) return port;
    await new Promise(r => setTimeout(r, 50));
  }
  return 0;
}
