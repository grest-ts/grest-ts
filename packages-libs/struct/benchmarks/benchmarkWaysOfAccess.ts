import {BenchHelper} from "./BenchHelper";

export function benchmarkWaysOfAccess() {
    const NO_OF_OBJECTS = 1000000;
    new BenchHelper("Access comparison")
        .addTestCase("Objects", () => {
            const data: { x: number, y: number, vx: number, vy: number }[] = [];
            for (let i = 0; i < NO_OF_OBJECTS; i++) {
                data.push({
                    x: Math.floor(Math.random() * 10000),
                    y: Math.floor(Math.random() * 10000),
                    vx: Math.floor(Math.random() * 255),
                    vy: Math.floor(Math.random() * 255)
                })
            }
            return () => {
                for (let i = 0; i < NO_OF_OBJECTS; i++) {
                    const item = data[i];
                    item.x += item.vx;
                    item.y += item.vy;
                    item.vx += 0.01;
                    item.vy += 0.01;
                }
            }
        })
        .addTestCase("AoS (32bit buffer)", () => {
            const data = new ArrayBuffer(NO_OF_OBJECTS * 12);
            const int32View = new Int32Array(data);
            for (let i = 0; i < NO_OF_OBJECTS; i++) {
                int32View[i * 3] = Math.floor(Math.random() * 10000);
                int32View[i * 3 + 1] = Math.floor(Math.random() * 10000);
                int32View[i * 3 + 2] = Math.floor(Math.random() * 255);
                int32View[i * 3 + 3] = Math.floor(Math.random() * 255);
            }
            return () => {
                for (let i = 0; i < NO_OF_OBJECTS; i++) {
                    int32View[i * 3] += int32View[i * 3 + 2]
                    int32View[i * 3 + 1] += int32View[i * 3 + 3]
                    int32View[i * 3 + 2] += 0.01;
                    int32View[i * 3 + 3] += 0.01;
                }
            }
        })
        .addTestCase("AoS (2x32 & 2x8bit views)", () => {
            const data = new ArrayBuffer(NO_OF_OBJECTS * 12);
            const int32View = new Int32Array(data);
            const int8View = new Int8Array(data);
            for (let i = 0; i < NO_OF_OBJECTS; i++) {
                int32View[i * 3] = Math.floor(Math.random() * 10000);
                int32View[i * 3 + 1] = Math.floor(Math.random() * 10000);
                int8View[i * 12 + 8] = Math.floor(Math.random() * 255);
                int8View[i * 12 + 9] = Math.floor(Math.random() * 255);
            }
            return () => {
                for (let i = 0; i < NO_OF_OBJECTS; i++) {
                    int32View[i * 3] += int8View[i * 12 + 8]
                    int32View[i * 3 + 1] += int8View[i * 12 + 9]
                    int8View[i * 12 + 8] += 0.01;
                    int8View[i * 12 + 9] += 0.01;
                }
            }
        })
        .addTestCase("SoA 4x32bit", () => {
            const x = new Int32Array(NO_OF_OBJECTS);
            const y = new Int32Array(NO_OF_OBJECTS);
            const vx = new Int32Array(NO_OF_OBJECTS)
            const vy = new Int32Array(NO_OF_OBJECTS)
            for (let i = 0; i < NO_OF_OBJECTS; i++) {
                x[i] = Math.floor(Math.random() * 10000);
                y[i] = Math.floor(Math.random() * 10000);
                vx[i] = Math.floor(Math.random() * 255);
                vy[i] = Math.floor(Math.random() * 255);
            }
            return () => {
                for (let i = 0; i < NO_OF_OBJECTS; i++) {
                    x[i] += vx[i]
                    y[i] += vy[i]
                    vx[i] += 0.01;
                    vy[i] += 0.01;
                }
            }
        })
        .addTestCase("SoA 4x32bit (funcs)", () => {
            const x = new Int32Array(NO_OF_OBJECTS);
            const y = new Int32Array(NO_OF_OBJECTS);
            const vx = new Int32Array(NO_OF_OBJECTS);
            const vy = new Int32Array(NO_OF_OBJECTS);

            for (let i = 0; i < NO_OF_OBJECTS; i++) {
                x[i] = Math.floor(Math.random() * 10000);
                y[i] = Math.floor(Math.random() * 10000);
                vx[i] = Math.floor(Math.random() * 255);
                vy[i] = Math.floor(Math.random() * 255);
            }

            const accessor = {
                setX(ref: number, value: number) {
                    x[ref] = value;
                },
                setY(ref: number, value: number) {
                    y[ref] = value;
                },
                setVx(ref: number, value: number) {
                    vx[ref] = value;
                },
                setVy(ref: number, value: number) {
                    vy[ref] = value;
                },
                getX(ref: number): number {
                    return x[ref];
                },
                getY(ref: number): number {
                    return y[ref];
                },
                getVx(ref: number): number {
                    return vx[ref];
                },
                getVy(ref: number): number {
                    return vy[ref];
                }
            }
            return () => {
                for (let i = 0; i < NO_OF_OBJECTS; i++) {
                    accessor.setX(i, accessor.getX(i) + accessor.getVx(i))
                    accessor.setY(i, accessor.getY(i) + accessor.getVy(i))
                    accessor.setVx(i, accessor.getVx(i) + 0.01)
                    accessor.setVy(i, accessor.getVy(i) + 0.01)
                }
            }
        })
        .addTestCase("SoA (2x32 & 2x8bit)", () => {
            const x = new Int32Array(NO_OF_OBJECTS);
            const y = new Int32Array(NO_OF_OBJECTS);
            const vx = new Int8Array(NO_OF_OBJECTS)
            const vy = new Int8Array(NO_OF_OBJECTS)
            for (let i = 0; i < NO_OF_OBJECTS; i++) {
                x[i] = Math.floor(Math.random() * 10000);
                y[i] = Math.floor(Math.random() * 10000);
                vx[i] = Math.floor(Math.random() * 255);
                vy[i] = Math.floor(Math.random() * 255);
            }
            return () => {
                for (let i = 0; i < NO_OF_OBJECTS; i++) {
                    x[i] += vx[i]
                    y[i] += vy[i]
                    vx[i] += 0.01;
                    vy[i] += 0.01;
                }
            }
        })
        .addTestCase("SoA (2x32 & 2x8bit) XXX", () => {
            const buffer = new ArrayBuffer(4 * NO_OF_OBJECTS * 4);
            const x = new Int32Array(buffer);
            const y = new Int32Array(buffer, NO_OF_OBJECTS * 4);
            const vx = new Int8Array(buffer, 2 * NO_OF_OBJECTS * 4)
            const vy = new Int8Array(buffer, 3 * NO_OF_OBJECTS * 4)
            for (let i = 0; i < NO_OF_OBJECTS; i++) {
                x[i] = Math.floor(Math.random() * 10000);
                y[i] = Math.floor(Math.random() * 10000);
                vx[i] = Math.floor(Math.random() * 255);
                vy[i] = Math.floor(Math.random() * 255);
            }
            return () => {
                for (let i = 0; i < NO_OF_OBJECTS; i++) {
                    x[i] += vx[i]
                    y[i] += vy[i]
                    vx[i] += 0.01;
                    vy[i] += 0.01;
                }
            }
        })
        .run();
}