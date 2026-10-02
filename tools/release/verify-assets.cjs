const fs = require('node:fs');
const crypto = require('node:crypto');
const { repository } = require('../../distribution.json');
const imagePattern = new RegExp('^ghcr\\.io/' + repository.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '@sha256:[a-f0-9]{64}$');
exports.prepare = async (_options, context) => {
  const manifest = JSON.parse(fs.readFileSync('.build/release/release-manifest.json', 'utf8'));
  if (manifest.version !== context.nextRelease.version) throw new Error('Release version changed while building; rebuild the artifacts');
  const asset = fs.readFileSync('.build/release/' + manifest.windows.asset);
  if (crypto.createHash('sha256').update(asset).digest('hex') !== manifest.windows.sha256) throw new Error('Release asset checksum mismatch');
  if (!imagePattern.test(manifest.image)) throw new Error('Missing immutable Docker image');
};
