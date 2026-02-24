import { is, Min, Max, MinLen, MaxLen, Matches } from "ts-runtime-checks";

// ============ Simple Data Type ============
// Same constraints as Typia for fair comparison
export interface SimpleData {
    name: string & MinLen<1> & MaxLen<100>;
    age: number & Min<0> & Max<150>;
    email: string & MinLen<1>;
    active: boolean;
    tags: string[];
}

// ============ Nested Data Type ============
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

// ============ Refine Data Type ============
// LIMITATION: ts-runtime-checks cannot handle complex regex patterns with escaping.
// The password regex should be: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).{8,}$/
// But ts-runtime-checks generates broken code with escaped characters in Matches<>.
// This simpler version only checks: length >= 8 + one lowercase letter
// This is NOT equivalent to other libraries, so refine test is SKIPPED for fairness.
export interface RefineData {
    username: string & MinLen<3> & MaxLen<20> & Matches<"/^[a-zA-Z0-9]+$/">;
    email: string & Matches<"/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+[.][a-zA-Z]{2,}$/">;
    age: number & Min<18> & Max<150>;
    password: string & MinLen<8> & Matches<"/[a-z]/">; // WEAK: only checks lowercase, not full pattern
    website: string & Matches<"/^https?:/">;
}

// ============ Discriminated Union Type ============
// Same constraints as Typia for fair comparison
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

// ============ Recursive Data Type ============
export interface RecursiveData {
    name: string;
    value: number;
    children?: RecursiveData[];
}

// ============ Tuple Data Type ============
export interface TupleData {
    coords: [number, number, number];
    range: [number, number];
    mixed: [string, number, boolean];
}

// ============ Big String Data Type ============
export interface BigStringData {
    content: string;
    description: string;
    metadata: string;
}

// ============ Big Array Data Type ============
export interface BigArrayItem {
    id: number;
    name: string;
    value: number;
}

export interface BigArrayData {
    items: BigArrayItem[];
}

// ============ Validation Functions ============
// These use ts-runtime-checks' is<T> and Assert<T> markers
// Will be transformed at compile time to actual validation code

// Type guards (is functions)
export const isNumber = (v: unknown): v is number => is<number>(v);
export const isSimple = (v: unknown): v is SimpleData => is<SimpleData>(v);
export const isNested = (v: unknown): v is NestedData => is<NestedData>(v);
export const isRefine = (v: unknown): v is RefineData => is<RefineData>(v);
export const isDiscriminated = (v: unknown): v is DiscriminatedData => is<DiscriminatedData>(v);
export const isRecursive = (v: unknown): v is RecursiveData => is<RecursiveData>(v);
export const isTuple = (v: unknown): v is TupleData => is<TupleData>(v);
export const isBigString = (v: unknown): v is BigStringData => is<BigStringData>(v);
export const isBigArray = (v: unknown): v is BigArrayData => is<BigArrayData>(v);

// Parse functions with ExactProps (strips extra properties)
// Using Assert with ExactProps to validate and clean in one step
export function parseNumber(v: unknown): number | undefined {
    return is<number>(v) ? v : undefined;
}

export function parseSimple(v: unknown): SimpleData | undefined {
    if (!is<SimpleData>(v)) return undefined;
    // Return a new clean object with only defined props
    return {
        name: v.name,
        age: v.age,
        email: v.email,
        active: v.active,
        tags: [...v.tags]
    };
}

export function parseNested(v: unknown): NestedData | undefined {
    if (!is<NestedData>(v)) return undefined;
    return {
        id: v.id,
        user: {
            name: v.user.name,
            email: v.user.email,
            profile: {
                bio: v.user.profile.bio,
                website: v.user.profile.website,
                social: {
                    twitter: v.user.profile.social.twitter,
                    github: v.user.profile.social.github
                }
            }
        },
        metadata: {
            createdAt: v.metadata.createdAt,
            updatedAt: v.metadata.updatedAt,
            version: v.metadata.version
        },
        tags: [...v.tags]
    };
}

export function parseRefine(v: unknown): RefineData | undefined {
    if (!is<RefineData>(v)) return undefined;
    return {
        username: v.username,
        email: v.email,
        age: v.age,
        password: v.password,
        website: v.website
    };
}

export function parseDiscriminated(v: unknown): DiscriminatedData | undefined {
    if (!is<DiscriminatedData>(v)) return undefined;
    if (v.type === 'user') {
        return { type: 'user', name: v.name, email: v.email };
    } else if (v.type === 'admin') {
        return { type: 'admin', name: v.name, email: v.email, level: v.level };
    } else {
        return { type: 'guest', sessionId: v.sessionId };
    }
}

function cloneRecursive(v: RecursiveData): RecursiveData {
    return {
        name: v.name,
        value: v.value,
        children: v.children ? v.children.map(cloneRecursive) : undefined
    };
}

export function parseRecursive(v: unknown): RecursiveData | undefined {
    if (!is<RecursiveData>(v)) return undefined;
    return cloneRecursive(v);
}

export function parseTuple(v: unknown): TupleData | undefined {
    if (!is<TupleData>(v)) return undefined;
    return {
        coords: [v.coords[0], v.coords[1], v.coords[2]],
        range: [v.range[0], v.range[1]],
        mixed: [v.mixed[0], v.mixed[1], v.mixed[2]]
    };
}

export function parseBigString(v: unknown): BigStringData | undefined {
    if (!is<BigStringData>(v)) return undefined;
    return {
        content: v.content,
        description: v.description,
        metadata: v.metadata
    };
}

export function parseBigArray(v: unknown): BigArrayData | undefined {
    if (!is<BigArrayData>(v)) return undefined;
    return {
        items: v.items.map(item => ({
            id: item.id,
            name: item.name,
            value: item.value
        }))
    };
}

// Stringify functions (validate + JSON.stringify)
export function stringifyNumber(v: unknown): string | null {
    return is<number>(v) ? JSON.stringify(v) : null;
}

export function stringifySimple(v: unknown): string | null {
    const parsed = parseSimple(v);
    return parsed ? JSON.stringify(parsed) : null;
}

export function stringifyNested(v: unknown): string | null {
    const parsed = parseNested(v);
    return parsed ? JSON.stringify(parsed) : null;
}

export function stringifyRefine(v: unknown): string | null {
    const parsed = parseRefine(v);
    return parsed ? JSON.stringify(parsed) : null;
}

export function stringifyDiscriminated(v: unknown): string | null {
    const parsed = parseDiscriminated(v);
    return parsed ? JSON.stringify(parsed) : null;
}

export function stringifyRecursive(v: unknown): string | null {
    const parsed = parseRecursive(v);
    return parsed ? JSON.stringify(parsed) : null;
}

export function stringifyTuple(v: unknown): string | null {
    const parsed = parseTuple(v);
    return parsed ? JSON.stringify(parsed) : null;
}

export function stringifyBigString(v: unknown): string | null {
    const parsed = parseBigString(v);
    return parsed ? JSON.stringify(parsed) : null;
}

export function stringifyBigArray(v: unknown): string | null {
    const parsed = parseBigArray(v);
    return parsed ? JSON.stringify(parsed) : null;
}
