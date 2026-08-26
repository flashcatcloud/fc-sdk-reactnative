## Overview

`DatadogProvider` replaces the manual `DdSdkReactNative.initialize()` call. This is a
correctness change, not a style preference — the two do the same work in the opposite order.

`DdSdkReactNative.initialize()` awaits the native SDK across the bridge and installs the
JavaScript auto-instrumentation only after that resolves. The XHR proxy behind
`track XHR / fetch resources` is a live patch on `XMLHttpRequest.prototype`, not a buffered
call: a request that starts before the patch is applied produces no resource event at all.
It is not dropped later and cannot be recovered — the SDK never sees it. Because most apps
fetch their first screen while starting up, that window usually swallows the requests you
most want to look at. Calling `initialize()` earlier narrows that window but does not close it
from inside a React tree: children mount before any effect of yours can await the call. Closing
it that way means awaiting initialization in your entry file before the app is registered, which
trades startup latency for the coverage the provider gives you for free.

`DatadogProvider` installs the instrumentation during its own render pass, before any child
renders, and initializes the native SDK afterwards. Anything reported meanwhile goes into a
bounded buffer and is flushed once the native SDK is up, so the window is closed rather than
merely narrowed.

The same ordering applies to user interactions and JS errors raised during the first render.

## Change the configuration class

Change your configuration from a `DdSdkReactNativeConfiguration` to a `DatadogProviderConfiguration` instance:

```git
- const config = new DdSdkReactNativeConfiguration(
+ const config = new DatadogProviderConfiguration(
```

## Add the DatadogProvider

Wrap the content of your `App` component by a `DatadogProvider` component, passing it your configuration:

```javascript
// App.js

const config = new DatadogProviderConfiguration();
//...

export default function App() {
    return (
        <DatadogProvider configuration={config}>
            <Navigation />
        </DatadogProvider>
    );
}
```

Wrap the app root, as high in the tree as you can. The provider only covers what renders
below it, so every level you push it down is a level whose startup requests go uncollected.

## Remove call to DdSdkReactNative.initialize

Remove the call to `DdSdkReactNative.initialize` in your code.

## Special cases

### Adding a callback after the initialization

If you have a callback running after the initialization, you can pass it as a `onInitialization` prop to your `DatadogProvider`:

```javascript
export default function App() {
    return (
        <DatadogProvider
            configuration={config}
            onInitialization={() => callback()}
        >
            <Navigation />
        </DatadogProvider>
    );
}
```

### Delaying the initialization

Set `initializationMode` on the configuration. `InitializationMode.SYNC` (the default)
initializes the native SDK as the provider renders. `InitializationMode.ASYNC` defers that
native initialization until after the current interactions and animations have finished, so
it does not compete with your first screen:

```javascript
import { InitializationMode } from '@flashcatcloud/mobile-react-native';

config.initializationMode = InitializationMode.ASYNC;
```

Both modes install the JavaScript auto-instrumentation immediately — `ASYNC` delays only the
native initialization, and events reported in the meantime are buffered either way.

### react-native-navigation (Wix)

`DatadogProvider` needs a single React root to wrap, and react-native-navigation does not
have one — each screen is registered separately. Keep `DdSdkReactNative.initialize()` there,
and call it at module scope in your entry file, before registering any screen, so the
uninstrumented window is as small as that setup allows.
