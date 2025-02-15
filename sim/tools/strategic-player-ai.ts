import { ObjectReadWriteStream } from "../../lib/streams";
import { BattlePlayer, range } from "../battle-stream";
import Dex from "../dex";
import { PRNG, PRNGSeed } from "../prng";

/**
 * Configuration for the AI, including difficulty, random seeds, etc.
 */
export interface HeuristicsAIOptions {
	move?: number;
	mega?: number;
	seed?: PRNG | PRNGSeed | null;
	difficulty?: number; // 1..5
}

/**
 * Represents an "active" Pokémon and its derived info for decision-making.
 */
interface IActiveTracker {
	pokemon: ISidePokemonRequest;
	currentHp: number;
	currentHpPercent: number;
	boosts: BoostsTable;
	atkBoost: number;
	defBoost: number;
	spaBoost: number;
	spdBoost: number;
	speBoost: number;
	currentAbility: string;
	currentTypes: string[];
	moves: string[];
	stats: { [stat: string]: number };
	sideConditions: { [id: string]: any };
	firstTurn: number;
	protectCount: number;
}

/**
 * Our main AI class that inherits from BattlePlayer.
 * It merges some logic from your Kotlin "StrongBattleAI" with standard Showdown heuristics.
 */
export class StrongHeuristicsAI extends BattlePlayer {
	protected activeTracker: {
		myActive?: IActiveTracker;
		opponentActive?: IActiveTracker;
		myTeam: ISidePokemonRequest[];
		opponentTeam: ISidePokemonRequest[];
	};

	protected readonly prng: PRNG;
	protected readonly difficulty: number;

	/** Various numeric parameters controlling AI behavior. */
	private speedTierCoefficient = 4.0;
	private trickRoomCoefficient = 1.0;
	private typeMatchupWeight = 2.5;
	private moveDamageWeight = 0.8;
	private antiBoostWeight = 25;
	private hpWeight = 0.25;
	private hpFractionCoefficient = 0.4;
	private boostWeightCoefficient = 1;
	private switchOutMatchupThreshold = -3;

	// Keep track of how often we’ve switched to avoid repeated bounce:
	private lastSwitchTurn: number | null = null;
	private switchLockTurns = 2; // number of turns we disallow immediate switching back

	/**
	 * If below this HP% and foe is faster, we might do an “emergency” switch.
	 */
	private faintThresholdPercent = 0.1;

	/**
	 * Probability of using Protect if available (random check).
	 */
	private protectProbability = 0.15;

	/**
	 * If below 50% HP, we might use recovery moves (if we have them).
	 */
	private recoveryMoveThreshold = 0.5;

	/**
	 * If accuracy is reduced below -3, consider switching out.
	 */
	private accuracySwitchThreshold = -3;

	/**
	 * If below 30% HP (and not trapped), consider switching.
	 */
	private hpSwitchOutThreshold = 0.3;

	/** We track weather to apply advanced weather-based multipliers. */
	private currentWeather: string | null = null;

	constructor(
		playerStream: ObjectReadWriteStream<string>,
		options: HeuristicsAIOptions = {},
		debug = false
	) {
		super(playerStream, debug);
		this.activeTracker = {
			myTeam: [],
			opponentTeam: [],
		};
		this.prng =
			options.seed && !Array.isArray(options.seed)
				? options.seed
				: new PRNG(options.seed as PRNGSeed);
		this.difficulty = options.difficulty || 3;
	}

	/**
	 * Called if our chosen action is invalid. We can try again next time.
	 * @param error - The error thrown, probably to do with move selection.
	 */
	public receiveError(error: string): void {
		console.warn(`Trainer Error Message: "${error}"`);

		// [Invalid choice] Can't move: Bunnelby's Agility is disabled
		// type == Invalid choice
		// suffix == Can't move
		// message == Bunnelby's Agility is disabled
		const [type, suffix, message] =
			error.match(/^\[(.*?)\] (.*?): (.*)$/) || [];

		switch (type) {
			case "Invalid choice":
				// This will tell you to send a different decision. If your previous choice
				// revealed additional information (For example: a move disabled by Imprison
				// or a trapping effect), the error will be followed with a `|request|` command
				// to base your decision off of:

				if (suffix === "Can't move") {
					// The trainer just choose a move that is probably disabled.
					// We need to block that move from being chosen again, and re-receiveRequest.
				}
				break;
			case "Unavailable choice":
				break;
			default:
				break;
		}
	}

	/**
	 * Called whenever Showdown sends a request: choose a move, force switch, team preview, etc.
	 */
	public receiveRequest(request: IShowdownRequest): string {
		if (request.wait) {
			return ``;
		}

		// If there's a weather field in the request (uncommon), record it.
		if ((request as any).weather) {
			this.currentWeather = (request as any).weather || null;
		}

		// Force switch scenario
		if (request.forceSwitch) {
			return this.handleForceSwitch(request);
		}
		// Standard move selection
		else if (request.active) {
			return this.chooseMove(request);
		}
		// Possibly team preview
		else {
			return this.chooseTeamPreview(request);
		}
	}

	/**
	 * For forced switching, e.g. after a KO or a pivot move.
	 */
	private handleForceSwitch(request: IShowdownRequest): string {
		const side = request.side;
		const forceSwitchFlags = request.forceSwitch || [];
		if (!side?.pokemon) return `pass`;

		const chosen: number[] = [];
		const decisions = forceSwitchFlags.map((mustSwitch, i) => {
			if (!mustSwitch) return `pass`;

			// Identify possible switch-ins
			const validSlots = range(1, side.pokemon.length).filter((j) => {
				const benchPoke = side.pokemon[j - 1];
				if (!benchPoke) return false;
				if (benchPoke.condition.endsWith(" fnt") && !benchPoke.reviving)
					return false;
				if (j <= forceSwitchFlags.length) return false; // active slot
				if (chosen.includes(j)) return false;
				return true;
			});

			if (!validSlots.length) return `pass`;

			// Among all valid bench, pick the best
			const bestBenchSlot = this.chooseBestSwitch(
				validSlots.map((x) => side.pokemon[x - 1]),
				request
			);
			chosen.push(bestBenchSlot);
			return `switch ${bestBenchSlot}`;
		});

		return decisions.join(", ");
	}

	/**
	 * Main logic for picking moves each turn.
	 */
	private chooseMove(request: IShowdownRequest): string {
		this.updateActiveTracker(request);

		const side = request.side;
		const actives = request.active;
		if (!side || !actives) return `pass`;

		const decisions = actives.map((slot, index) => {
			const sidePoke = side.pokemon[index];
			if (!sidePoke || sidePoke.condition.endsWith(" fnt")) {
				return `pass`;
			}

			const moves = this.getAvailableMoves(slot);
			if (!moves.length) return `pass`;

			// Possibly check if we do a “correct” switch or move:
			const canSwitchMons = this.canSwitch(request);
			const doSwitch = this.shouldSwitchOut(request, index);

			// Possibly do a random Protect usage
			if (this.prng.next() < this.protectProbability) {
				const protectIndex = moves.findIndex(
					(m) => Dex.getActiveMove(m.id)?.id === "protect"
				);
				if (protectIndex >= 0) {
					return `move ${protectIndex + 1}`;
				}
			}

			if (doSwitch && canSwitchMons.length > 0) {
				// skill-based check for switch
				const switchSuccessProb = this.skillToSuccessProbability(
					this.difficulty,
					"switch"
				);
				if (this.prng.next() < switchSuccessProb) {
					const bestSlot = this.chooseBestSwitch(canSwitchMons, request);
					return `switch ${bestSlot}`;
				}
			}

			// Otherwise choose best move
			return this.chooseBestMove(moves, request, index);
		});

		return decisions.join(", ");
	}

	/**
	 * For team preview: pick an initial lead. We do a simple approach:
	 * evaluate each of ours vs. foe's rosters, pick the best sum.
	 */
	private chooseTeamPreview(request: IShowdownRequest): string {
		const side = request.side;
		if (!side?.pokemon?.length || !side.foePokemon.length) {
			return `default`;
		}

		let bestScore = -Infinity;
		let bestIndex = 0;

		for (let i = 0; i < side.pokemon.length; i++) {
			const candidate = side.pokemon[i];
			if (!candidate || candidate.condition.endsWith(" fnt")) continue;
			let sum = 0;
			for (const foeMon of side.foePokemon) {
				sum += this.evaluateMatchup(candidate, foeMon);
			}
			if (sum > bestScore) {
				bestScore = sum;
				bestIndex = i;
			}
		}

		const order = [
			bestIndex,
			...range(0, side.pokemon.length - 1).filter((x) => x !== bestIndex),
		];
		return `team ${order.map((x) => x + 1).join(",")}`;
	}

	/**
	 * Update our internal tracking of the active Pokémon on each side.
	 */
	private updateActiveTracker(request: IShowdownRequest): void {
		const side = request.side;
		if (!side) return;
		const foe = side.foePokemon;
		const myActive = side.pokemon.find((p) => p.active);
		const oppActive = foe?.find((p) => p.active);

		if (!myActive || !oppActive) {
			this.activeTracker.myActive = undefined;
			this.activeTracker.opponentActive = undefined;
			this.activeTracker.myTeam = side.pokemon;
			this.activeTracker.opponentTeam = foe || [];
			return;
		}

		this.activeTracker.myActive = {
			pokemon: myActive,
			currentHp: this.getCurrentHP(myActive.condition),
			currentHpPercent: this.getHPFraction(myActive.condition),
			boosts: myActive.boosts,
			atkBoost: myActive.boosts.atk || 0,
			defBoost: myActive.boosts.def || 0,
			spaBoost: myActive.boosts.spa || 0,
			spdBoost: myActive.boosts.spd || 0,
			speBoost: myActive.boosts.spe || 0,
			currentAbility: myActive.ability || myActive.baseAbility,
			currentTypes: myActive.types,
			moves: myActive.moves,
			stats: myActive.stats,
			sideConditions: side.sideConditions,
			firstTurn: 1,
			protectCount: 0,
		};

		this.activeTracker.opponentActive = {
			pokemon: oppActive,
			currentHp: this.getCurrentHP(oppActive.condition),
			currentHpPercent: this.getHPFraction(oppActive.condition),
			boosts: oppActive.boosts,
			atkBoost: oppActive.boosts.atk || 0,
			defBoost: oppActive.boosts.def || 0,
			spaBoost: oppActive.boosts.spa || 0,
			spdBoost: oppActive.boosts.spd || 0,
			speBoost: oppActive.boosts.spe || 0,
			currentAbility: oppActive.ability || oppActive.baseAbility,
			currentTypes: oppActive.types,
			moves: oppActive.moves,
			stats: oppActive.stats,
			sideConditions: {}, // not in request
			firstTurn: 1,
			protectCount: 0,
		};

		this.activeTracker.myTeam = side.pokemon;
		this.activeTracker.opponentTeam = foe || [];
	}

	/**
	 * Returns numeric HP from "145/300" or "0 fnt" etc.
	 * @param condition The condition string from the Pokémon.
	 */
	private getCurrentHP(condition: string): number {
		if (condition.includes(" fnt")) return 0;
		const [hpPart] = condition.split(" ");
		if (hpPart.includes("/")) {
			const [curr] = hpPart.split("/").map(Number);
			return curr;
		} else if (hpPart.endsWith("%")) {
			return parseInt(hpPart, 10);
		}
		return 100;
	}

	/**
	 * Returns fraction 0..1 from "145/300" or "50%".
	 * @param condition The condition string from the Pokémon.
	 */
	private getHPFraction(condition: string): number {
		const [hpPart] = condition.split(" ");
		if (hpPart.includes("/")) {
			const [num, den] = hpPart.split("/").map(Number);
			if (den) return num / den;
			return 1.0;
		} else if (hpPart.endsWith("%")) {
			return parseInt(hpPart, 10) / 100;
		}
		return 1.0;
	}

	/**
	 * Whether we want to switch out the current active Pokémon.
	 * We consider HP, matchup, stat drops, etc.
	 *
	 * @param request The current request.
	 * @param slotIndex The index of the active slot.
	 */
	private shouldSwitchOut(
		request: IShowdownRequest,
		slotIndex: number
	): boolean {
		this.updateActiveTracker(request);
		const me = this.activeTracker.myActive;
		const foe = this.activeTracker.opponentActive;
		if (!me || !foe) return false;

		// If we just switched recently, skip switching again to avoid ping-pong
		if (this.lastSwitchTurn != null) {
			// e.g., get the current turn from request if possible (somewhere in the data)
			const currentTurn = (request as any).turn || 0;
			if (currentTurn - this.lastSwitchTurn < this.switchLockTurns) {
				return false;
			}
		}

		if (me.pokemon.trapped) return false;

		// If extremely low HP and foe is faster
		if (
			me.currentHpPercent < this.faintThresholdPercent &&
			me.stats.spe < foe.stats.spe &&
			this.canSwitch(request).length > 0
		) {
			this.lastSwitchTurn = (request as any).turn || 0;
			return true;
		}

		// Evaluate matchup
		const matchScore = this.evaluateMatchup(me.pokemon, foe.pokemon);
		// Only switch if significantly negative
		if (
			matchScore < this.switchOutMatchupThreshold &&
			this.canSwitch(request).length > 0
		) {
			this.lastSwitchTurn = (request as any).turn || 0;
			return true;
		}

		// Large negative stat drops
		if ((me.boosts.atk || 0) <= -3 && me.stats.atk >= me.stats.spa) {
			this.lastSwitchTurn = (request as any).turn || 0;
			return true;
		}
		if ((me.boosts.spa || 0) <= -3 && me.stats.spa >= me.stats.atk) {
			this.lastSwitchTurn = (request as any).turn || 0;
			return true;
		}

		// If below hpSwitchOutThreshold
		if (
			me.currentHpPercent < this.hpSwitchOutThreshold &&
			this.canSwitch(request).length > 0
		) {
			this.lastSwitchTurn = (request as any).turn || 0;
			return true;
		}

		return false;
	}

	/**
	 * We adapt the Kotlin logic to evaluate a matchup.
	 * The higher the returned score, the better it is for "myPoke".
	 *
	 * @param myPoke The Pokémon we are evaluating.
	 * @param foePoke The opponent's Pokémon.
	 */
	private evaluateMatchup(
		myPoke: ISidePokemonRequest,
		foePoke: ISidePokemonRequest
	): number {
		let score = 0;

		// Type advantage
		const typeMult = this.calculateTypeEffectiveness(
			myPoke.types,
			foePoke.types
		);
		score += typeMult * this.typeMatchupWeight;

		// Speed advantage
		if (myPoke.stats.spe > foePoke.stats.spe) {
			score += this.speedTierCoefficient * this.trickRoomCoefficient;
		} else if (myPoke.stats.spe < foePoke.stats.spe) {
			score -= this.speedTierCoefficient * this.trickRoomCoefficient;
		}

		// HP fraction difference
		const myHPFrac = this.getHPFraction(myPoke.condition);
		const foeHPFrac = this.getHPFraction(foePoke.condition);
		score +=
			(myHPFrac - foeHPFrac) * this.hpFractionCoefficient * this.hpWeight;

		// Sum boosts
		const mySum = this.sumBoosts(myPoke.boosts);
		const theirSum = this.sumBoosts(foePoke.boosts);
		score += mySum - theirSum;

		// If the foe is boosted but we have anti-boost moves
		if (this.isBoosted(foePoke) && this.hasAntiBoostMoves(myPoke)) {
			score += this.antiBoostWeight;
		}

		return score;
	}

	/**
	 * Sum the numeric values in a BoostsTable.
	 * @param boosts The BoostsTable to sum.
	 */
	private sumBoosts(boosts: BoostsTable): number {
		let s = 0;
		for (const statID in boosts) {
			const st = statID as BoostID;
			s += boosts[st] || 0;
		}
		return s;
	}

	/**
	 * If any relevant stat is above our threshold, we consider the Pokémon "boosted."
	 * @param poke The Pokémon to check.
	 */
	private isBoosted(poke: ISidePokemonRequest): boolean {
		return (
			(poke.boosts.atk || 0) > this.boostWeightCoefficient ||
			(poke.boosts.def || 0) > this.boostWeightCoefficient ||
			(poke.boosts.spa || 0) > this.boostWeightCoefficient ||
			(poke.boosts.spd || 0) > this.boostWeightCoefficient ||
			(poke.boosts.spe || 0) > this.boostWeightCoefficient
		);
	}

	/**
	 * If we have moves like "haze", "clearsmog", or "spectralthief".
	 * @param poke The Pokémon to check.
	 */
	private hasAntiBoostMoves(poke: ISidePokemonRequest): boolean {
		const anti = ["haze", "clearsmog", "spectralthief", "clearSmog"];
		return poke.moves.some((m) => anti.includes(m));
	}

	/**
	 * Multiply together the type effectiveness of each attacker type on each defender type.
	 * Showdown’s Dex.getEffectiveness is simpler than your Kotlin typed map.
	 *
	 * @param attackerTypes The types of the attacking Pokémon.
	 * @param defenderTypes The types of the defending Pokémon.
	 */
	private calculateTypeEffectiveness(
		attackerTypes: string[],
		defenderTypes: string[]
	): number {
		let mult = 1.0;
		for (const atk of attackerTypes) {
			for (const def of defenderTypes) {
				mult *= Dex.getEffectiveness(atk, def);
			}
		}
		return mult;
	}

	/**
	 * Choose the best move from the given move list.
	 * We incorporate a more advanced damage formula that references
	 * some of the Kotlin logic (multi-hit, burn, weather, Adaptability, random factor, etc.).
	 *
	 * @param moves The list of selectable moves.
	 * @param request The current request.
	 * @param slotIndex The index of the active slot.
	 */
	private chooseBestMove(
		moves: MoveOption[],
		request: IShowdownRequest,
		slotIndex: number
	): string {
		const me = this.activeTracker.myActive;
		const foe = this.activeTracker.opponentActive;
		if (!me || !foe) return `move 1`;

		let bestMove = moves[0];
		let bestValue = -Infinity;

		for (const opt of moves) {
			const moveData = Dex.getActiveMove(opt.id);
			if (!moveData) continue;

			let value = 0;

			if (moveData.category === "Status") {
				// Use your custom logic for status/boost/hazard moves
				value = this.evaluateStatusMove(opt, me.pokemon, foe.pokemon);
			} else {
				// Offensive move: estimate partial damage
				const foeHP = this.getCurrentHP(foe.pokemon.condition);
				const predictedDmg = this.estimateDamage(
					opt,
					me.pokemon,
					foe.pokemon
				);

				// Add some base "damage weight" so big hits are appealing
				value = predictedDmg * this.moveDamageWeight;

				// If the move is a guaranteed KO, add a large bonus
				if (predictedDmg >= foeHP) {
					value += 40;
				}
			}

			if (value > bestValue) {
				bestValue = value;
				bestMove = opt;
			}
		}

		// If doubles/triples, pick which target to attack
		const targetIndex = this.chooseMoveTarget(bestMove, request, slotIndex);

		// Get Real IDX of the move
		const moveIdx =
			(request.active as IActivePokemonRequest[])[slotIndex].moves.indexOf(
				bestMove
			) + 1;

		if (request.active && request.active.length > 1) {
			return `move ${moveIdx} ${targetIndex}`;
		} else {
			return `move ${moveIdx}`;
		}
	}

	/**
	 * Evaluate a status move.
	 * E.g., Will-o-Wisp vs physically inclined foes, TWave vs faster foes, etc.
	 *
	 * @param opt The move option to evaluate.
	 * @param myPoke Our active Pokémon.
	 * @param foePoke The opponent's active Pokémon.
	 */
	private evaluateStatusMove(
		opt: MoveOption,
		myPoke: ISidePokemonRequest,
		foePoke: ISidePokemonRequest
	): number {
		const m = Dex.getActiveMove(opt.id);
		if (!m) return 0;

		// If foe is already statused, no point in using a status-inflicting move again
		const foeAlreadyStatused = !!foePoke.status && foePoke.status !== "none";

		let val = 0;
		switch (m.id) {
			case "willowisp":
				// If foe is physically oriented and not already burned, not Fire-type
				if (
					!foeAlreadyStatused &&
					foePoke.stats.atk > foePoke.stats.spa &&
					!foePoke.types.includes("Fire")
				) {
					val = 35; // lowered from 50
				}
				break;

			case "thunderwave":
				// If foe is faster, not already statused, not Ground/Electric immune
				if (!foeAlreadyStatused && foePoke.stats.spe > myPoke.stats.spe) {
					val = 30; // lowered from 40
				}
				break;

			case "swordsdance":
			case "nastyplot":
				// Only valuable if we haven't boosted too much already
				// e.g., if we're < +2 in the relevant offensive stat, or if it actually fits our stats
				const isPhysical = m.id === "swordsdance";
				const currentBoost = isPhysical
					? myPoke.boosts.atk || 0
					: myPoke.boosts.spa || 0;
				if (currentBoost < 2) {
					// also check if we’re actually that kind of attacker
					const betterAtk = isPhysical
						? myPoke.stats.atk >= myPoke.stats.spa
						: myPoke.stats.spa >= myPoke.stats.atk;
					if (betterAtk) val = 20; // lowered from 30
				}
				break;

			case "stealthrock":
			case "spikes":
				// Example: only if hazards are not already set
				// (In a real AI, you'd check side conditions properly)
				val = 15; // lowered from 25
				break;

			default:
				// Possibly more checks for other utility/status moves
				break;
		}

		return val;
	}

	/**
	 * A more advanced damage formula that mimics your Kotlin logic from the `StrongBattleAI`.
	 * Includes multi-hit moves, burn penalty, weather, and so on.
	 *
	 * @param opt The move option to evaluate.
	 * @param atkSide Our active Pokémon.
	 * @param defSide The opponent's active Pokémon.
	 */
	private estimateDamage(
		opt: MoveOption,
		atkSide: ISidePokemonRequest,
		defSide: ISidePokemonRequest
	): number {
		const m = Dex.getActiveMove(opt.id);
		if (!m || !m.basePower) return 0;

		// Determine if multi-hit
		const multiHitInfo = this.getMultiHitInfo(m.id);
		// The average # hits if multi-hit
		const hits = multiHitInfo.avgHits || 1;

		// Physical or special
		const isPhysical = m.category === "Physical";
		const atkStat = isPhysical ? "atk" : "spa";
		const defStat = isPhysical ? "def" : "spd";

		let atkVal = atkSide.stats[atkStat];
		let defVal = defSide.stats[defStat];

		// Apply boosts
		atkVal *= this.getBoostMultiplier(atkSide.boosts[atkStat] || 0);
		defVal *= this.getBoostMultiplier(defSide.boosts[defStat] || 0);

		// Abilities: e.g., Huge/Pure Power => double Attack
		const ability = (
			atkSide.ability ||
			atkSide.baseAbility ||
			""
		).toLowerCase();
		if ((ability === "hugepower" || ability === "purepower") && isPhysical) {
			atkVal *= 2;
		}

		// Check for items: choice band/specs
		const item = atkSide.item.toLowerCase();
		if (
			(item.includes("choice band") || item.includes("choiceband")) &&
			isPhysical
		) {
			atkVal *= 1.5;
		}
		if (
			(item.includes("choice specs") || item.includes("choicespecs")) &&
			!isPhysical
		) {
			atkVal *= 1.5;
		}

		// Base formula
		let damage =
			(((2 * (atkSide.level || 100)) / 5 + 2) * m.basePower * atkVal) /
				defVal /
				50 +
			2;

		// STAB
		if (atkSide.types.includes(m.type)) {
			// If ability is "adaptability," STAB is 2.0 instead of 1.5
			if (ability === "adaptability") {
				damage *= 2.0;
			} else {
				damage *= 1.5;
			}
		}

		// Type effectiveness
		for (const defType of defSide.types) {
			const eff = Dex.getEffectiveness(m.type, defType);
			damage *= eff;
		}

		// Weather
		if (this.currentWeather === "raindance") {
			if (m.type === "Water") damage *= 1.5;
			if (m.type === "Fire") damage *= 0.5;
		} else if (this.currentWeather === "sunnyday") {
			if (m.type === "Fire") damage *= 1.5;
			if (m.type === "Water") damage *= 0.5;
		}

		// If user is burned and using a physical move, cut damage in half
		// (unless Guts, etc. but we skip that detail for brevity).
		if (
			atkSide.status === "brn" &&
			isPhysical &&
			ability !== "guts" &&
			ability !== "flareboost"
		) {
			damage *= 0.5;
		}

		// Multiply by hits
		damage *= hits;

		// We can add a small random factor (0.85..1.0) for realism
		const rand = 0.85 + 0.15 * this.prng.next();
		damage *= rand;

		// Don’t go negative
		if (damage < 0) damage = 0;

		return damage;
	}

	/**
	 * Returns [minHits, maxHits, avgHits] for a multi-hit move ID, if relevant.
	 *
	 * @param moveId The ID of the move to check.
	 * @returns The min, max, and average number of hits.
	 * @example getMultiHitInfo("rockblast") => { minHits: 2, maxHits: 5, avgHits: 3.5 }
	 */
	private getMultiHitInfo(moveId: string): {
		minHits: number;
		maxHits: number;
		avgHits: number;
	} {
		// Example: in your Kotlin code, you have an entire map of multi-hit moves.
		// We'll just handle a few or do a simple fallback.
		const multiHitMap: { [id: string]: [number, number] } = {
			// 2 - 5 hit moves
			armthrust: [2, 5],
			barrage: [2, 5],
			bonerush: [2, 5],
			bulletseed: [2, 5],
			cometpunch: [2, 5],
			doubleslap: [2, 5],
			furyattack: [2, 5],
			furyswipes: [2, 5],
			iciclespear: [2, 5],
			pinmissile: [2, 5],
			rockblast: [2, 5],
			scaleshot: [2, 5],
			spikecannon: [2, 5],
			tailslap: [2, 5],

			// fixed hit count
			bonemerang: [2, 2],
			doublehit: [2, 2],
			doubleironbash: [2, 2],
			doublekick: [2, 2],
			dragondarts: [2, 2],
			dualchop: [2, 2],
			dualwingbeat: [2, 2],
			geargrind: [2, 2],
			twinbeam: [2, 2],
			twineedle: [2, 2],
			suringstrikes: [3, 3],
			tripledive: [3, 3],
			watershuriken: [3, 3],

			// accuracy based multi-hit moves
			tripleaxel: [1, 3],
			triplekick: [1, 3],
			populationbomb: [1, 10],
		};
		const match = multiHitMap[moveId];
		if (!match) {
			return { minHits: 1, maxHits: 1, avgHits: 1 };
		}

		const [min, max] = match;
		if (min === max) {
			return { minHits: min, maxHits: max, avgHits: min };
		} else {
			// e.g. 2..5 => average is (3.0) or something approximate
			const avg = (min + max) / 2;
			return { minHits: min, maxHits: max, avgHits: avg };
		}
	}

	/**
	 * Returns a multiplier for a given integer boost.
	 * @param boost The boost value (-6..+6).
	 */
	private getBoostMultiplier(boost: number): number {
		if (boost >= 0) {
			return (2 + boost) / 2;
		} else {
			return 2 / (2 - boost);
		}
	}

	/**
	 * Return the list of bench Pokémon we can switch to.
	 * @param request The current request.
	 */
	private canSwitch(request: IShowdownRequest): ISidePokemonRequest[] {
		const side = request.side;
		if (!side?.pokemon) return [];
		return side.pokemon.filter(
			(p) => !p.active && !p.condition.endsWith(" fnt")
		);
	}

	/**
	 * Among some candidate bench Pokémon, pick the best to switch into.
	 * We evaluate by comparing each candidate's matchup vs. the foe’s active.
	 *
	 * @param candidates The list of candidate Pokémon to switch to.
	 * @param request The current request.
	 */
	private chooseBestSwitch(
		candidates: ISidePokemonRequest[],
		request: IShowdownRequest
	): number {
		const foe = this.activeTracker.opponentActive?.pokemon;
		if (!foe) {
			// fallback
			return request.side?.pokemon.indexOf(candidates[0]) + 1 || 1;
		}

		let bestScore = -Infinity;
		let bestMon = candidates[0];
		for (const c of candidates) {
			const sc = this.evaluateMatchup(c, foe);
			if (sc > bestScore) {
				bestScore = sc;
				bestMon = c;
			}
		}

		const idx = request.side?.pokemon.indexOf(bestMon);
		if (idx === undefined || idx < 0) return 1;
		return idx + 1;
	}

	/**
	 * Choose move target in multi-target formats (doubles, triples).
	 * We can do something more advanced: e.g., if we can KO an enemy, prefer that.
	 *
	 * @param move The move option we are considering.
	 * @param request The current request.
	 * @param slotIndex The index of the active slot.
	 */
	private chooseMoveTarget(
		move: MoveOption,
		request: IShowdownRequest,
		slotIndex: number
	): number {
		if (!request.active || request.active.length <= 1) {
			return 1; // single battles => always target 1
		}
		// In doubles/triples, let's pick the foe that yields the highest “damage” estimate
		// or that is within KO range.

		const me = this.activeTracker.myActive;
		const foes: Array<{ slot: number; foePoke: ISidePokemonRequest }> = [];
		const foeSide = request.side.foePokemon;

		// Let’s guess how many foes are on the field for multi battles:
		// We'll assume up to foeSide.length is possible.
		// This is simplistic, but a real doubles/triples AI would check request.active on the foe’s side.

		foeSide.forEach((f, i) => {
			if (f.active && !f.condition.endsWith(" fnt")) {
				foes.push({ slot: i + 1, foePoke: f });
			}
		});

		if (!foes.length || !me) return 1;

		let bestSlot = foes[0].slot;
		let bestValue = -Infinity;

		for (const foeObj of foes) {
			const hypotheticalDamage = this.estimateDamage(
				move,
				me.pokemon,
				foeObj.foePoke
			);
			// If we can KO them => huge value
			const foeHP = this.getCurrentHP(foeObj.foePoke.condition);
			if (hypotheticalDamage >= foeHP) {
				// immediate KO => pick this
				return foeObj.slot;
			}
			if (hypotheticalDamage > bestValue) {
				bestValue = hypotheticalDamage;
				bestSlot = foeObj.slot;
			}
		}

		return bestSlot;
	}

	/**
	 * We incorporate a skill check for picking "good" vs "random" actions (move/switch/item).
	 * This is a simple heuristic that can be adjusted.
	 *
	 * @param difficulty The difficulty level (1..5).
	 * @param actionType The type of action we are considering.
	 */
	private skillToSuccessProbability(
		difficulty: number,
		actionType: "move" | "switch" | "item"
	): number {
		// Some arbitrary mappings. Tweak to your preference.
		if (actionType === "move") {
			// difficulty=5 => 100% always pick the best
			// difficulty=1 => 20%
			return difficulty * 0.2;
		} else if (actionType === "switch") {
			// For switching logic
			switch (difficulty) {
				case 5:
					return 1.0;
				case 4:
					return 0.8;
				case 3:
					return 0.4;
				case 2:
					return 0.2;
				default:
					return 0.0;
			}
		} else if (actionType === "item") {
			// If we had item usage
			switch (difficulty) {
				case 5:
					return 1.0;
				case 4:
					return 0.75;
				case 3:
					return 0.5;
				case 2:
					return 0.25;
				default:
					return 0.0;
			}
		}
		return 0;
	}

	/**
	 * Return all non-disabled moves from the active slot.
	 *
	 * @param active The active slot to check.
	 */
	protected getAvailableMoves(active: IActivePokemonRequest): MoveOption[] {
		if (!active?.moves) return [];
		return active.moves.filter((m) => !m.disabled);
	}
}
