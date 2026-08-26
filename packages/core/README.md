# React-Native Monitoring

Flashcat Real User Monitoring (RUM) enables you to visualize and analyze the real-time performance and user journeys of your application’s individual users.

## Setup

To install with NPM, run:

```sh
npm install @flashcatcloud/mobile-react-native
```

To install with Yarn, run:

```sh
yarn add @flashcatcloud/mobile-react-native
```

**Minimum React Native version**: SDK supports React Native version 0.63.4 or higher. Compatibility with older versions is not guaranteed out of the box.

Versions `1.0.0-rc5` and higher require you to have `compileSdkVersion = 31` in the Android application setup, which implies that you should use Build Tools version 31, Android Gradle Plugin version 7, and Gradle version 7 or higher. To modify the versions, change the values in the `buildscript.ext` block of your application's top-level `build.gradle` file. Flashcat recommends using React Native version 0.67 or higher.

### Specify application details in UI

1. In the [Flashcat console][1], open **RUM > Applications** and create a new application.
2. Choose `react-native` as your application type.
3. Name the application to generate its RUM application ID and client token.

![image][2]

To ensure the safety of your data, you must use a client token. Never configure `@flashcatcloud/mobile-react-native` with an API key: the client bundle is shipped to your users, so anything in it is readable by them. A client token can only write RUM events, which is why it is safe to embed.

### Initialize the library with application context

```js
import {
    DatadogProvider,
    DatadogProviderConfiguration
} from '@flashcatcloud/mobile-react-native';

const datadogConfiguration = new DatadogProviderConfiguration(
    '<CLIENT_TOKEN>',
    '<ENVIRONMENT_NAME>',
    '<RUM_APPLICATION_ID>',
    true, // track User interactions (e.g.: Tap on buttons. You can use 'accessibilityLabel' element property to give tap action the name, otherwise element type will be reported)
    true, // track XHR Resources
    true // track Errors
);
// Optional: select the Flashcat site, one of "CN" (default) or "STAGING". For a private
// deployment, leave `site` alone and set `customEndpoints` to your own intake URLs instead.
datadogConfiguration.site = 'CN';
// Optional: enable or disable native crash reports
datadogConfiguration.nativeCrashReportEnabled = true;
// Optional: sample RUM sessions (here, 80% of sessions are reported. Default = 100%)
datadogConfiguration.sessionSamplingRate = 80;
// Optional: sample the tracing integration for calls between your app and your backend (here, 80% of
// calls to your instrumented backend are linked from the RUM view to the trace. Default = 20%)
// You need to specify the hosts of your backends to enable tracing with these backends
datadogConfiguration.resourceTracingSamplingRate = 80;
datadogConfiguration.firstPartyHosts = ['example.com']; // matches 'example.com' and subdomains like 'api.example.com'
// Optional: set the reported service name (by default, it'll use the package name / bundleIdentifier of your Android / iOS app respectively)
datadogConfiguration.serviceName = 'com.example.reactnative';
// Optional: let the SDK print internal logs (at or above the provided level. Default = undefined, meaning no logs).
// Worth turning on while integrating: it prints whether resource tracking actually started.
datadogConfiguration.verbosity = SdkVerbosity.WARN;

export default function App() {
    return (
        <DatadogProvider configuration={datadogConfiguration}>
            <Navigation />
        </DatadogProvider>
    );
}
```

Wrap the app root, as high in the tree as you can. `DatadogProvider` installs the JavaScript
auto-instrumentation during its own render pass, before any child renders, and initializes the
native SDK afterwards — events reported meanwhile are buffered and flushed once it is up.

Do not initialize by hand with `DdSdkReactNative.initialize()` instead. That call awaits the
native SDK first and only then patches `XMLHttpRequest`, so requests made while your app is
starting up produce no resource event at all: they are never recorded, and nothing can recover
them afterwards. Calling it earlier shortens that window but cannot close it. The one place it
is still required is react-native-navigation (Wix), which has no single React root to wrap —
see [migrating to DatadogProvider][5].

`firstPartyHosts` is what links a resource to its backend trace: the SDK adds tracing headers
only to requests whose host matches. Left unset, resources are still reported but none of them
can be correlated with the backend.

### Track view navigation

Because React Native offers a wide range of libraries to create screen navigation, by default only manual View tracking is supported. You can manually start and stop a View using the following `startView()` and `stopView` methods.

```js
import {
    DdSdkReactNative,
    DdSdkReactNativeConfiguration,
    DdLogs,
    DdRum
} from '@flashcatcloud/mobile-react-native';

// Start a view with a unique view identifier, a custom view url, and an object to attach additional attributes to the view
DdRum.startView('ViewKey', 'ViewName', Date.now(), {
    'custom.foo': 'something'
});
// Stops a previously started view with the same unique view identifier, and an object to attach additional attributes to the view
DdRum.stopView('ViewKey', Date.now(), { 'custom.bar': 42 });
```

## Data Storage

### Android

Before data is uploaded, it is stored in cleartext in your application's cache directory.
This cache folder is protected by [Android's Application Sandbox][3], meaning that on most devices
this data can't be read by other applications. However, if the mobile device is rooted, or someone
tempers with the linux kernel, the stored data might become readable.

### iOS

Before data is uploaded, it is stored in cleartext in the cache directory (`Library/Caches`)
of your [application sandbox][4], which can't be read by any other app installed on the device.

[1]: https://console.flashcat.cloud/rum/apps
[2]: ../../docs/image_reactnative.png
[3]: https://source.android.com/security/app-sandbox
[4]: https://support.apple.com/guide/security/security-of-runtime-process-sec15bfe098e/web
[5]: ../../docs/migrating_to_datadog_provider.md
