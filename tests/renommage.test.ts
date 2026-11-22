// Le nom de l'outil est « Labije Cab » : aucun texte du code source ne doit encore dire « BeBess'Invest ».
// Les identifiants d'infrastructure (Workers, base D1, bucket) et le contenu des cabinets de démonstration (seeds/) sont exclus :
// ils ne sont pas dans src/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { creerMailer } from '../src/lib/mail';

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

test('l’en-tête d’un courriel : le nom d’expéditeur envoyé au fournisseur est « Labije Cab » (fournisseur simulé)', async () => {
  const vrai = globalThis.fetch;
  let corps: { from: { email: string; name: string }; to: { email: string }[]; subject: string } | null = null;
  globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
    corps = JSON.parse(init.body);
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  try {
    const m = creerMailer({ MAIL_DRIVER: 'scaleway', SCW_SECRET_KEY: 'x', SCW_PROJECT_ID: 'p', MAIL_FROM: 'noreply@exemple.test' } as never, 'cabinet.test');
    await m.envoyer('client@exemple.test', 'Sujet', 'Texte');
  } finally {
    globalThis.fetch = vrai;
  }
  assert.deepEqual(corps!.from, { email: 'noreply@exemple.test', name: 'Labije Cab' });
});
