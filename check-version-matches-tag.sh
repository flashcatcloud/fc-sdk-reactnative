#!/bin/sh

# Fails unless every place the SDK version is written matches the given version.
#
# A release publishes whatever these files say, so a tag that disagrees with any of
# them ships a version nobody asked for. The native files are the ones that go stale
# quietly: they feed `_dd.sdk_version`, so leaving them behind makes the SDK report
# the previous version while npm serves the new one.
#
# Run it before tagging; the publish workflow runs it again on the tag it was
# triggered by, so a mismatch stops the release instead of shipping.

usage() {
  echo "usage: $0 <version>" >&2
  exit 2
}

expected="$1"
[ -n "$expected" ] || usage

fail=0

check() {
  if [ "$2" = "$expected" ]; then
    printf '  ok        %s\n' "$1"
  else
    printf '  MISMATCH  %s declares "%s"\n' "$1" "$2" >&2
    fail=1
  fi
}

check lerna.json "$(node -p "require('./lerna.json').version")"

for manifest in packages/*/package.json; do
  check "$manifest" "$(node -p "require('./$manifest').version")"
done

check packages/core/src/version.ts \
  "$(sed -n "s/.*version = '\(.*\)';.*/\1/p" packages/core/src/version.ts)"

check packages/core/ios/Sources/SdkVersion.swift \
  "$(sed -n 's/.*SdkVersion = "\(.*\)".*/\1/p' packages/core/ios/Sources/SdkVersion.swift)"

check packages/core/android/src/main/kotlin/com/datadog/reactnative/SdkVersion.kt \
  "$(sed -n 's/.*SDK_VERSION = "\(.*\)".*/\1/p' packages/core/android/src/main/kotlin/com/datadog/reactnative/SdkVersion.kt)"

if [ "$fail" -ne 0 ]; then
  echo "" >&2
  echo "Not every file declares $expected. Run ./update-version.sh $expected and commit the result before tagging." >&2
  exit 1
fi

echo "Every declared version is $expected."
