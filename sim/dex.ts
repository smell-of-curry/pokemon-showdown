/**
 * Dex
 * Pokemon Showdown - http://pokemonshowdown.com/
 *
 * Handles getting data about pokemon, items, etc. Also contains some useful
 * helper functions for using dex data.
 *
 * By default, nothing is loaded until you call Dex.mod(mod) or
 * Dex.forFormat(format).
 *
 * You may choose to preload some things:
 * - Dex.includeMods() ~10ms
 *   This will preload `Dex.dexes`, giving you a list of possible mods.
 * - Dex.includeFormats() ~30ms
 *   As above, but will also preload `Dex.formats.all()`.
 * - Dex.includeData() ~500ms
 *   As above, but will also preload all of Dex.data for Gen 8, so
 *   functions like `Dex.species.get`, etc will be instantly usable.
 * - Dex.includeModData() ~1500ms
 *   As above, but will also preload `Dex.dexes[...].data` for all mods.
 *
 * Note that preloading is never necessary. All the data will be
 * automatically preloaded when needed, preloading will just spend time
 * now so you don't need to spend time later.
 *
 * @license MIT
 */
import * as Data from "./dex-data";
import { Condition, DexConditions } from "./dex-conditions";
import { DataMove, DexMoves, MoveData } from "./dex-moves";
import { Item, DexItems, ItemData } from "./dex-items";
import { Ability, AbilityData, DexAbilities } from "./dex-abilities";
import { Species, DexSpecies, LearnsetData, SpeciesData } from "./dex-species";
import { Format, DexFormats, FormatData } from "./dex-formats";
import { Utils } from "../lib";
import { AbilitiesText } from "../data/text/abilities";
import { DefaultText } from "../data/text/default";
import { ItemsText } from "../data/text/items";
import { MovesText } from "../data/text/moves";
import { PokedexText } from "../data/text/pokedex";
import { Scripts as FullPotentialScripts } from "../data/mods/fullpotential/scripts";
import { Scripts as Gen1Scripts } from "../data/mods/gen1/scripts";
import { Scripts as Gen1JpnScripts } from "../data/mods/gen1jpn/scripts";
import { Scripts as Gen1StadiumScripts } from "../data/mods/gen1stadium/scripts";
import { Scripts as Gen2Scripts } from "../data/mods/gen2/scripts";
import { Scripts as Gen2SDoublescripts } from "../data/mods/gen2doubles/scripts";
import { Scripts as Gen2Stadium2Scripts } from "../data/mods/gen2stadium2/scripts";
import { Scripts as Gen3Scripts } from "../data/mods/gen3/scripts";
import { Scripts as Gen4Scripts } from "../data/mods/gen4/scripts";
import { Scripts as Gen4PtScripts } from "../data/mods/gen4pt/scripts";
import { Scripts as Gen5Scripts } from "../data/mods/gen5/scripts";
import { Scripts as Gen5Bw1Scripts } from "../data/mods/gen5bw1/scripts";
import { Scripts as Gen6Scripts } from "../data/mods/gen6/scripts";
import { Scripts as Gen6XyScripts } from "../data/mods/gen6xy/scripts";
import { Scripts as Gen7Scripts } from "../data/mods/gen7/scripts";
import { Scripts as Gen7LetsGoScripts } from "../data/mods/gen7letsgo/scripts";
import { Scripts as Gen7SmScripts } from "../data/mods/gen7sm/scripts";
import { Scripts as Gen7PokebilitiesScripts } from "../data/mods/gen7pokebilities/scripts";
import { Scripts as Gen8Scripts } from "../data/mods/gen8/scripts";
import { Scripts as Gen8BdspScripts } from "../data/mods/gen8bdsp/scripts";
import { Scripts as Gen8Dlc1Scripts } from "../data/mods/gen8dlc1/scripts";
import { Scripts as Gen8LinkedScripts } from "../data/mods/gen8linked/scripts";
import { Scripts as Gen9preDLCScripts } from "../data/mods/gen9predlc/scripts";
import { Scripts as Gen9SSBScripts } from "../data/mods/gen9ssb/scripts";
import { Scripts as LittleColosseumScripts } from "../data/mods/littlecolosseum/scripts";
import { Scripts as MixAndMegaScripts } from "../data/mods/mixandmega/scripts";
import { Scripts as PartnersInCrimeScripts } from "../data/mods/partnersincrime/scripts";
import { Scripts as PassiveAggressiveScripts } from "../data/mods/partnersincrime/scripts";
import { Scripts as PokeBedrockScripts } from "../data/mods/pokebedrock/scripts";
import { Scripts as PokebilitiesScripts } from "../data/mods/passiveaggressive/scripts";
import { Scripts as PokeMovesScripts } from "../data/mods/pokemoves/scripts";
import { Scripts as SharedPowerScripts } from "../data/mods/sharedpower/scripts";
import { Scripts as TheCardGameScripts } from "../data/mods/thecardgame/scripts";
import { Scripts as TrademarkedScripts } from "../data/mods/trademarked/scripts";
import { Abilities } from "../data/abilities";
import { Aliases } from "../data/aliases";
import { Rulesets } from "../data/rulesets";
import { FormatsData } from "../data/formats-data";
import { Items } from "../data/items";
import { Learnsets } from "../data/learnsets";
import { Moves } from "../data/moves";
import { Natures } from "../data/natures";
import { Pokedex } from "../data/pokedex";
import { Scripts } from "../data/scripts";
import { Conditions } from "../data/conditions";
import { TypeChart } from "../data/typechart";
import { PokemonGoData } from "../data/pokemongo";

const BASE_MOD = "gen9" as ID;

const dexes: { [mod: string]: ModdedDex } = Object.create(null);

type DataType =
	| "Abilities"
	| "Rulesets"
	| "FormatsData"
	| "Items"
	| "Learnsets"
	| "Moves"
	| "Natures"
	| "Pokedex"
	| "Scripts"
	| "Conditions"
	| "TypeChart"
	| "PokemonGoData";
const DATA_TYPES: (DataType | "Aliases")[] = [
	"Abilities",
	"Rulesets",
	"FormatsData",
	"Items",
	"Learnsets",
	"Moves",
	"Natures",
	"Pokedex",
	"Scripts",
	"Conditions",
	"TypeChart",
	"PokemonGoData",
];

const DATA_FILES = {
	Abilities: Abilities,
	Aliases: Aliases,
	Rulesets: Rulesets,
	FormatsData: FormatsData,
	Items: Items,
	Learnsets: Learnsets,
	Moves: Moves,
	Natures: Natures,
	Pokedex: Pokedex,
	Scripts: Scripts,
	Conditions: Conditions,
	TypeChart: TypeChart,
	PokemonGoData: PokemonGoData,
};

/** Unfortunately we do for..in too much to want to deal with the casts */
export interface DexTable<T> {
	[id: string]: T;
}
export interface AliasesTable {
	[id: IDEntry]: string;
}

interface DexTableData {
	Abilities: DexTable<import("./dex-abilities").AbilityData>;
	Aliases: DexTable<string>;
	Rulesets: DexTable<import("./dex-formats").FormatData>;
	Items: DexTable<import("./dex-items").ItemData>;
	Learnsets: DexTable<import("./dex-species").LearnsetData>;
	Moves: DexTable<import("./dex-moves").MoveData>;
	Natures: DexTable<import("./dex-data").NatureData>;
	Pokedex: DexTable<import("./dex-species").SpeciesData>;
	FormatsData: DexTable<import("./dex-species").SpeciesFormatsData>;
	PokemonGoData: DexTable<import("./dex-species").PokemonGoData>;
	Scripts: DexTable<AnyObject>;
	Conditions: DexTable<import("./dex-conditions").ConditionData>;
	TypeChart: DexTable<import("./dex-data").TypeData>;
}
interface TextTableData {
	Abilities: DexTable<AbilityText>;
	Items: DexTable<ItemText>;
	Moves: DexTable<MoveText>;
	Pokedex: DexTable<PokedexText>;
	Default: DexTable<DefaultText>;
}

const TEXT_DATA_FILES: { [key: string]: any } = {
	abilities: AbilitiesText,
	default: DefaultText,
	items: ItemsText,
	moves: MovesText,
	pokedex: PokedexText,
};

const MOD_NAMES = [
	"fullpotential",
	"gen1",
	"gen1jpn",
	"gen1stadium",
	"gen2",
	"gen2doubles",
	"gen2stadium2",
	"gen3",
	"gen4",
	"gen4pt",
	"gen5",
	"gen5bw1",
	"gen6",
	"gen6xy",
	"gen7",
	"gen7letsgo",
	"gen7sm",
	"gen7pokebilities",
	"gen8",
	"gen8bdsp",
	"gen8dlc1",
	"gen8linked",
	// "gen9dlc1",
	"gen9predlc",
	"gen9ssb",
	"littlecolosseum",
	"mixandmega",
	"moderngen2",
	"partnersincrime",
	"passiveaggressive",
	"pokebedrock", // IMPORTANT
	"pokebilities",
	"pokemoves",
	"randomroulette",
	"sharedpower",
	"sharingiscaring",
	"thecardgame",
	"trademarked",
] as const;

const MOD_SCRIPTS: {
	[key in (typeof MOD_NAMES)[number] | string]: ModdedBattleScriptsData;
} = {
	fullpotential: FullPotentialScripts,
	gen1: Gen1Scripts,
	gen1jpn: Gen1JpnScripts,
	gen1stadium: Gen1StadiumScripts,
	gen2: Gen2Scripts,
	gen2doubles: Gen2SDoublescripts,
	gen2stadium2: Gen2Stadium2Scripts,
	gen3: Gen3Scripts,
	gen4: Gen4Scripts,
	gen4pt: Gen4PtScripts,
	gen5: Gen5Scripts,
	gen5bw1: Gen5Bw1Scripts,
	gen6: Gen6Scripts,
	gen6xy: Gen6XyScripts,
	gen7: Gen7Scripts,
	gen7letsgo: Gen7LetsGoScripts,
	gen7sm: Gen7SmScripts,
	gen7pokebilities: Gen7PokebilitiesScripts,
	gen8: Gen8Scripts,
	gen8bdsp: Gen8BdspScripts,
	gen8dlc1: Gen8Dlc1Scripts,
	gen8linked: Gen8LinkedScripts,
	gen9predlc: Gen9preDLCScripts,
	gen9ssb: Gen9SSBScripts,
	littlecolosseum: LittleColosseumScripts,
	mixandmega: MixAndMegaScripts,
	partnersincrime: PartnersInCrimeScripts,
	passiveaggressive: PassiveAggressiveScripts,
	pokebedrock: PokeBedrockScripts,
	pokebilities: PokebilitiesScripts,
	pokemoves: PokeMovesScripts,
	// "potd": PotdScripts,
	sharedpower: SharedPowerScripts,
	thecardgame: TheCardGameScripts,
	trademarked: TrademarkedScripts,
};

export const toID = Data.toID;

export class ModdedDex {
	readonly Data = Data;
	readonly Condition = Condition;
	readonly Ability = Ability;
	readonly Item = Item;
	readonly Move = DataMove;
	readonly Species = Species;
	readonly Format = Format;
	readonly ModdedDex = ModdedDex;

	readonly name = "[ModdedDex]";
	readonly isBase: boolean;
	readonly currentMod: string;

	readonly toID = Data.toID;

	gen = 0;
	parentMod = "";
	modsLoaded = false;

	dataCache: DexTableData | null;
	textCache: TextTableData | null;

	deepClone = Utils.deepClone;
	deepFreeze = Utils.deepFreeze;
	Multiset = Utils.Multiset;

	readonly formats: DexFormats;
	readonly abilities: DexAbilities;
	readonly items: DexItems;
	readonly moves: DexMoves;
	readonly species: DexSpecies;
	readonly conditions: DexConditions;
	readonly natures: Data.DexNatures;
	readonly types: Data.DexTypes;
	readonly stats: Data.DexStats;

	constructor(mod = "base") {
		this.isBase = mod === "base";
		this.currentMod = mod;

		this.dataCache = null;
		this.textCache = null;

		this.formats = new DexFormats(this);
		this.abilities = new DexAbilities(this);
		this.items = new DexItems(this);
		this.moves = new DexMoves(this);
		this.species = new DexSpecies(this);
		this.conditions = new DexConditions(this);
		this.natures = new Data.DexNatures(this);
		this.types = new Data.DexTypes(this);
		this.stats = new Data.DexStats(this);
	}

	get data(): DexTableData {
		return this.loadData();
	}

	get dexes(): { [mod: string]: ModdedDex } {
		this.includeMods();
		return dexes;
	}

	mod(mod: string | undefined): ModdedDex {
		if (!dexes["base"].modsLoaded) dexes["base"].includeMods();
		return dexes[mod || "base"];
	}

	forGen(gen: number) {
		if (!gen) return this;
		return this.mod(`gen${gen}`);
	}

	forFormat(format: Format | string): ModdedDex {
		if (!this.modsLoaded) this.includeMods();
		const mod = this.formats.get(format).mod;
		return dexes[mod || BASE_MOD].includeData();
	}

	modData(dataType: DataType, id: string) {
		if (this.isBase) return this.data[dataType][id];
		if (this.data[dataType][id] !== dexes[this.parentMod].data[dataType][id])
			return this.data[dataType][id];
		return (this.data[dataType][id] = Utils.deepClone(
			this.data[dataType][id]
		));
	}

	effectToString() {
		return this.name;
	}

	/**
	 * Sanitizes a username or Pokemon nickname
	 *
	 * Returns the passed name, sanitized for safe use as a name in the PS
	 * protocol.
	 *
	 * Such a string must uphold these guarantees:
	 * - must not contain any ASCII whitespace character other than a space
	 * - must not start or end with a space character
	 * - must not contain any of: | , [ ]
	 * - must not be the empty string
	 * - must not contain Unicode RTL control characters
	 *
	 * If no such string can be found, returns the empty string. Calling
	 * functions are expected to check for that condition and deal with it
	 * accordingly.
	 *
	 * getName also enforces that there are not multiple consecutive space
	 * characters in the name, although this is not strictly necessary for
	 * safety.
	 */
	getName(name: any): string {
		if (typeof name !== "string" && typeof name !== "number") return "";
		name = ("" + name).replace(/[|\s[\],\u202e]+/g, " ").trim();
		if (name.length > 18) name = name.substr(0, 18).trim();

		// remove zalgo
		name = name.replace(
			/[\u0300-\u036f\u0483-\u0489\u0610-\u0615\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06ED\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]{3,}/g,
			""
		);
		name = name.replace(/[\u239b-\u23b9]/g, "");

		return name;
	}

	/**
	 * Returns false if the target is immune; true otherwise.
	 * Also checks immunity to some statuses.
	 */
	getImmunity(
		source: { type: string } | string,
		target:
			| { getTypes: () => string[] }
			| { types: string[] }
			| string[]
			| string
	): boolean {
		const sourceType: string =
			typeof source !== "string" ? source.type : source;

		const targetTyping: string[] | string =
			// @ts-ignore
			target.getTypes?.() || target.types || target;
		if (Array.isArray(targetTyping)) {
			for (const type of targetTyping) {
				if (!this.getImmunity(sourceType, type)) return false;
			}
			return true;
		}
		const typeData = this.types.get(targetTyping);
		if (typeData && typeData.damageTaken[sourceType] === 3) return false;
		return true;
	}

	getEffectiveness(
		source: { type: string } | string,
		target:
			| { getTypes: () => string[] }
			| { types: string[] }
			| string[]
			| string
	): number {
		const sourceType: string =
			typeof source !== "string" ? source.type : source;

		const targetTyping: string[] | string =
			// @ts-ignore
			target.getTypes?.() || target.types || target;
		let totalTypeMod = 0;
		if (Array.isArray(targetTyping)) {
			for (const type of targetTyping) {
				totalTypeMod += this.getEffectiveness(sourceType, type);
			}
			return totalTypeMod;
		}
		const typeData = this.types.get(targetTyping);
		if (!typeData) return 0;
		switch (typeData.damageTaken[sourceType]) {
			case 1:
				return 1; // super-effective
			case 2:
				return -1; // resist
			// in case of weird situations like Gravity, immunity is handled elsewhere
			default:
				return 0;
		}
	}

	getDescs(table: keyof TextTableData, id: ID, dataEntry: AnyObject) {
		if (dataEntry.shortDesc) {
			return {
				desc: dataEntry.desc,
				shortDesc: dataEntry.shortDesc,
			};
		}
		const entry = this.loadTextData()[table][id];
		if (!entry) return null;
		const descs = {
			desc: "",
			shortDesc: "",
		};
		for (let i = this.gen; i < dexes["base"].gen; i++) {
			const curDesc = entry[`gen${i}` as keyof typeof entry]?.desc;
			const curShortDesc = entry[`gen${i}` as keyof typeof entry]?.shortDesc;
			if (!descs.desc && curDesc) {
				descs.desc = curDesc;
			}
			if (!descs.shortDesc && curShortDesc) {
				descs.shortDesc = curShortDesc;
			}
			if (descs.desc && descs.shortDesc) break;
		}
		if (!descs.shortDesc) descs.shortDesc = entry.shortDesc || "";
		if (!descs.desc) descs.desc = entry.desc || descs.shortDesc;
		return descs;
	}

	/**
	 * Ensure we're working on a copy of a move (and make a copy if we aren't)
	 *
	 * Remember: "ensure" - by default, it won't make a copy of a copy:
	 *     moveCopy === Dex.getActiveMove(moveCopy)
	 *
	 * If you really want to, use:
	 *     moveCopyCopy = Dex.getActiveMove(moveCopy.id)
	 */
	getActiveMove(move: Move | string): ActiveMove {
		if (move && typeof (move as ActiveMove).hit === "number")
			return move as ActiveMove;
		move = this.moves.get(move);
		const moveCopy: ActiveMove = this.deepClone(move);
		moveCopy.hit = 0;
		return moveCopy;
	}

	getHiddenPower(ivs: StatsTable) {
		const hpTypes = [
			"Fighting",
			"Flying",
			"Poison",
			"Ground",
			"Rock",
			"Bug",
			"Ghost",
			"Steel",
			"Fire",
			"Water",
			"Grass",
			"Electric",
			"Psychic",
			"Ice",
			"Dragon",
			"Dark",
		];
		const tr = this.trunc;
		const stats = { hp: 31, atk: 31, def: 31, spe: 31, spa: 31, spd: 31 };
		if (this.gen <= 2) {
			// Gen 2 specific Hidden Power check. IVs are still treated 0-31 so we get them 0-15
			const atkDV = tr(ivs.atk / 2);
			const defDV = tr(ivs.def / 2);
			const speDV = tr(ivs.spe / 2);
			const spcDV = tr(ivs.spa / 2);
			return {
				type: hpTypes[4 * (atkDV % 4) + (defDV % 4)],
				power: tr(
					(5 *
						((spcDV >> 3) +
							2 * (speDV >> 3) +
							4 * (defDV >> 3) +
							8 * (atkDV >> 3)) +
						(spcDV % 4)) /
						2 +
						31
				),
			};
		} else {
			// Hidden Power check for Gen 3 onwards
			let hpTypeX = 0;
			let hpPowerX = 0;
			let i = 1;
			for (const s in stats) {
				hpTypeX += i * (ivs[s as StatID] % 2);
				hpPowerX += i * (tr(ivs[s as StatID] / 2) % 2);
				i *= 2;
			}
			return {
				type: hpTypes[tr((hpTypeX * 15) / 63)],
				// After Gen 6, Hidden Power is always 60 base power
				power:
					this.gen && this.gen < 6 ? tr((hpPowerX * 40) / 63) + 30 : 60,
			};
		}
	}

	/**
	 * Truncate a number into an unsigned 32-bit integer, for
	 * compatibility with the cartridge games' math systems.
	 */
	trunc(num: number, bits = 0) {
		if (bits) return (num >>> 0) % 2 ** bits;
		return num >>> 0;
	}

	dataSearch(
		target: string,
		searchIn?: ('Pokedex' | 'Moves' | 'Abilities' | 'Items' | 'Natures' | 'TypeChart')[] | null,
		isInexact?: boolean
	): AnyObject[] | null {
		if (!target) return null;

		searchIn = searchIn || [
			"Pokedex",
			"Moves",
			"Abilities",
			"Items",
			"Natures",
		];

		const searchObjects = {
			Pokedex: 'species', Moves: 'moves', Abilities: 'abilities', Items: 'items', Natures: 'natures', TypeChart: 'types',
		} as const;
		const searchTypes = {
			Pokedex: 'pokemon', Moves: 'move', Abilities: 'ability', Items: 'item', Natures: 'nature', TypeChart: 'type',
		} as const;
		let searchResults: AnyObject[] | null = [];
		for (const table of searchIn) {
			const res = this[searchObjects[table]].get(target);
			if (res.exists && res.gen <= this.gen) {
				searchResults.push({
					isInexact,
					searchType: searchTypes[table],
					name: res.name,
				});
			}
		}
		if (searchResults.length) return searchResults;
		if (isInexact) return null; // prevent infinite loop

		const cmpTarget = toID(target);
		let maxLd = 3;
		if (cmpTarget.length <= 1) {
			return null;
		} else if (cmpTarget.length <= 4) {
			maxLd = 1;
		} else if (cmpTarget.length <= 6) {
			maxLd = 2;
		}
		searchResults = null;
		for (const table of [...searchIn, "Aliases"] as const) {
			const searchObj = this.data[table] as DexTable<any>;
			if (!searchObj) continue;

			for (const j in searchObj) {
				const ld = Utils.levenshtein(cmpTarget, j, maxLd);
				if (ld <= maxLd) {
					const word = searchObj[j].name || j;
					const results = this.dataSearch(word, searchIn, word);
					if (results) {
						searchResults = results;
						maxLd = ld;
					}
				}
			}
		}

		return searchResults;
	}

	loadDataFile(dataType: DataType | "Aliases"): AnyObject {
		try {
			const dataObject = DATA_FILES[dataType];
			if (!dataObject) {
				throw new TypeError(
					`${dataType}, if it exists, must export a non-null object`
				);
			}
			return dataObject;
		} catch (e: any) {
			if (e.code !== "MODULE_NOT_FOUND" && e.code !== "ENOENT") {
				throw e;
			}
		}
		return {};
	}

	loadTextFile(
		name: string,
		exportName: string
	): DexTable<MoveText | ItemText | AbilityText | PokedexText | DefaultText> {
		return TEXT_DATA_FILES[name][exportName];
	}

	includeMods(): this {
		if (!this.isBase) throw new Error(`This must be called on the base Dex`);
		if (this.modsLoaded) return this;

		for (const mod of MOD_NAMES) {
			dexes[mod] = new ModdedDex(mod);
		}
		this.modsLoaded = true;

		return this;
	}

	includeModData(): this {
		for (const mod in this.dexes) {
			dexes[mod].includeData();
		}
		return this;
	}

	includeData(): this {
		this.loadData();
		return this;
	}

	loadTextData(): TextTableData {
		if (dexes["base"].textCache) return dexes["base"].textCache;
		dexes["base"].textCache = {
			Pokedex: PokedexText,
			Moves: MovesText,
			Abilities: AbilitiesText,
			Items: ItemsText,
			Default: DefaultText,
		};
		return dexes["base"].textCache;
	}

	loadData(): DexTableData {
		if (this.dataCache) return this.dataCache;
		dexes["base"].includeMods();
		const dataCache: { [k in keyof DexTableData]?: any } = {};

		const Scripts = MOD_SCRIPTS[this.currentMod];
		this.parentMod = this.isBase ? "" : Scripts.inherit || "base";

		let parentDex;
		if (this.parentMod) {
			parentDex = dexes[this.parentMod];
			if (!parentDex || parentDex === this) {
				throw new Error(
					`Unable to load ${this.currentMod}. 'inherit' in scripts.ts should specify a parent mod from which to inherit data, or must be not specified.`
				);
			}
		}

		if (!parentDex) {
			// Formats are inherited by mods and used by Rulesets
			this.includeFormats();
		}
		for (const dataType of DATA_TYPES.concat("Aliases")) {
			const BattleData = this.loadDataFile(dataType);
			if (BattleData !== dataCache[dataType])
				dataCache[dataType] = Object.assign(
					BattleData,
					dataCache[dataType]
				);
			if (dataType === "Rulesets" && !parentDex) {
				for (const format of this.formats.all()) {
					BattleData[format.id] = { ...format, ruleTable: null };
				}
			}
		}
		if (parentDex) {
			for (const dataType of DATA_TYPES) {
				const parentTypedData: DexTable<any> = parentDex.data[dataType];
				const childTypedData: DexTable<any> =
					dataCache[dataType] || (dataCache[dataType] = {});
				for (const entryId in parentTypedData) {
					if (childTypedData[entryId] === null) {
						// null means don't inherit
						delete childTypedData[entryId];
					} else if (!(entryId in childTypedData)) {
						// If it doesn't exist it's inherited from the parent data
						if (dataType === "Pokedex") {
							// Pokedex entries can be modified too many different ways
							// e.g. inheriting different formats-data/learnsets
							childTypedData[entryId] = this.deepClone(
								parentTypedData[entryId]
							);
						} else {
							childTypedData[entryId] = parentTypedData[entryId];
						}
					} else if (
						childTypedData[entryId] &&
						childTypedData[entryId].inherit
					) {
						// {inherit: true} can be used to modify only parts of the parent data,
						// instead of overwriting entirely
						delete childTypedData[entryId].inherit;

						// Merge parent into children entry, preserving existing childs' properties.
						childTypedData[entryId] = {
							...parentTypedData[entryId],
							...childTypedData[entryId],
						};
					}
				}
			}
			dataCache["Aliases"] = parentDex.data["Aliases"];
		}

		// Flag the generation. Required for team validator.
		this.gen = dataCache.Scripts.gen;
		if (!this.gen)
			throw new Error(
				`Mod ${this.currentMod} needs a generation number in scripts.js`
			);
		this.dataCache = dataCache as DexTableData;

		// Execute initialization script.
		if (Scripts?.init) Scripts.init.call(this);

		return this.dataCache;
	}

	includeFormats(): this {
		this.formats.load();
		return this;
	}
}

dexes["base"] = new ModdedDex();

// "gen9" is an alias for the current base data
dexes[BASE_MOD] = dexes["base"];

export const Dex = dexes["base"];
export namespace Dex {
	export type Species = import("./dex-species").Species;
	export type Item = import("./dex-items").Item;
	export type Move = import("./dex-moves").Move;
	export type Ability = import("./dex-abilities").Ability;

	export type HitEffect = import("./dex-moves").HitEffect;
	export type SecondaryEffect = import("./dex-moves").SecondaryEffect;
	export type RuleTable = import("./dex-formats").RuleTable;
}

export default Dex;
