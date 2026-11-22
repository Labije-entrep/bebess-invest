// Le nom de l'outil est « Labije Cab » : aucun texte du code source ne doit encore dire « BeBess'Invest ».
// Les identifiants d'infrastructure (Workers, base D1, bucket) et le contenu des cabinets de démonstration (seeds/) sont exclus :
// ils ne sont pas dans src/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function fichiers(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? fichiers(p) : [p];
  });
}

test('le code source ne nomme plus l’outil BeBess’Invest', () => {
  const restes = fichiers('src').filter((p) => /bebess/i.test(readFileSync(p, 'utf8')));
  assert.deepEqual(restes, []);
});

test('l’expéditeur des courriels et la page de connexion portent le nom Labije Cab', () => {
  assert.match(readFileSync('src/lib/mail.ts', 'utf8'), /name: "Labije Cab"/);
  assert.match(readFileSync('src/layouts/Connexion.astro', 'utf8'), /Labije Cab/);
  assert.equal(JSON.parse(readFileSync('package.json', 'utf8')).name, 'labije-cab');
});
