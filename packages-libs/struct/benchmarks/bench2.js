/**
 * Benchmark: copyDirty (bit‑mask)  vs  full typedArray.set
 *
 * pool layout (per object):
 *   segment 0 : 1 × uint32   (index = ref)
 *   segment 2 : 3 × uint32   (index = N + ref*3 .. +2)
 *   total     : 4 words = 16 bytes
 *
 * Author: ChatGPT – 2025‑05‑09
 */
"use strict";

/* ---------- parameters you may want to tweak ---------- */
const N_OBJECTS = 100000;        // 65 536 objects in the pool
const ITERATIONS = 20;             // runs per data point
const FRACTIONS = [               // % of objects marked dirty
    0.00001, 0.01, 0.05, 0.10, 0.15, 0.20,
    0.25, 0.30, 0.40, 0.50, 0.75, 1.0,
];
/* ------------------------------------------------------ */

const WORDS_SEG0 = 1;
const WORDS_SEG2 = 3;
const WORDS_TOTAL = WORDS_SEG0 + WORDS_SEG2;

/* create & fill the backing buffers */
function makeViews(n) {
    const totalWords = n * WORDS_TOTAL;
    const fromView = new Uint32Array(totalWords);
    const toView = new Uint32Array(totalWords);
    for (let i = 0; i < totalWords; ++i) fromView[i] = i;
    return {fromView, toView};
}

/* random dirty‑mask with “fraction” of bits set */
function makeDirtyMask(n, fraction) {
    const maskLen = (n + 31) >>> 5;
    const mask = new Uint32Array(maskLen);
    for (let ref = 0; ref < n; ++ref) {
        if (Math.random() < fraction) {
            const w = ref >>> 5;
            mask[w] |= 1 << (ref & 31);
        }
    }
    return mask;
}

/* user‑style dirty copy -------------------------------------------------- */
function copyDirty(maxObjs, fromView, toView, mask, onChange) {
    for (let i = 0; i < mask.length; ++i) {
        for (let word = mask[i]; word; word &= word - 1) {
            const lsb = word & -word;
            const bit = (Math.clz32(lsb) ^ 31);
            const ref = (i << 5) + bit;

            /* segment 0 */
            toView[ref] = fromView[ref];

            /* segment 2 */
            const base = maxObjs * WORDS_SEG0 + ref * WORDS_SEG2;
            toView[base] = fromView[base];
            toView[base + 1] = fromView[base + 1];
            toView[base + 2] = fromView[base + 2];

            if (onChange) onChange(ref);
        }
    }
}

/* full copy -------------------------------------------------------------- */
const fullCopy = (from, to) => to.set(from);

/* run the benchmark ------------------------------------------------------ */
(function run() {
    const {fromView, toView} = makeViews(N_OBJECTS);
    let s = 0.0;

    const onChange = (ref) => {
        s += ref * 0.0011;
    };

    console.log(`Pool size           : ${N_OBJECTS.toLocaleString()} objects`);
    console.log(`Words per object    : ${WORDS_TOTAL} (16 bytes)`);
    console.log(`Iterations per test : ${ITERATIONS}\n`);
    console.log(["dirty %", "dirty avg ms", "full avg ms", "faster"].join("\t"));

    for (const frac of FRACTIONS) {
        let tDirty = 0, tFull = 0;

        for (let k = 0; k < ITERATIONS; ++k) {
            s = 0.0;
            const mask = makeDirtyMask(N_OBJECTS, frac);

            /* dirty‑only path */
            let t0 = performance.now();
            copyDirty(N_OBJECTS, fromView, toView, mask, onChange);
            tDirty += performance.now() - t0;

            /* full copy path */
            t0 = performance.now();
            fullCopy(fromView, toView);
            for (let i = 0; i < N_OBJECTS; i++) {
                onChange(i);
            }
            tFull += performance.now() - t0;
        }

        const avgDirty = tDirty / ITERATIONS;
        const avgFull = tFull / ITERATIONS;
        console.log(
            `${(frac * 100).toFixed(0).padStart(6)}\t` +
            `${avgDirty.toFixed(3).padStart(11)}\t` +
            `${avgFull.toFixed(3).padStart(10)}\t` +
            `${avgDirty < avgFull ? "dirty" : "full"}`
        );
    }
})();
