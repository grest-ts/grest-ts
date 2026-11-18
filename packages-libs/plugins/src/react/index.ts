import {createContext, createElement, useContext, useMemo, type ReactNode} from "react"
import type {GGContribution, GGPoint} from "../GGPoint"
import type {GGPluginHost} from "../GGPluginHost"

type IsOn = (name: string) => boolean

interface GGPluginsValue {
    host: GGPluginHost<object>
    useIsOn: (scope: string | undefined) => IsOn
}

const allOn: IsOn = () => true
const GGPluginsContext = createContext<GGPluginsValue | null>(null)

/** `useIsOn` is a hook: which plugins are on in a scope (e.g. one workspace); called with `undefined` outside one. */
export function GGPluginsProvider(props: {
    host: GGPluginHost<object>
    useIsOn?: (scope: string | undefined) => IsOn
    children?: ReactNode
}): ReactNode {
    const value = useMemo(() => ({host: props.host, useIsOn: props.useIsOn ?? (() => allOn)}), [props.host, props.useIsOn])
    return createElement(GGPluginsContext.Provider, {value}, props.children)
}

function usePlugins(): GGPluginsValue {
    const value = useContext(GGPluginsContext)
    if (!value) throw new Error("No GGPluginsProvider above this component")
    return value
}

/** Every item provided to `point`, ungated by scope: for a caller that checks a scope per item outside render. */
export function useSlotContributions<T>(point: GGPoint<T>): GGContribution<T>[] {
    const {host} = usePlugins()
    return useMemo(() => host.many(point), [host, point])
}

/** The items of plugins on in `scope`. */
export function useSlot<T>(point: GGPoint<T>, scope?: string): T[] {
    const {host, useIsOn} = usePlugins()
    const isOn = useIsOn(scope)
    return useMemo(() => host.many(point, isOn).map(c => c.item), [host, point, isOn])
}

/** The item of a `one` point, or undefined while none is on in `scope`. */
export function useSlotOne<T>(point: GGPoint<T, "one">, scope?: string): T | undefined {
    return useSlot(point, scope)[0]
}

/**
 * For items whose hooks feed one result: calls `use` on every provided item, on or not, so switching a plugin can't
 * change the hook order; an item that is off gets `on: false` and should do no work. Returns the results of the
 * items {@link useSlot} would give.
 */
export function useSlotHooks<T, R>(point: GGPoint<T>, use: (item: T, on: boolean) => R, scope?: string): R[] {
    const {host, useIsOn} = usePlugins()
    const isOn = useIsOn(scope)
    const all = useMemo(() => host.many(point), [host, point])
    const gated = useMemo(() => new Set(host.many(point, isOn)), [host, point, isOn])
    const on = all.map(c => gated.has(c))
    const results = all.map((c, i) => use(c.item, on[i]))
    // `all` is fixed for the host's lifetime, so these deps keep their length.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return useMemo(() => results.filter((_, i) => on[i]), [...results, ...on])
}
