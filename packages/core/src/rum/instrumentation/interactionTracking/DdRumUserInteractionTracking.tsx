/*
 * Unless explicitly stated otherwise all files in this repository are licensed under the Apache License Version 2.0.
 * This product includes software developed at Datadog (https://www.datadoghq.com/).
 * Copyright 2016-Present Datadog, Inc.
 */

import React from 'react';

import { InternalLog } from '../../../InternalLog';
import { SdkVerbosity } from '../../../SdkVerbosity';
import { DdSdk } from '../../../sdk/DdSdk';
import { getErrorMessage } from '../../../utils/errorUtils';
import { BABEL_PLUGIN_TELEMETRY } from '../../constants';

import { DdBabelInteractionTracking } from './DdBabelInteractionTracking';
import type { DdEventsInterceptorOptions } from './DdEventsInterceptor';
import { DdEventsInterceptor } from './DdEventsInterceptor';
import type { EventsInterceptor } from './EventsInterceptor';
import { NoOpEventsInterceptor } from './NoOpEventsInterceptor';
import { areObjectShallowEqual } from './ShallowObjectEqualityChecker';
import { getJsxRuntimes } from './getJsxRuntime';

/**
 * A JSX runtime: any module exposing `jsx` / `jsxs` / `jsxDEV` element factories.
 * `react/jsx-runtime` is one; a module that wraps it is another.
 */
export type JsxRuntimeModule = Record<string, unknown>;

const JSX_FACTORY_KEYS = ['jsx', 'jsxs', 'jsxDEV'] as const;

type JsxFactoryKey = typeof JSX_FACTORY_KEYS[number];

type PatchedRuntime = {
    runtime: JsxRuntimeModule;
    originals: Partial<Record<JsxFactoryKey, unknown>>;
};

/**
 * Replaces a property, and reports whether it actually took.
 *
 * An accessor is left alone on purpose. A host framework that exposes an element factory
 * through a getter is not merely storing a function there - it is managing that slot, and the
 * value it returns participates in bookkeeping of its own. Redefining the slot as a plain
 * property does succeed, and then that bookkeeping silently operates on something the host no
 * longer controls; the observed result on a nativewind app was the heap growing without bound
 * until Hermes aborted. Not writable is not an obstacle to push harder against, it is the host
 * saying this is mine.
 *
 * A plain property that merely refuses writes carries no such logic, so redefining that one is
 * safe and still worth doing.
 *
 * Either way this must not throw: it runs inside `enableFeatures`, where an exception used to
 * take the other instrumentations - and the native initialization after them - down with it.
 */
const replaceProperty = (
    target: Record<string, any>,
    key: string,
    value: unknown
): boolean => {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (descriptor && (descriptor.get || descriptor.set)) {
        InternalLog.log(
            `Datadog SDK won't replace "${key}": it is an accessor, so the host framework owns that slot`,
            SdkVerbosity.WARN
        );
        return false;
    }

    try {
        target[key] = value;
        if (target[key] === value) {
            return true;
        }
    } catch (error) {
        // read-only in strict mode - redefining is still allowed if it is configurable
    }

    try {
        Object.defineProperty(target, key, {
            value,
            writable: true,
            enumerable: true,
            configurable: true
        });
        if (target[key] === value) {
            return true;
        }
    } catch (error) {
        // non-configurable - nothing left to try
    }

    InternalLog.log(
        `Datadog SDK can't replace "${key}": the property is neither writable nor configurable`,
        SdkVerbosity.WARN
    );
    return false;
};

const reactModule = (React as unknown) as Record<string, any>;

/**
 * Provides RUM auto-instrumentation feature to track user interaction as RUM events.
 * For now we are only covering the "onPress" events.
 */
export class DdRumUserInteractionTracking {
    private static isTracking = false;
    private static eventsInterceptor: EventsInterceptor = new NoOpEventsInterceptor();
    private static originalCreateElement = React.createElement;
    private static originalMemo = React.memo;
    private static patchedRuntimes: PatchedRuntime[] = [];

    private static patchCreateElementFunction = (
        originalFunction: typeof React.createElement,
        [element, props, ...rest]: Parameters<typeof React.createElement>
    ): ReturnType<typeof React.createElement> => {
        if (
            props &&
            typeof (props as Record<string, unknown>).onPress === 'function'
        ) {
            const originalOnPress = (props as Record<string, unknown>) // eslint-disable-next-line @typescript-eslint/ban-types
                .onPress as Function;
            (props as Record<string, unknown>).onPress = (...args: any[]) => {
                DdRumUserInteractionTracking.eventsInterceptor.interceptOnPress(
                    ...args
                );
                return originalOnPress(...args);
            };
            // we store the original onPress prop so we can keep memoization working
            (props as Record<
                string,
                unknown
            >).__DATADOG_INTERNAL_ORIGINAL_ON_PRESS__ = originalOnPress;
        }
        return originalFunction(element, props, ...rest);
    };

    /**
     * Wraps every element factory a runtime exposes.
     *
     * All three keys matter: under the automatic JSX transform an element with a single child
     * compiles to `jsx` and one with several children to `jsxs`, so patching only `jsx` leaves
     * every multi-child element uninstrumented. `jsxDEV` lives on the dev runtime, which is a
     * different module - handling the keys per runtime keeps install and uninstall symmetric.
     */
    private static patchJsxRuntime = (runtime: JsxRuntimeModule): void => {
        if (!runtime) {
            return;
        }

        const originals: PatchedRuntime['originals'] = {};
        let patchedAnyFactory = false;
        let foundAnyFactory = false;

        for (const key of JSX_FACTORY_KEYS) {
            const originalFactory = runtime[key];
            if (typeof originalFactory !== 'function') {
                continue;
            }
            foundAnyFactory = true;

            const patchedFactory = (
                ...args: Parameters<typeof React.createElement>
            ): ReturnType<typeof React.createElement> =>
                DdRumUserInteractionTracking.patchCreateElementFunction(
                    originalFactory as typeof React.createElement,
                    args
                );

            if (replaceProperty(runtime, key, patchedFactory)) {
                originals[key] = originalFactory;
                patchedAnyFactory = true;
            }
        }

        if (patchedAnyFactory) {
            DdRumUserInteractionTracking.patchedRuntimes.push({
                runtime,
                originals
            });
            return;
        }

        if (foundAnyFactory) {
            // Saying only that a property could not be replaced leaves the integrator to work
            // out what that costs them. Name the consequence: no action will be recorded for
            // anything this runtime renders, and this is not something they can fix in
            // configuration - the element factories have to be instrumented at build time
            // instead.
            const message =
                'Datadog SDK could not instrument a JSX runtime: its element factories are read-only. No RUM action will be recorded for elements it renders.';
            InternalLog.log(message, SdkVerbosity.ERROR);
            DdSdk?.telemetryError?.(
                message,
                '',
                'JsxRuntimeNotPatchable'
            )?.catch(() => {
                // reporting the failure must not become a second failure
            });
        }
    };

    /**
     * Starts tracking user interactions and sends a RUM Action event every time a new interaction was detected.
     * Please note that we are only considering as valid - for - tracking only the user interactions that have
     * a visible output (either an UI state change or a Resource request)
     *
     * @param options interception options
     * @param jsxRuntimes additional JSX runtimes the app compiles its own JSX to, on top of
     * React's. Required whenever the app sets a custom `jsxImportSource` (nativewind and any
     * other css-interop based styling library): such a runtime wraps React's factories at
     * import time, which happens while the bundle is evaluated - long before this function
     * runs - so patching `react/jsx-runtime` afterwards can no longer reach the app's elements.
     * They cannot be required from here: Metro resolves requires statically, so a hard-coded
     * `require('nativewind/jsx-runtime')` would break bundling for every app that does not
     * depend on it.
     */
    static startTracking(
        options: DdEventsInterceptorOptions,
        jsxRuntimes: JsxRuntimeModule[] = []
    ): void {
        // extra safety to avoid wrapping more than 1 time this function
        if (DdRumUserInteractionTracking.isTracking) {
            InternalLog.log(
                'Datadog SDK is already tracking interactions',
                SdkVerbosity.WARN
            );
            return;
        }

        DdSdk?.sendTelemetryLog?.(
            BABEL_PLUGIN_TELEMETRY,
            DdBabelInteractionTracking.getTelemetryConfig(),
            { onlyOnce: true }
        );

        DdRumUserInteractionTracking.eventsInterceptor = new DdEventsInterceptor(
            options
        );

        const originalCreateElement = React.createElement;
        replaceProperty(
            reactModule,
            'createElement',
            (...args: Parameters<typeof React.createElement>): any => {
                return this.patchCreateElementFunction(
                    originalCreateElement,
                    args
                );
            }
        );

        const runtimes: JsxRuntimeModule[] = [];
        try {
            const [jsxRuntime, jsxDevRuntime] = getJsxRuntimes();
            if (jsxRuntime) {
                runtimes.push(jsxRuntime);
            }
            if (jsxDevRuntime) {
                runtimes.push(jsxDevRuntime);
            }
        } catch (e) {
            DdSdk?.telemetryDebug?.(getErrorMessage(e));
        }
        runtimes.push(...jsxRuntimes);
        runtimes.forEach(DdRumUserInteractionTracking.patchJsxRuntime);

        const originalMemo = React.memo;
        replaceProperty(
            reactModule,
            'memo',
            (
                component: any,
                propsAreEqual?: (prevProps: any, newProps: any) => boolean
            ) => {
                return originalMemo(component, (prev, next) => {
                    if (!next.onPress || !prev.onPress) {
                        return propsAreEqual
                            ? propsAreEqual(prev, next)
                            : areObjectShallowEqual(prev, next);
                    }
                    // we replace "our" onPress from the props by the original for comparison
                    const { onPress: _prevOnPress, ...partialPrevProps } = prev;
                    const prevProps = {
                        ...partialPrevProps,
                        onPress: prev.__DATADOG_INTERNAL_ORIGINAL_ON_PRESS__
                    };

                    const { onPress: _nextOnPress, ...partialNextProps } = next;
                    const nextProps = {
                        ...partialNextProps,
                        onPress: next.__DATADOG_INTERNAL_ORIGINAL_ON_PRESS__
                    };

                    // if no comparison function is provided we do shallow comparison
                    return propsAreEqual
                        ? propsAreEqual(prevProps, nextProps)
                        : areObjectShallowEqual(nextProps, prevProps);
                });
            }
        );

        DdRumUserInteractionTracking.isTracking = true;
        InternalLog.log(
            'Datadog SDK is tracking interactions',
            SdkVerbosity.INFO
        );
    }

    static stopTracking(): void {
        replaceProperty(
            reactModule,
            'createElement',
            DdRumUserInteractionTracking.originalCreateElement
        );
        replaceProperty(
            reactModule,
            'memo',
            DdRumUserInteractionTracking.originalMemo
        );

        for (const {
            runtime,
            originals
        } of DdRumUserInteractionTracking.patchedRuntimes) {
            for (const key of JSX_FACTORY_KEYS) {
                if (key in originals) {
                    replaceProperty(runtime, key, originals[key]);
                }
            }
        }
        DdRumUserInteractionTracking.patchedRuntimes = [];

        DdRumUserInteractionTracking.isTracking = false;
    }
}
