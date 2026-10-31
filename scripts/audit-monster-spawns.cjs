// Read-only audit of trusted, locally installed executable game data.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function catalog(G) {
  const source = fs.readFileSync(path.join(__dirname, '../characters/shared.js'), 'utf8');
  const start = source.indexOf('  function monsterChoices(');
  const end = source.indexOf('  function bestiaryCatalog()', start);
  if (start < 0 || end < 0) throw new Error('Monster catalog source boundary missing');
  const context = { G, monsterSpriteDefinition: () => null };
  vm.runInNewContext(source.slice(start, end) + ';result = monsterChoices();', context);
  return JSON.parse(JSON.stringify(context.result));
}

function audit(G) {
  const choices = catalog(G);
  const monsters = choices.map(monster => {
    // Independently scan every map, including excluded source maps.
    const rawSpawns = Object.entries(G.maps).flatMap(([map, definition]) =>
      (Array.isArray(definition.monsters) ? definition.monsters : [])
        .filter(spawn => spawn?.type === monster.id).map(spawn => ({ sourceMap: map, ...spawn })));
    return { id: monster.id, locationCount: monster.locations.length,
      rawSpawns, spawnRecords: monster.spawnRecords };
  });
  return { monsterCount: monsters.length,
    noLocations: monsters.filter(monster => !monster.locationCount).length,
    noMapRecords: monsters.filter(monster => !monster.rawSpawns.length).length,
    monsters };
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: node scripts/audit-monster-spawns.cjs <trusted game data.js>');
  const context = {};
  vm.runInNewContext(fs.readFileSync(path.resolve(file), 'utf8'), context, { filename: file, timeout: 10000 });
  console.log(JSON.stringify(audit(context.G), null, 2));
}
module.exports = { catalog, audit };
