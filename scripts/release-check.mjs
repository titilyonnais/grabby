/**
 * Keeps every version documented: CHANGELOG.md and README.md must describe the version of
 * package.json before it can be released.
 *
 *   node scripts/release-check.mjs              checks (CI, every push and every release)
 *   node scripts/release-check.mjs --notes [v]  prints a version's CHANGELOG section (release notes)
 *
 * In the release workflow, GITHUB_REF_NAME (the pushed tag) must match the version.
 */
import { readFileSync } from 'node:fs';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const changelog = readFileSync('CHANGELOG.md', 'utf8').replace(/\r\n/g, '\n');
const readme = readFileSync('README.md', 'utf8').replace(/\r\n/g, '\n');

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The body of "## [v] — date", up to the next version heading or the links at the end. */
function section(text, v) {
  const m = new RegExp(`^## \\[${escape(v)}\\][^\\n]*\\n([\\s\\S]*?)(?=^## \\[|^\\[[^\\]]+\\]: )`, 'm').exec(text);
  return m ? m[1].trim() : null;
}

const args = process.argv.slice(2);
if (args[0] === '--notes') {
  const v = (args[1] ?? version).replace(/^v/, '');
  const body = section(changelog, v);
  if (!body) {
    console.error(`Pas de section [${v}] dans CHANGELOG.md`);
    process.exit(1);
  }
  process.stdout.write(`${body}\n\n---\nJournal complet : https://github.com/titilyonnais/grabby/blob/main/CHANGELOG.md\n`);
  process.exit(0);
}

const problems = [];
const heading = new RegExp(`^## \\[${escape(version)}\\] — (\\d{4}-\\d{2}-\\d{2})$`, 'm').exec(changelog);
if (!heading) problems.push(`CHANGELOG.md : il manque le titre « ## [${version}] — AAAA-MM-JJ ».`);
const body = section(changelog, version);
if (heading && (!body || !/^### /m.test(body) || !/^- /m.test(body))) {
  problems.push(`CHANGELOG.md : la section [${version}] doit avoir au moins une rubrique (### Ajouté, ### Corrigé…) et une entrée.`);
}
if (!/^## \[Non publié\]/m.test(changelog)) problems.push('CHANGELOG.md : il manque la section « ## [Non publié] » en tête.');
if (!new RegExp(`^\\[${escape(version)}\\]: https://`, 'm').test(changelog)) {
  problems.push(`CHANGELOG.md : il manque le lien de comparaison « [${version}]: https://… » en bas du fichier.`);
}
if (!readme.includes(`<!-- release:${version} `) || !readme.includes(`## Nouveautés de la version ${version}`)) {
  problems.push(`README.md : le bloc « Nouveautés de la version ${version} » (<!-- release:${version} … -->) n'est pas à jour.`);
}
const tag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined;
if (tag && tag !== `v${version}`) problems.push(`Le tag ${tag} ne correspond pas à la version ${version} de package.json.`);

if (problems.length) {
  console.error(`Documentation de la version ${version} incomplète :\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`✓ CHANGELOG et README à jour pour la version ${version} (${heading[1]}).`);
