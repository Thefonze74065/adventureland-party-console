const fs=require('node:fs');
const path=require('node:path');

const manifest=require('../fixtures/game/manifest.json');
const pinnedVersions=manifest.versions.map(entry=>entry.version).sort((a,b)=>Number(b)-Number(a));
/** Retained regressions use the same historical fixtures in CI and locally.
 * A live game-cache upgrade must not silently change the regression's upstream contract. */
function downloadedGameSource(filename,version){
 const root=path.resolve('.caracal/game_files');
 const versions=version===undefined?pinnedVersions:[String(version)];
 for(const version of versions){
  try{return fs.readFileSync(path.join(root,version,filename),'utf8');}
  catch(error){if(error.code!=='ENOENT')throw error;}
 }
 throw new Error('No pinned game fixture contains '+filename+'; run node scripts/ci/restore-game-fixtures.cjs');
}
module.exports={downloadedGameSource};
