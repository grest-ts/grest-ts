export const isValidIdentifier = (key: string): boolean =>
    /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key);

export const propAccess = (v: string, key: string): string =>
    isValidIdentifier(key) ? `${v}.${key}` : `${v}[${JSON.stringify(key)}]`;
