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
 * Assigns a property, but only when the host lets us.
 *
 * A host framework can expose its element factories as getter-only properties - nativewind's
 * `react-native-css-interop` does exactly that - and assigning to one throws a TypeError in
 * strict mode. This code runs inside `enableFeatures`, so such a throw used to take resource
 * and error tracking down with it, and through `DatadogProvider` it aborted the native
 * initialization that follows, leaving the app with no RUM data at all. Auto-instrumentation
 * is best-effort: failing to patch one factory must never be the reason the SDK does not start.
 */
const assignIfWritable = (
    target: Record<string, any>,
    key: string,
    value: unknown
): boolean => {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (descriptor && !descriptor.writable && !descriptor.set) {
        InternalLog.log(
            `Datadog SDK can't patch "${key}": the property is read-only, the host framework likely owns it`,
            SdkVerbosity.WARN
        );
        return false;
    }
    try {
        target[key] = value;
        return true;
    } catch (error) {
        InternalLog.log(
            `Datadog SDK can't patch "${key}": ${getErrorMessage(error)}`,
            SdkVerbosity.WARN
        );
        return false;
    }
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

        for (const key of JSX_FACTORY_KEYS) {
            const originalFactory = runtime[key];
            if (typeof originalFactory !== 'function') {
                continue;
            }

            const patchedFactory = (
                ...args: Parameters<typeof React.createElement>
            ): ReturnType<typeof React.createElement> =>
                DdRumUserInteractionTracking.patchCreateElementFunction(
                    originalFactory as typeof React.createElement,
                    args
                );

            if (assignIfWritable(runtime, key, patchedFactory)) {
                originals[key] = originalFactory;
                patchedAnyFactory = true;
            }
        }

        if (patchedAnyFactory) {
            DdRumUserInteractionTracking.patchedRuntimes.push({
                runtime,
                originals
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
        assignIfWritable(
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
        assignIfWritable(
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
        assignIfWritable(
            reactModule,
            'createElement',
            DdRumUserInteractionTracking.originalCreateElement
        );
        assignIfWritable(
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
                    assignIfWritable(runtime, key, originals[key]);
                }
            }
        }
        DdRumUserInteractionTracking.patchedRuntimes = [];

        DdRumUserInteractionTracking.isTracking = false;
    }
}
