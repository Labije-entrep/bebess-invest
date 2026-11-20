// Une « D1 » en mémoire : node:sqlite (SQLite du runtime, sans dépendance) derrière l'interface Base de src/lib/db.ts.
//
// Fidèle à ce que le code du dépôt en attend :
//   - requêtes préparées et `bind` seulement ; `first`, `all` (`results`), `run` (`meta.changes`) ;
//   - `batch` = UNE transaction, tout ou rien, `changes()` lisible d'une instruction à la suivante ;
//   - clés étrangères actives, déclencheurs et index des vraies migrations (migrations/0001 à 0012, appliquées dans l'ordre) ;
//   - chaque appel est asynchrone : deux appels concurrents s'entrelacent entre leurs `await`, mais un `batch` ne s'entrelace jamais,
//     comme sur D1 qui sérialise les écritures.
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Base, Requete } from '../../src/lib/db';

const MIGRATIONS = fileURLToPath(new URL('../../migrations/', import.meta.url));

type Valeur = unknown;
const lier = (v: Valeur[]): SQLInputValue[] =>
  v.map((x) => {
    if (x === undefined) throw new Error('D1 : undefined ne se lie pas (null attendu)');
    if (typeof x === 'boolean') return x ? 1n : 0n;
    // node:sqlite lie un nombre JavaScript en REAL ; D1 lie un entier en INTEGER : on rétablit ce comportement.
    if (typeof x === 'number' && Number.isSafeInteger(x)) return BigInt(x);
    return x as SQLInputValue;
  });

const estLecture = (sql: string): boolean => /^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql) && !/\bRETURNING\b/i.test(sql);

class RequeteD1 implements Requete {
  constructor(private base: DatabaseSync, readonly sql: string, private valeurs: Valeur[] = []) {}
  bind(...valeurs: Valeur[]): Requete {
    return new RequeteD1(this.base, this.sql, valeurs);
  }
  async first<T = unknown>(): Promise<T | null> {
    return ((this.base.prepare(this.sql).get(...lier(this.valeurs)) as T | undefined) ?? null);
  }
  async all<T = unknown>(): Promise<{ results: T[] }> {
    return { results: this.base.prepare(this.sql).all(...lier(this.valeurs)) as T[] };
  }
  async run(): Promise<unknown> {
    return this.executer();
  }
  /** Synchrone : c'est ce qui rend un `batch` indivisible. */
  executer(): { success: true; meta: { changes: number }; results?: unknown[] } {
    const st = this.base.prepare(this.sql);
    if (estLecture(this.sql)) return { success: true, meta: { changes: 0 }, results: st.all(...lier(this.valeurs)) };
    const r = st.run(...lier(this.valeurs));
    return { success: true, meta: { changes: Number(r.changes) } };
  }
}

export interface BaseTest extends Base {
  /** La base elle-même, pour lire et écrire sans passer par le code testé (fixtures, vérifications). */
  brut: DatabaseSync;
  /** Raccourcis de vérification : une ligne, toutes les lignes. */
  un<T = Record<string, unknown>>(sql: string, ...valeurs: Valeur[]): T | null;
  tous<T = Record<string, unknown>>(sql: string, ...valeurs: Valeur[]): T[];
  exec(sql: string, ...valeurs: Valeur[]): number;
  /** Compte les lignes d'une table (avec une condition facultative). */
  compte(table: string, ou?: string, ...valeurs: Valeur[]): number;
}

/** `jusqua` : s'arrêter à cette migration comprise (« 0013 »), pour éprouver la suivante sur une base qui a déjà des lignes. */
export function baseNeuve(jusqua?: string): BaseTest {
  const brut = new DatabaseSync(':memory:');
  brut.exec('PRAGMA foreign_keys = ON');
  for (const f of listerMigrations().filter((x) => !jusqua || x.slice(0, 4) <= jusqua)) appliquer(brut, f);
  return enrober(brut);
}

export const listerMigrations = (): string[] => readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();

/** Applique une migration comme D1 : dans une transaction. */
export function appliquer(brut: DatabaseSync, f: string): void {
  brut.exec('BEGIN');
  try {
    brut.exec(readFileSync(MIGRATIONS + f, 'utf8'));
    brut.exec('COMMIT');
  } catch (e) {
    brut.exec('ROLLBACK');
    throw new Error(`migration ${f} : ${e instanceof Error ? e.message : e}`);
  }
}

export function enrober(brut: DatabaseSync): BaseTest {
  const db: BaseTest = {
    brut,
    prepare: (sql) => new RequeteD1(brut, sql),
    async batch(requetes) {
      brut.exec('BEGIN');
      try {
        const sorties = requetes.map((r) => (r as RequeteD1).executer());
        brut.exec('COMMIT');
        return sorties;
      } catch (e) {
        brut.exec('ROLLBACK');
        throw e;
      }
    },
    un: (sql, ...v) => (brut.prepare(sql).get(...lier(v)) as never) ?? null,
    tous: (sql, ...v) => brut.prepare(sql).all(...lier(v)) as never,
    exec: (sql, ...v) => Number(brut.prepare(sql).run(...lier(v)).changes),
    compte: (table, ou, ...v) => Number((brut.prepare(`SELECT COUNT(*) AS n FROM ${table}${ou ? ` WHERE ${ou}` : ''}`).get(...lier(v)) as { n: number }).n),
  };
  return db;
}

/**
 * Une copie intégrale du contenu des tables : pour prouver qu'une série de requêtes refusées n'a rien modifié. Les sessions sont
 * écartées : le banc les ouvre lui-même, entre deux empreintes.
 */
export function empreinte(db: BaseTest, exclure: string[] = []): string {
  exclure = ['session', ...exclure];
  const tables = db.tous<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  const sortie: Record<string, unknown[]> = {};
  for (const { name } of tables) {
    if (exclure.includes(name)) continue;
    sortie[name] = db.tous(`SELECT * FROM ${name} ORDER BY rowid`);
  }
  return JSON.stringify(sortie);
}
