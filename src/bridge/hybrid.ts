import type { IBridge } from './index';
import { createHttpBridge, setServerPort } from './http';
import { tauriBridge } from './tauri';

export async function initHybridBridge(): Promise<IBridge> {
  const port = await getServerPort();
  setServerPort(port);

  const httpBridge = createHttpBridge();

  return {
    ...tauriBridge,
    ...httpBridge,
  };
}

interface MusicliWindow {
  __MUSICLI_PORT__?: number;
}

async function getServerPort(): Promise<number> {
  for (let i = 0; i < 50; i++) {
    const port = (window as unknown as MusicliWindow).__MUSICLI_PORT__;
    if (port) return port;
    await new Promise(r => setTimeout(r, 100));
  }
  return 3000;
}
