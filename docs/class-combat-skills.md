# Class combat skills

The class policies in `runtime/characters/skills/` use the installed `G.skills`
catalog for unlocks, costs, cooldown families, stat requirements and equipment.
They extend typed-adventureland 0.0.57 only for the verified September 2026
Paladin/Fan of Knives fields. Review those extensions when upgrading the package.

## Ownership and scheduling

The configured leader owns Taunt and Absorb Sins. Warrior followers never taunt,
including porcupine pulls. A priest leader can absorb any threatened combat ally,
including another priest, without a low-HP prerequisite. Transfers require fresh
observations, enough MP for a subsequent heal, and a two-second incoming-damage
projection leaving more than 30% HP. Unknown attack rates defer protection.
Paladins protect allies with Guardian's Oath without changing monster targets.

Melee formation behavior applies to warriors, paladins and rogues with short
weapon range. Queue observations no longer let a warrior replace the leader as
the designated fighter. Healing coverage still uses an available priest;
compositions without one use the existing leader anchor.

The attack controller chooses between basic attacks and attack-cooldown skills.
Skill requests are sent once, with per-family pending locks and a 2.5-second
acknowledgement deadline. Independent skills use the role support loop. Every
cast rechecks eligibility, activity ownership, range and MP. Multi-target skills
receive explicit target IDs and settle queue evidence per accepted target.

## Mana and damage

Optional damage preserves survival MP: paladins retain the greater of 30% or two
Self-Heals plus Guardian's Oath; priests retain the greater of 35% or two heals
plus Party Heal; rogues/rangers retain 20%. Only unlocked, equipped skills count
toward the reserve. Warrior leader reservations include Taunt and usable emergency
defenses. Emergency healing/protection can spend below the optional reserve.

Farming replenishes damage credit from positive observed MP recovery over 30
seconds plus surplus MP divided by 30 per second. Credit starts and caps at one
affordable optional cast. Cast acknowledgements and expected Mental Burst refunds
never manufacture recovery credit. This deliberately underestimates recovery when
spending and regeneration arrive in the same update.

Events remove the farming spending-rate limit, retaining survival reserves.
Damage comparisons account for armor/resistance, piercing, critical eligibility,
Rogue Stack, fortitude and reported incoming-damage amplification. Remaining HP
and observed allied projectiles cap useful damage. Uncertain item side effects
are not treated as guaranteed damage. Conservative executes exclude criticals
and use the low damage roll.

## Skill decisions

| Class | Skill | Policy |
|---|---|---|
| Warrior | Warcry | Maintain when its own effect is absent and cooldown is ready; emergency defense takes priority and survival MP is reserved. |
| Priest | Dark Blessing | Maintain when its own effect is absent and cooldown is ready; aggro rescue and healing take priority and healing MP is reserved. |
| Ranger | 3-Shot (60), 5-Shot (75) | Choose useful damage across authorized targets; five-shot is not automatically better against three targets. |
| Ranger | Piercing Shot (72) | Replace a basic shot only when the armor-piercing result is better. |
| Ranger | Supershot | Independent burst; avoid negligible remaining HP. |
| Ranger | Hunter's Mark | Durable targets, no existing mark; deterministic ranger ownership. |
| Ranger | Poison Arrow | Disabled: consumes poison. |
| Ranger | Track, 4 Fingers (64) | Player detection/control; no automatic PvE use. |
| Rogue | Fan of Knives (65) | Equipped Knife Belt required; up to five explicit targets, compared with basic attack. |
| Rogue | Mental Burst (64 INT) | Prefer conservative executes; otherwise evaluate magic damage per MP or cooldown. |
| Rogue | Quick Stab, Quick Punch | Require dagger/fist respectively; share one cooldown lock. |
| Rogue | Invisibility | Unengaged opener; never drop active tank responsibility. |
| Rogue | Swiftness (40) | Maintain self/party buffs; one rogue owns refreshes. |
| Rogue | Stack | Passive damage estimate, never a cast. |
| Rogue | Poisonous Touch, Shadow Strike (70) | Disabled consumable skills. |
| Rogue | Pickpocket (16) | No automatic player-item theft. |
| Paladin | Self-Heal | Below 70% HP or at least 80% of its level-scaled heal would be useful. |
| Paladin | Mana Shield | Enable under 40% HP with incoming damage and surplus MP; release above 65% or at the reserve. |
| Paladin | Aether Shield (60) | Safe magical pressure with missing MP; emergency Mana Shield takes precedence. |
| Paladin | Cleansing Light (30) | Cleanse affected allies, never self; urgent conditions can spend reserved MP. |
| Paladin | Guardian's Oath (50) | Endangered ally only, safe projected shared damage, no duplicate links. |
| Paladin | Beacon of Resolve (70) | Multiple allies under attack or a leader facing imminent danger; no redundant refresh. |
| Paladin | Aura (60) | Leader-first defensive coverage; followers prefer complementary auras. Ten-second change hold. |
| Paladin | Purify (60) | Preserve party debuffs unless conservatively lethal; count only removable conditions. |
| Paladin | Shield Slam (60) | Equipped shield; armor-scaled burst subject to optional MP budget. |
| Paladin | Smash (10) | Equipped mace; independent damage filler. |

Ordinary grouped combat includes only the committed target and already engaged
authorized threats. Scatter can add farm targets only when the combined pull
passes survival checks. Goobrawl and other events retain their target authorization.
A/B Testing keeps its existing strategy; the new PvE policies cannot attack players.
Travel, recovery and rare-monster restrictions remain authoritative. This feature
does not purchase consumables or add automatic equipment changes.

## Diagnostics and activation

`combat.runner.skill` reports the last decision's skill, target IDs, reserve,
spending category, result and skip reason through the existing heartbeat.
Use `class-skills.test.cjs`, `priest-absorb-sins.test.cjs`, the attack/movement tests,
and the full regression suite. Build with `npm run build:runtime` and
`npm run build:characters`; activate character and coordinator changes with the
ordinary `scripts/start-console.ps1` workflow. A coordinator-only restart cannot
activate these character policies.
