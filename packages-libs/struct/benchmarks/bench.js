/* dirty-set-vs-bitmask.js --------------------------------------- */
const SIZES = [1_000, 10_000, 50_000, 100_000, 100_0000];
const RATIOS = [0.001, 0.10, 0.25, 0.50, 0.75, 1.00];   // 0.1 % … 100 %
const COUNT = 25;

// use hr‑timer everywhere
const now = (typeof performance === "undefined" ? require("perf_hooks").performance.now.bind(require("perf_hooks").performance) : performance.now.bind(performance));

function markWithSet(dirtyIds, id) {
    dirtyIds.add(id);
}

function markWithMask(mask, id) {
    mask[id >>> 5] |= 1 << (id & 31);
}

function scanSet(dirtyIds, cb) {
    for (const id of dirtyIds) cb(id);
}

function scanMask(mask, count, cb) {
    for (let i = 0; i < count; ++i) {
        if (mask[i] > 0) {
            for (let b = mask[i]; b; b &= b - 1) {   // bit‑twiddle popcount walk
                cb((i << 5) + Math.clz32(b & -b) ^ 31);
            }
        }
    }
}

function benchCase(N, ratio) {
    const dirtyCount = Math.floor(N * ratio);
    const ids = new Uint32Array(dirtyCount);
    for (let i = 0; i < dirtyCount; ++i) ids[i] = (i * 97) % N; // pseudo‑random ids

    /* ---------- mark phase --------------------------------------- */
    const dirtySet = new Set();
    const bitMask32 = new Uint32Array((N + 31) >>> 5);

    let t0 = now();
    for (let id of ids) markWithSet(dirtySet, id);
    const setWrite = now() - t0;

    t0 = now();
    for (let id of ids) markWithMask(bitMask32, id);
    const maskWrite = now() - t0;

    /* ---------- scan phase --------------------------------------- */
    let acc = 0; // work so loop isn't eliminated
    t0 = now();
    scanSet(dirtySet, i => (acc ^= i));
    dirtySet.clear();
    const setScan = now() - t0;

    t0 = now();
    // scanMask(bitMask32, bitMask32.length, i => (acc ^= i));

    for (let i = 0; i < bitMask32.length; ++i) {
        if (bitMask32[i] > 0) {
            for (let b = bitMask32[i]; b; b &= b - 1) {   // bit‑twiddle popcount walk
                const ff = (i << 5) + Math.clz32(b & -b) ^ 31;
                acc ^= ff;
            }
        }
    }

    bitMask32.fill(0);
    const maskScan = now() - t0;


    return {setWrite, maskWrite, setScan, maskScan};
}

/* pretty table helper ------------------------------------------- */
function fmt(n) {
    return n.toFixed(2).padStart(9);
}

console.log(`Each cell = millisec (lower is faster)\n`);


for (const N of SIZES) {
    console.log(`=== ${N.toLocaleString()} objects ===`);
    console.log("dirty%      add(Set)  add(mask)  scan(Set) scan(mask)");
    for (const r of RATIOS) {

        let setWrite = 0, maskWrite = 0, setScan = 0, maskScan = 0;

        for (let i = 0; i < COUNT; i++) {
            const res = benchCase(N, r);
            setWrite += res.setWrite;
            maskWrite += res.maskWrite;
            setScan += res.setScan;
            maskScan += res.maskScan;
        }

        console.log((r * 100).toString().padStart(5) + "%  ", fmt(setWrite / COUNT), fmt(maskWrite / COUNT), fmt(setScan / COUNT), fmt(maskScan / COUNT));
    }
    console.log("");
}
