import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function parseEnvContent(content) {
  const result = {};
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);

  for (let line of lines) {
    line = line.trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    if (line.startsWith('export ')) {
      line = line.slice(7).trim();
    }

    const equalsIndex = line.indexOf('=');

    if (equalsIndex <= 0) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();

    if (!key) {
      continue;
    }

    let value = line.slice(equalsIndex + 1);

    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t');
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    } else {
      const hashIndex = value.indexOf(' #');

      if (hashIndex >= 0) {
        value = value.slice(0, hashIndex);
      }

      value = value.trim();
    }

    result[key] = value;
  }

  return result;
}

export function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return false;
  }

  const parsed = parseEnvContent(readFileSync(filePath, 'utf8'));

  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  return true;
}

export function loadProjectEnv(projectRoot, fileNames = ['.env', '.env.local']) {
  for (const fileName of fileNames) {
    loadEnvFile(resolve(projectRoot, fileName));
  }
}
