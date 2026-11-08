// Tiny static server for the local Monaco fixture (no dependencies).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = join(root, 'e2e', 'fixture');
const monacoDir = join(root, 'node_modules', 'monaco-editor', 'min');
const port = Number(process.env.FIXTURE_PORT || 4173);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.json': 'application/json' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let base = fixtureDir;
  let rel = url.pathname;
  if (rel.startsWith('/monaco/')) {
    base = monacoDir;
    rel = rel.slice('/monaco'.length);
  }
  if (rel === '/') rel = '/mock-scrimba.html';
  const file = normalize(join(base, rel));
  if (!file.startsWith(base)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`fixture server on http://127.0.0.1:${port}`));
