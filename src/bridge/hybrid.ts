import type { IBridge } from './index';
import { createHttpBridge, setServerPort } from './http';
import { tauriBridge } from './tauri';

export async function initHybridBridge(): Promise<IBridge> {
  // In Tauri context, prefer Tauri invoke for data.
  // HTTP is only used when the server is explicitly running.
  const isTauri = !!(window as any).__TAURI_INTERNALS__;

  if (isTauri) {
    // Try to detect if HTTP server is running (port available)
    const port = await tryGetServerPort();
    if (port) {
      setServerPort(port);
      const httpBridge = createHttpBridge();
      return {
        ...tauriBridge,
        ...httpBridge, // HTTP overrides if server is running
      };
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
  for (let i = 0; i < 30; i++) {
    const port = (window as any).__MUSICLI_PORT__;
    if (port) return port;
    await new Promise(r => setTimeout(r, 100));
  }
  return 0;
}
