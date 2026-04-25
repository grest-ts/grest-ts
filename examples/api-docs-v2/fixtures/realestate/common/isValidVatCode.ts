const countryVatPatterns: { [key: string]: RegExp } = {
    'EE': /^EE\d{9}$/,
    'FI': /^FI\d{8}$/,
    'LV': /^LV\d{11}$/,
    'LT': /^LT(\d{9}|\d{12})$/,
    'SW': /^SE\d{12}01$/,
    'RU': /^RU(\d{10}|\d{12})$/,
    'UA': /^UA\d{8}$/,
    'DE': /^DE[0-9]{9}$/,
    'FR': /^FR[A-Z0-9]{2}[0-9]{9}$/,
    'GB': /^GB[0-9]{9}$/,
};

export function isValidVatCode(vatNo: string | undefined, country: string | undefined): boolean {
    if (!vatNo) return true;
    if (!country) return true;
    country = country.toUpperCase();
    const pattern = countryVatPatterns[country];
    if (pattern) return pattern.test(vatNo);
    return /^[0-9a-zA-Z]{6,16}$/.test(vatNo);
}

