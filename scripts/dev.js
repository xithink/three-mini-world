import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjectEnv } from './loadEnv.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = resolve(__dirname, '..');

loadProjectEnv(projectRoot);

const processes = [];
let isShuttingDown = false;

function startProcess(name, command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: projectRoot,
    env: {
      ...process.env,
      SAVE_SERVER_PORT: process.env.SAVE_SERVER_PORT ?? '3001',
      ADMIN_SERVER_PORT: process.env.ADMIN_SERVER_PORT ?? '3002',
      ...env,
    },
    shell: false,
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[${name}] ${chunk}`);
  });
  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[${name}] ${chunk}`);
  });
  child.on('exit', (code) => {
    if (isShuttingDown) {
      return;
    }

    console.error(`[${name}] exited with code ${code}`);
    shutdown(code ?? 1);
  });

  processes.push(child);

  return child;
}

function shutdown(exitCode = 0) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  processes.forEach((child) => {
    if (!child.killed) {
      child.kill();
    }
  });
  setTimeout(() => process.exit(exitCode), 200);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

startProcess('api', process.execPath, ['server/index.js']);
startProcess('vite', process.execPath, [
  'node_modules/vite/bin/vite.js',
  '--host',
  '0.0.0.0',
  '--port',
  process.env.VITE_PORT ?? '5173',
  '--strictPort',
]);
