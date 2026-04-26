const countryPersonIdCodePatterns: { [key: string]: RegExp } = {
    'EE': /^\d{11}$/,
    'FI': /^\d{6}[+-A]\d{3}[0-9A-Z]$/,
    'LV': /^\d{6}-\d{5}$/,
    'LT': /^\d{11}$/,
    'SW': /^(\d{8}-\d{4}|\d{12})$/,
    'RU': /^\d{12}$/,
    'UA': /^\d{10}$/
}

export function isValidPersonCode(code: string, country: string | undefined): boolean {
    return code.split(",").map(c => c.trim()).every(c => isValidSinglePersonCode(c, country));
}

function isValidSinglePersonCode(code: string, country: string | undefined): boolean {
    if (!country) return true;
    country = country.toUpperCase();
    const pattern = countryPersonIdCodePatterns[country];
    if (pattern) {
        if (!pattern.test(code)) return false;
        if (country === "EE") return isValidEstonianPersonIdCode(code);
        return true;
    }
    return /^[0-9a-zA-Z]{6,16}$/.test(code);
}

function isValidEstonianPersonIdCode(a: string): boolean {
    const nin = String(a).split('').map(Number)
    if (nin.length !== 11) return false

    const c = (x => [null, '18', '18', '19', '19', '20', '20'][x])(nin[0])
    if (!c) return false

    const date = c + nin[1] + nin[2] + '-' + nin[3] + nin[4] + '-' + nin[5] + nin[6]
    if (isNaN(Date.parse(date))) return false

    const mod = (nin: number[], weights: number[]) => nin.slice(0, 10).reduce((sum, num, i) => {
        return num * weights[i] + sum
    }, 0) % 11
    return nin[10] === [mod(nin, [1, 2, 3, 4, 5, 6, 7, 8, 9, 1]), mod(nin, [3, 4, 5, 6, 7, 8, 9, 1, 2, 3]), 0].find(modulus => modulus !== 10)
}