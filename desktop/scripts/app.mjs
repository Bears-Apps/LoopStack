// `npm run desktop:app`: open LoopStack in Electron. Uses the Vite dev server
// on :5190 when it's running (npm run desktop:dev), otherwise the built
// renderer in desktop/dist, building it first if it isn't there.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(desktop, '..');
const DEV = 'http://localhost:5190';

async function devUp() {
  try {
    const r = await fetch(DEV, { signal: AbortSignal.timeout(800) });
    return r.ok;
  } catch {
    return false;
  }
}

const env = { ...process.env };
if (await devUp()) {
  env.LOOPSTACK_DEV_URL = DEV;
  console.log(`LoopStack: using the dev server at ${DEV}`);
} else {
  delete env.LOOPSTACK_DEV_URL;
  if (!fs.existsSync(path.join(desktop, 'dist', 'index.html'))) {
    console.log('LoopStack: building the renderer into desktop/dist');
    const b = spawnSync('npm', ['run', 'desktop:build'], { cwd: root, stdio: 'inherit' });
    if (b.status !== 0) process.exit(b.status ?? 1);
  }
  console.log('LoopStack: using the build in desktop/dist');
}

const electron = createRequire(path.join(desktop, 'package.json'))('electron');
const child = spawn(electron, [desktop], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
