# No data is being sent

Work down this list in order — each step narrows where the data is being lost.

## 1. Confirm the SDK started

Turn on internal logs and read them before changing anything else:

```javascript
import { SdkVerbosity } from '@flashcatcloud/mobile-react-native';

config.verbosity = SdkVerbosity.DEBUG;
```

You are looking for two separate lines. `Datadog SDK was initialized` means the native SDK is
up. `Datadog SDK is tracking XHR resources` means the network instrumentation was installed —
it is only printed when `trackResources` is enabled, and its absence is the single most common
reason an app reports views but no API calls. (Both strings still carry the upstream name this
SDK was forked from; grep for them verbatim.)

A third line, `Datadog SDK could not start <feature>`, means one instrumentation failed to
install. The others, and the native SDK itself, still start — you lose only that feature's
events. Section 3 covers the most common cause.

If neither of the first two lines appears, initialization never ran: check that the provider is
actually mounted, and that no exception is being swallowed around it.

## 2. Views and crashes arrive, but no API calls

This is almost always initialization order.

`DdSdkReactNative.initialize()` awaits the native SDK across the bridge and installs the
JavaScript instrumentation only after that resolves. That instrumentation is a live patch on
`XMLHttpRequest.prototype`, not a buffered call: a request that starts before the patch is
applied produces no resource event at all. It is not queued and delivered late — the SDK never
sees it, and nothing can recover it afterwards.

RUM calls such as `DdRum.startView` *are* buffered before initialization, which is why views
and errors survive while resources do not. That asymmetry is what makes this look like a
resource-specific bug when it is really a timing one.

Use `DatadogProvider` instead. It installs the instrumentation during its own render pass,
before any child renders, and initializes the native SDK afterwards. Wrap the app root, as high
in the tree as you can — the provider only covers what renders below it. See
[migrating to DatadogProvider](./migrating_to_datadog_provider.md).

react-native-navigation (Wix) has no single React root to wrap, so it must keep the manual
call. Put it at module scope in your entry file, before any screen is registered.

## 3. Views and API calls arrive, but no tap actions

Check whether your Babel config sets a custom `jsxImportSource`. nativewind does, and so does
any other styling library built on `react-native-css-interop`:

```javascript
// babel.config.js
presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }]];
```

With that in place your app's JSX no longer compiles to `react/jsx-runtime` — it compiles to
the library's runtime, which wraps React's element factories **while the bundle is evaluated**,
long before the SDK starts. Patching `react/jsx-runtime` afterwards can no longer reach your
elements, so no `onPress` is instrumented and no action is ever recorded.

The SDK cannot require those modules itself: Metro resolves requires statically, so a
hard-coded one would break bundling for every app that does not depend on it. Pass them in:

```javascript
import * as NativeWindJsxRuntime from 'nativewind/jsx-runtime';

config.jsxRuntimes = [NativeWindJsxRuntime];
```

A runtime may expose its factories through accessors rather than plain properties. The SDK
leaves those alone, on purpose: a host that puts a getter there is managing the slot, not just
storing a function in it, and taking it over breaks bookkeeping the host still believes it
controls. It is logged as:

```
Datadog SDK won't replace "createElement": it is an accessor, so the host framework owns that slot
```

Seeing this for `createElement` or `memo` on a nativewind app is expected and harmless — under
the automatic JSX transform your components never call `React.createElement`, so instrumenting
the runtime you declared in `jsxRuntimes` is what actually matters. One side effect worth
knowing: with `memo` left alone, a memoized component whose `onPress` the SDK wraps will
re-render on every parent render, because the wrapper is a new function each time.

When no factory on a runtime could be replaced at all, the SDK says what it costs:

```
Datadog SDK could not instrument a JSX runtime: its element factories are read-only.
No RUM action will be recorded for elements it renders.
```

There is no configuration that recovers from that: the factories have to be instrumented while
the app is built instead. Two things to try, in order — import the runtime with `require()`
rather than `import * as`, which skips the interop layer that may have frozen it, and if that
still fails, open an issue. Views, resources and errors are unaffected either way.

## 4. Resources arrive but are not linked to backend traces

Set `firstPartyHosts`. The SDK adds tracing headers only to requests whose host matches, so
with it unset every resource is a dead end:

```javascript
config.firstPartyHosts = ['example.com']; // matches example.com and its subdomains
```

Pass bare hosts, not URLs — no scheme, port or path. Also check
`resourceTracingSamplingRate`, which defaults to `20`: at that value four out of five matching
requests carry no tracing headers by design.

## 5. Nothing arrives at all

- **Wrong destination.** `site` accepts `'CN'` (default) and `'STAGING'`. For a private
  deployment leave `site` alone and set `customEndpoints` to your own intake URLs instead;
  each value is the complete URL including its path, and is passed to the native SDKs as is.
- **Credentials.** The client token and RUM application ID must come from the same application
  in the console. A token that is valid but belongs to another application produces a silent
  no-op, not an error.
- **Sampling.** `sessionSamplingRate` is a percentage of *sessions*. At a low value most test
  runs legitimately report nothing; set it to `100` while integrating.
- **Consent.** Nothing is collected under `TrackingConsent.NOT_GRANTED`, and events collected
  under `PENDING` are discarded unless consent is later granted.

## 6. Only in development

Two request kinds are filtered on purpose in dev builds, and only in dev builds: the Expo
`/logs` endpoint and the React Native packager's `/symbolicate`. Both are noise from the
tooling rather than from your app — the first would otherwise loop, since logging an API call
is itself an API call. Your own requests are never filtered.

Also check whether your own configuration disables collection outside release builds. Guards
such as `trackResources: !__DEV__` are easy to forget and behave exactly like a broken SDK.

## Still stuck

Open an [issue](https://github.com/flashcatcloud/fc-sdk-reactnative/issues/new) with the
`SdkVerbosity.DEBUG` output, your configuration with the credentials removed, and the SDK and
React Native versions.
