const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function hash(file) {
  const digest = createHash('sha256'), buffer = Buffer.allocUnsafe(1024 * 1024);
  const descriptor = fs.openSync(file, 'r');
  try { let count; while ((count = fs.readSync(descriptor, buffer, 0, buffer.length, null))) digest.update(buffer.subarray(0, count)); }
  finally { fs.closeSync(descriptor); }
  return digest.digest('hex');
}
function gitRaw(...args) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 }); }
  catch { return 'unavailable'; }
}
const git = (...args) => gitRaw(...args).trim();
class ArtifactReporter {
  onBegin(_config, suite) {
    this.started = new Date().toISOString(); this.tests = [];
    this.provenance = {
      revision: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'),
      dirty: git('status', '--porcelain').length > 0,
      node: process.version, platform: process.platform,
      playwright: require('@playwright/test/package.json').version,
      locks: ['package-lock.json', 'dashboard/package-lock.json', 'e2e/game/backend-package-lock.json', 'e2e/game/server-package-lock.json'].map(file => ({ path: file, sha256: hash(path.join(root, file)) })),
    };
    this.selectedTests = suite.allTests().map(test => test.titlePath().join(' > '));
    // Preserve uncommitted test work as well as the base revision for repeatability.
    const reproduction = path.join(root, '.build/e2e-results/reproduction');
    fs.mkdirSync(reproduction, { recursive: true });
    this.ledger = path.join(root, '.build/e2e-results/outcomes.jsonl');
    fs.writeFileSync(this.ledger, '', { flush: true });
    fs.writeFileSync(path.join(reproduction, 'run.json'), JSON.stringify({ started: this.started, ...this.provenance, selectedTests: this.selectedTests }, null, 2));
    fs.writeFileSync(path.join(reproduction, 'working-tree.patch'), gitRaw('diff', '--binary', 'HEAD'));
    const untracked = git('ls-files', '--others', '--exclude-standard', '--', 'e2e', 'playwright.config.ts', '.github/workflows', 'docs/testing*.md', 'docs/testing*.json');
    for (const relative of untracked.split('\n').filter(Boolean)) {
      if (relative === 'unavailable') continue;
      const target = path.join(reproduction, 'untracked', relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(root, relative), target);
    }
  }
  onTestEnd(test, result) {
    const attachments = result.attachments.map((attachment, index) => {
      const { name, contentType, body } = attachment;
      let file = attachment.path;
      if (!file && body) {
        const directory = path.join(root, '.build/e2e-results/evidence', test.id.replace(/[^a-zA-Z0-9_-]/g, '_'), `retry-${result.retry}`);
        fs.mkdirSync(directory, { recursive: true });
        const extension = { 'application/json': '.json', 'image/png': '.png', 'application/zip': '.zip' }[contentType] || '.txt';
        file = path.join(directory, `${index}-${name.replace(/[^a-zA-Z0-9_-]/g, '_')}${extension}`);
        fs.writeFileSync(file, body);
      }
      // Playwright HTML serializes JSON buffers inline. Its file-path branch
      // copies each file and keeps only the path, avoiding a suite-sized string.
      // Mutate the shared result before later reporters see it; preserve bytes.
      if (file) { attachment.path = file; delete attachment.body; }
      return { name, path: file && path.relative(root, file), contentType };
    });
    const outcome = { title: test.titlePath().join(' > '), status: result.status,
      boundary: /debug-(instance|container)\.spec\.ts$/.test(test.location.file)
        ? 'Disposable Docker lifecycle through the real gateway; isolated native upstream server, god party and production coordinator'
        : /live-franky\.spec\.ts$/.test(test.location.file)
        ? 'Native game clients, maintained runtime and upstream server; initial acknowledged event-return history is a sanitized production-state fixture, followed by real restart, travel and reward claim'
        : /live-[a-z-]+\.spec\.ts$/.test(test.location.file)
        ? 'Native authenticated game clients and maintained runtime against disposable upstream game server and MongoDB; administrative scenario setup'
        : 'Real console/gateway/coordinator/storage; simulated external account and game observations',
      durationMs: result.duration, retry: result.retry,
      errors: result.errors.map(error => ({ message: error.message, stack: error.stack })),
      attachments };
    this.tests.push(outcome);
    // Durable partial results survive a later HTML failure or process crash.
    fs.appendFileSync(this.ledger, JSON.stringify(outcome) + '\n', { flush: true });
  }
  onEnd(result) {
    const artifacts = [];
    const serverLog = path.join(root, '.build/e2e-live/server.log');
    if (this.tests.some(test => test.boundary.startsWith('Native')) && fs.existsSync(serverLog)) {
      const destination = path.join(root, '.build/e2e-results/upstream-server.log');
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(serverLog, destination);
    }
    function walk(directory) {
      if (!fs.existsSync(directory)) return;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(file);
        else artifacts.push({ path: path.relative(root, file).replaceAll('\\', '/'), sha256: hash(file), bytes: fs.statSync(file).size });
      }
    }
    walk(path.join(root, '.build/e2e-results'));
    fs.mkdirSync(path.join(root, '.build/e2e-report'), { recursive: true });
    fs.writeFileSync(path.join(root, '.build/e2e-report/manifest.json'), JSON.stringify({
      schema: 1, started: this.started, finished: new Date().toISOString(), status: result.status,
      ...this.provenance,
      command: ['npx', 'playwright', ...process.argv.slice(2)],
      selectedTests: this.selectedTests,
      boundary: 'See each test boundary; live-game scenarios execute the upstream server locally, not public production realms',
      tests: this.tests, artifacts,
    }, null, 2));
  }
}
module.exports = ArtifactReporter;
