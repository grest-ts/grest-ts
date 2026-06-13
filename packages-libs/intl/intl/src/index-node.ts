import "./_dedupCheck";
// Side-effect: installs the locator-scoped GGIntl store (node-only). Must run
// before any GGIntl is constructed so the server gets locator lifecycle.
import "./GGIntlStore.node";
export * from './GGIntl';
export * from './GG_INTL_LOCALE';
export * from './GGIntlMessage';
export * from './GGIntlMessageRegistry';
export * from './GGIntlTypeLocalizer';
export {GG_INTL} from "./GG_INTL";
