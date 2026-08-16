module.exports = {
  dependencies: {
    // Session Replay is out of scope for RN: FlashcatSessionReplay is not published,
    // so the package's podspec cannot resolve. Exclude it from iOS autolinking.
    '@flashcatcloud/mobile-react-native-session-replay': {
      platforms: {
        ios: null,
      },
    },
  },
};
