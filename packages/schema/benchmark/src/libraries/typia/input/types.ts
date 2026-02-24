import typia, {tags} from "typia";

// ============ Simple Data Type ============
export interface TypiaSimpleData {
    name: string & tags.MinLength<1> & tags.MaxLength<100>;
    age: number & tags.Minimum<0> & tags.Maximum<150>;
    email: string & tags.MinLength<1>;
    active: boolean;
    tags: string[];
}

// ============ Nested Data Type ============
export interface TypiaNestedData {
    id: number;
    user: {
        name: string & tags.MinLength<1>;
        email: string & tags.MinLength<1>;
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
// Uses @pattern JSDoc tags for regex validation (same patterns as constants.ts)
export interface TypiaRefineData {
    /**
     * @pattern ^[a-zA-Z0-9]+$
     */
    username: string & tags.MinLength<3> & tags.MaxLength<20>;
    /**
     * @pattern ^[^\s@]+@[^\s@]+\.[^\s@]+$
     */
    email: string;
    age: number & tags.Minimum<18> & tags.Maximum<150>;
    /**
     * @pattern ^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).{8,}$
     */
    password: string;
    /**
     * @pattern ^https?://.+
     */
    website: string;
}

// ============ Discriminated Union Type ============
export interface TypiaDiscriminatedUser {
    type: 'user';
    name: string & tags.MinLength<1>;
    email: string & tags.MinLength<1>;
}

export interface TypiaDiscriminatedAdmin {
    type: 'admin';
    name: string & tags.MinLength<1>;
    email: string & tags.MinLength<1>;
    level: number & tags.Minimum<1> & tags.Maximum<10>;
}

export interface TypiaDiscriminatedGuest {
    type: 'guest';
    sessionId: string & tags.MinLength<1>;
}

export type TypiaDiscriminatedData = TypiaDiscriminatedUser | TypiaDiscriminatedAdmin | TypiaDiscriminatedGuest;

// ============ Recursive Data Type ============
export interface TypiaRecursiveData {
    name: string;
    value: number;
    children?: TypiaRecursiveData[];
}

// ============ Tuple Data Type ============
export interface TypiaTupleData {
    coords: [number, number, number];
    range: [number, number];
    mixed: [string, number, boolean];
}

// ============ Big String Data Type ============
export interface TypiaBigStringData {
    content: string;
    description: string;
    metadata: string;
}

// ============ Big Array Data Type ============
export interface TypiaBigArrayItem {
    id: number;
    name: string;
    value: number;
}

export interface TypiaBigArrayData {
    items: TypiaBigArrayItem[];
}

// ============ Validator function exports ============
// These will be transformed by typia generate into actual validation code
// Using validateClone instead of validate to strip extra properties (fair comparison with GGType)

export const isNumberType = typia.createIs<number>();
export const validateNumber = typia.createValidate<number>();

export const isSimple = typia.createIs<TypiaSimpleData>();
export const validateSimple = typia.misc.createValidateClone<TypiaSimpleData>();

export const isNested = typia.createIs<TypiaNestedData>();
export const validateNested = typia.misc.createValidateClone<TypiaNestedData>();

export const isRefine = typia.createIs<TypiaRefineData>();
export const validateRefine = typia.misc.createValidateClone<TypiaRefineData>();

export const isDiscriminated = typia.createIs<TypiaDiscriminatedData>();
export const validateDiscriminated = typia.misc.createValidateClone<TypiaDiscriminatedData>();

export const isRecursive = typia.createIs<TypiaRecursiveData>();
export const validateRecursive = typia.misc.createValidateClone<TypiaRecursiveData>();

export const isTuple = typia.createIs<TypiaTupleData>();
export const validateTuple = typia.misc.createValidateClone<TypiaTupleData>();

export const isBigString = typia.createIs<TypiaBigStringData>();
export const validateBigString = typia.misc.createValidateClone<TypiaBigStringData>();

export const isBigArray = typia.createIs<TypiaBigArrayData>();
export const validateBigArray = typia.misc.createValidateClone<TypiaBigArrayData>();

// ============ Optimized Stringify function exports ============
// These use typia's optimized JSON stringify which is faster than JSON.stringify
export const isStringifyNumber = typia.json.createIsStringify<number>();
export const isStringifySimple = typia.json.createIsStringify<TypiaSimpleData>();
export const isStringifyNested = typia.json.createIsStringify<TypiaNestedData>();
export const isStringifyRefine = typia.json.createIsStringify<TypiaRefineData>();
export const isStringifyDiscriminated = typia.json.createIsStringify<TypiaDiscriminatedData>();
export const isStringifyRecursive = typia.json.createIsStringify<TypiaRecursiveData>();
export const isStringifyTuple = typia.json.createIsStringify<TypiaTupleData>();
export const isStringifyBigString = typia.json.createIsStringify<TypiaBigStringData>();
export const isStringifyBigArray = typia.json.createIsStringify<TypiaBigArrayData>();
