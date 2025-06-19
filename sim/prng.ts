/**
 * PRNG
 * Pokemon Showdown - http://pokemonshowdown.com/
 *
 * This simulates the on-cartridge PRNG used in the real games.
 *
 * In addition to potentially allowing us to read replays from in-game,
 * this also makes it possible to record an "input log" (a seed +
 * initial teams + move/switch decisions) and "replay" a simulation to
 * get the same result.
 *
 * @license MIT license
 */

export type PRNGSeed = `${'sodium' | 'gen5' | number},${string}`;
export type SodiumRNGSeed = ['sodium', string];
/** 64-bit big-endian [high -> low] int */
export type Gen5RNGSeed = [number, number, number, number];

interface RNG {
  getSeed(): PRNGSeed;
  /** random 32-bit number */
  next(): number;
}

/**
 * High-level PRNG API.
 */
export class PRNG {
  readonly startingSeed: PRNGSeed;
  rng!: RNG;
  constructor(seed: PRNGSeed | null = null, initialSeed?: PRNGSeed) {
    if (!seed) seed = PRNG.generateSeed();
    if (Array.isArray(seed)) {
      seed = seed.join(',') as PRNGSeed;
    }
    if (typeof seed !== 'string') {
      throw new Error(`PRNG: Seed ${seed} must be a string`);
    }
    this.startingSeed = initialSeed ?? seed;
    this.setSeed(seed);
  }

  setSeed(seed: PRNGSeed) {
    if (seed.startsWith('sodium,')) {
      this.rng = new SodiumRNG(seed.split(',') as SodiumRNGSeed);
    } else if (seed.startsWith('gen5,')) {
      const gen5Seed = [
        seed.slice(5, 9),
        seed.slice(9, 13),
        seed.slice(13, 17),
        seed.slice(17, 21),
      ];
      this.rng = new Gen5RNG(gen5Seed.map(n => parseInt(n, 16)) as Gen5RNGSeed);
    } else if (/[0-9]/.test(seed.charAt(0))) {
      this.rng = new Gen5RNG(seed.split(',').map(Number) as Gen5RNGSeed);
    } else {
      throw new Error(`Unrecognized RNG seed ${seed}`);
    }
  }
  getSeed(): PRNGSeed {
    return this.rng.getSeed();
  }
  clone(): PRNG {
    return new PRNG(this.rng.getSeed(), this.startingSeed);
  }
  random(from?: number, to?: number): number {
    const result = this.rng.next();
    if (from) from = Math.floor(from);
    if (to) to = Math.floor(to);
    if (from === undefined) {
      return result / 2 ** 32;
    } else if (!to) {
      return Math.floor((result * from) / 2 ** 32);
    } else {
      return Math.floor((result * (to - from)) / 2 ** 32) + from;
    }
  }
  randomChance(numerator: number, denominator: number): boolean {
    return this.random(denominator) < numerator;
  }
  sample<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new RangeError(`Cannot sample an empty array`);
    }
    const index = this.random(items.length);
    const item = items[index];
    if (
      item === undefined &&
      !Object.prototype.hasOwnProperty.call(items, index)
    ) {
      throw new RangeError(`Cannot sample a sparse array`);
    }
    return item;
  }
  shuffle<T>(items: T[], start = 0, end: number = items.length) {
    while (start < end - 1) {
      const nextIndex = this.random(start, end);
      if (start !== nextIndex) {
        [items[start], items[nextIndex]] = [items[nextIndex], items[start]];
      }
      start++;
    }
  }
  static generateSeed(): PRNGSeed {
    return PRNG.convertSeed(SodiumRNG.generateSeed());
  }
  static convertSeed(seed: SodiumRNGSeed | Gen5RNGSeed): PRNGSeed {
    return seed.join(',') as PRNGSeed;
  }
  static get(prng?: PRNG | PRNGSeed | null) {
    return prng && typeof prng !== 'string' && !Array.isArray(prng)
      ? prng
      : new PRNG(prng as PRNGSeed);
  }
}

/**
 * A native RNG that mimics libsodium's deterministic randombytes_buf,
 * without relying on external crypto libraries or ChaCha20.
 *
 * This implementation uses a 256-bit internal state (as an 8-element Uint32Array)
 * and updates it via a simple xorshift routine.
 */
export class SodiumRNG implements RNG {
  state!: Uint32Array; // 8 elements (32 bytes)

  constructor(seed: SodiumRNGSeed) {
    this.setSeed(seed);
  }

  setSeed(seed: SodiumRNGSeed) {
    // Use the hex seed (pad to 64 characters if necessary) to initialize a 32-byte state.
    const hex = seed[1].padEnd(64, '0');
    this.state = new Uint32Array(8);
    for (let i = 0; i < 8; i++) {
      this.state[i] = parseInt(hex.substr(i * 8, 8), 16) >>> 0;
    }
  }

  getSeed(): PRNGSeed {
    let hex = '';
    for (let i = 0; i < 8; i++) {
      hex += ('00000000' + this.state[i].toString(16)).slice(-8);
    }
    return `sodium,${hex}` as PRNGSeed;
  }

  next(): number {
    // Update each 32-bit word in the state with a simple xorshift.
    for (let i = 0; i < this.state.length; i++) {
      let x = this.state[i];
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      this.state[i] = x >>> 0;
    }
    // Combine two state elements (here, simply add the first two) to produce a 32-bit output.
    const output = (this.state[0] + this.state[1]) >>> 0;
    return output;
  }

  static generateSeed(): SodiumRNGSeed {
    // Instead of using crypto.randomBytes, use Math.random to produce 16 random bytes (as a hex string).
    let hex = '';
    for (let i = 0; i < 16; i++) {
      const byte = Math.floor(Math.random() * 256);
      hex += ('0' + byte.toString(16)).slice(-2);
    }
    return ['sodium', hex];
  }
}

/**
 * A PRNG intended to emulate the on-cartridge PRNG for Gen 5 with a 64-bit
 * initial seed.
 */
export class Gen5RNG implements RNG {
  seed: Gen5RNGSeed;
  constructor(seed: Gen5RNGSeed | null = null) {
    this.seed = [...(seed || Gen5RNG.generateSeed())];
  }

  getSeed(): PRNGSeed {
    return this.seed.join(',') as PRNGSeed;
  }

  next(): number {
    this.seed = this.nextFrame(this.seed); // Advance the RNG
    return ((this.seed[0] << 16) >>> 0) + this.seed[1]; // Use the upper 32 bits
  }

  /**
   * Calculates `a * b + c` (with 64-bit 2's complement arithmetic)
   */
  multiplyAdd(a: Gen5RNGSeed, b: Gen5RNGSeed, c: Gen5RNGSeed) {
    const out: Gen5RNGSeed = [0, 0, 0, 0];
    let carry = 0;
    for (let outIndex = 3; outIndex >= 0; outIndex--) {
      for (let bIndex = outIndex; bIndex < 4; bIndex++) {
        const aIndex = 3 - (bIndex - outIndex);
        carry += a[aIndex] * b[bIndex];
      }
      carry += c[outIndex];
      out[outIndex] = carry & 0xffff;
      carry >>>= 16;
    }
    return out;
  }

  /**
   * The RNG is a Linear Congruential Generator (LCG) in the form:
   * xₙ₊₁ = (a · xₙ + c) mod 2^64.
   */
  nextFrame(seed: Gen5RNGSeed, framesToAdvance = 1): Gen5RNGSeed {
    const a: Gen5RNGSeed = [0x5d58, 0x8b65, 0x6c07, 0x8965];
    const c: Gen5RNGSeed = [0, 0, 0x26, 0x9ec3];
    for (let i = 0; i < framesToAdvance; i++) {
      seed = this.multiplyAdd(seed, a, c);
    }
    return seed;
  }

  static generateSeed(): Gen5RNGSeed {
    return [
      Math.trunc(Math.random() * 2 ** 16),
      Math.trunc(Math.random() * 2 ** 16),
      Math.trunc(Math.random() * 2 ** 16),
      Math.trunc(Math.random() * 2 ** 16),
    ];
  }
}
