import * as __typia_transform__validateReport from "typia/lib/internal/_validateReport.js";
import * as __typia_transform__createStandardSchema from "typia/lib/internal/_createStandardSchema.js";
import * as __typia_transform__throwTypeGuardError from "typia/lib/internal/_throwTypeGuardError.js";
import * as __typia_transform__jsonStringifyNumber from "typia/lib/internal/_jsonStringifyNumber.js";
import * as __typia_transform__jsonStringifyString from "typia/lib/internal/_jsonStringifyString.js";
import { tags } from "typia";
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
    coords: [
        number,
        number,
        number
    ];
    range: [
        number,
        number
    ];
    mixed: [
        string,
        number,
        boolean
    ];
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
export const isNumberType = (() => { return (input: any): input is number => "number" === typeof input; })();
export const validateNumber = (() => { const __is = (input: any): input is number => "number" === typeof input; let errors: any; let _report: any; return __typia_transform__createStandardSchema._createStandardSchema((input: any): import("typia").IValidation<number> => {
    if (false === __is(input)) {
        errors = [];
        _report = (__typia_transform__validateReport._validateReport as any)(errors);
        ((input: any, _path: string, _exceptionable: boolean = true) => "number" === typeof input || _report(true, {
            path: _path + "",
            expected: "number",
            value: input
        }))(input, "$input", true);
        const success = 0 === errors.length;
        return success ? {
            success,
            data: input
        } : {
            success,
            errors,
            data: input
        } as any;
    }
    return {
        success: true,
        data: input
    } as any;
}); })();
export const isSimple = (() => { const _io0 = (input: any): boolean => "string" === typeof input.name && (1 <= input.name.length && input.name.length <= 100) && ("number" === typeof input.age && (0 <= input.age && input.age <= 150)) && ("string" === typeof input.email && 1 <= input.email.length) && "boolean" === typeof input.active && (Array.isArray(input.tags) && input.tags.every((elem: any) => "string" === typeof elem)); return (input: any): input is TypiaSimpleData => "object" === typeof input && null !== input && _io0(input); })();
export const validateSimple = (() => { const _cp0 = (input: any) => input.map((elem: any) => elem); const _io0 = (input: any): boolean => "string" === typeof input.name && (1 <= input.name.length && input.name.length <= 100) && ("number" === typeof input.age && (0 <= input.age && input.age <= 150)) && ("string" === typeof input.email && 1 <= input.email.length) && "boolean" === typeof input.active && (Array.isArray(input.tags) && input.tags.every((elem: any) => "string" === typeof elem)); const _vo0 = (input: any, _path: string, _exceptionable: boolean = true): boolean => ["string" === typeof input.name && (1 <= input.name.length || _report(_exceptionable, {
        path: _path + ".name",
        expected: "string & MinLength<1>",
        value: input.name
    })) && (input.name.length <= 100 || _report(_exceptionable, {
        path: _path + ".name",
        expected: "string & MaxLength<100>",
        value: input.name
    })) || _report(_exceptionable, {
        path: _path + ".name",
        expected: "(string & MinLength<1> & MaxLength<100>)",
        value: input.name
    }), "number" === typeof input.age && (0 <= input.age || _report(_exceptionable, {
        path: _path + ".age",
        expected: "number & Minimum<0>",
        value: input.age
    })) && (input.age <= 150 || _report(_exceptionable, {
        path: _path + ".age",
        expected: "number & Maximum<150>",
        value: input.age
    })) || _report(_exceptionable, {
        path: _path + ".age",
        expected: "(number & Minimum<0> & Maximum<150>)",
        value: input.age
    }), "string" === typeof input.email && (1 <= input.email.length || _report(_exceptionable, {
        path: _path + ".email",
        expected: "string & MinLength<1>",
        value: input.email
    })) || _report(_exceptionable, {
        path: _path + ".email",
        expected: "(string & MinLength<1>)",
        value: input.email
    }), "boolean" === typeof input.active || _report(_exceptionable, {
        path: _path + ".active",
        expected: "boolean",
        value: input.active
    }), (Array.isArray(input.tags) || _report(_exceptionable, {
        path: _path + ".tags",
        expected: "Array<string>",
        value: input.tags
    })) && input.tags.map((elem: any, _index2: number) => "string" === typeof elem || _report(_exceptionable, {
        path: _path + ".tags[" + _index2 + "]",
        expected: "string",
        value: elem
    })).every((flag: boolean) => flag) || _report(_exceptionable, {
        path: _path + ".tags",
        expected: "Array<string>",
        value: input.tags
    })].every((flag: boolean) => flag); const _co0 = (input: any): any => ({
    name: input.name,
    age: input.age,
    email: input.email,
    active: input.active,
    tags: _cp0(input.tags) as any
}); const __is = (input: any): input is TypiaSimpleData => "object" === typeof input && null !== input && _io0(input); let errors: any; let _report: any; const __validate = (input: any): import("typia").IValidation<TypiaSimpleData> => {
    if (false === __is(input)) {
        errors = [];
        _report = (__typia_transform__validateReport._validateReport as any)(errors);
        ((input: any, _path: string, _exceptionable: boolean = true) => ("object" === typeof input && null !== input || _report(true, {
            path: _path + "",
            expected: "TypiaSimpleData",
            value: input
        })) && _vo0(input, _path + "", true) || _report(true, {
            path: _path + "",
            expected: "TypiaSimpleData",
            value: input
        }))(input, "$input", true);
        const success = 0 === errors.length;
        return success ? {
            success,
            data: input
        } : {
            success,
            errors,
            data: input
        } as any;
    }
    return {
        success: true,
        data: input
    } as any;
}; const __clone = (input: TypiaSimpleData): import("typia").Resolved<TypiaSimpleData> => _co0(input) as any; return (input: any): import("typia").IValidation<import("typia").Resolved<TypiaSimpleData>> => {
    const result = __validate(input) as any;
    if (result.success)
        result.data = __clone(input);
    return result;
}; })();
export const isNested = (() => { const _io0 = (input: any): boolean => "number" === typeof input.id && ("object" === typeof input.user && null !== input.user && _io1(input.user)) && ("object" === typeof input.metadata && null !== input.metadata && _io4(input.metadata)) && (Array.isArray(input.tags) && input.tags.every((elem: any) => "string" === typeof elem)); const _io1 = (input: any): boolean => "string" === typeof input.name && 1 <= input.name.length && ("string" === typeof input.email && 1 <= input.email.length) && ("object" === typeof input.profile && null !== input.profile && _io2(input.profile)); const _io2 = (input: any): boolean => "string" === typeof input.bio && "string" === typeof input.website && ("object" === typeof input.social && null !== input.social && _io3(input.social)); const _io3 = (input: any): boolean => "string" === typeof input.twitter && "string" === typeof input.github; const _io4 = (input: any): boolean => "number" === typeof input.createdAt && "number" === typeof input.updatedAt && "number" === typeof input.version; return (input: any): input is TypiaNestedData => "object" === typeof input && null !== input && _io0(input); })();
export const validateNested = (() => { const _cp0 = (input: any) => input.map((elem: any) => elem); const _io0 = (input: any): boolean => "number" === typeof input.id && ("object" === typeof input.user && null !== input.user && _io1(input.user)) && ("object" === typeof input.metadata && null !== input.metadata && _io4(input.metadata)) && (Array.isArray(input.tags) && input.tags.every((elem: any) => "string" === typeof elem)); const _io1 = (input: any): boolean => "string" === typeof input.name && 1 <= input.name.length && ("string" === typeof input.email && 1 <= input.email.length) && ("object" === typeof input.profile && null !== input.profile && _io2(input.profile)); const _io2 = (input: any): boolean => "string" === typeof input.bio && "string" === typeof input.website && ("object" === typeof input.social && null !== input.social && _io3(input.social)); const _io3 = (input: any): boolean => "string" === typeof input.twitter && "string" === typeof input.github; const _io4 = (input: any): boolean => "number" === typeof input.createdAt && "number" === typeof input.updatedAt && "number" === typeof input.version; const _vo0 = (input: any, _path: string, _exceptionable: boolean = true): boolean => ["number" === typeof input.id || _report(_exceptionable, {
        path: _path + ".id",
        expected: "number",
        value: input.id
    }), ("object" === typeof input.user && null !== input.user || _report(_exceptionable, {
        path: _path + ".user",
        expected: "__type",
        value: input.user
    })) && _vo1(input.user, _path + ".user", true && _exceptionable) || _report(_exceptionable, {
        path: _path + ".user",
        expected: "__type",
        value: input.user
    }), ("object" === typeof input.metadata && null !== input.metadata || _report(_exceptionable, {
        path: _path + ".metadata",
        expected: "__type.o5",
        value: input.metadata
    })) && _vo4(input.metadata, _path + ".metadata", true && _exceptionable) || _report(_exceptionable, {
        path: _path + ".metadata",
        expected: "__type.o5",
        value: input.metadata
    }), (Array.isArray(input.tags) || _report(_exceptionable, {
        path: _path + ".tags",
        expected: "Array<string>",
        value: input.tags
    })) && input.tags.map((elem: any, _index2: number) => "string" === typeof elem || _report(_exceptionable, {
        path: _path + ".tags[" + _index2 + "]",
        expected: "string",
        value: elem
    })).every((flag: boolean) => flag) || _report(_exceptionable, {
        path: _path + ".tags",
        expected: "Array<string>",
        value: input.tags
    })].every((flag: boolean) => flag); const _vo1 = (input: any, _path: string, _exceptionable: boolean = true): boolean => ["string" === typeof input.name && (1 <= input.name.length || _report(_exceptionable, {
        path: _path + ".name",
        expected: "string & MinLength<1>",
        value: input.name
    })) || _report(_exceptionable, {
        path: _path + ".name",
        expected: "(string & MinLength<1>)",
        value: input.name
    }), "string" === typeof input.email && (1 <= input.email.length || _report(_exceptionable, {
        path: _path + ".email",
        expected: "string & MinLength<1>",
        value: input.email
    })) || _report(_exceptionable, {
        path: _path + ".email",
        expected: "(string & MinLength<1>)",
        value: input.email
    }), ("object" === typeof input.profile && null !== input.profile || _report(_exceptionable, {
        path: _path + ".profile",
        expected: "__type.o3",
        value: input.profile
    })) && _vo2(input.profile, _path + ".profile", true && _exceptionable) || _report(_exceptionable, {
        path: _path + ".profile",
        expected: "__type.o3",
        value: input.profile
    })].every((flag: boolean) => flag); const _vo2 = (input: any, _path: string, _exceptionable: boolean = true): boolean => ["string" === typeof input.bio || _report(_exceptionable, {
        path: _path + ".bio",
        expected: "string",
        value: input.bio
    }), "string" === typeof input.website || _report(_exceptionable, {
        path: _path + ".website",
        expected: "string",
        value: input.website
    }), ("object" === typeof input.social && null !== input.social || _report(_exceptionable, {
        path: _path + ".social",
        expected: "__type.o4",
        value: input.social
    })) && _vo3(input.social, _path + ".social", true && _exceptionable) || _report(_exceptionable, {
        path: _path + ".social",
        expected: "__type.o4",
        value: input.social
    })].every((flag: boolean) => flag); const _vo3 = (input: any, _path: string, _exceptionable: boolean = true): boolean => ["string" === typeof input.twitter || _report(_exceptionable, {
        path: _path + ".twitter",
        expected: "string",
        value: input.twitter
    }), "string" === typeof input.github || _report(_exceptionable, {
        path: _path + ".github",
        expected: "string",
        value: input.github
    })].every((flag: boolean) => flag); const _vo4 = (input: any, _path: string, _exceptionable: boolean = true): boolean => ["number" === typeof input.createdAt || _report(_exceptionable, {
        path: _path + ".createdAt",
        expected: "number",
        value: input.createdAt
    }), "number" === typeof input.updatedAt || _report(_exceptionable, {
        path: _path + ".updatedAt",
        expected: "number",
        value: input.updatedAt
    }), "number" === typeof input.version || _report(_exceptionable, {
        path: _path + ".version",
        expected: "number",
        value: input.version
    })].every((flag: boolean) => flag); const _co0 = (input: any): any => ({
    id: input.id,
    user: _co1(input.user) as any,
    metadata: _co4(input.metadata) as any,
    tags: _cp0(input.tags) as any
}); const _co1 = (input: any): any => ({
    name: input.name,
    email: input.email,
    profile: _co2(input.profile) as any
}); const _co2 = (input: any): any => ({
    bio: input.bio,
    website: input.website,
    social: _co3(input.social) as any
}); const _co3 = (input: any): any => ({
    twitter: input.twitter,
    github: input.github
}); const _co4 = (input: any): any => ({
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    version: input.version
}); const __is = (input: any): input is TypiaNestedData => "object" === typeof input && null !== input && _io0(input); let errors: any; let _report: any; const __validate = (input: any): import("typia").IValidation<TypiaNestedData> => {
    if (false === __is(input)) {
        errors = [];
        _report = (__typia_transform__validateReport._validateReport as any)(errors);
        ((input: any, _path: string, _exceptionable: boolean = true) => ("object" === typeof input && null !== input || _report(true, {
            path: _path + "",
            expected: "TypiaNestedData",
            value: input
        })) && _vo0(input, _path + "", true) || _report(true, {
            path: _path + "",
            expected: "TypiaNestedData",
            value: input
        }))(input, "$input", true);
        const success = 0 === errors.length;
        return success ? {
            success,
            data: input
        } : {
            success,
            errors,
            data: input
        } as any;
    }
    return {
        success: true,
        data: input
    } as any;
}; const __clone = (input: TypiaNestedData): import("typia").Resolved<TypiaNestedData> => _co0(input) as any; return (input: any): import("typia").IValidation<import("typia").Resolved<TypiaNestedData>> => {
    const result = __validate(input) as any;
    if (result.success)
        result.data = __clone(input);
    return result;
}; })();
export const isRefine = (() => { const _io0 = (input: any): boolean => "string" === typeof input.username && (3 <= input.username.length && input.username.length <= 20 && RegExp("^[a-zA-Z0-9]+$").test(input.username)) && ("string" === typeof input.email && RegExp("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$").test(input.email)) && ("number" === typeof input.age && (18 <= input.age && input.age <= 150)) && ("string" === typeof input.password && RegExp("^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[!@#$%^&*]).{8,}$").test(input.password)) && ("string" === typeof input.website && RegExp("^https?://.+").test(input.website)); return (input: any): input is TypiaRefineData => "object" === typeof input && null !== input && _io0(input); })();
export const validateRefine = (() => { const _io0 = (input: any): boolean => "string" === typeof input.username && (3 <= input.username.length && input.username.length <= 20 && RegExp("^[a-zA-Z0-9]+$").test(input.username)) && ("string" === typeof input.email && RegExp("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$").test(input.email)) && ("number" === typeof input.age && (18 <= input.age && input.age <= 150)) && ("string" === typeof input.password && RegExp("^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[!@#$%^&*]).{8,}$").test(input.password)) && ("string" === typeof input.website && RegExp("^https?://.+").test(input.website)); const _vo0 = (input: any, _path: string, _exceptionable: boolean = true): boolean => ["string" === typeof input.username && (3 <= input.username.length || _report(_exceptionable, {
        path: _path + ".username",
        expected: "string & MinLength<3>",
        value: input.username
    })) && (input.username.length <= 20 || _report(_exceptionable, {
        path: _path + ".username",
        expected: "string & MaxLength<20>",
        value: input.username
    })) && (RegExp("^[a-zA-Z0-9]+$").test(input.username) || _report(_exceptionable, {
        path: _path + ".username",
        expected: "string & Pattern<\"^[a-zA-Z0-9]+$\">",
        value: input.username
    })) || _report(_exceptionable, {
        path: _path + ".username",
        expected: "(string & MinLength<3> & MaxLength<20> & Pattern<\"^[a-zA-Z0-9]+$\">)",
        value: input.username
    }), "string" === typeof input.email && (RegExp("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$").test(input.email) || _report(_exceptionable, {
        path: _path + ".email",
        expected: "string & Pattern<\"^[^\\\\s@]+@[^\\\\s@]+\\\\.[^\\\\s@]+$\">",
        value: input.email
    })) || _report(_exceptionable, {
        path: _path + ".email",
        expected: "(string & Pattern<\"^[^\\\\s@]+@[^\\\\s@]+\\\\.[^\\\\s@]+$\">)",
        value: input.email
    }), "number" === typeof input.age && (18 <= input.age || _report(_exceptionable, {
        path: _path + ".age",
        expected: "number & Minimum<18>",
        value: input.age
    })) && (input.age <= 150 || _report(_exceptionable, {
        path: _path + ".age",
        expected: "number & Maximum<150>",
        value: input.age
    })) || _report(_exceptionable, {
        path: _path + ".age",
        expected: "(number & Minimum<18> & Maximum<150>)",
        value: input.age
    }), "string" === typeof input.password && (RegExp("^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[!@#$%^&*]).{8,}$").test(input.password) || _report(_exceptionable, {
        path: _path + ".password",
        expected: "string & Pattern<\"^(?=.*[a-z])(?=.*[A-Z])(?=.*\\\\d)(?=.*[!@#$%^&*]).{8,}$\">",
        value: input.password
    })) || _report(_exceptionable, {
        path: _path + ".password",
        expected: "(string & Pattern<\"^(?=.*[a-z])(?=.*[A-Z])(?=.*\\\\d)(?=.*[!@#$%^&*]).{8,}$\">)",
        value: input.password
    }), "string" === typeof input.website && (RegExp("^https?://.+").test(input.website) || _report(_exceptionable, {
        path: _path + ".website",
        expected: "string & Pattern<\"^https?://.+\">",
        value: input.website
    })) || _report(_exceptionable, {
        path: _path + ".website",
        expected: "(string & Pattern<\"^https?://.+\">)",
        value: input.website
    })].every((flag: boolean) => flag); const _co0 = (input: any): any => ({
    username: input.username,
    email: input.email,
    age: input.age,
    password: input.password,
    website: input.website
}); const __is = (input: any): input is TypiaRefineData => "object" === typeof input && null !== input && _io0(input); let errors: any; let _report: any; const __validate = (input: any): import("typia").IValidation<TypiaRefineData> => {
    if (false === __is(input)) {
        errors = [];
        _report = (__typia_transform__validateReport._validateReport as any)(errors);
        ((input: any, _path: string, _exceptionable: boolean = true) => ("object" === typeof input && null !== input || _report(true, {
            path: _path + "",
            expected: "TypiaRefineData",
            value: input
        })) && _vo0(input, _path + "", true) || _report(true, {
            path: _path + "",
            expected: "TypiaRefineData",
            value: input
        }))(input, "$input", true);
        const success = 0 === errors.length;
        return success ? {
            success,
            data: input
        } : {
            success,
            errors,
            data: input
        } as any;
    }
    return {
        success: true,
        data: input
    } as any;
}; const __clone = (input: TypiaRefineData): import("typia").Resolved<TypiaRefineData> => _co0(input) as any; return (input: any): import("typia").IValidation<import("typia").Resolved<TypiaRefineData>> => {
    const result = __validate(input) as any;
    if (result.success)
        result.data = __clone(input);
    return result;
}; })();
export const isDiscriminated = (() => { const _io0 = (input: any): boolean => "user" === input.type && ("string" === typeof input.name && 1 <= input.name.length) && ("string" === typeof input.email && 1 <= input.email.length); const _io1 = (input: any): boolean => "admin" === input.type && ("string" === typeof input.name && 1 <= input.name.length) && ("string" === typeof input.email && 1 <= input.email.length) && ("number" === typeof input.level && (1 <= input.level && input.level <= 10)); const _io2 = (input: any): boolean => "guest" === input.type && ("string" === typeof input.sessionId && 1 <= input.sessionId.length); const _iu0 = (input: any): any => (() => {
    if ("user" === input.type)
        return _io0(input);
    else if ("admin" === input.type)
        return _io1(input);
    else if ("guest" === input.type)
        return _io2(input);
    else
        return false;
})(); return (input: any): input is TypiaDiscriminatedData => "object" === typeof input && null !== input && _iu0(input); })();
export const validateDiscriminated = (() => { const _io0 = (input: any): boolean => "user" === input.type && ("string" === typeof input.name && 1 <= input.name.length) && ("string" === typeof input.email && 1 <= input.email.length); const _io1 = (input: any): boolean => "admin" === input.type && ("string" === typeof input.name && 1 <= input.name.length) && ("string" === typeof input.email && 1 <= input.email.length) && ("number" === typeof input.level && (1 <= input.level && input.level <= 10)); const _io2 = (input: any): boolean => "guest" === input.type && ("string" === typeof input.sessionId && 1 <= input.sessionId.length); const _iu0 = (input: any): any => (() => {
    if ("user" === input.type)
        return _io0(input);
    else if ("admin" === input.type)
        return _io1(input);
    else if ("guest" === input.type)
        return _io2(input);
    else
        return false;
})(); const _vo0 = (input: any, _path: string, _exceptionable: boolean = true): boolean => ["user" === input.type || _report(_exceptionable, {
        path: _path + ".type",
        expected: "\"user\"",
        value: input.type
    }), "string" === typeof input.name && (1 <= input.name.length || _report(_exceptionable, {
        path: _path + ".name",
        expected: "string & MinLength<1>",
        value: input.name
    })) || _report(_exceptionable, {
        path: _path + ".name",
        expected: "(string & MinLength<1>)",
        value: input.name
    }), "string" === typeof input.email && (1 <= input.email.length || _report(_exceptionable, {
        path: _path + ".email",
        expected: "string & MinLength<1>",
        value: input.email
    })) || _report(_exceptionable, {
        path: _path + ".email",
        expected: "(string & MinLength<1>)",
        value: input.email
    })].every((flag: boolean) => flag); const _vo1 = (input: any, _path: string, _exceptionable: boolean = true): boolean => ["admin" === input.type || _report(_exceptionable, {
        path: _path + ".type",
        expected: "\"admin\"",
        value: input.type
    }), "string" === typeof input.name && (1 <= input.name.length || _report(_exceptionable, {
        path: _path + ".name",
        expected: "string & MinLength<1>",
        value: input.name
    })) || _report(_exceptionable, {
        path: _path + ".name",
        expected: "(string & MinLength<1>)",
        value: input.name
    }), "string" === typeof input.email && (1 <= input.email.length || _report(_exceptionable, {
        path: _path + ".email",
        expected: "string & MinLength<1>",
        value: input.email
    })) || _report(_exceptionable, {
        path: _path + ".email",
        expected: "(string & MinLength<1>)",
        value: input.email
    }), "number" === typeof input.level && (1 <= input.level || _report(_exceptionable, {
        path: _path + ".level",
        expected: "number & Minimum<1>",
        value: input.level
    })) && (input.level <= 10 || _report(_exceptionable, {
        path: _path + ".level",
        expected: "number & Maximum<10>",
        value: input.level
    })) || _report(_exceptionable, {
        path: _path + ".level",
        expected: "(number & Minimum<1> & Maximum<10>)",
        value: input.level
    })].every((flag: boolean) => flag); const _vo2 = (input: any, _path: string, _exceptionable: boolean = true): boolean => ["guest" === input.type || _report(_exceptionable, {
        path: _path + ".type",
        expected: "\"guest\"",
        value: input.type
    }), "string" === typeof input.sessionId && (1 <= input.sessionId.length || _report(_exceptionable, {
        path: _path + ".sessionId",
        expected: "string & MinLength<1>",
        value: input.sessionId
    })) || _report(_exceptionable, {
        path: _path + ".sessionId",
        expected: "(string & MinLength<1>)",
        value: input.sessionId
    })].every((flag: boolean) => flag); const _vu0 = (input: any, _path: string, _exceptionable: boolean = true): any => (() => {
    if ("user" === input.type)
        return _vo0(input, _path, true && _exceptionable);
    else if ("admin" === input.type)
        return _vo1(input, _path, true && _exceptionable);
    else if ("guest" === input.type)
        return _vo2(input, _path, true && _exceptionable);
    else
        return _report(_exceptionable, {
            path: _path,
            expected: "(TypiaDiscriminatedUser | TypiaDiscriminatedAdmin | TypiaDiscriminatedGuest)",
            value: input
        });
})(); const _co0 = (input: any): any => ({
    type: input.type,
    name: input.name,
    email: input.email
}); const _co1 = (input: any): any => ({
    type: input.type,
    name: input.name,
    email: input.email,
    level: input.level
}); const _co2 = (input: any): any => ({
    type: input.type,
    sessionId: input.sessionId
}); const _cu0 = (input: any): any => (() => {
    if ("user" === input.type)
        return _co0(input);
    else if ("admin" === input.type)
        return _co1(input);
    else if ("guest" === input.type)
        return _co2(input);
    else
        __typia_transform__throwTypeGuardError._throwTypeGuardError({
            method: "typia.misc.createValidateClone",
            expected: "(TypiaDiscriminatedUser | TypiaDiscriminatedAdmin | TypiaDiscriminatedGuest)",
            value: input
        });
})(); const __is = (input: any): input is TypiaDiscriminatedData => "object" === typeof input && null !== input && _iu0(input); let errors: any; let _report: any; const __validate = (input: any): import("typia").IValidation<TypiaDiscriminatedData> => {
    if (false === __is(input)) {
        errors = [];
        _report = (__typia_transform__validateReport._validateReport as any)(errors);
        ((input: any, _path: string, _exceptionable: boolean = true) => ("object" === typeof input && null !== input || _report(true, {
            path: _path + "",
            expected: "(TypiaDiscriminatedAdmin | TypiaDiscriminatedGuest | TypiaDiscriminatedUser)",
            value: input
        })) && _vu0(input, _path + "", true) || _report(true, {
            path: _path + "",
            expected: "(TypiaDiscriminatedAdmin | TypiaDiscriminatedGuest | TypiaDiscriminatedUser)",
            value: input
        }))(input, "$input", true);
        const success = 0 === errors.length;
        return success ? {
            success,
            data: input
        } : {
            success,
            errors,
            data: input
        } as any;
    }
    return {
        success: true,
        data: input
    } as any;
}; const __clone = (input: TypiaDiscriminatedData): import("typia").Resolved<TypiaDiscriminatedData> => "object" === typeof input && null !== input ? _cu0(input) : input as any; return (input: any): import("typia").IValidation<import("typia").Resolved<TypiaDiscriminatedData>> => {
    const result = __validate(input) as any;
    if (result.success)
        result.data = __clone(input);
    return result;
}; })();
export const isRecursive = (() => { const _io0 = (input: any): boolean => "string" === typeof input.name && "number" === typeof input.value && (undefined === input.children || Array.isArray(input.children) && input.children.every((elem: any) => "object" === typeof elem && null !== elem && _io0(elem))); return (input: any): input is TypiaRecursiveData => "object" === typeof input && null !== input && _io0(input); })();
export const validateRecursive = (() => { const _cp0 = (input: any) => input.map((elem: any) => _co0(elem) as any); const _io0 = (input: any): boolean => "string" === typeof input.name && "number" === typeof input.value && (undefined === input.children || Array.isArray(input.children) && input.children.every((elem: any) => "object" === typeof elem && null !== elem && _io0(elem))); const _vo0 = (input: any, _path: string, _exceptionable: boolean = true): boolean => ["string" === typeof input.name || _report(_exceptionable, {
        path: _path + ".name",
        expected: "string",
        value: input.name
    }), "number" === typeof input.value || _report(_exceptionable, {
        path: _path + ".value",
        expected: "number",
        value: input.value
    }), undefined === input.children || (Array.isArray(input.children) || _report(_exceptionable, {
        path: _path + ".children",
        expected: "(Array<TypiaRecursiveData> | undefined)",
        value: input.children
    })) && input.children.map((elem: any, _index2: number) => ("object" === typeof elem && null !== elem || _report(_exceptionable, {
        path: _path + ".children[" + _index2 + "]",
        expected: "TypiaRecursiveData",
        value: elem
    })) && _vo0(elem, _path + ".children[" + _index2 + "]", true && _exceptionable) || _report(_exceptionable, {
        path: _path + ".children[" + _index2 + "]",
        expected: "TypiaRecursiveData",
        value: elem
    })).every((flag: boolean) => flag) || _report(_exceptionable, {
        path: _path + ".children",
        expected: "(Array<TypiaRecursiveData> | undefined)",
        value: input.children
    })].every((flag: boolean) => flag); const _co0 = (input: any): any => ({
    name: input.name,
    value: input.value,
    children: input.children ? _cp0(input.children) : input.children as any
}); const __is = (input: any): input is TypiaRecursiveData => "object" === typeof input && null !== input && _io0(input); let errors: any; let _report: any; const __validate = (input: any): import("typia").IValidation<TypiaRecursiveData> => {
    if (false === __is(input)) {
        errors = [];
        _report = (__typia_transform__validateReport._validateReport as any)(errors);
        ((input: any, _path: string, _exceptionable: boolean = true) => ("object" === typeof input && null !== input || _report(true, {
            path: _path + "",
            expected: "TypiaRecursiveData",
            value: input
        })) && _vo0(input, _path + "", true) || _report(true, {
            path: _path + "",
            expected: "TypiaRecursiveData",
            value: input
        }))(input, "$input", true);
        const success = 0 === errors.length;
        return success ? {
            success,
            data: input
        } : {
            success,
            errors,
            data: input
        } as any;
    }
    return {
        success: true,
        data: input
    } as any;
}; const __clone = (input: TypiaRecursiveData): import("typia").Resolved<TypiaRecursiveData> => _co0(input) as any; return (input: any): import("typia").IValidation<import("typia").Resolved<TypiaRecursiveData>> => {
    const result = __validate(input) as any;
    if (result.success)
        result.data = __clone(input);
    return result;
}; })();
export const isTuple = (() => { const _io0 = (input: any): boolean => Array.isArray(input.coords) && (input.coords.length === 3 && "number" === typeof input.coords[0] && "number" === typeof input.coords[1] && "number" === typeof input.coords[2]) && (Array.isArray(input.range) && (input.range.length === 2 && "number" === typeof input.range[0] && "number" === typeof input.range[1])) && (Array.isArray(input.mixed) && (input.mixed.length === 3 && "string" === typeof input.mixed[0] && "number" === typeof input.mixed[1] && "boolean" === typeof input.mixed[2])); return (input: any): input is TypiaTupleData => "object" === typeof input && null !== input && _io0(input); })();
export const validateTuple = (() => { const _io0 = (input: any): boolean => Array.isArray(input.coords) && (input.coords.length === 3 && "number" === typeof input.coords[0] && "number" === typeof input.coords[1] && "number" === typeof input.coords[2]) && (Array.isArray(input.range) && (input.range.length === 2 && "number" === typeof input.range[0] && "number" === typeof input.range[1])) && (Array.isArray(input.mixed) && (input.mixed.length === 3 && "string" === typeof input.mixed[0] && "number" === typeof input.mixed[1] && "boolean" === typeof input.mixed[2])); const _vo0 = (input: any, _path: string, _exceptionable: boolean = true): boolean => [(Array.isArray(input.coords) || _report(_exceptionable, {
        path: _path + ".coords",
        expected: "[number, number, number]",
        value: input.coords
    })) && ((input.coords.length === 3 || _report(_exceptionable, {
        path: _path + ".coords",
        expected: "[number, number, number]",
        value: input.coords
    })) && [
        "number" === typeof input.coords[0] || _report(_exceptionable, {
            path: _path + ".coords[0]",
            expected: "number",
            value: input.coords[0]
        }),
        "number" === typeof input.coords[1] || _report(_exceptionable, {
            path: _path + ".coords[1]",
            expected: "number",
            value: input.coords[1]
        }),
        "number" === typeof input.coords[2] || _report(_exceptionable, {
            path: _path + ".coords[2]",
            expected: "number",
            value: input.coords[2]
        })
    ].every((flag: boolean) => flag)) || _report(_exceptionable, {
        path: _path + ".coords",
        expected: "[number, number, number]",
        value: input.coords
    }), (Array.isArray(input.range) || _report(_exceptionable, {
        path: _path + ".range",
        expected: "[number, number]",
        value: input.range
    })) && ((input.range.length === 2 || _report(_exceptionable, {
        path: _path + ".range",
        expected: "[number, number]",
        value: input.range
    })) && [
        "number" === typeof input.range[0] || _report(_exceptionable, {
            path: _path + ".range[0]",
            expected: "number",
            value: input.range[0]
        }),
        "number" === typeof input.range[1] || _report(_exceptionable, {
            path: _path + ".range[1]",
            expected: "number",
            value: input.range[1]
        })
    ].every((flag: boolean) => flag)) || _report(_exceptionable, {
        path: _path + ".range",
        expected: "[number, number]",
        value: input.range
    }), (Array.isArray(input.mixed) || _report(_exceptionable, {
        path: _path + ".mixed",
        expected: "[string, number, boolean]",
        value: input.mixed
    })) && ((input.mixed.length === 3 || _report(_exceptionable, {
        path: _path + ".mixed",
        expected: "[string, number, boolean]",
        value: input.mixed
    })) && [
        "string" === typeof input.mixed[0] || _report(_exceptionable, {
            path: _path + ".mixed[0]",
            expected: "string",
            value: input.mixed[0]
        }),
        "number" === typeof input.mixed[1] || _report(_exceptionable, {
            path: _path + ".mixed[1]",
            expected: "number",
            value: input.mixed[1]
        }),
        "boolean" === typeof input.mixed[2] || _report(_exceptionable, {
            path: _path + ".mixed[2]",
            expected: "boolean",
            value: input.mixed[2]
        })
    ].every((flag: boolean) => flag)) || _report(_exceptionable, {
        path: _path + ".mixed",
        expected: "[string, number, boolean]",
        value: input.mixed
    })].every((flag: boolean) => flag); const _co0 = (input: any): any => ({
    coords: [
        input.coords[0],
        input.coords[1],
        input.coords[2]
    ] as any as any,
    range: [
        input.range[0],
        input.range[1]
    ] as any as any,
    mixed: [
        input.mixed[0],
        input.mixed[1],
        input.mixed[2]
    ] as any as any
}); const __is = (input: any): input is TypiaTupleData => "object" === typeof input && null !== input && _io0(input); let errors: any; let _report: any; const __validate = (input: any): import("typia").IValidation<TypiaTupleData> => {
    if (false === __is(input)) {
        errors = [];
        _report = (__typia_transform__validateReport._validateReport as any)(errors);
        ((input: any, _path: string, _exceptionable: boolean = true) => ("object" === typeof input && null !== input || _report(true, {
            path: _path + "",
            expected: "TypiaTupleData",
            value: input
        })) && _vo0(input, _path + "", true) || _report(true, {
            path: _path + "",
            expected: "TypiaTupleData",
            value: input
        }))(input, "$input", true);
        const success = 0 === errors.length;
        return success ? {
            success,
            data: input
        } : {
            success,
            errors,
            data: input
        } as any;
    }
    return {
        success: true,
        data: input
    } as any;
}; const __clone = (input: TypiaTupleData): import("typia").Resolved<TypiaTupleData> => _co0(input) as any; return (input: any): import("typia").IValidation<import("typia").Resolved<TypiaTupleData>> => {
    const result = __validate(input) as any;
    if (result.success)
        result.data = __clone(input);
    return result;
}; })();
export const isBigString = (() => { const _io0 = (input: any): boolean => "string" === typeof input.content && "string" === typeof input.description && "string" === typeof input.metadata; return (input: any): input is TypiaBigStringData => "object" === typeof input && null !== input && _io0(input); })();
export const validateBigString = (() => { const _io0 = (input: any): boolean => "string" === typeof input.content && "string" === typeof input.description && "string" === typeof input.metadata; const _vo0 = (input: any, _path: string, _exceptionable: boolean = true): boolean => ["string" === typeof input.content || _report(_exceptionable, {
        path: _path + ".content",
        expected: "string",
        value: input.content
    }), "string" === typeof input.description || _report(_exceptionable, {
        path: _path + ".description",
        expected: "string",
        value: input.description
    }), "string" === typeof input.metadata || _report(_exceptionable, {
        path: _path + ".metadata",
        expected: "string",
        value: input.metadata
    })].every((flag: boolean) => flag); const _co0 = (input: any): any => ({
    content: input.content,
    description: input.description,
    metadata: input.metadata
}); const __is = (input: any): input is TypiaBigStringData => "object" === typeof input && null !== input && _io0(input); let errors: any; let _report: any; const __validate = (input: any): import("typia").IValidation<TypiaBigStringData> => {
    if (false === __is(input)) {
        errors = [];
        _report = (__typia_transform__validateReport._validateReport as any)(errors);
        ((input: any, _path: string, _exceptionable: boolean = true) => ("object" === typeof input && null !== input || _report(true, {
            path: _path + "",
            expected: "TypiaBigStringData",
            value: input
        })) && _vo0(input, _path + "", true) || _report(true, {
            path: _path + "",
            expected: "TypiaBigStringData",
            value: input
        }))(input, "$input", true);
        const success = 0 === errors.length;
        return success ? {
            success,
            data: input
        } : {
            success,
            errors,
            data: input
        } as any;
    }
    return {
        success: true,
        data: input
    } as any;
}; const __clone = (input: TypiaBigStringData): import("typia").Resolved<TypiaBigStringData> => _co0(input) as any; return (input: any): import("typia").IValidation<import("typia").Resolved<TypiaBigStringData>> => {
    const result = __validate(input) as any;
    if (result.success)
        result.data = __clone(input);
    return result;
}; })();
export const isBigArray = (() => { const _io0 = (input: any): boolean => Array.isArray(input.items) && input.items.every((elem: any) => "object" === typeof elem && null !== elem && _io1(elem)); const _io1 = (input: any): boolean => "number" === typeof input.id && "string" === typeof input.name && "number" === typeof input.value; return (input: any): input is TypiaBigArrayData => "object" === typeof input && null !== input && _io0(input); })();
export const validateBigArray = (() => { const _cp0 = (input: any) => input.map((elem: any) => _co1(elem) as any); const _io0 = (input: any): boolean => Array.isArray(input.items) && input.items.every((elem: any) => "object" === typeof elem && null !== elem && _io1(elem)); const _io1 = (input: any): boolean => "number" === typeof input.id && "string" === typeof input.name && "number" === typeof input.value; const _vo0 = (input: any, _path: string, _exceptionable: boolean = true): boolean => [(Array.isArray(input.items) || _report(_exceptionable, {
        path: _path + ".items",
        expected: "Array<TypiaBigArrayItem>",
        value: input.items
    })) && input.items.map((elem: any, _index2: number) => ("object" === typeof elem && null !== elem || _report(_exceptionable, {
        path: _path + ".items[" + _index2 + "]",
        expected: "TypiaBigArrayItem",
        value: elem
    })) && _vo1(elem, _path + ".items[" + _index2 + "]", true && _exceptionable) || _report(_exceptionable, {
        path: _path + ".items[" + _index2 + "]",
        expected: "TypiaBigArrayItem",
        value: elem
    })).every((flag: boolean) => flag) || _report(_exceptionable, {
        path: _path + ".items",
        expected: "Array<TypiaBigArrayItem>",
        value: input.items
    })].every((flag: boolean) => flag); const _vo1 = (input: any, _path: string, _exceptionable: boolean = true): boolean => ["number" === typeof input.id || _report(_exceptionable, {
        path: _path + ".id",
        expected: "number",
        value: input.id
    }), "string" === typeof input.name || _report(_exceptionable, {
        path: _path + ".name",
        expected: "string",
        value: input.name
    }), "number" === typeof input.value || _report(_exceptionable, {
        path: _path + ".value",
        expected: "number",
        value: input.value
    })].every((flag: boolean) => flag); const _co0 = (input: any): any => ({
    items: _cp0(input.items) as any
}); const _co1 = (input: any): any => ({
    id: input.id,
    name: input.name,
    value: input.value
}); const __is = (input: any): input is TypiaBigArrayData => "object" === typeof input && null !== input && _io0(input); let errors: any; let _report: any; const __validate = (input: any): import("typia").IValidation<TypiaBigArrayData> => {
    if (false === __is(input)) {
        errors = [];
        _report = (__typia_transform__validateReport._validateReport as any)(errors);
        ((input: any, _path: string, _exceptionable: boolean = true) => ("object" === typeof input && null !== input || _report(true, {
            path: _path + "",
            expected: "TypiaBigArrayData",
            value: input
        })) && _vo0(input, _path + "", true) || _report(true, {
            path: _path + "",
            expected: "TypiaBigArrayData",
            value: input
        }))(input, "$input", true);
        const success = 0 === errors.length;
        return success ? {
            success,
            data: input
        } : {
            success,
            errors,
            data: input
        } as any;
    }
    return {
        success: true,
        data: input
    } as any;
}; const __clone = (input: TypiaBigArrayData): import("typia").Resolved<TypiaBigArrayData> => _co0(input) as any; return (input: any): import("typia").IValidation<import("typia").Resolved<TypiaBigArrayData>> => {
    const result = __validate(input) as any;
    if (result.success)
        result.data = __clone(input);
    return result;
}; })();
// ============ Optimized Stringify function exports ============
// These use typia's optimized JSON stringify which is faster than JSON.stringify
export const isStringifyNumber = (() => { const __is = (input: any): input is number => "number" === typeof input && Number.isFinite(input); const __stringify = (input: number): string => __typia_transform__jsonStringifyNumber._jsonStringifyNumber(input).toString(); return (input: any): string | null => __is(input) ? __stringify(input) : null; })();
export const isStringifySimple = (() => { const _io0 = (input: any): boolean => "string" === typeof input.name && (1 <= input.name.length && input.name.length <= 100) && ("number" === typeof input.age && (0 <= input.age && input.age <= 150)) && ("string" === typeof input.email && 1 <= input.email.length) && "boolean" === typeof input.active && (Array.isArray(input.tags) && input.tags.every((elem: any) => "string" === typeof elem)); const _so0 = (input: any): any => `{"name":${__typia_transform__jsonStringifyString._jsonStringifyString(input.name)},"age":${__typia_transform__jsonStringifyNumber._jsonStringifyNumber(input.age)},"email":${__typia_transform__jsonStringifyString._jsonStringifyString(input.email)},"active":${input.active},"tags":${`[${input.tags.map((elem: any) => __typia_transform__jsonStringifyString._jsonStringifyString(elem)).join(",")}]`}}`; const __is = (input: any): input is TypiaSimpleData => "object" === typeof input && null !== input && _io0(input); const __stringify = (input: TypiaSimpleData): string => _so0(input); return (input: any): string | null => __is(input) ? __stringify(input) : null; })();
export const isStringifyNested = (() => { const _io0 = (input: any): boolean => "number" === typeof input.id && Number.isFinite(input.id) && ("object" === typeof input.user && null !== input.user && _io1(input.user)) && ("object" === typeof input.metadata && null !== input.metadata && _io4(input.metadata)) && (Array.isArray(input.tags) && input.tags.every((elem: any) => "string" === typeof elem)); const _io1 = (input: any): boolean => "string" === typeof input.name && 1 <= input.name.length && ("string" === typeof input.email && 1 <= input.email.length) && ("object" === typeof input.profile && null !== input.profile && _io2(input.profile)); const _io2 = (input: any): boolean => "string" === typeof input.bio && "string" === typeof input.website && ("object" === typeof input.social && null !== input.social && _io3(input.social)); const _io3 = (input: any): boolean => "string" === typeof input.twitter && "string" === typeof input.github; const _io4 = (input: any): boolean => "number" === typeof input.createdAt && Number.isFinite(input.createdAt) && ("number" === typeof input.updatedAt && Number.isFinite(input.updatedAt)) && ("number" === typeof input.version && Number.isFinite(input.version)); const _so0 = (input: any): any => `{"id":${__typia_transform__jsonStringifyNumber._jsonStringifyNumber(input.id)},"user":${_so1(input.user)},"metadata":${_so4(input.metadata)},"tags":${`[${input.tags.map((elem: any) => __typia_transform__jsonStringifyString._jsonStringifyString(elem)).join(",")}]`}}`; const _so1 = (input: any): any => `{"name":${__typia_transform__jsonStringifyString._jsonStringifyString(input.name)},"email":${__typia_transform__jsonStringifyString._jsonStringifyString(input.email)},"profile":${_so2(input.profile)}}`; const _so2 = (input: any): any => `{"bio":${__typia_transform__jsonStringifyString._jsonStringifyString(input.bio)},"website":${__typia_transform__jsonStringifyString._jsonStringifyString(input.website)},"social":${_so3(input.social)}}`; const _so3 = (input: any): any => `{"twitter":${__typia_transform__jsonStringifyString._jsonStringifyString(input.twitter)},"github":${__typia_transform__jsonStringifyString._jsonStringifyString(input.github)}}`; const _so4 = (input: any): any => `{"createdAt":${__typia_transform__jsonStringifyNumber._jsonStringifyNumber(input.createdAt)},"updatedAt":${__typia_transform__jsonStringifyNumber._jsonStringifyNumber(input.updatedAt)},"version":${__typia_transform__jsonStringifyNumber._jsonStringifyNumber(input.version)}}`; const __is = (input: any): input is TypiaNestedData => "object" === typeof input && null !== input && _io0(input); const __stringify = (input: TypiaNestedData): string => _so0(input); return (input: any): string | null => __is(input) ? __stringify(input) : null; })();
export const isStringifyRefine = (() => { const _io0 = (input: any): boolean => "string" === typeof input.username && (3 <= input.username.length && input.username.length <= 20 && RegExp("^[a-zA-Z0-9]+$").test(input.username)) && ("string" === typeof input.email && RegExp("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$").test(input.email)) && ("number" === typeof input.age && (18 <= input.age && input.age <= 150)) && ("string" === typeof input.password && RegExp("^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[!@#$%^&*]).{8,}$").test(input.password)) && ("string" === typeof input.website && RegExp("^https?://.+").test(input.website)); const _so0 = (input: any): any => `{"username":${__typia_transform__jsonStringifyString._jsonStringifyString(input.username)},"email":${__typia_transform__jsonStringifyString._jsonStringifyString(input.email)},"age":${__typia_transform__jsonStringifyNumber._jsonStringifyNumber(input.age)},"password":${__typia_transform__jsonStringifyString._jsonStringifyString(input.password)},"website":${__typia_transform__jsonStringifyString._jsonStringifyString(input.website)}}`; const __is = (input: any): input is TypiaRefineData => "object" === typeof input && null !== input && _io0(input); const __stringify = (input: TypiaRefineData): string => _so0(input); return (input: any): string | null => __is(input) ? __stringify(input) : null; })();
export const isStringifyDiscriminated = (() => { const _io0 = (input: any): boolean => "user" === input.type && ("string" === typeof input.name && 1 <= input.name.length) && ("string" === typeof input.email && 1 <= input.email.length); const _io1 = (input: any): boolean => "admin" === input.type && ("string" === typeof input.name && 1 <= input.name.length) && ("string" === typeof input.email && 1 <= input.email.length) && ("number" === typeof input.level && (1 <= input.level && input.level <= 10)); const _io2 = (input: any): boolean => "guest" === input.type && ("string" === typeof input.sessionId && 1 <= input.sessionId.length); const _iu0 = (input: any): any => (() => {
    if ("user" === input.type)
        return _io0(input);
    else if ("admin" === input.type)
        return _io1(input);
    else if ("guest" === input.type)
        return _io2(input);
    else
        return false;
})(); const _so0 = (input: any): any => `{"type":${"\"" + input.type + "\""},"name":${__typia_transform__jsonStringifyString._jsonStringifyString(input.name)},"email":${__typia_transform__jsonStringifyString._jsonStringifyString(input.email)}}`; const _so1 = (input: any): any => `{"type":${"\"" + input.type + "\""},"name":${__typia_transform__jsonStringifyString._jsonStringifyString(input.name)},"email":${__typia_transform__jsonStringifyString._jsonStringifyString(input.email)},"level":${__typia_transform__jsonStringifyNumber._jsonStringifyNumber(input.level)}}`; const _so2 = (input: any): any => `{"type":${"\"" + input.type + "\""},"sessionId":${__typia_transform__jsonStringifyString._jsonStringifyString(input.sessionId)}}`; const _su0 = (input: any): any => (() => {
    if ("user" === input.type)
        return _so0(input);
    else if ("admin" === input.type)
        return _so1(input);
    else if ("guest" === input.type)
        return _so2(input);
    else
        __typia_transform__throwTypeGuardError._throwTypeGuardError({
            method: "typia.json.createIsStringify",
            expected: "(TypiaDiscriminatedUser | TypiaDiscriminatedAdmin | TypiaDiscriminatedGuest)",
            value: input
        });
})(); const __is = (input: any): input is TypiaDiscriminatedData => "object" === typeof input && null !== input && _iu0(input); const __stringify = (input: TypiaDiscriminatedData): string => _su0(input); return (input: any): string | null => __is(input) ? __stringify(input) : null; })();
export const isStringifyRecursive = (() => { const _io0 = (input: any): boolean => "string" === typeof input.name && ("number" === typeof input.value && Number.isFinite(input.value)) && (undefined === input.children || Array.isArray(input.children) && input.children.every((elem: any) => "object" === typeof elem && null !== elem && _io0(elem))); const _so0 = (input: any): any => `{${undefined === input.children ? "" : `"children":${undefined !== input.children ? `[${input.children.map((elem: any) => _so0(elem)).join(",")}]` : undefined},`}"name":${__typia_transform__jsonStringifyString._jsonStringifyString(input.name)},"value":${__typia_transform__jsonStringifyNumber._jsonStringifyNumber(input.value)}}`; const __is = (input: any): input is TypiaRecursiveData => "object" === typeof input && null !== input && _io0(input); const __stringify = (input: TypiaRecursiveData): string => _so0(input); return (input: any): string | null => __is(input) ? __stringify(input) : null; })();
export const isStringifyTuple = (() => { const _io0 = (input: any): boolean => Array.isArray(input.coords) && (input.coords.length === 3 && ("number" === typeof input.coords[0] && Number.isFinite(input.coords[0])) && ("number" === typeof input.coords[1] && Number.isFinite(input.coords[1])) && ("number" === typeof input.coords[2] && Number.isFinite(input.coords[2]))) && (Array.isArray(input.range) && (input.range.length === 2 && ("number" === typeof input.range[0] && Number.isFinite(input.range[0])) && ("number" === typeof input.range[1] && Number.isFinite(input.range[1])))) && (Array.isArray(input.mixed) && (input.mixed.length === 3 && "string" === typeof input.mixed[0] && ("number" === typeof input.mixed[1] && Number.isFinite(input.mixed[1])) && "boolean" === typeof input.mixed[2])); const _so0 = (input: any): any => `{"coords":${`[${__typia_transform__jsonStringifyNumber._jsonStringifyNumber(input.coords[0])},${__typia_transform__jsonStringifyNumber._jsonStringifyNumber(input.coords[1])},${__typia_transform__jsonStringifyNumber._jsonStringifyNumber(input.coords[2])}]`},"range":${`[${__typia_transform__jsonStringifyNumber._jsonStringifyNumber(input.range[0])},${__typia_transform__jsonStringifyNumber._jsonStringifyNumber(input.range[1])}]`},"mixed":${`[${__typia_transform__jsonStringifyString._jsonStringifyString(input.mixed[0])},${__typia_transform__jsonStringifyNumber._jsonStringifyNumber(input.mixed[1])},${input.mixed[2]}]`}}`; const __is = (input: any): input is TypiaTupleData => "object" === typeof input && null !== input && _io0(input); const __stringify = (input: TypiaTupleData): string => _so0(input); return (input: any): string | null => __is(input) ? __stringify(input) : null; })();
export const isStringifyBigString = (() => { const _io0 = (input: any): boolean => "string" === typeof input.content && "string" === typeof input.description && "string" === typeof input.metadata; const _so0 = (input: any): any => `{"content":${__typia_transform__jsonStringifyString._jsonStringifyString(input.content)},"description":${__typia_transform__jsonStringifyString._jsonStringifyString(input.description)},"metadata":${__typia_transform__jsonStringifyString._jsonStringifyString(input.metadata)}}`; const __is = (input: any): input is TypiaBigStringData => "object" === typeof input && null !== input && _io0(input); const __stringify = (input: TypiaBigStringData): string => _so0(input); return (input: any): string | null => __is(input) ? __stringify(input) : null; })();
export const isStringifyBigArray = (() => { const _io0 = (input: any): boolean => Array.isArray(input.items) && input.items.every((elem: any) => "object" === typeof elem && null !== elem && _io1(elem)); const _io1 = (input: any): boolean => "number" === typeof input.id && Number.isFinite(input.id) && "string" === typeof input.name && ("number" === typeof input.value && Number.isFinite(input.value)); const _so0 = (input: any): any => `{"items":${`[${input.items.map((elem: any) => _so1(elem)).join(",")}]`}}`; const _so1 = (input: any): any => `{"id":${__typia_transform__jsonStringifyNumber._jsonStringifyNumber(input.id)},"name":${__typia_transform__jsonStringifyString._jsonStringifyString(input.name)},"value":${__typia_transform__jsonStringifyNumber._jsonStringifyNumber(input.value)}}`; const __is = (input: any): input is TypiaBigArrayData => "object" === typeof input && null !== input && _io0(input); const __stringify = (input: TypiaBigArrayData): string => _so0(input); return (input: any): string | null => __is(input) ? __stringify(input) : null; })();
