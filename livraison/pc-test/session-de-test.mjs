// Outil de TEST : ouvre une session sans courriel pour un compte, sur la base LOCALE (wrangler --local).
//
//   node livraison/pc-test/session-de-test.mjs --lister
//   node livraison/pc-test/session-de-test.mjs usr_gestionnaire
//   node livraison/pc-test/session-de-test.mjs usr_claire --persist-to D:\donnees-test
//
// Il écrit dans la table `session` le HASH SHA-256 d'un secret aléatoire (comme le fait le produit) et affiche le secret : c'est la valeur
// à poser dans le cookie « bbs » du navigateur (voir PROCEDURE-WINDOWS.md). Le secret n'est jamais stocké en clair.
//
// Garde-fous : `--local` est écrit en dur, ce script n'atteint jamais une base distante ; aucune dépendance.

import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const option = (nom) => {
  const i = args.indexOf(nom);
  return i >= 0 ? args[i + 1] : undefined;
};
const base = option('--base') ?? 'bebess';
const persist = option('--persist-to');
const lister = args.includes('--lister');
const utilisateur = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--base' && args[i - 1] !== '--persist-to');

if (!lister && !utilisateur) {
  console.error('Usage : node livraison/pc-test/session-de-test.mjs <identifiant_utilisateur> [--base bebess] [--persist-to dossier]');
  console.error('        node livraison/pc-test/session-de-test.mjs --lister');
  process.exit(1);
}

// Wrangler est lancé par Node directement (pas par npx ni par un shell) : même comportement sous Windows, macOS et Linux, sans problème de guillemets.
const WRANGLER = join(process.cwd(), 'node_modules', 'wrangler', 'bin', 'wrangler.js');
if (!existsSync(WRANGLER)) {
  console.error('Wrangler introuvable : lancez ce script depuis le dossier du projet, après « npm install ».');
  process.exit(1);
}

function wrangler(extra) {
  const cmd = [WRANGLER, 'd1', 'execute', base, '--local', ...(persist ? ['--persist-to', persist] : []), ...extra];
  return spawnSync(process.execPath, cmd, { encoding: 'utf8' });
}

if (lister) {
  const r = wrangler(['--command', "SELECT id, email, role, tenant_id FROM utilisateur ORDER BY tenant_id, role, email", '--json']);
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    process.exit(1);
  }
  try {
    const sortie = JSON.parse(r.stdout);
    for (const l of sortie[0].results) console.log(`${l.id}\t${l.role}\t${l.email}\t(${l.tenant_id})`);
  } catch {
    console.log(r.stdout);
  }
  process.exit(0);
}

if (!/^[A-Za-z0-9_-]{1,80}$/.test(utilisateur)) {
  console.error('Identifiant d\'utilisateur invalide.');
  process.exit(1);
}

const secret = randomBytes(32).toString('hex');
const hash = createHash('sha256').update(secret).digest('hex');
const maintenant = new Date();
const expire = new Date(maintenant.getTime() + 30 * 24 * 3600 * 1000);
const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

const dossier = mkdtempSync(join(tmpdir(), 'session-test-'));
const fichier = join(dossier, 'session.sql');
writeFileSync(
  fichier,
  `INSERT INTO session (id, utilisateur_id, expire_le, cree_le) SELECT '${hash}', id, '${iso(expire)}', '${iso(maintenant)}' FROM utilisateur WHERE id = '${utilisateur}';\n`,
);
const r = wrangler([`--file=${fichier}`]);
rmSync(dossier, { recursive: true, force: true });
if (r.status !== 0) {
  console.error(r.stderr || r.stdout);
  process.exit(1);
}

// La ligne n'est insérée que si l'utilisateur existe : on le vérifie.
const v = wrangler(['--command', `SELECT count(*) AS n FROM session WHERE id = '${hash}'`, '--json']);
let ok = false;
try {
  ok = JSON.parse(v.stdout)[0].results[0].n === 1;
} catch {
  /* sortie illisible : traité comme un échec */
}
if (!ok) {
  console.error(`Aucun utilisateur « ${utilisateur} » : aucune session créée. Essayez --lister.`);
  process.exit(1);
}

console.log(`Session créée pour ${utilisateur}, valable 30 jours.`);
console.log('');
console.log('Valeur du cookie « bbs » (à ne partager avec personne) :');
console.log(secret);
console.log('');
console.log('Dans le navigateur, sur le site, ouvrez la console (F12) et collez :');
console.log(`document.cookie = "bbs=${secret}; path=/; max-age=2592000; secure"; location.href = "/";`);
