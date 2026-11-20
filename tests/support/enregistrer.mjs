// Branche le chargeur du banc (hooks.mjs) avant le premier import. `node --import ./tests/support/enregistrer.mjs`.
import { register } from 'node:module';

register('./hooks.mjs', import.meta.url);
