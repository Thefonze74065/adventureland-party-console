const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, '.build/e2e-report/manifest.json'), 'utf8'));
if (manifest.schema !== 1 || !manifest.tests?.length || !manifest.artifacts?.length)
  throw new Error('Incomplete E2E evidence manifest');
if (manifest.tests.length !== manifest.selectedTests?.length)
  throw new Error('Recorded outcomes do not cover every selected scenario');
if (JSON.stringify(manifest.tests.map(test => test.title).sort()) !== JSON.stringify([...manifest.selectedTests].sort()))
  throw new Error('Recorded outcomes do not match selected scenario identities');
for (const artifact of manifest.artifacts) {
  const file = path.resolve(root, artifact.path);
  const relative = path.relative(path.join(root, '.build/e2e-results'), file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Artifact outside E2E results');
  const bytes = fs.readFileSync(file);
  if (bytes.length !== artifact.bytes || createHash('sha256').update(bytes).digest('hex') !== artifact.sha256)
    throw new Error('Artifact changed: ' + artifact.path);
}
console.log(`Verified ${manifest.artifacts.length} evidence files for ${manifest.tests.length} scenarios (${manifest.status}).`);
// These transport tests have no native-clock equivalent. Preserve their recorded
// selection and explicit expected skip; every ordinary gameplay case must pass.
const backendExclusion = test => manifest.gameplayBackend==='native' &&
  test.location==='e2e/chronal-clock-reconnect.case.ts' &&
  test.status==='skipped' && test.expectedStatus==='skipped';
if (manifest.status !== 'passed' || manifest.tests.some(test => test.status !== 'passed' && !backendExclusion(test)))
  throw new Error('Evidence is intact, but the recorded suite did not pass completely');
