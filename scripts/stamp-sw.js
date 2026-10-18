import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const swPath = path.resolve('sw.js');
if (!fs.existsSync(swPath)) {
  console.error('sw.js not found!');
  process.exit(1);
}

// Get short git commit hash or timestamp fallback
let versionTag = Date.now().toString(36);
try {
  const gitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  if (gitHash) {
    versionTag = `${gitHash}-${Date.now().toString(36)}`;
  }
} catch (e) {
  // git not available or detached, use timestamp
}

let content = fs.readFileSync(swPath, 'utf8');
// Replace const CACHE_VERSION = ... cleanly
content = content.replace(/const CACHE_VERSION = [^\n;]+;/, `const CACHE_VERSION = 'dairy-erp-v${versionTag}';`);

fs.writeFileSync(swPath, content, 'utf8');
console.log(`[PWA Build] Updated sw.js CACHE_VERSION to: dairy-erp-v${versionTag}`);
