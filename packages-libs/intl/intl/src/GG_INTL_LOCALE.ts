import {GGContextKey} from "@grest-ts/context";
import type {GGInbound, GGOutbound, GGTransportMiddleware} from "@grest-ts/context";
import {IsCountry, IsLanguage, IsObject, IsString, tCountry, tLanguage} from "@grest-ts/schema";
import {IsLocale} from "@grest-ts/schema";

const IsGGIntlLocaleContext = IsObject({
    /** Full locale tag (e.g., "en-US", "en", "zh-Hans-CN") */
    locale: IsLocale.orUndefined,
    /** Language code convenience field (e.g., "en", "zh") */
    language: IsLanguage.orUndefined,
    /** Country/region code convenience field (e.g., "US", "CN") */
    country: IsCountry.orUndefined
});
export type GGIntlLocaleContext = typeof IsGGIntlLocaleContext.infer;

const HEADER_ACCEPT_LANGUAGE = "accept-language";
const HeaderType = IsObject({
    [HEADER_ACCEPT_LANGUAGE]: IsString.orUndefined
});

export const GG_INTL_LOCALE = new GGContextKey<GGIntlLocaleContext>("GG_INTL_LOCALE", IsGGIntlLocaleContext, {
    description: 'Current locale for internationalization'
});

const localeCodec = HeaderType.codecTo(IsGGIntlLocaleContext, {
    encode: (value) => {
        const headerValue = value[HEADER_ACCEPT_LANGUAGE];
        if (!headerValue || headerValue === '*' || headerValue.trim() === '') {
            return {locale: undefined, language: undefined, country: undefined};
        }

        // Accept-Language can have multiple values with quality: "en-US, en;q=0.9, de;q=0.8"
        // Take the first (highest priority) one
        const firstLocale = headerValue.split(',')[0].split(';')[0].trim();

        if (!firstLocale || firstLocale === '*') {
            return {locale: undefined, language: undefined, country: undefined};
        }

        const {language, country} = parseLocale(firstLocale);

        return {
            locale: firstLocale,
            language,
            country
        };
    },
    decode: (value) => {
        // When encoding back to header, prefer locale, fall back to language
        return {[HEADER_ACCEPT_LANGUAGE]: value.locale ?? value.language};
    }
});

/**
 * Wire binding for GG_INTL_LOCALE: reads the standard Accept-Language request header into
 * the locale key (server) and writes it back from the key (client). The Accept-Language
 * value is parsed into {locale, language, country}; a browser sends it automatically.
 * Bind with httpSchema(...).use(intlLocaleHeader()).
 */
export function intlLocaleHeader(): GGTransportMiddleware {
    return {
        headers: {[HEADER_ACCEPT_LANGUAGE]: IsString.orUndefined},
        responseHeaders: {},
        parse(inbound: GGInbound): void {
            const result = localeCodec.encode(inbound.headers as Record<string, string>);
            if (result.success) GG_INTL_LOCALE.set(result.value);
        },
        update(outbound: GGOutbound): void {
            const value = GG_INTL_LOCALE.get();
            if (value === undefined) return;
            const result = localeCodec.decode(value);
            if (result.success) Object.assign(outbound.headers, result.value);
        },
    };
}

/**
 * Parses a locale string (e.g., "en-US", "zh-Hans-CN") into components
 */
function parseLocale(locale: string): { language?: tLanguage; country?: tCountry } {
    const parts = locale.split('-');
    const language = parts[0]?.toLowerCase() as tLanguage | undefined;

    // Country is typically 2 uppercase letters, can be 2nd or 3rd part
    // e.g., "en-US" -> US is at index 1, "zh-Hans-CN" -> CN is at index 2
    let country: tCountry | undefined;
    for (let i = 1; i < parts.length; i++) {
        if (parts[i].length === 2 && /^[A-Z]{2}$/.test(parts[i])) {
            country = parts[i] as tCountry;
            break;
        }
    }

    return {language, country};
}
