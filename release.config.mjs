import { readFileSync } from 'node:fs';
const { repository } = JSON.parse(readFileSync(new URL('./distribution.json', import.meta.url)));
// This fork tracks upstream's own version number; it never invents a minor/major
// bump of its own. The default Angular rules give every "feat:" a minor bump and
// a breaking change a major bump, either of which would let a fork-only commit
// step ahead of whatever minor/major upstream is actually on. Cap both at patch;
// which commit types trigger a release at all is otherwise unchanged. A minor/
// major jump only happens when it's set by hand to match an upstream release.
const releaseRules = [{ type: 'feat', release: 'patch' }, { breaking: true, release: 'patch' }];
export default {
  branches: ['main'], repositoryUrl: `https://github.com/${repository}.git`, tagFormat: 'v${version}',
  plugins: [
    ['@semantic-release/commit-analyzer', { releaseRules }], '@semantic-release/release-notes-generator',
    './tools/release/verify-assets.cjs',
    ['@semantic-release/github', { successComment: false, failComment: false, releasedLabels: false,
      assets: ['.build/release/*.zip', '.build/release/release-manifest.json', { path: 'distribution/compose.release.yaml', name: 'compose.yaml' }] }],
  ],
};
