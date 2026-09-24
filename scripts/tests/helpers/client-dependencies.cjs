const fs = require('node:fs');
const vm = require('node:vm');
const {namedFunction} = require('./named-function.cjs');
const source = fs.readFileSync('characters/shared.js', 'utf8');
function functions(context, names) {
  vm.runInContext(names.map(name => namedFunction(source, name)).join('\n'), context);
}

// Ordinary combat scenarios start without passing encounters. Use the real
// predicates so a fixture can also introduce passing ownership explicitly.
exports.passingContext = values => {
  const context = vm.createContext({
    passingEncounters: {}, peerPassingEncounters: [], coordinatorClockOffset: 0,
    groupedCombat: null, passiveHunting: {rules: {}, useFieldGenerators: true},
    navigationIntent: {}, partyTownActive: false, banking: false, stocking: false,
    upgrading: false, gatheringActive: false, forceTraveling: false, townTraveling: false,
    eventTraveling: false, joinedEvent: false, root: {},
    escapeOwns: () => false, combatRecoveryActive: () => false,
    activeCombatEvent: () => false, rareActive: () => false, unfinishedFight: () => false,
    reunionRealm: () => 'USII', ...values,
  });
  functions(context, ['passiveStopRequired','passiveTravelInterruptible','travelStopCandidates','outboundHuntTravel', 'huntTravelDefense', 'huntTravelControl', 'huntTravelExtraAggro', 'returnDepartureDefense', 'committedHuntEncounter', 'passingKey', 'isPassingEncounter', 'passingTravelAllowed', 'passingTarget']);
  return context;
};

exports.merchantGuards = (context, {stock = false, journal = false} = {}) => {
  context.root ||= {};
  functions(context, ['verifyMerchantItemMarks']);
  if (stock) {
    context.partyAvailableCraftStock = require('../../../runtime/coordinator/merchant/craft-reservations.ts').availableCraftStock;
    functions(context, ['compoundAvailableStock']);
  }
  if (journal) {
    const storage = new Map();
    context.root.localStorage ||= {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    };
    context.luckyUpgradeService ??= null;
    functions(context, ['productionJournalKey', 'finishProductionJournal', 'recoverProductionJournal',
      'verifyProductionProtection', 'trackedProduction']);
  }
  return context;
};
