import { Min, Max, MinLen, MaxLen, Matches } from "ts-runtime-checks";
export interface SimpleData {
    name: string & MinLen<1> & MaxLen<100>;
    age: number & Min<0> & Max<150>;
    email: string & MinLen<1>;
    active: boolean;
    tags: string[];
}
export interface NestedData {
    id: number;
    user: {
        name: string & MinLen<1>;
        email: string & MinLen<1>;
        profile: {
            bio: string;
            website: string;
            social: {
                twitter: string;
                github: string;
            };
        };
    };
    metadata: {
        createdAt: number;
        updatedAt: number;
        version: number;
    };
    tags: string[];
}
export interface RefineData {
    username: string & MinLen<3> & MaxLen<20> & Matches<"/^[a-zA-Z0-9]+$/">;
    email: string & Matches<"/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+[.][a-zA-Z]{2,}$/">;
    age: number & Min<18> & Max<150>;
    password: string & MinLen<8> & Matches<"/[a-z]/">;
    website: string & Matches<"/^https?:/">;
}
export interface DiscriminatedUser {
    type: 'user';
    name: string & MinLen<1>;
    email: string & MinLen<1>;
}
export interface DiscriminatedAdmin {
    type: 'admin';
    name: string & MinLen<1>;
    email: string & MinLen<1>;
    level: number & Min<1> & Max<10>;
}
export interface DiscriminatedGuest {
    type: 'guest';
    sessionId: string & MinLen<1>;
}
export type DiscriminatedData = DiscriminatedUser | DiscriminatedAdmin | DiscriminatedGuest;
export interface RecursiveData {
    name: string;
    value: number;
    children?: RecursiveData[];
}
export interface TupleData {
    coords: [number, number, number];
    range: [number, number];
    mixed: [string, number, boolean];
}
export interface BigStringData {
    content: string;
    description: string;
    metadata: string;
}
export interface BigArrayItem {
    id: number;
    name: string;
    value: number;
}
export interface BigArrayData {
    items: BigArrayItem[];
}
export declare const isNumber: (v: unknown) => v is number;
export declare const isSimple: (v: unknown) => v is SimpleData;
export declare const isNested: (v: unknown) => v is NestedData;
export declare const isRefine: (v: unknown) => v is RefineData;
export declare const isDiscriminated: (v: unknown) => v is DiscriminatedData;
export declare const isRecursive: (v: unknown) => v is RecursiveData;
export declare const isTuple: (v: unknown) => v is TupleData;
export declare const isBigString: (v: unknown) => v is BigStringData;
export declare const isBigArray: (v: unknown) => v is BigArrayData;
export declare function parseNumber(v: unknown): number | undefined;
export declare function parseSimple(v: unknown): SimpleData | undefined;
export declare function parseNested(v: unknown): NestedData | undefined;
export declare function parseRefine(v: unknown): RefineData | undefined;
export declare function parseDiscriminated(v: unknown): DiscriminatedData | undefined;
export declare function parseRecursive(v: unknown): RecursiveData | undefined;
export declare function parseTuple(v: unknown): TupleData | undefined;
export declare function parseBigString(v: unknown): BigStringData | undefined;
export declare function parseBigArray(v: unknown): BigArrayData | undefined;
export declare function stringifyNumber(v: unknown): string | null;
export declare function stringifySimple(v: unknown): string | null;
export declare function stringifyNested(v: unknown): string | null;
export declare function stringifyRefine(v: unknown): string | null;
export declare function stringifyDiscriminated(v: unknown): string | null;
export declare function stringifyRecursive(v: unknown): string | null;
export declare function stringifyTuple(v: unknown): string | null;
export declare function stringifyBigString(v: unknown): string | null;
export declare function stringifyBigArray(v: unknown): string | null;
