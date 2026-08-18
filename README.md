# Flashcat SDK for React Native

Flashcat Real User Monitoring (RUM) enables you to visualize and analyze the real-time performance and user journeys of your application’s individual users.

## Setup

Install the core package:

```sh
yarn add @flashcatcloud/mobile-react-native
```

Then initialize the SDK with your Flashcat client token and RUM application ID. Data is sent to the Flashcat `CN` site by default; use the `STAGING` site or `customEndpoints` for other environments.

The RUM React Native SDK supports [Expo][2].

The RUM React Native SDK supports monitoring hybrid applications.

The RUM React Native SDK supports [OpenTelemetry][9] and distributed traces through header generation.

## Troubleshooting

If you encounter any issue when using the Flashcat SDK for React Native, please take a look at the [troubleshooting documentation][4], or at the [existing issues][5].

## Contributing

Pull requests are welcome. First, open an issue to discuss what you would like to change. For more information, read the [Contributing Guide][6].

## License

For more information, see [Apache License, v2.0][7]

[2]: https://docs.expo.dev/
[4]: https://github.com/flashcat/fc-sdk-reactnative/blob/develop/TROUBLESHOOTING.md
[5]: https://github.com/flashcat/fc-sdk-reactnative/issues?q=is%3Aissue
[6]: https://github.com/flashcat/fc-sdk-reactnative/blob/develop/CONTRIBUTING.md
[7]: https://github.com/flashcat/fc-sdk-reactnative/blob/main/LICENSE
[9]: https://opentelemetry.io/
