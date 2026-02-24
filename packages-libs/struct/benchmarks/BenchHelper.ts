export interface BenchHelperConfig {
    runs?: number;
    warmRuns?: number;
}

export class BenchHelper {

    private readonly name: string;
    private readonly config: BenchHelperConfig;

    private bestTime: number = Infinity;
    private worstTime: number = 0;
    private tests: {
        name: string,
        init: () => (() => void),
    }[] = []

    private results: Map<string, number> = new Map();

    constructor(name: string, config?: BenchHelperConfig) {
        this.name = name;
        this.config = config ?? {};
        this.config.runs ??= 50;
        this.config.warmRuns ??= 5;
    }

    public addTestCase<T>(name: string, init: () => (() => void)) {
        this.tests.push({
            name: name,
            init: init
        });
        return this;
    }

    public run() {

        this.tests.forEach((test) => {
            const testFunc = test.init();

            for (let i = 0; i < this.config.warmRuns; i++) {
                testFunc();
            }

            let timeSum = 0;
            let ts = 0
            for (let i = 0; i < this.config.runs; i++) {
                ts = performance.now();
                testFunc();
                timeSum += performance.now() - ts;
            }

            const t = timeSum / this.config.runs;
            if (t < this.bestTime) {
                this.bestTime = t;
            }
            if (t > this.worstTime) {
                this.worstTime = t;
            }
            this.results.set(test.name, t)
        });

        const lines: string[] = [];

        lines.push(("RUNNING '" + this.name + "' ").padEnd(80, "-"));
        lines.push("Test".padEnd(35, " ")
            + "Test".padEnd(15, " ")
            + "Slower".padEnd(15, " ")
            + "Faster");
        this.results.forEach((time, name) => {
            lines.push(name.padEnd(35, " ")
                + (time.toFixed(3) + "ms").padEnd(15, " ")
                + ((time / this.bestTime).toFixed(2) + "x").padEnd(15, " ")
                + (this.worstTime / time).toFixed(2) + "x")
        });
        console.log(lines.join("\n") + "\n")
    }

}

export interface BenchTest {
    name: string,
    setup: (() => any)[],
    exec: ((args: any) => void)[]
}