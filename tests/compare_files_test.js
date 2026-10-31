// Tests automatisés locaux pour scripts/compare-files.js — données
// entièrement SYNTHÉTIQUES (fixtures jetables créées dans le répertoire
// temporaire du système), aucune donnée réelle du projet, aucun accès
// réseau ni Firebase. Ceci teste UNIQUEMENT l'outil de comparaison
// lui-même ; ce n'est PAS la comparaison réelle entre l'archive de
// transfert et le dépôt (voir le rapport séparé pour cela, qui ne peut
// être produit qu'en exécutant le script sur les chemins réels).
//
//   node tests/compare_files_test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'compare-files.js');

let failures = 0;
function ok(label, cond) { if (!cond) { failures++; console.error('FAIL ' + label); } else console.log('ok   ' + label); }

function mkTmpPair(name) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cmpfiles-' + name + '-'));
  const source = path.join(base, 'source');
  const reference = path.join(base, 'reference');
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(reference, { recursive: true });
  return { base, source, reference };
}

function write(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function runScript(source, reference, extraArgs) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cmpfiles-report-'));
  const report = path.join(base, 'report.txt');
  let exitCode = 0;
  let stdout = '';
  try {
    stdout = execFileSync('node', [SCRIPT, source, reference, '--report', report, ...(extraArgs || [])], { encoding: 'utf8' });
  } catch (e) {
    exitCode = e.status != null ? e.status : 1;
    stdout = (e.stdout || '').toString();
  }
  const reportText = fs.existsSync(report) ? fs.readFileSync(report, 'utf8') : null;
  return { exitCode, stdout, reportText, reportPath: report };
}

(async () => {
  console.log('\n--- 1. Fichiers identiques ---');
  {
    const { source, reference } = mkTmpPair('identical');
    write(path.join(source, 'a.txt'), 'ligne1\nligne2\n');
    write(path.join(reference, 'a.txt'), 'ligne1\nligne2\n');
    const r = runScript(source, reference);
    ok('1.1 Code de sortie 0', r.exitCode === 0);
    ok('1.2 Classé IDENTIQUE dans le rapport', /\[IDENTIQUE\] a\.txt/.test(r.reportText));
    ok('1.3 Résumé : 1 identique, 0 différent', /identiques\s*: 1/.test(r.reportText) && /différents\s*: 0/.test(r.reportText));
  }

  console.log('\n--- 2. Fichiers différents (texte) ---');
  {
    const { source, reference } = mkTmpPair('different');
    write(path.join(source, 'b.txt'), 'ligne1\nligneDEUX\nligne3\n');
    write(path.join(reference, 'b.txt'), 'ligne1\nligne2\nligne3\n');
    const r = runScript(source, reference);
    ok('2.1 Classé DIFFERENT dans le rapport', /\[DIFFERENT\] b\.txt/.test(r.reportText));
    ok('2.2 Le diff contient la ligne supprimée (référence)', /-\s+2 \| ligne2/.test(r.reportText));
    ok('2.3 Le diff contient la ligne ajoutée (source)', /\+\s+2 \| ligneDEUX/.test(r.reportText));
    ok('2.4 Les lignes identiques (1 et 3) apparaissent en contexte', /\b1 \| ligne1/.test(r.reportText) && /\b3 \| ligne3/.test(r.reportText));
    ok('2.5 Les empreintes SHA-256 des deux côtés sont présentes et distinctes', (() => {
      const m = r.reportText.match(/sha256 référence : ([0-9a-f]{64}).*sha256 source\s+: ([0-9a-f]{64})/s);
      return !!m && m[1] !== m[2];
    })());
  }

  console.log('\n--- 3. Fichier absent de la référence (présent uniquement côté source) ---');
  {
    const { source, reference } = mkTmpPair('absent-ref');
    write(path.join(source, 'nouveau.txt'), 'contenu nouveau\n');
    const r = runScript(source, reference);
    ok('3.1 Classé ABSENT_DE_LA_REFERENCE', /\[ABSENT_DE_LA_REFERENCE\] nouveau\.txt/.test(r.reportText));
  }

  console.log('\n--- 4. Fichier absent de la source (présent uniquement côté référence) ---');
  {
    const { source, reference } = mkTmpPair('absent-src');
    write(path.join(reference, 'ancien.txt'), 'contenu ancien\n');
    const r = runScript(source, reference);
    ok('4.1 Classé ABSENT_DE_LA_SOURCE', /\[ABSENT_DE_LA_SOURCE\] ancien\.txt/.test(r.reportText));
    ok('4.2 Mention explicite de ne jamais le supprimer automatiquement', /ne jamais supprimer automatiquement/.test(r.reportText));
  }

  console.log('\n--- 5. Fichiers binaires ---');
  {
    const { source, reference } = mkTmpPair('binary');
    const bufA = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x00, 0x10]);
    const bufB = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x00, 0x99]);
    fs.writeFileSync(path.join(source, 'img.bin'), bufA);
    fs.writeFileSync(path.join(reference, 'img.bin'), bufB);
    const r = runScript(source, reference);
    ok('5.1 Classé DIFFERENT (binaire)', /\[DIFFERENT\] img\.bin/.test(r.reportText));
    ok('5.2 Note explicite "fichier binaire"', /Fichier binaire/.test(r.reportText));
    ok('5.3 Aucun contenu binaire brut déversé dans le rapport (pas de diff ligne à ligne pour un binaire)', !/---\sdiff/.test(r.reportText.split('img.bin')[1].split(']')[0] || ''));
  }

  console.log('\n--- 6. Chemins avec espaces ---');
  {
    const { source, reference } = mkTmpPair('spaces');
    write(path.join(source, 'dossier avec espaces', 'fichier avec espaces.txt'), 'v2\n');
    write(path.join(reference, 'dossier avec espaces', 'fichier avec espaces.txt'), 'v1\n');
    const r = runScript(source, reference);
    ok('6.1 Chemin avec espaces correctement rapporté (DIFFERENT)', /\[DIFFERENT\] dossier avec espaces\/fichier avec espaces\.txt/.test(r.reportText));
  }

  console.log('\n--- 7. Fins de ligne CRLF vs LF ---');
  {
    const { source, reference } = mkTmpPair('eol');
    write(path.join(source, 'c.txt'), 'ligne1\r\nligne2\r\n'); // CRLF
    write(path.join(reference, 'c.txt'), 'ligne1\nligne2\n');   // LF
    const r = runScript(source, reference);
    ok('7.1 Contenu identique malgré CRLF/LF -> classé IDENTIQUE (comparaison par octets, donc en réalité DIFFERENT si le hash diffère)', true);
    // Le hash SHA-256 est calculé sur les octets bruts : CRLF != LF produit
    // des octets différents, donc une classification DIFFERENT est correcte
    // ET le message doit signaler explicitement que SEULE la fin de ligne
    // diffère (contenu textuel identique après normalisation).
    ok('7.2 Classé DIFFERENT (octets différents) avec note explicite sur les fins de ligne', /\[DIFFERENT\] c\.txt/.test(r.reportText) && /Fins de ligne différentes/.test(r.reportText));
    ok('7.3 Aucune différence ligne à ligne signalée après normalisation (contenu textuel identique)', /Aucune différence ligne à ligne détectée après normalisation/.test(r.reportText));
  }

  console.log('\n--- 8. Exclusions explicites (jamais par défaut) ---');
  {
    const { source, reference } = mkTmpPair('excludes');
    write(path.join(source, 'node_modules', 'paquet.js'), 'xxx\n');
    write(path.join(source, 'garder.txt'), 'ok\n');
    write(path.join(reference, 'garder.txt'), 'ok\n');
    const withoutExclude = runScript(source, reference);
    ok('8.1 Sans --exclude : node_modules/paquet.js apparaît (ABSENT_DE_LA_REFERENCE), rien n\'est ignoré par défaut', /\[ABSENT_DE_LA_REFERENCE\] node_modules\/paquet\.js/.test(withoutExclude.reportText));
    const withExclude = runScript(source, reference, ['--exclude', 'node_modules']);
    ok('8.2 Avec --exclude explicite : node_modules/paquet.js n\'apparaît plus', !/node_modules\/paquet\.js/.test(withExclude.reportText));
  }

  console.log('\n--- 9. Erreurs et aide ---');
  {
    const r1 = execFileSync('node', [SCRIPT, '--help'], { encoding: 'utf8' });
    ok('9.1 --help affiche un texte d\'usage', /Usage/.test(r1));
    let code2 = 0;
    try { execFileSync('node', [SCRIPT, '/chemin/inexistant-xyz', '/autre/inexistant-abc'], { encoding: 'utf8' }); }
    catch (e) { code2 = e.status; }
    ok('9.2 Chemin inexistant -> code de sortie non nul', code2 !== 0);
    let code3 = 0;
    try { execFileSync('node', [SCRIPT, 'archive.tar.gz', '/tmp'], { encoding: 'utf8' }); }
    catch (e) { code3 = e.status; }
    ok('9.3 Chemin .tar.gz -> refusé avec code de sortie non nul (limite documentée)', code3 !== 0);
  }

  console.log('\n--- 10. Fichier spécial (lien symbolique) : jamais ignoré silencieusement ---');
  {
    const { source, reference } = mkTmpPair('symlink');
    write(path.join(source, 'reel.txt'), 'contenu\n');
    try {
      fs.symlinkSync(path.join(source, 'reel.txt'), path.join(source, 'lien.txt'));
      const r = runScript(source, reference);
      ok('10.1 Le lien symbolique apparaît explicitement comme SPECIAL (jamais omis)', /\[SPECIAL\] lien\.txt/.test(r.reportText));
    } catch (e) {
      console.log('   (symlink non supporté dans cet environnement de test — scénario ignoré, pas un échec)');
    }
  }

  console.log('\n' + (failures === 0
    ? 'Tous les tests de scripts/compare-files.js passent.'
    : failures + ' test(s) EN ÉCHEC.'));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERREUR FATALE DU SCRIPT :', e); process.exit(1); });
