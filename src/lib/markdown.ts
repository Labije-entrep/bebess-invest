// Rendu Markdown minimal, écrit à la main : titres, gras, italique, liens, listes,
// citations, paragraphes. Tout le texte est échappé AVANT d'être interprété :
// une balise saisie s'affiche comme du texte, jamais comme du HTML.

function echapper(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function emphase(t: string): string {
  return t
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/(^|[^\w])_(.+?)_(?=[^\w]|$)/g, '$1<em>$2</em>');
}

/** Reçoit du texte déjà échappé. Les liens sont mis de côté pour que leur adresse ne soit pas retouchée. */
function enLigne(t: string): string {
  const jetons: string[] = [];
  const sansLiens = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, texte: string, url: string) => {
    // Seuls http(s), mailto, les chemins du site et les ancres : jamais javascript: ni data:.
    if (!/^(https?:\/\/|mailto:|\/|#)/i.test(url)) return m;
    jetons.push(`<a href="${url}">${emphase(texte)}</a>`);
    return `\u0000${jetons.length - 1}\u0000`;
  });
  return emphase(sansLiens).replace(/\u0000(\d+)\u0000/g, (_, i: string) => jetons[Number(i)]);
}

export function rendreMarkdown(source: string): string {
  const lignes = echapper(source.replace(/\r\n?/g, '\n')).split('\n');
  const sortie: string[] = [];
  let i = 0;

  const estBloc = (l: string) =>
    /^#{1,3}\s/.test(l) || /^&gt;/.test(l) || /^[-*]\s+/.test(l) || /^\d+\.\s+/.test(l);

  while (i < lignes.length) {
    const l = lignes[i];
    if (l.trim() === '') { i++; continue; }

    const titre = /^(#{1,3})\s+(.*)$/.exec(l);
    if (titre) {
      const n = titre[1].length + 1; // # -> h2 : le h1 de la page est le titre de la note
      sortie.push(`<h${n}>${enLigne(titre[2].trim())}</h${n}>`);
      i++;
      continue;
    }

    if (/^&gt;/.test(l)) {
      const bloc: string[] = [];
      while (i < lignes.length && /^&gt;/.test(lignes[i])) bloc.push(lignes[i++].replace(/^&gt;\s?/, ''));
      sortie.push(`<blockquote><p>${enLigne(bloc.join(' ').trim())}</p></blockquote>`);
      continue;
    }

    const puce = /^[-*]\s+/;
    const numero = /^\d+\.\s+/;
    if (puce.test(l) || numero.test(l)) {
      const motif = puce.test(l) ? puce : numero;
      const balise = motif === puce ? 'ul' : 'ol';
      const items: string[] = [];
      while (i < lignes.length && motif.test(lignes[i])) items.push(`<li>${enLigne(lignes[i++].replace(motif, '').trim())}</li>`);
      sortie.push(`<${balise}>${items.join('')}</${balise}>`);
      continue;
    }

    const para: string[] = [];
    while (i < lignes.length && lignes[i].trim() !== '' && !estBloc(lignes[i])) para.push(lignes[i++].trim());
    sortie.push(`<p>${enLigne(para.join(' '))}</p>`);
  }
  return sortie.join('\n');
}
