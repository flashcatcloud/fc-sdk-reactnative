# Flashcat SDK for React Native

Flashcat Real User Monitoring (RUM) enables you to visualize and analyze the real-time performance and user journeys of your application’s individual users.

## Setup

Install the core package:

```sh
yarn add @flashcatcloud/mobile-react-native
```

Then initialize the SDK with your Flashcat client token and RUM application ID. Data is sent to the Flashcat `CN` site by default; use the `STAGING` site or `customEndpoints` for other environments.

```javascript
import {
    DatadogProvider,
    DatadogProviderConfiguration,
    TrackingConsent
} from '@flashcatcloud/mobile-react-native';

const config = new DatadogProviderConfiguration(
    '<CLIENT_TOKEN>',
    '<ENVIRONMENT_NAME>',
    '<RUM_APPLICATION_ID>',
    true, // track user interactions (taps)
    true, // track XHR / fetch resources
    true, // track JS errors
    TrackingConsent.GRANTED
);
config.site = 'CN';
config.serviceName = '<SERVICE_NAME>';
config.nativeCrashReportEnabled = true;
// Your own backend hosts. Only requests matching these carry tracing headers, which is
// what links a resource in RUM to its backend trace.
config.firstPartyHosts = ['example.com'];

export default function App() {
    return (
        <DatadogProvider configuration={config}>
            <Navigation />
        </DatadogProvider>
    );
}
```

Wrap the app root, as high in the tree as you can. `DatadogProvider` installs the JavaScript
auto-instrumentation during its own render pass and initializes the native SDK afterwards,
buffering whatever is reported meanwhile — so requests made while the app starts up are
collected. Initializing by hand with `DdSdkReactNative.initialize()` reverses that order and
those requests produce no resource event at all; see [migrating to DatadogProvider][10] for
why, and for the react-native-navigation (Wix) case where the manual call is still required.

The [core package reference][8] documents every configuration option, view tracking and data storage.

The RUM React Native SDK supports [Expo][2].

The RUM React Native SDK supports monitoring hybrid applications.

The RUM React Native SDK supports [OpenTelemetry][9] and distributed traces through header generation.

### Source maps (Android)

Uploading source maps lets Flashcat show readable stack traces for release builds. Apply the bundled Gradle script in `android/app/build.gradle`:

```groovy
apply from: "../../node_modules/@flashcatcloud/mobile-react-native/flashcat-sourcemaps.gradle"
```

It adds an `upload<Variant>Sourcemaps` task that runs automatically after the JS bundle task and uploads the bundle and its source map through `@flashcatcloud/flashcat-cli`, authenticated with the `FLASHCAT_API_KEY` environment variable.

The upload never blocks the build:

- If `FLASHCAT_API_KEY` is not set, the task is skipped and a warning is printed.
- If the upload fails (invalid key, network error, ...), a warning containing the CLI output is printed and the build continues.
- Set `FLASHCAT_SOURCEMAPS_DRY_RUN=true` (or the Gradle property `flashcatSourcemapsDryRun=true`) to run the task without uploading; this also silences the missing-key warning.

## Troubleshooting

If you encounter any issue when using the Flashcat SDK for React Native, please take a look at the [troubleshooting documentation][4], or at the [existing issues][5].

## Contributing

Pull requests are welcome. First, open an issue to discuss what you would like to change. For more information, read the [Contributing Guide][6].

## License

For more information, see [Apache License, v2.0][7]

[2]: https://docs.expo.dev/
[4]: ./TROUBLESHOOTING.md
[5]: https://github.com/flashcatcloud/fc-sdk-reactnative/issues?q=is%3Aissue
[6]: ./CONTRIBUTING.md
[7]: ./LICENSE
[8]: ./packages/core/README.md
[9]: https://opentelemetry.io/
[10]: ./docs/migrating_to_datadog_provider.md
