import {GG_LOG, GGLog} from "@grest-ts/logger";
import {GGTestLogger} from "./GGTestLogger";
import {GGLocatorScope} from "@grest-ts/locator";

export * from "./GGTestLogger";
export * from "./GGLogCommands";
export * from "./GGLogCursor";
export * from "./GGLogSelector";
export * from "./GGLogWith";
export * from "./GGLogInterceptor";

const originalInit = GGLog.init.bind(GGLog);
GGLog.init = function (scope?: GGLocatorScope) {
    originalInit();
    GGLog.add(new GGTestLogger());
    return originalInit
};

if (GG_LOG.tryGet()) {
    GGLog.add(new GGTestLogger());
}

