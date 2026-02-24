import {GGLocator} from "./GGLocator";

export class GGLocatorKey<T> {

    public readonly name: string

    public constructor(name: string) {
        this.name = name
    }

    public get(): T {
        return GGLocator.getScope().get(this);
    }

    public tryGet(): T | undefined {
        return GGLocator.tryGetScope()?.tryGet(this);
    }

    public has(): boolean {
        return !!GGLocator.tryGetScope()?.has(this);
    }

    public set(value: T): void {
        GGLocator.getScope().set(this, value);
    }

    public overwrite(value: T): void {
        GGLocator.getScope().overwrite(this, value);
    }
}