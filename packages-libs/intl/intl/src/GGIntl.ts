import i18next, {i18n, InitOptions} from 'i18next';
import ICU from 'i18next-icu';
import {GGContextStore} from "@grest-ts/context";
import {GG_INTL_LOCALE} from "./GG_INTL_LOCALE";
import {_registerGGIntl} from "./GG_INTL";

export interface GGIntlOptions extends Omit<InitOptions, 'fallbackLng' | 'interpolation'> {
    systemLocale?: string;
}

export class GGIntl {
    private instance!: i18n;
    private readonly systemLocale: string;
    private readonly options: GGIntlOptions;

    // Translations added during compose() before start()
    private pendingTranslations: Array<{lang: string, namespace: string, translations: Record<string, string>}> = [];

    constructor(options: GGIntlOptions = {}) {
        this.options = options;
        this.systemLocale = options.systemLocale ?? 'en';

        _registerGGIntl(this, {
            start: () => this.start(),
            teardown: () => this.teardown()
        });
    }

    /**
     * Initialize i18next. Called by GGRuntime during start phase,
     * or manually in tests.
     */
    public async start(): Promise<void> {
        const {systemLocale, ...i18nextOptions} = this.options;

        this.instance = i18next.createInstance();

        await this.instance
            .use(ICU)
            .init({
                fallbackLng: this.systemLocale,
                lng: this.systemLocale,
                interpolation: {
                    escapeValue: false
                },
                ...i18nextOptions
            });

        // Apply translations added during compose()
        for (const {lang, namespace, translations} of this.pendingTranslations) {
            this.instance.addResourceBundle(lang, namespace, translations, true, true);
        }
        this.pendingTranslations = [];
    }

    /**
     * Called by GGRuntime during teardown phase.
     */
    private async teardown(): Promise<void> {
        // Nothing to clean up
    }

    /**
     * Get the current locale from context.
     * Prefers locale, falls back to language, then systemLocale.
     */
    public getLocale(): string {
        const ctx = GGContextStore.tryGetContext()?.get(GG_INTL_LOCALE);
        if (ctx?.locale && typeof ctx.locale === 'string') {
            return ctx.locale;
        }
        if (ctx?.language && typeof ctx.language === 'string') {
            return ctx.language;
        }
        return this.systemLocale;
    }

    /**
     * Get the system locale (used for logs, internal messages).
     */
    public getSystemLocale(): string {
        return this.systemLocale;
    }

    /**
     * Translate using context language.
     */
    public t(key: string, params?: object, defaultValue?: string): string {
        return this.instance.t(key, {lng: this.getLocale(), defaultValue, ...params});
    }

    /**
     * Translate and return info about which language was used.
     */
    public tWithInfo(key: string, params?: object, defaultValue?: string): { message: string; usedLanguage: string } {
        const requestedLang = this.getLocale();
        const hasInRequested = this.instance.hasResourceBundle(requestedLang, 'translation') &&
            this.instance.getResourceBundle(requestedLang, 'translation')?.[key] !== undefined;
        const usedLanguage = hasInRequested ? requestedLang : this.systemLocale;
        const message = this.instance.t(key, {lng: requestedLang, defaultValue, ...params});
        return {message, usedLanguage};
    }

    /**
     * Translate using system language (for logs, debugging).
     */
    public system(key: string, params?: object): string {
        return this.instance.t(key, {lng: this.systemLocale, ...params});
    }

    /**
     * Translate with a specific locale.
     */
    public format(locale: string, key: string, params?: object): string {
        return this.instance.t(key, {lng: locale, ...params});
    }

    /**
     * Add translations for a language.
     * Can be called during compose() or after start().
     */
    public addTranslations(lang: string, namespace: string, translations: Record<string, string>): void {
        if (this.instance) {
            this.instance.addResourceBundle(lang, namespace, translations, true, true);
        } else {
            this.pendingTranslations.push({lang, namespace, translations});
        }
    }

    /**
     * Add translations to the default namespace.
     */
    public addMessages(lang: string, translations: Record<string, string>): void {
        this.addTranslations(lang, 'translation', translations);
    }

    /**
     * Check if a translation key exists.
     */
    public exists(key: string, lang?: string): boolean {
        return this.instance.exists(key, {lng: lang ?? this.getLocale()});
    }

    /**
     * Get the underlying i18next instance for advanced usage.
     */
    public getI18next(): i18n {
        return this.instance;
    }
}
