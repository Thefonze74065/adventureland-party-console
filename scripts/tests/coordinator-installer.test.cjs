const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm'), {EventEmitter} = require('node:events');
const {spawnSync} = require('node:child_process');

for (const legacy of [false, true]) test(`installer replaces ${legacy ? 'legacy host' : 'current launcher'} and safely repeats`, async () => {
  const root = path.resolve(__dirname, '../..');
  const fixtureRoot = path.join(root, '.build');
  const target = await fs.mkdtemp(path.join(fixtureRoot, 'coordinator-installer-test-'));
  const files = ['src/CharacterThread.js', 'standalones/CharacterCoordinator.js', 'game_files.js'];
  const originals = new Map();
  for (const file of files) {
    const source = await fs.readFile(path.join(root, '.caracal', file), 'utf8');
    originals.set(file, source);
    await fs.mkdir(path.dirname(path.join(target, file)), {recursive: true});
    // A legacy host needs no recognized function anchors: none of its code is
    // retained or executed when installing the maintained application launcher.
    await fs.writeFile(path.join(target, file), legacy && file.startsWith('standalones/')
      ? 'throw new Error("Legacy coordinator must never run during installation");\n'
      : source.replaceAll('.get_game_files(proc_args.version)', '.get_game_files()')
        .replaceAll('.get_runner_files(proc_args.version)', '.get_runner_files()'));
  }
  const expected = await fs.readFile(path.join(root, 'tools/caracal/CharacterCoordinator.cjs'), 'utf8');
  for (let run = 0; run < 2; run++) {
    const result = spawnSync(process.execPath, ['tools/caracal/install.mts', target],
      {cwd: root, encoding: 'utf8', windowsHide: true});
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(await fs.readFile(path.join(target, files[1]), 'utf8'), expected);
    assert.equal(await fs.readFile(path.join(target, 'game_files.js'), 'utf8'),
      'module.exports = require("../scripts/client-files.cjs");\n');
    const thread = await fs.readFile(path.join(target, files[0]), 'utf8');
    const storage = new Map(), session = new Map();
    const context = {JSDOM:require('../../.caracal/node_modules/jsdom').JSDOM,
      html_spoof:'<!doctype html>',fetch:()=>{},node_query:()=>{},require,console,vm,
      ipc_storage:{make_IPC_storage:ident=>ident==='ls'?storage:session}};
    vm.runInNewContext(thread.slice(thread.indexOf('function make_context('), thread.indexOf('async function ev_files(')),context);
    const game=context.make_context(),runner=context.make_context(game);
    assert.equal(game.localStorage,storage);
    assert.equal(runner.localStorage,game.localStorage);
    runner.localStorage.set('party-production:M','running journal');
    const replacement=context.make_context(context.make_context());
    assert.equal(replacement.localStorage.get('party-production:M'),'running journal');
    assert.equal(replacement.sessionStorage,session);
    for(const window of [runner,game,replacement,replacement.parent])window.close();
    assert.ok(thread.includes('get_game_files(proc_args.version)'));
    assert.ok(thread.includes('get_runner_files(proc_args.version)'));
    assert.equal(thread.split('const originalInitSocket').length,2);
    const events=[],socket=new EventEmitter(),game_context={socket,init_socket(){return 'socket-ready'}};
    const hook=thread.slice(thread.indexOf('  game_context.__partyClientVersion'),thread.indexOf('  vm.runInContext("the_game()", game_context);'));
    vm.runInNewContext(hook,{require,game_context,proc_args:{version:99,clientInstance:'instance'},process:{connected:true,send:message=>events.push(message)}});
    assert.equal(game_context.init_socket(),'socket-ready');game_context.init_socket();
    socket.emit('welcome',{});socket.emit('reloaded',{});
    assert.deepEqual(events.map(message=>message.event),['welcome','reloaded']);
    assert.equal(game_context.__partyClientVersion,99);assert.equal(game_context.__partyClientInstance,'instance');

    assert.ok(thread.includes('process.send({type: "client_update", event})'));
    assert.doesNotMatch(thread, /get_(?:game|runner)_files\(\)/);
    assert.ok(thread.indexOf('game_context.is_electron = false;') < thread.indexOf('await ev_files(game_sources, game_context)'));
    assert.equal(thread.split('game_context.is_electron = false;').length, 2);
  }
  for (const file of files) {
    assert.equal(await fs.readFile(path.join(root, '.caracal', file), 'utf8'), originals.get(file),
      'isolated installation must not change the live caracAL checkout');
  }
});
