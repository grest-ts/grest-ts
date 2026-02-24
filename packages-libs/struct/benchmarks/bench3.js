/* ─── tunables ──────────────────────────────────────────────────────────── */
const N_OBJECTS = 500_000;          // pool size
const ITERATIONS = 40;                 // timed runs per layout
const WARM_UP = 5;                  // extra runs to prime JIT
/* ───────────────────────────────────────────────────────────────────────── */

/* helpers */
const rnd32 = () => (Math.random() * 0xFFFFFFFF) >>> 0;
const rnd8 = () => (Math.random() * 0xFF) >>> 0;

function hrtimeMs(fn) {
    const t0 = performance.now();
    fn();
    return performance.now() - t0;
}

/* ─── 1. build source & destination pools ───────────────────────────────── */

/* AoS: flat Int32Array [a,b,c,d, a,b,c,d, …] */

const bufferFrom = new ArrayBuffer(N_OBJECTS * 4 * 10)
const bufferTo = new ArrayBuffer(N_OBJECTS * 4 * 10)
const aosFrom32 = new Int32Array(bufferFrom);
const aosFrom8 = new Int8Array(bufferFrom);
const aosTo32 = new Int32Array(bufferTo);
const aosTo8 = new Int32Array(bufferTo);

/* SoA: 4 parallel Int32Arrays */
const soaFrom = {
    a: new Int32Array(N_OBJECTS),
    b: new Int32Array(N_OBJECTS),
    c: new Int8Array(N_OBJECTS),
    d: new Int8Array(N_OBJECTS),
};
const soaTo = {
    a: new Int32Array(N_OBJECTS),
    b: new Int32Array(N_OBJECTS),
    c: new Int8Array(N_OBJECTS),
    d: new Int8Array(N_OBJECTS),
};

/* JS objects */
const objFrom = new Array(N_OBJECTS);
const objTo = new Array(N_OBJECTS);

/* fill with pseudo‑random data */
for (let i = 0; i < N_OBJECTS; ++i) {
    /* AoS */
    const off = i << 2;
    aosFrom32[off] = rnd32();
    aosFrom32[off + 1] = rnd32();
    aosFrom8[off + 8] = rnd8();
    aosFrom8[off + 9] = rnd8();

    /* SoA */
    soaFrom.a[i] = rnd32();
    soaFrom.b[i] = rnd32();
    soaFrom.c[i] = rnd8();
    soaFrom.d[i] = rnd8();

    /* Objects */
    objFrom[i] = {
        a: rnd32(),
        b: rnd32(),
        c: rnd32(),
        d: rnd32(),
    };
    objTo[i] = {a: 0, b: 0, c: 0, d: 0};     // pre‑allocate
}

/* ─── 2. update kernels ───────────────────────────────────────────────────*/

/* • AoS –  flat array */
function updateAoSSa(from8, from32, to8, to32, n) {
    for (let i = 0; i < n; ++i) {
        const off32 = i * 4;
        const off8 = i * 16;
        const a = from32[off32];
        const b = from32[off32 + 1];
        const c = from8[off8 + 8];
        const d = from8[off8 + 9];

        to32[off32] = a;
        to32[off32 + 1] = b + c;
        to8[off8 + 8] = d;
        to8[off8 + 9] = a + b;
    }
}

function updateAoS(from8, from32, to8, to32, n) {
    for (let i = 0; i < n; ++i) {
        const off32 = i * 4;
        const off8 = i * 16;
        const a = from32[off32];
        const b = from32[off32 + 1];
        const c = from8[off8 + 8];
        const d = from8[off8 + 9];

        to32[off32] = a;
        to32[off32 + 1] = b + c;
        to8[off8 + 8] = d;
        to8[off8 + 9] = a + b;
    }
}

/* • SoA –  4 parallel arrays */
function updateSoA(f, t, n) {
    const fa = f.a, fb = f.b, fc = f.c, fd = f.d;
    const ta = t.a, tb = t.b, tc = t.c, td = t.d;

    for (let i = 0; i < n; ++i) {
        ta[i] = fa[i];
        tb[i] = fb[i] + fc[i];
        tc[i] = fd[i];
        td[i] = fa[i] + fb[i];
    }
}

/* • Objects –  [{a,b,c,d}, …] */
function updateObj(f, t, n) {
    for (let i = 0; i < n; ++i) {
        const src = f[i];
        const dst = t[i];

        dst.a = src.a;
        dst.b = src.b + src.c;
        dst.c = src.d;
        dst.d = src.a + src.b;
    }
}

/* ─── 3. run benchmark ────────────────────────────────────────────────────*/

function bench(label, kernel) {
    /* warm‑up – let TurboFan optimise the hot loop */
    for (let i = 0; i < WARM_UP; ++i) kernel();

    let total = 0;
    for (let i = 0; i < ITERATIONS; ++i) {
        total += hrtimeMs(kernel);
    }
    return total / ITERATIONS;
}

/* closures capture the correct pools */
const tAoS = bench('AoS', () => updateAoS(aosFrom8, aosFrom32, aosTo8, aosTo32, N_OBJECTS));
const tSoA = bench('SoA', () => updateSoA(soaFrom, soaTo, N_OBJECTS));
const tObj = bench('Objects', () => updateObj(objFrom, objTo, N_OBJECTS));

/* ─── 4. results ──────────────────────────────────────────────────────────*/

console.table([
    {layout: 'AoS ‑ flat Int32Array', avg_ms: tAoS.toFixed(3)},
    {layout: 'SoA ‑ 4× Int32Array', avg_ms: tSoA.toFixed(3)},
    {layout: 'Plain JS objects', avg_ms: tObj.toFixed(3)},
]);

/* quick checksum so the loops can’t be optimised away */
const checksum =
    aosTo[0] + soaTo.a[0] + objTo[0].a +
    aosTo[(N_OBJECTS - 1) << 2] + soaTo.d[N_OBJECTS - 1] + objTo[N_OBJECTS - 1].d;
console.log('checksum:', checksum >>> 0);
