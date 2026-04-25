const countryCompanyCodePatterns: { [key: string]: RegExp } = {
    'EE': /^\d{8}$/,
    'FI': /^\d{7}-\d$/,
    'LV': /^\d{11}$/,
    'LT': /^\d{9}$/,
    'SW': /^(\d{6}|\d{8})-\d{4}$/,
    'RU': /^\d{10}|\d{12}$/,
    'UA': /^\d{8}|\d{10}$/
};

export function isValidCompanyCode(code: string, country: string | undefined): boolean {
    if (!country) return true;
    country = country.toUpperCase();
    const pattern = countryCompanyCodePatterns[country];
    if (pattern) return pattern.test(code);
    return /^[0-9a-zA-Z]{6,16}$/.test(code);
}