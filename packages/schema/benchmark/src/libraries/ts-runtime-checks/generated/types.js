// ============ Validation Functions ============
// These use ts-runtime-checks' is<T> and Assert<T> markers
// Will be transformed at compile time to actual validation code
// Type guards (is functions)
export const isNumber = (v) => {
    return typeof v === "number";
};
export const isSimple = (v) => {
    return (() => {
        if (typeof v !== "object" || v === null)
            return false;
        const { tags: tags_1 } = v;
        if (v.active !== false && v.active !== true || (typeof v.email !== "string" || v.email.length < 1) || (typeof v.name !== "string" || v.name.length < 1 || v.name.length > 100) || (typeof v.age !== "number" || v.age < 0 || v.age > 150) || !Array.isArray(tags_1))
            return false;
        for (let i_1 = 0; i_1 < tags_1.length; i_1++) {
            if (typeof tags_1[i_1] !== "string")
                return false;
        }
        return true;
    })();
};
export const isNested = (v) => {
    return (() => {
        if (typeof v !== "object" || v === null)
            return false;
        const { metadata: metadata_1, tags: tags_2, user: user_1 } = v;
        const { profile: profile_1 } = user_1;
        const { social: social_1 } = profile_1;
        if (typeof v.id !== "number" || (typeof metadata_1 !== "object" || metadata_1 === null || typeof metadata_1.createdAt !== "number" || typeof metadata_1.updatedAt !== "number" || typeof metadata_1.version !== "number") || !Array.isArray(tags_2) || (typeof user_1 !== "object" || user_1 === null) || (typeof user_1.name !== "string" || user_1.name.length < 1 || (typeof user_1.email !== "string" || user_1.email.length < 1) || (typeof profile_1 !== "object" || profile_1 === null) || (typeof profile_1.bio !== "string" || typeof profile_1.website !== "string" || (typeof social_1 !== "object" || social_1 === null || typeof social_1.twitter !== "string" || typeof social_1.github !== "string"))))
            return false;
        for (let i_2 = 0; i_2 < tags_2.length; i_2++) {
            if (typeof tags_2[i_2] !== "string")
                return false;
        }
        return true;
    })();
};
export const isRefine = (v) => {
    return typeof v === "object" && v !== null && (typeof v.email === "string" && /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+[.][a-zA-Z]{2,}$/.test(v.email)) && (typeof v.website === "string" && /^https?:/.test(v.website)) && (typeof v.age === "number" && v.age >= 18 && v.age <= 150) && (typeof v.password === "string" && v.password.length >= 8 && /[a-z]/.test(v.password)) && (typeof v.username === "string" && v.username.length >= 3 && v.username.length <= 20 && /^[a-zA-Z0-9]+$/.test(v.username));
};
export const isDiscriminated = (v) => {
    return (() => {
        return typeof v === "object" && v !== null;
    })();
};
export const isRecursive = (v) => {
    function v_1(param_1) { if (typeof param_1 !== "object" || param_1 === null)
        return false; const { children: children_1 } = param_1; if (children_1 !== undefined) {
        if (!Array.isArray(children_1))
            return false;
        for (let i_3 = 0; i_3 < children_1.length; i_3++) {
            if (!v_1(children_1[i_3]))
                return false;
        }
        ;
    } if (typeof param_1.name !== "string" || typeof param_1.value !== "number")
        return false; return true; }
    return v_1(v);
};
export const isTuple = (v) => {
    return (() => {
        if (typeof v !== "object" || v === null)
            return false;
        const { range: range_1, mixed: mixed_1, coords: coords_1 } = v;
        return Array.isArray(range_1) && typeof range_1[0] === "number" && typeof range_1[1] === "number" && (Array.isArray(mixed_1) && (mixed_1[2] === false || mixed_1[2] === true) && typeof mixed_1[0] === "string" && typeof mixed_1[1] === "number") && (Array.isArray(coords_1) && typeof coords_1[0] === "number" && typeof coords_1[1] === "number" && typeof coords_1[2] === "number");
    })();
};
export const isBigString = (v) => {
    return typeof v === "object" && v !== null && typeof v.content === "string" && typeof v.description === "string" && typeof v.metadata === "string";
};
export const isBigArray = (v) => {
    return (() => {
        if (typeof v !== "object" || v === null)
            return false;
        const { items: items_1 } = v;
        if (!Array.isArray(items_1))
            return false;
        for (let i_4 = 0; i_4 < items_1.length; i_4++) {
            if (typeof items_1[i_4] !== "object" || items_1[i_4] === null || typeof items_1[i_4].id !== "number" || typeof items_1[i_4].name !== "string" || typeof items_1[i_4].value !== "number")
                return false;
        }
        return true;
    })();
};
// Parse functions with ExactProps (strips extra properties)
// Using Assert with ExactProps to validate and clean in one step
export function parseNumber(v) {
    return typeof v === "number" ? v : undefined;
}
export function parseSimple(v) {
    if (!(() => {
        if (typeof v !== "object" || v === null)
            return false;
        const { tags: tags_3 } = v;
        if (v.active !== false && v.active !== true || (typeof v.email !== "string" || v.email.length < 1) || (typeof v.name !== "string" || v.name.length < 1 || v.name.length > 100) || (typeof v.age !== "number" || v.age < 0 || v.age > 150) || !Array.isArray(tags_3))
            return false;
        for (let i_5 = 0; i_5 < tags_3.length; i_5++) {
            if (typeof tags_3[i_5] !== "string")
                return false;
        }
        return true;
    })())
        return undefined;
    // Return a new clean object with only defined props
    return {
        name: v.name,
        age: v.age,
        email: v.email,
        active: v.active,
        tags: [...v.tags]
    };
}
export function parseNested(v) {
    if (!(() => {
        if (typeof v !== "object" || v === null)
            return false;
        const { metadata: metadata_2, tags: tags_4, user: user_2 } = v;
        const { profile: profile_2 } = user_2;
        const { social: social_2 } = profile_2;
        if (typeof v.id !== "number" || (typeof metadata_2 !== "object" || metadata_2 === null || typeof metadata_2.createdAt !== "number" || typeof metadata_2.updatedAt !== "number" || typeof metadata_2.version !== "number") || !Array.isArray(tags_4) || (typeof user_2 !== "object" || user_2 === null) || (typeof user_2.name !== "string" || user_2.name.length < 1 || (typeof user_2.email !== "string" || user_2.email.length < 1) || (typeof profile_2 !== "object" || profile_2 === null) || (typeof profile_2.bio !== "string" || typeof profile_2.website !== "string" || (typeof social_2 !== "object" || social_2 === null || typeof social_2.twitter !== "string" || typeof social_2.github !== "string"))))
            return false;
        for (let i_6 = 0; i_6 < tags_4.length; i_6++) {
            if (typeof tags_4[i_6] !== "string")
                return false;
        }
        return true;
    })())
        return undefined;
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
export function parseRefine(v) {
    if (!(typeof v === "object" && v !== null && (typeof v.email === "string" && /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+[.][a-zA-Z]{2,}$/.test(v.email)) && (typeof v.website === "string" && /^https?:/.test(v.website)) && (typeof v.age === "number" && v.age >= 18 && v.age <= 150) && (typeof v.password === "string" && v.password.length >= 8 && /[a-z]/.test(v.password)) && (typeof v.username === "string" && v.username.length >= 3 && v.username.length <= 20 && /^[a-zA-Z0-9]+$/.test(v.username))))
        return undefined;
    return {
        username: v.username,
        email: v.email,
        age: v.age,
        password: v.password,
        website: v.website
    };
}
export function parseDiscriminated(v) {
    if (!(() => {
        return typeof v === "object" && v !== null;
    })())
        return undefined;
    if (v.type === 'user') {
        return { type: 'user', name: v.name, email: v.email };
    }
    else if (v.type === 'admin') {
        return { type: 'admin', name: v.name, email: v.email, level: v.level };
    }
    else {
        return { type: 'guest', sessionId: v.sessionId };
    }
}
function cloneRecursive(v) {
    return {
        name: v.name,
        value: v.value,
        children: v.children ? v.children.map(cloneRecursive) : undefined
    };
}
export function parseRecursive(v) {
    function v_2(param_2) { if (typeof param_2 !== "object" || param_2 === null)
        return false; const { children: children_2 } = param_2; if (children_2 !== undefined) {
        if (!Array.isArray(children_2))
            return false;
        for (let i_7 = 0; i_7 < children_2.length; i_7++) {
            if (!v_2(children_2[i_7]))
                return false;
        }
        ;
    } if (typeof param_2.name !== "string" || typeof param_2.value !== "number")
        return false; return true; }
    if (!v_2(v))
        return undefined;
    return cloneRecursive(v);
}
export function parseTuple(v) {
    if (!(() => {
        if (typeof v !== "object" || v === null)
            return false;
        const { range: range_2, mixed: mixed_2, coords: coords_2 } = v;
        return Array.isArray(range_2) && typeof range_2[0] === "number" && typeof range_2[1] === "number" && (Array.isArray(mixed_2) && (mixed_2[2] === false || mixed_2[2] === true) && typeof mixed_2[0] === "string" && typeof mixed_2[1] === "number") && (Array.isArray(coords_2) && typeof coords_2[0] === "number" && typeof coords_2[1] === "number" && typeof coords_2[2] === "number");
    })())
        return undefined;
    return {
        coords: [v.coords[0], v.coords[1], v.coords[2]],
        range: [v.range[0], v.range[1]],
        mixed: [v.mixed[0], v.mixed[1], v.mixed[2]]
    };
}
export function parseBigString(v) {
    if (!(typeof v === "object" && v !== null && typeof v.content === "string" && typeof v.description === "string" && typeof v.metadata === "string"))
        return undefined;
    return {
        content: v.content,
        description: v.description,
        metadata: v.metadata
    };
}
export function parseBigArray(v) {
    if (!(() => {
        if (typeof v !== "object" || v === null)
            return false;
        const { items: items_2 } = v;
        if (!Array.isArray(items_2))
            return false;
        for (let i_8 = 0; i_8 < items_2.length; i_8++) {
            if (typeof items_2[i_8] !== "object" || items_2[i_8] === null || typeof items_2[i_8].id !== "number" || typeof items_2[i_8].name !== "string" || typeof items_2[i_8].value !== "number")
                return false;
        }
        return true;
    })())
        return undefined;
    return {
        items: v.items.map((item) => {
            return ({
                id: item.id,
                name: item.name,
                value: item.value
            });
        })
    };
}
// Stringify functions (validate + JSON.stringify)
export function stringifyNumber(v) {
    return typeof v === "number" ? JSON.stringify(v) : null;
}
export function stringifySimple(v) {
    const parsed = parseSimple(v);
    return parsed ? JSON.stringify(parsed) : null;
}
export function stringifyNested(v) {
    const parsed = parseNested(v);
    return parsed ? JSON.stringify(parsed) : null;
}
export function stringifyRefine(v) {
    const parsed = parseRefine(v);
    return parsed ? JSON.stringify(parsed) : null;
}
export function stringifyDiscriminated(v) {
    const parsed = parseDiscriminated(v);
    return parsed ? JSON.stringify(parsed) : null;
}
export function stringifyRecursive(v) {
    const parsed = parseRecursive(v);
    return parsed ? JSON.stringify(parsed) : null;
}
export function stringifyTuple(v) {
    const parsed = parseTuple(v);
    return parsed ? JSON.stringify(parsed) : null;
}
export function stringifyBigString(v) {
    const parsed = parseBigString(v);
    return parsed ? JSON.stringify(parsed) : null;
}
export function stringifyBigArray(v) {
    const parsed = parseBigArray(v);
    return parsed ? JSON.stringify(parsed) : null;
}
