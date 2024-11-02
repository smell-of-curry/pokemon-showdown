import { ObjectReadWriteStream } from "../../lib/streams";
import { BattlePlayer } from "../battle-stream";
import Dex from "../dex";
import { PRNG, PRNGSeed } from "../prng";

// Define the options interface for the AI
interface HeuristicsAIOptions {
  move?: number;
  mega?: number;
  seed?: PRNG | PRNGSeed | null;
  difficulty?: number; // Difficulty level from 1 (easiest) to 5 (hardest)
}

// Define interfaces and types for clarity
interface IStats {
  [stat: string]: number;
}

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
  stats: IStats;
  sideConditions: { [id: string]: any };
  firstTurn: number;
  protectCount: number;
}

// Creates an array of numbers progressing from start up to and including end
function range(start: number, end?: number, step = 1) {
  if (end === undefined) {
    end = start;
    start = 0;
  }
  const result: number[] = [];
  for (; start <= end; start += step) {
    result.push(start);
  }
  return result;
}

export class HeuristicsPlayerAI extends BattlePlayer {
  protected activeTracker: {
    myActive: IActiveTracker;
    opponentActive: IActiveTracker;
    myTeam: ISidePokemonRequest[];
    opponentTeam: ISidePokemonRequest[];
  };

  protected readonly prng: PRNG;
  protected readonly difficulty: number;

  private speedTierCoefficient = 4.0;
  private trickRoomCoefficient = 1.0;
  private typeMatchupWeight = 2.5;
  private moveDamageWeight = 0.8;
  private antiBoostWeight = 25;
  private hpWeight = 0.25;
  private hpFractionCoefficient = 0.4;
  private boostWeightCoefficient = 1;
  private switchOutMatchupThreshold = 0;

  constructor(
    playerStream: ObjectReadWriteStream<string>,
    options: HeuristicsAIOptions = {},
    debug: boolean = false
  ) {
    super(playerStream, debug);
    this.activeTracker = {
      myActive: null,
      opponentActive: null,
      myTeam: [],
      opponentTeam: [],
    };
    this.prng =
      options.seed && !Array.isArray(options.seed)
        ? options.seed
        : new PRNG(options.seed as PRNGSeed);
    this.difficulty = options.difficulty || 3;
  }

  receiveError(error: Error) {
    // If we made an unavailable choice we will receive a followup request to
    // allow us the opportunity to correct our decision.
    if (error.message.startsWith("[Unavailable choice]")) return;
    throw error;
  }

  receiveRequest(request: IShowdownRequest): string {
    if (request.wait) {
      // Do nothing if waiting
    } else if (request.forceSwitch) {
      // Handle forced switches
      const pokemon = request.side.pokemon;
      const chosen: number[] = [];
      const choices = request.forceSwitch.map((mustSwitch, i) => {
        if (!mustSwitch) return `pass`;

        const canSwitch = range(1, 6).filter(
          (j) =>
            pokemon[j - 1] &&
            // not active
            j > request.forceSwitch.length &&
            // not chosen for a simultaneous switch
            !chosen.includes(j) &&
            // not fainted or fainted and using Revival Blessing
            !!(
              +!!pokemon[i].reviving ^
              +!pokemon[j - 1].condition.endsWith(` fnt`)
            )
        );

        if (!canSwitch.length) return `pass`;
        const target = this.chooseBestSwitch(
          canSwitch.map((slot) => pokemon[slot - 1]),
          request
        );
        chosen.push(target);
        return `switch ${target}`;
      });

      return choices.join(`, `);
    } else if (request.active) {
      // Handle move requests
      const choice = this.chooseMove(request);
      return choice;
    } else {
      // Handle team preview
      const choice = this.chooseTeamPreview(request);
      return choice;
    }
  }

  protected chooseMove(request: IShowdownRequest): string {
    // Update the active tracker
    this.updateActiveTracker(request);

    const active = request.active;
    const side = request.side;
    const choices = active.map((pokemon, index) => {
      if (side.pokemon[index].condition.endsWith(" fnt")) return `pass`;

      const moves = this.getAvailableMoves(pokemon);
      const canSwitch = this.canSwitch(request);
      const shouldSwitch = this.shouldSwitchOut(request, index);

      if (shouldSwitch && canSwitch.length) {
        const bestSwitch = this.chooseBestSwitch(canSwitch, request);
        return `switch ${bestSwitch}`;
      } else {
        const bestMove = this.chooseBestMove(moves, request, index);
        return bestMove;
      }
    });

    return choices.join(", ");
  }

  protected chooseTeamPreview(request: IShowdownRequest): string {
    // Prioritize Pokémon with advantageous matchups

    // TODO - Implement logic to choose the best lead Pokémon
    // For simplicity, we'll return the default order
    return `default`;
  }

  protected updateActiveTracker(request: IShowdownRequest): void {
    const mySide = request.side;
    const opponentSide = request.side.foePokemon;

    // Initialize myActive and opponentActive
    const myActivePokemon = mySide.pokemon.find((p) => p.active);
    const opponentActivePokemon = opponentSide.find((p) => p.active);

    this.activeTracker.myActive = {
      pokemon: myActivePokemon,
      currentHp: this.getCurrentHP(myActivePokemon.condition),
      currentHpPercent: this.getHPFraction(myActivePokemon.condition),
      boosts: myActivePokemon.boosts,
      atkBoost: myActivePokemon.boosts.atk || 0,
      defBoost: myActivePokemon.boosts.def || 0,
      spaBoost: myActivePokemon.boosts.spa || 0,
      spdBoost: myActivePokemon.boosts.spd || 0,
      speBoost: myActivePokemon.boosts.spe || 0,
      currentAbility: myActivePokemon.ability || myActivePokemon.baseAbility,
      currentTypes: myActivePokemon.types,
      moves: myActivePokemon.moves,
      stats: myActivePokemon.stats,
      sideConditions: mySide.sideConditions,
      firstTurn: 1, // Set to 1 for the first turn
      protectCount: 0,
    };

    this.activeTracker.opponentActive = {
      pokemon: opponentActivePokemon,
      currentHp: this.getCurrentHP(opponentActivePokemon.condition),
      currentHpPercent: this.getHPFraction(opponentActivePokemon.condition),
      boosts: opponentActivePokemon.boosts,
      atkBoost: opponentActivePokemon.boosts.atk || 0,
      defBoost: opponentActivePokemon.boosts.def || 0,
      spaBoost: opponentActivePokemon.boosts.spa || 0,
      spdBoost: opponentActivePokemon.boosts.spd || 0,
      speBoost: opponentActivePokemon.boosts.spe || 0,
      currentAbility:
        opponentActivePokemon.ability || opponentActivePokemon.baseAbility,
      currentTypes: opponentActivePokemon.types,
      moves: opponentActivePokemon.moves,
      stats: opponentActivePokemon.stats,
      sideConditions: {}, // TODO - Opponent side conditions are not available
      firstTurn: 1,
      protectCount: 0,
    };

    this.activeTracker.myTeam = mySide.pokemon;
    this.activeTracker.opponentTeam = opponentSide;
  }

  protected getCurrentHP(condition: string): number {
    if (condition === "0 fnt") return 0;
    const [hpStatus] = condition.split(" ");
    if (hpStatus.includes("/")) {
      const [currentHP] = hpStatus.split("/").map(Number);
      return currentHP;
    } else if (hpStatus.endsWith("%")) {
      return parseInt(hpStatus, 10);
    } else {
      return 100; // Assume full HP if not specified
    }
  }

  protected shouldSwitchOut(request: IShowdownRequest, index: number): boolean {
    // Update the active tracker
    this.updateActiveTracker(request);

    const myActive = this.activeTracker.myActive;
    const opponentActive = this.activeTracker.opponentActive;
    const canSwitch = this.canSwitch(request);

    // Check if the Pokémon is trapped
    if (myActive.pokemon.trapped) return false;

    // If the AI's Pokémon is low on HP and the opponent is faster
    if (
      myActive.currentHpPercent < 0.3 &&
      myActive.stats.spe < opponentActive.stats.spe &&
      canSwitch.length > 0
    ) {
      return true;
    }

    // If the AI's Pokémon is at a type disadvantage and has better options
    const matchupScore = this.evaluateMatchup(
      myActive.pokemon,
      opponentActive.pokemon
    );
    if (matchupScore < this.switchOutMatchupThreshold && canSwitch.length > 0) {
      return true;
    }

    // Consider stat drops
    if (
      (myActive.boosts.atk || 0) <= -3 &&
      myActive.stats.atk >= myActive.stats.spa
    ) {
      return true;
    }

    if (
      (myActive.boosts.spa || 0) <= -3 &&
      myActive.stats.spa >= myActive.stats.atk
    ) {
      return true;
    }

    // Additional logic can be added here

    return false;
  }

  protected evaluateMatchup(
    myPokemon: ISidePokemonRequest,
    opponentPokemon: ISidePokemonRequest
  ): number {
    let score = 0;

    // Type effectiveness
    const typeEffectiveness = this.calculateTypeEffectiveness(
      myPokemon.types,
      opponentPokemon.types
    );
    score += typeEffectiveness * this.typeMatchupWeight;

    // Speed comparison
    if (myPokemon.stats.spe > opponentPokemon.stats.spe) {
      score += this.speedTierCoefficient * this.trickRoomCoefficient;
    } else if (myPokemon.stats.spe < opponentPokemon.stats.spe) {
      score -= this.speedTierCoefficient * this.trickRoomCoefficient;
    }

    // HP comparison
    const myHPFraction = this.getHPFraction(myPokemon.condition);
    const oppHPFraction = this.getHPFraction(opponentPokemon.condition);
    score +=
      (myHPFraction - oppHPFraction) *
      this.hpFractionCoefficient *
      this.hpWeight;

    // Consider stat boosts
    const myBoosts = this.sumBoosts(myPokemon.boosts);
    const oppBoosts = this.sumBoosts(opponentPokemon.boosts);
    score += myBoosts - oppBoosts;

    // If the opponent is boosted and the AI has anti-boost moves
    if (this.isBoosted(opponentPokemon) && this.hasAntiBoostMoves(myPokemon)) {
      score += this.antiBoostWeight;
    }

    // Additional factors can be added

    return score;
  }

  protected isBoosted(pokemon: ISidePokemonRequest): boolean {
    const boosts = pokemon.boosts;
    return (
      boosts.atk > this.boostWeightCoefficient ||
      boosts.def > this.boostWeightCoefficient ||
      boosts.spa > this.boostWeightCoefficient ||
      boosts.spd > this.boostWeightCoefficient ||
      boosts.spe > this.boostWeightCoefficient
    );
  }

  protected hasAntiBoostMoves(pokemon: ISidePokemonRequest): boolean {
    const antiBoostMoves = ["haze", "clearSmog"];
    return pokemon.moves.some((moveId) => antiBoostMoves.includes(moveId));
  }

  protected calculateTypeEffectiveness(
    attackerTypes: string[],
    defenderTypes: string[]
  ): number {
    let multiplier = 1.0;
    for (const atkType of attackerTypes) {
      for (const defType of defenderTypes) {
        const effectiveness = Dex.getEffectiveness(atkType, defType);
        multiplier *= effectiveness;
      }
    }
    return multiplier;
  }

  protected sumBoosts(boosts: BoostsTable): number {
    let sum = 0;
    for (const stat in boosts) {
      sum += boosts[stat];
    }
    return sum;
  }

  protected chooseBestMove(
    moves: MoveOption[],
    request: IShowdownRequest,
    index: number
  ): string {
    const myActive = this.activeTracker.myActive;
    const opponentActive = this.activeTracker.opponentActive;

    let bestMove = moves[0];
    let bestValue = -Infinity;

    for (const moveOption of moves) {
      const move = Dex.getActiveMove(moveOption.id);
      let value = 0;

      // Estimate damage
      const damage = this.estimateDamage(
        moveOption,
        myActive.pokemon,
        opponentActive.pokemon
      );

      // Consider status moves
      if (move.category === "Status") {
        // Evaluate status moves strategically
        value = this.evaluateStatusMove(
          moveOption,
          myActive.pokemon,
          opponentActive.pokemon
        );
      } else {
        value = damage;
      }

      // Adjust for randomness and difficulty
      const randomness = 1 - this.difficulty / 5;
      const adjustedValue = value * (1 - randomness * this.prng.next());

      if (adjustedValue > bestValue) {
        bestValue = adjustedValue;
        bestMove = moveOption;
      }
    }

    // Construct the move command
    let moveCmd = `move ${moves.indexOf(bestMove) + 1}`;
    if (request.active.length > 1) {
      moveCmd += ` ${this.chooseMoveTarget(bestMove, request, index)}`;
    }

    return moveCmd;
  }

  protected evaluateStatusMove(
    moveOption: MoveOption,
    attacker: ISidePokemonRequest,
    defender: ISidePokemonRequest
  ): number {
    const move = Dex.getActiveMove(moveOption.id);
    let value = 0;

    // Example: Assign higher value to Will-O-Wisp against physical attackers
    if (move.id === "willowisp" && this.isPhysicalAttacker(defender)) {
      value = 50; // Arbitrary high value
    }

    // Example: Use Thunder Wave if the opponent is faster
    if (move.id === "thunderwave" && defender.stats.spe > attacker.stats.spe) {
      value = 40;
    }

    // Additional logic for other status moves can be added here

    return value;
  }

  protected isPhysicalAttacker(pokemon: ISidePokemonRequest): boolean {
    return pokemon.stats.atk > pokemon.stats.spa;
  }

  protected estimateDamage(
    moveOption: MoveOption,
    attacker: ISidePokemonRequest,
    defender: ISidePokemonRequest
  ): number {
    const move = Dex.getActiveMove(moveOption.id);
    if (!move.basePower) return 0;

    const category = move.category;
    const attackStat = category === "Physical" ? "atk" : "spa";
    const defenseStat = category === "Physical" ? "def" : "spd";

    let attack = attacker.stats[attackStat];
    let defense = defender.stats[defenseStat];

    // Adjust for stat boosts
    attack *= this.getBoostMultiplier(attacker.boosts[attackStat] || 0);
    defense *= this.getBoostMultiplier(defender.boosts[defenseStat] || 0);

    // Adjust for abilities
    if (attacker.ability === "Huge Power" && attackStat === "atk") {
      attack *= 2;
    }

    // Adjust for items
    if (attacker.item === "Choice Band" && attackStat === "atk") {
      attack *= 1.5;
    }

    let baseDamage =
      (((2 * attacker.level) / 5 + 2) * move.basePower * attack) /
        defense /
        50 +
      2;

    // STAB
    if (attacker.types.includes(move.type)) {
      baseDamage *= 1.5;
    }

    // Type effectiveness
    for (const type of defender.types) {
      const effectiveness = Dex.getEffectiveness(move.type, type);
      baseDamage *= effectiveness;
    }

    // Weather effects can be added here
    // For example:
    // if (this.currentWeather === 'RainDance' && move.type === 'Water') {
    //   baseDamage *= 1.5;
    // }

    // Random factor is ignored in estimation

    return baseDamage;
  }

  protected getBoostMultiplier(boost: number): number {
    if (boost >= 0) {
      return (2 + boost) / 2;
    } else {
      return 2 / (2 - boost);
    }
  }

  protected canSwitch(request: IShowdownRequest): ISidePokemonRequest[] {
    return request.side.pokemon.filter(
      (p: any) => !p.active && !p.condition.endsWith(" fnt")
    );
  }

  protected chooseBestSwitch(
    canSwitch: ISidePokemonRequest[],
    request: IShowdownRequest
  ): number {
    let bestScore = -Infinity;
    let bestPokemon = canSwitch[0];

    for (const pokemon of canSwitch) {
      const score = this.evaluateSwitchIn(pokemon, request);
      if (score > bestScore) {
        bestScore = score;
        bestPokemon = pokemon;
      }
    }

    return request.side.pokemon.indexOf(bestPokemon) + 1;
  }

  protected evaluateSwitchIn(
    pokemon: ISidePokemonRequest,
    request: IShowdownRequest
  ): number {
    const opponentActive = this.activeTracker.opponentActive.pokemon;
    return this.evaluateMatchup(pokemon, opponentActive);
  }

  protected chooseMoveTarget(
    move: MoveOption,
    request: IShowdownRequest,
    index: number
  ): number {
    // Simplified targeting logic
    return 1; // Target the first opponent by default
  }

  protected getAvailableMoves(pokemon: IActivePokemonRequest): MoveOption[] {
    return pokemon.moves.filter((move: any) => !move.disabled);
  }

  protected getHPFraction(condition: string): number {
    const [hpStatus] = condition.split(" ");
    if (hpStatus.includes("/")) {
      const [currentHP, maxHP] = hpStatus.split("/").map(Number);
      return currentHP / maxHP;
    } else if (hpStatus.endsWith("%")) {
      return parseInt(hpStatus, 10) / 100;
    } else {
      return 1.0; // Assume full HP if not specified
    }
  }

  // Additional methods can be added here to handle abilities, items, weather, status conditions, etc.
}
