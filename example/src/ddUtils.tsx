import {
    DatadogProviderConfiguration,
    DdLogs,
    DdSdkReactNative,
    DdSdkReactNativeConfiguration,
    SdkVerbosity,
    TrackingConsent
} from '@flashcatcloud/mobile-react-native';

// ddCredentials.tsx is gitignored: create it with your Flashcat credentials
// (APPLICATION_ID, CLIENT_TOKEN, ENVIRONMENT).
import {APPLICATION_ID, CLIENT_TOKEN, ENVIRONMENT} from './ddCredentials';

// Preferred setup: hand this configuration to a <DatadogProvider> wrapping the app root.
// The provider installs the JS auto-instrumentation as it renders and initializes the native
// SDK afterwards, so requests made during startup are still collected.
//
// Not usable with react-native-navigation, which has no single React root to wrap - see
// initializeDatadog below.
export function getDatadogConfig(trackingConsent: TrackingConsent) {
    const config = new DatadogProviderConfiguration(
        CLIENT_TOKEN,
        ENVIRONMENT,
        APPLICATION_ID,
        true,
        true,
        true,
        trackingConsent
    )
    config.nativeCrashReportEnabled = true
    config.sessionSamplingRate = 100
    config.serviceName = "com.flashcat.reactnative.sample"
    // Defaults to 'CN'; use 'STAGING' or customEndpoints for other environments.
    config.site = 'CN'
    config.verbosity = SdkVerbosity.DEBUG;

    return config
}

 export function onDatadogInitialization() {
    DdLogs.info('The RN Sdk was properly initialized')
    DdSdkReactNative.setUserInfo({id: "1337", name: "Xavier", email: "xg@example.com", extraInfo: { type: "premium" } })
    DdSdkReactNative.setAttributes({campaign: "ad-network"})
}

// Manual setup. Only correct for react-native-navigation, where there is no single React root
// for <DatadogProvider> to wrap - every other app should use getDatadogConfig above.
//
// initialize() awaits the native SDK before it patches XMLHttpRequest, so requests issued
// before that resolves produce no resource event at all. Call it at module scope in the entry
// file, before registering any screen, to keep that window as small as this setup allows.
export function initializeDatadog(trackingConsent: TrackingConsent) {

    const config = new DdSdkReactNativeConfiguration(
        CLIENT_TOKEN,
        ENVIRONMENT,
        APPLICATION_ID,
        true,
        true,
        true,
        trackingConsent
    )
    config.nativeCrashReportEnabled = true
    config.sampleRate = 100
    config.serviceName = "com.flashcat.reactnative.sample"
    // Defaults to 'CN'; use 'STAGING' or customEndpoints for other environments.
    config.site = 'CN'
    config.verbosity = SdkVerbosity.DEBUG;

    DdSdkReactNative.initialize(config).then(() => {
        DdLogs.info('The RN Sdk was properly initialized')
        DdSdkReactNative.setUserInfo({id: "1337", name: "Xavier", email: "xg@example.com", extraInfo: { type: "premium" } })
        DdSdkReactNative.setAttributes({campaign: "ad-network"})
    });
}
