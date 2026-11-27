// Serveur local pour tester le SDK 1.x dans un vrai navigateur contre BNAAS (test).
//
//   npm run test:navigateur      → build du SDK puis http://localhost:8765
//
// Port et chemin imposés par le client de test « bnaas-smoke » enregistré sur le Gateway
// de test (redirect_uri = http://localhost:8765/callback). Écoute sur localhost seulement.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const PORT = 8765;

const routes = {
  '/': [join(here, 'index.html'), 'text/html; charset=utf-8'],
  '/callback': [join(here, 'callback.html'), 'text/html; charset=utf-8'],
  '/sdk.js': [join(root, 'dist', 'index.js'), 'text/javascript; charset=utf-8'],
};

createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', `http://localhost:${PORT}`).pathname;
  const route = routes[path];
  if (!route) { res.writeHead(404).end('Introuvable'); return; }
  try {
    const body = await readFile(route[0]);
    res.writeHead(200, { 'Content-Type': route[1], 'Cache-Control': 'no-store' }).end(body);
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      .end(path === '/sdk.js' ? 'dist/index.js absent : lancer « npm run build ».' : 'Erreur de lecture.');
  }
}).listen(PORT, 'localhost', () => {
  console.log(`Page de test : http://localhost:${PORT}/   (Ctrl+C pour arrêter)`);
});
