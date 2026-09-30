import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjectEnv } from './loadEnv.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = resolve(__dirname, '..');
const pidDir = resolve(projectRoot, '.service-pids');
const logDir = resolve(projectRoot, 'logs');

loadProjectEnv(projectRoot);

const DEFAULT_SAVE_SERVER_PORT = process.env.SAVE_SERVER_PORT ?? '3001';
const DEFAULT_ADMIN_SERVER_PORT = process.env.ADMIN_SERVER_PORT ?? '3002';
const DEFAULT_VITE_PORT = process.env.VITE_PORT ?? '5173';
const MONGO_SERVICE_NAME = process.env.MONGO_SERVICE_NAME ?? 'MongoDB';
const SERVICE_ORDER = ['mongo', 'api', 'client'];
const STOP_ORDER = [...SERVICE_ORDER].reverse();

function ensureDirs() {
  mkdirSync(pidDir, { recursive: true });
  mkdirSync(logDir, { recursive: true });
}

function pidPath(service) {
  return resolve(pidDir, `${service}.json`);
}

function readPid(service) {
  const filePath = pidPath(service);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writePid(service, data) {
  writeFileSync(pidPath(service), JSON.stringify(data, null, 2));
}

function removePid(service) {
  rmSync(pidPath(service), { force: true });
}

function isProcessRunning(pid) {
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function canListen(port) {
  return new Promise((resolvePromise) => {
    const server = createServer();

    server.once('error', () => {
      resolvePromise(false);
    });
    server.once('listening', () => {
      server.close(() => resolvePromise(true));
    });
    server.listen(Number(port), '127.0.0.1');
  });
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      shell: false,
      windowsHide: true,
      ...options,
    });
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      resolvePromise({ code: 1, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on('close', (code) => {
      resolvePromise({ code: code ?? 0, stdout, stderr });
    });
  });
}

async function taskkill(pid) {
  if (!pid || !isProcessRunning(pid)) {
    return true;
  }

  if (process.platform === 'win32') {
    const result = await run('taskkill.exe', ['/PID', String(pid), '/T', '/F']);
    return result.code === 0;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return true;
  }

  return true;
}

async function getMongoStatus() {
  if (process.platform !== 'win32') {
    return { exists: false, status: 'unsupported', message: 'Mongo service control is implemented for Windows service installs.' };
  }

  const result = await run('powershell.exe', [
    '-NoProfile',
    '-Command',
    `(Get-Service -Name '${MONGO_SERVICE_NAME}' -ErrorAction SilentlyContinue).Status`,
  ]);
  const status = result.stdout.trim();

  return {
    exists: Boolean(status),
    status: status || 'not-found',
    message: result.stderr.trim(),
  };
}

async function setMongoService(action) {
  if (process.platform !== 'win32') {
    console.log(`mongo: 当前平台不支持脚本控制系统服务，请手动 ${action === 'start' ? '启动' : '停止'} MongoDB。`);
    return;
  }

  const verb = action === 'start' ? 'Start-Service' : 'Stop-Service';
  const result = await run('powershell.exe', [
    '-NoProfile',
    '-Command',
    `${verb} -Name '${MONGO_SERVICE_NAME}' -ErrorAction Stop`,
  ]);

  if (result.code === 0) {
    console.log(`mongo: ${action === 'start' ? '已启动' : '已停止'} Windows 服务 ${MONGO_SERVICE_NAME}`);
    return;
  }

  console.log(`mongo: 操作失败。请用管理员权限运行，或手动执行 ${verb} ${MONGO_SERVICE_NAME}`);
  if (result.stderr.trim()) {
    console.log(result.stderr.trim());
  }
}

async function startNodeService(service, args, env = {}, ports = []) {
  ensureDirs();

  const current = readPid(service);
  if (current?.pid && isProcessRunning(current.pid)) {
    console.log(`${service}: 已运行 pid=${current.pid}`);
    return;
  }

  const portList = Array.isArray(ports) ? ports.filter(Boolean) : [ports].filter(Boolean);

  for (const port of portList) {
    if (!(await canListen(port))) {
      console.log(`${service}: 端口 ${port} 已被占用。请先停止旧服务，或设置环境变量改用其他端口。`);
      return;
    }
  }

  const stdout = openSync(resolve(logDir, `${service}.out.log`), 'a');
  const stderr = openSync(resolve(logDir, `${service}.err.log`), 'a');
  const child = spawn(process.execPath, args, {
    cwd: projectRoot,
    detached: true,
    env: {
      ...process.env,
      SAVE_SERVER_PORT: DEFAULT_SAVE_SERVER_PORT,
      ADMIN_SERVER_PORT: DEFAULT_ADMIN_SERVER_PORT,
      VITE_PORT: DEFAULT_VITE_PORT,
      ...env,
    },
    stdio: ['ignore', stdout, stderr],
    windowsHide: true,
  });

  child.unref();
  writePid(service, {
    pid: child.pid,
    startedAt: Date.now(),
    args,
  });
  console.log(`${service}: 已启动 pid=${child.pid}`);
}

async function stopNodeService(service) {
  const current = readPid(service);

  if (!current?.pid) {
    console.log(`${service}: 未找到 pid 记录`);
    return;
  }

  if (!isProcessRunning(current.pid)) {
    removePid(service);
    console.log(`${service}: pid 已失效，已清理记录`);
    return;
  }

  const stopped = await taskkill(current.pid);

  if (stopped) {
    removePid(service);
    console.log(`${service}: 已停止 pid=${current.pid}`);
  } else {
    console.log(`${service}: 停止失败 pid=${current.pid}`);
  }
}

async function startService(service) {
  if (service === 'mongo') {
    await setMongoService('start');
    return;
  }

  if (service === 'api') {
    await startNodeService('api', ['server/index.js'], {}, [DEFAULT_SAVE_SERVER_PORT, DEFAULT_ADMIN_SERVER_PORT]);
    return;
  }

  if (service === 'client') {
    await startNodeService('client', [
      'node_modules/vite/bin/vite.js',
      '--host',
      '0.0.0.0',
      '--port',
      DEFAULT_VITE_PORT,
      '--strictPort',
    ], {}, [DEFAULT_VITE_PORT]);
    return;
  }

  throw new Error(`未知服务：${service}`);
}

async function stopService(service) {
  if (service === 'mongo') {
    await setMongoService('stop');
    return;
  }

  if (service === 'api' || service === 'client') {
    await stopNodeService(service);
    return;
  }

  throw new Error(`未知服务：${service}`);
}

async function statusService(service) {
  if (service === 'mongo') {
    const status = await getMongoStatus();
    console.log(`mongo: ${status.status}`);
    return;
  }

  const current = readPid(service);
  const running = current?.pid ? isProcessRunning(current.pid) : false;
  console.log(`${service}: ${running ? `running pid=${current.pid}` : 'stopped'}`);
}

function expandTargets(target) {
  if (!target || target === 'all') {
    return SERVICE_ORDER;
  }

  if (!SERVICE_ORDER.includes(target)) {
    throw new Error(`未知服务：${target}。可用服务：all, ${SERVICE_ORDER.join(', ')}`);
  }

  return [target];
}

async function main() {
  const [action = 'status', target = 'all'] = process.argv.slice(2);

  if (!['start', 'stop', 'restart', 'status'].includes(action)) {
    throw new Error('用法：node scripts/services.js <start|stop|restart|status> [all|mongo|api|client]');
  }

  if (action === 'start') {
    for (const service of expandTargets(target)) {
      await startService(service);
    }
    return;
  }

  if (action === 'stop') {
    const targets = target === 'all' || !target ? STOP_ORDER : expandTargets(target);
    for (const service of targets) {
      await stopService(service);
    }
    return;
  }

  if (action === 'restart') {
    const stopTargets = target === 'all' || !target ? STOP_ORDER : expandTargets(target);
    const startTargets = expandTargets(target);

    for (const service of stopTargets) {
      await stopService(service);
    }
    for (const service of startTargets) {
      await startService(service);
    }
    return;
  }

  for (const service of expandTargets(target)) {
    await statusService(service);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
