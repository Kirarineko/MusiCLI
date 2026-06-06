// Dev script: starts Vite dev server then launches Electron
import { spawn } from 'child_process';
import { createServer } from 'vite';

async function start() {
  const server = await createServer({
    configFile: './vite.config.ts',
  });
  await server.listen();

  const address = server.httpServer.address();
  const url = `http://localhost:${address.port}`;
  console.log(`[dev] Vite server ready at ${url}`);
  console.log('[dev] Launching Electron...');

  const electron = spawn('npx', ['electron', '.'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: url },
    shell: true,
  });

  electron.on('close', (code) => {
    console.log(`[dev] Electron exited with code ${code}`);
    server.close();
    process.exit(code);
  });

  electron.on('error', (err) => {
    console.error('[dev] Failed to launch Electron:', err);
    server.close();
    process.exit(1);
  });
}

start().catch(err => {
  console.error('[dev] Failed to start:', err);
  process.exit(1);
});
