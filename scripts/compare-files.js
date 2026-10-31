#!/usr/bin/env node
'use strict';

// ── MAINTIX — COMPARAISON DE FICHIERS MULTIPLATEFORME (lecture seule) ──
//
// Compare récursivement deux répertoires et produit un rapport détaillé :
// fichiers IDENTIQUE / DIFFÉRENT / ABSENT_DE_LA_REFERENCE / ABSENT_DE_LA_SOURCE,
// empreintes SHA-256, et un diff ligne à ligne pour les fichiers texte
// différents. Aucune dépendance externe (uniquement les modules natifs
// Node.js : fs, path, crypto) — fonctionne à l'identique sous PowerShell,
// CMD, Git Bash et un terminal Linux, dès qu'un même binaire `node` est
// disponible sur le PATH.
//
// GARANTIES :
//   - Strictement en LECTURE SEULE : aucune écriture dans les répertoires
//     comparés, seulement dans le fichier de rapport explicitement désigné
//     (--report), créé à un emplacement choisi par l'appelant.
//   - Ne journalise/n'affiche jamais le CONTENU d'un fichier sur la console
//     — seulement des compteurs et des noms de fichiers. Le diff détaillé
//     ligne à ligne n'est écrit QUE dans le fichier de rapport local.
//   - Ne fait jamais d'accès réseau, n'utilise jamais Firebase ni aucun
//     identifiant cloud.
//   - N'exclut JAMAIS un fichier silencieusement : tout fichier rencontré
//     apparaît dans le rapport (catégorie SPÉCIAL pour les liens
//     symboliques/fichiers non standards), sauf exclusion EXPLICITE via
//     --exclude.
//
// USAGE :
//   node scripts/compare-files.js <source> <reference> [options]
//
//   <source>    : répertoire "nouveau" (ex. une archive déjà extraite)
//   <reference> : répertoire "existant" (ex. un dépôt local)
//
// OPTIONS :
//   --report <chemin>     Fichier de rapport à écrire (défaut :
//                          ./compare-files-report-<horodatage>.txt dans le
//                          répertoire courant)
//   --exclude <chemin>     Chemin relatif (fichier ou dossier) à exclure de
//                          la comparaison, relatif à CHAQUE racine comparée.
//                          Répétable. Jamais appliqué par défaut.
//   --context <n>          Lignes de contexte autour de chaque différence
//                          dans le diff (défaut : 2)
//   --help, -h              Affiche cette aide
//
// EXEMPLES — PowerShell (Windows) :
//   node scripts\compare-files.js `
//     "C:\Users\keyze\Downloads\maintix-pin-security-review" `
//     "C:\Users\keyze\claude-code-" `
//     --exclude .git --exclude node_modules --exclude "functions\node_modules" `
//     --report "C:\Users\keyze\Downloads\pin-security-diffs.txt"
//
// EXEMPLES — Linux / Git Bash :
//   node scripts/compare-files.js \
//     /chemin/vers/maintix-pin-security-review \
//     /chemin/vers/claude-code- \
//     --exclude .git --exclude node_modules --exclude functions/node_modules \
//     --report /chemin/vers/pin-security-diffs.txt
//
// LIMITE DOCUMENTÉE : ce script compare des RÉPERTOIRES DÉJÀ EXTRAITS. Il ne
// lit pas directement une archive .tar.gz (aucune méthode d'extraction
// native et totalement fiable n'est incluse dans les modules standards de
// Node.js pour le format tar — seul gzip/deflate est couvert par le module
// natif "zlib", pas le désarchivage tar lui-même). Si un chemin fourni se
// termine par .tar.gz/.tgz, le script s'arrête avec un message clair
// invitant à l'extraire d'abord (`tar -xzf ...`, disponible nativement sous
// Windows 10+/Linux/Git Bash) plutôt que de tenter une extraction maison
// risquée pour un outil qui doit rester fiable.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HELP_TEXT = `Maintix — compare-files.js : comparaison multiplateforme de deux répertoires (lecture seule)

Usage :
  node scripts/compare-files.js <source> <reference> [options]

  <source>     Répertoire "nouveau" (ex. une archive déjà extraite)
  <reference>  Répertoire "existant" (ex. un dépôt local)

Options :
  --report <chemin>   Fichier de rapport (défaut : ./compare-files-report-<horodatage>.txt)
  --exclude <chemin>  Chemin relatif à exclure (répétable, jamais appliqué par défaut)
  --context <n>       Lignes de contexte autour de chaque diff (défaut : 2)
  --help, -h          Affiche cette aide

Catégories de classement : IDENTIQUE, DIFFERENT, ABSENT_DE_LA_REFERENCE, ABSENT_DE_LA_SOURCE, SPECIAL.

Limite : attend deux répertoires déjà extraits, ne lit pas .tar.gz directement (voir le
commentaire d'en-tête du script pour la raison et la marche à suivre).`;

function parseArgs(argv) {
  const out = { source: null, reference: null, report: null, excludes: [], context: 2, help: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { out.help = true; }
    else if (a === '--report') { out.report = argv[++i]; }
    else if (a === '--exclude') { out.excludes.push(argv[++i]); }
    else if (a === '--context') { out.context = parseInt(argv[++i], 10); if (!Number.isFinite(out.context) || out.context < 0) out.context = 2; }
    else if (a.startsWith('--')) { throw new Error('Option inconnue : ' + a + ' (voir --help)'); }
    else { positional.push(a); }
  }
  if (!out.help) {
    if (positional.length < 2) throw new Error('Deux chemins requis : <source> <reference> (voir --help)');
    out.source = positional[0];
    out.reference = positional[1];
  }
  return out;
}

// Normalise un chemin relatif en séparateurs "/" pour un rapport cohérent,
// que l'outil tourne sous Windows ou sous Linux.
function toPosixRel(relPath) {
  return relPath.split(path.sep).join('/');
}

function isTarGz(p) {
  return /\.(tar\.gz|tgz)$/i.test(p);
}

// ── Parcours récursif d'un répertoire ──
// Retourne une Map<cheminRelatifPosix, {abs, type}> où type est
// 'file' | 'symlink' | 'special'. Rien n'est jamais omis silencieusement :
// tout ce qui n'est pas un fichier régulier ou un sous-répertoire est classé
// 'special' et apparaîtra dans le rapport, jamais ignoré sans trace.
function walkDir(root, excludes) {
  const result = new Map();
  const excludeSet = new Set(excludes.map(toPosixRel));
  function isExcluded(relPosix) {
    if (excludeSet.has(relPosix)) return true;
    for (const ex of excludeSet) { if (relPosix.startsWith(ex + '/')) return true; }
    return false;
  }
  function walk(dir, relBase) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { throw new Error('Impossible de lire le répertoire "' + dir + '" : ' + e.message); }
    for (const entry of entries) {
      const relPosix = relBase ? relBase + '/' + entry.name : entry.name;
      if (isExcluded(relPosix)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs, relPosix);
      } else if (entry.isSymbolicLink()) {
        result.set(relPosix, { abs, type: 'symlink' });
      } else if (entry.isFile()) {
        result.set(relPosix, { abs, type: 'file' });
      } else {
        result.set(relPosix, { abs, type: 'special' });
      }
    }
  }
  const rootStat = (() => { try { return fs.statSync(root); } catch (e) { return null; } })();
  if (!rootStat || !rootStat.isDirectory()) {
    throw new Error('Chemin introuvable ou n\'est pas un répertoire : ' + root);
  }
  walk(root, '');
  return result;
}

function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Heuristique binaire/texte : présence d'un octet NUL dans l'échantillon, ou
// proportion significative de caractères de remplacement U+FFFD après un
// décodage UTF-8 (indice d'un contenu qui n'est pas réellement de l'UTF-8).
function looksBinary(buf) {
  const sampleLen = Math.min(buf.length, 8192);
  for (let i = 0; i < sampleLen; i++) { if (buf[i] === 0) return true; }
  if (buf.length === 0) return false;
  const text = buf.toString('utf8');
  const replacementCount = (text.match(/\uFFFD/g) || []).length;
  return replacementCount > 0 && replacementCount / Math.max(1, text.length) > 0.01;
}

// Découpe en lignes en gérant CRLF/LF/CR isolé, tout en comptant le style
// dominant pour le signaler dans le rapport (sans faire échouer la
// comparaison pour une simple différence de fin de ligne).
function splitLines(text) {
  const crlfCount = (text.match(/\r\n/g) || []).length;
  const lfOnlyCount = (text.match(/(?<!\r)\n/g) || []).length - crlfCount >= 0
    ? (text.match(/\n/g) || []).length - crlfCount
    : 0;
  const lines = text.length === 0 ? [] : text.split(/\r\n|\r|\n/);
  const endsWithNewline = text.length > 0 && /[\r\n]$/.test(text);
  if (endsWithNewline && lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return { lines, crlfCount, lfOnlyCount, endsWithNewline };
}

// ── Diff ligne à ligne (LCS classique, DP 1D) ──
// Garde-fou de performance : au-delà de MAX_CELLS cellules, bascule sur un
// résumé (nombre de lignes de chaque côté) plutôt qu'un diff complet —
// jamais un blocage pour un fichier très volumineux.
const MAX_DIFF_CELLS = 4000000;
function diffLines(aLines, bLines) {
  const n = aLines.length, m = bLines.length;
  if (n * m > MAX_DIFF_CELLS) {
    return { tooLarge: true, aLen: n, bLen: m };
  }
  const width = m + 1;
  const dp = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] = aLines[i] === bLines[j]
        ? dp[(i + 1) * width + (j + 1)] + 1
        : Math.max(dp[(i + 1) * width + j], dp[i * width + (j + 1)]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) { ops.push({ type: 'eq', aLine: i, bLine: j }); i++; j++; }
    else if (dp[(i + 1) * width + j] >= dp[i * width + (j + 1)]) { ops.push({ type: 'del', aLine: i }); i++; }
    else { ops.push({ type: 'add', bLine: j }); j++; }
  }
  while (i < n) { ops.push({ type: 'del', aLine: i }); i++; }
  while (j < m) { ops.push({ type: 'add', bLine: j }); j++; }
  return { tooLarge: false, ops };
}

// Regroupe les opérations de différence en "hunks" façon diff unifié, avec
// un nombre de lignes de contexte configurable, et fusionne les hunks trop
// proches entre eux (comme `diff -u`).
function buildHunks(ops, context) {
  const changeIdxs = [];
  for (let k = 0; k < ops.length; k++) if (ops[k].type !== 'eq') changeIdxs.push(k);
  if (changeIdxs.length === 0) return [];
  const ranges = [];
  let groupStart = changeIdxs[0], groupEnd = changeIdxs[0];
  for (let t = 1; t < changeIdxs.length; t++) {
    const idx = changeIdxs[t];
    if (idx - groupEnd - 1 <= context * 2) groupEnd = idx;
    else { ranges.push([groupStart, groupEnd]); groupStart = idx; groupEnd = idx; }
  }
  ranges.push([groupStart, groupEnd]);
  return ranges.map(([s, e]) => {
    const from = Math.max(0, s - context);
    const to = Math.min(ops.length - 1, e + context);
    return ops.slice(from, to + 1);
  });
}

function renderDiff(aLines, bLines, context) {
  const result = diffLines(aLines, bLines);
  if (result.tooLarge) {
    return '  [Fichier trop volumineux pour un diff ligne à ligne complet : '
      + result.aLen + ' lignes (référence) vs ' + result.bLen + ' lignes (source) — '
      + 'affichage limité au nombre de lignes de chaque côté.]';
  }
  const hunks = buildHunks(result.ops, context);
  if (hunks.length === 0) return '  [Aucune différence ligne à ligne détectée après normalisation des fins de ligne.]';
  const out = [];
  for (const hunk of hunks) {
    for (const op of hunk) {
      if (op.type === 'eq') out.push('    ' + String(op.aLine + 1).padStart(6) + ' | ' + aLines[op.aLine]);
      else if (op.type === 'del') out.push('  - ' + String(op.aLine + 1).padStart(6) + ' | ' + aLines[op.aLine]);
      else out.push('  + ' + String(op.bLine + 1).padStart(6) + ' | ' + bLines[op.bLine]);
    }
    out.push('    ...');
  }
  out.pop(); // retire le dernier séparateur "..." superflu
  return out.join('\n');
}

function compareOneFile(srcEntry, refEntry, context) {
  const srcBuf = fs.readFileSync(srcEntry.abs);
  const refBuf = fs.readFileSync(refEntry.abs);
  const srcHash = sha256Buffer(srcBuf);
  const refHash = sha256Buffer(refBuf);
  const info = {
    sizeSource: srcBuf.length, sizeReference: refBuf.length,
    sha256Source: srcHash, sha256Reference: refHash,
    binary: looksBinary(srcBuf) || looksBinary(refBuf),
  };
  if (srcHash === refHash) return { category: 'IDENTIQUE', info };
  if (info.binary) return { category: 'DIFFERENT', info, note: '[Fichier binaire — seules la taille et les empreintes sont comparées.]' };
  const srcText = srcBuf.toString('utf8');
  const refText = refBuf.toString('utf8');
  const srcSplit = splitLines(srcText);
  const refSplit = splitLines(refText);
  let eolNote = '';
  if ((srcSplit.crlfCount > 0) !== (refSplit.crlfCount > 0)) {
    eolNote = '  [Fins de ligne différentes : référence=' + (refSplit.crlfCount > 0 ? 'CRLF' : 'LF') +
      ', source=' + (srcSplit.crlfCount > 0 ? 'CRLF' : 'LF') + ' — comparaison effectuée sur le contenu normalisé.]\n';
  }
  const diffText = eolNote + renderDiff(refSplit.lines, srcSplit.lines, context);
  return { category: 'DIFFERENT', info, diff: diffText };
}

function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (e) { console.error('Erreur : ' + e.message); process.exitCode = 2; return; }

  if (args.help) { console.log(HELP_TEXT); return; }

  for (const [label, p] of [['source', args.source], ['reference', args.reference]]) {
    if (isTarGz(p)) {
      console.error('Erreur : le chemin ' + label + ' ("' + p + '") est une archive .tar.gz/.tgz.');
      console.error('Ce script compare des répertoires déjà extraits (voir la limite documentée en tête de fichier).');
      console.error('Extrayez d\'abord l\'archive, par exemple : tar -xzf "' + p + '" -C <dossier de destination>');
      process.exitCode = 3;
      return;
    }
  }

  let sourceFiles, referenceFiles;
  try {
    sourceFiles = walkDir(args.source, args.excludes);
    referenceFiles = walkDir(args.reference, args.excludes);
  } catch (e) {
    console.error('Erreur : ' + e.message);
    process.exitCode = 4;
    return;
  }

  const allPaths = new Set([...sourceFiles.keys(), ...referenceFiles.keys()]);
  const sortedPaths = Array.from(allPaths).sort();

  const counts = { IDENTIQUE: 0, DIFFERENT: 0, ABSENT_DE_LA_REFERENCE: 0, ABSENT_DE_LA_SOURCE: 0, SPECIAL: 0, ERREUR: 0 };
  const reportLines = [];
  reportLines.push('Rapport de comparaison Maintix — compare-files.js');
  reportLines.push('Généré le : ' + new Date().toISOString());
  reportLines.push('Source     : ' + path.resolve(args.source));
  reportLines.push('Référence  : ' + path.resolve(args.reference));
  if (args.excludes.length) reportLines.push('Exclusions : ' + args.excludes.join(', '));
  reportLines.push('');

  for (const relPosix of sortedPaths) {
    const src = sourceFiles.get(relPosix);
    const ref = referenceFiles.get(relPosix);

    if (src && src.type !== 'file') { counts.SPECIAL++; reportLines.push('[SPECIAL] ' + relPosix + '  (type non standard côté source : ' + src.type + ', non comparé)'); continue; }
    if (ref && ref.type !== 'file') { counts.SPECIAL++; reportLines.push('[SPECIAL] ' + relPosix + '  (type non standard côté référence : ' + ref.type + ', non comparé)'); continue; }

    if (src && !ref) {
      counts.ABSENT_DE_LA_REFERENCE++;
      try {
        const buf = fs.readFileSync(src.abs);
        reportLines.push('[ABSENT_DE_LA_REFERENCE] ' + relPosix + '  (taille=' + buf.length + ', sha256=' + sha256Buffer(buf) + ')');
      } catch (e) { counts.ERREUR++; reportLines.push('[ERREUR] ' + relPosix + '  (lecture source impossible : ' + e.message + ')'); }
      continue;
    }
    if (ref && !src) {
      counts.ABSENT_DE_LA_SOURCE++;
      try {
        const buf = fs.readFileSync(ref.abs);
        reportLines.push('[ABSENT_DE_LA_SOURCE] ' + relPosix + '  (taille=' + buf.length + ', sha256=' + sha256Buffer(buf) + ')  — présence à ne jamais supprimer automatiquement');
      } catch (e) { counts.ERREUR++; reportLines.push('[ERREUR] ' + relPosix + '  (lecture référence impossible : ' + e.message + ')'); }
      continue;
    }

    // Présent des deux côtés, les deux sont des fichiers réguliers.
    try {
      const result = compareOneFile(src, ref, args.context);
      counts[result.category]++;
      const info = result.info;
      reportLines.push('[' + result.category + '] ' + relPosix);
      reportLines.push('    sha256 référence : ' + info.sha256Reference + '  (' + info.sizeReference + ' octets)');
      reportLines.push('    sha256 source    : ' + info.sha256Source + '  (' + info.sizeSource + ' octets)');
      if (result.note) reportLines.push('    ' + result.note);
      if (result.diff) { reportLines.push('    --- diff (référence -> source) ---'); reportLines.push(result.diff); }
      reportLines.push('');
    } catch (e) {
      counts.ERREUR++;
      reportLines.push('[ERREUR] ' + relPosix + '  (comparaison impossible : ' + e.message + ')');
    }
  }

  const summary = [
    '',
    '=== RÉSUMÉ ===',
    'Fichiers identiques              : ' + counts.IDENTIQUE,
    'Fichiers différents              : ' + counts.DIFFERENT,
    'Absents de la référence (dépôt)  : ' + counts.ABSENT_DE_LA_REFERENCE,
    'Absents de la source (archive)   : ' + counts.ABSENT_DE_LA_SOURCE,
    'Entrées spéciales (non comparées): ' + counts.SPECIAL,
    'Erreurs de lecture               : ' + counts.ERREUR,
    'Total de chemins examinés        : ' + sortedPaths.length,
  ];
  reportLines.push(...summary);

  const reportPath = path.resolve(args.report || ('compare-files-report-' + Date.now() + '.txt'));
  try {
    fs.writeFileSync(reportPath, reportLines.join('\n') + '\n', 'utf8');
  } catch (e) {
    console.error('Erreur : impossible d\'écrire le rapport dans "' + reportPath + '" : ' + e.message);
    process.exitCode = 5;
    return;
  }

  // Console : uniquement le résumé chiffré, jamais le détail (voir garanties
  // en tête de fichier) — le contenu complet, y compris les diffs, reste
  // dans le fichier de rapport local.
  console.log(summary.join('\n'));
  console.log('\nRapport détaillé écrit dans : ' + reportPath);

  if (counts.ERREUR > 0) process.exitCode = 1;
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, walkDir, sha256Buffer, looksBinary, splitLines, diffLines, buildHunks, renderDiff, compareOneFile, toPosixRel, isTarGz };
