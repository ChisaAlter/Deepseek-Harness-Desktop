# Expo Two-Way-Audio Using Flow API

This example shows how expo-two-way-audio can be used to communicate with [Speechmatics Flow API](https://www.speechmatics.com/flow)

Flow is a conversational AI API and therefore, we need to send audio data in real time and play back the audio responses that we'll get from the API.

## Requirements

- Node.js
- Expo CLI
- [iOS](https://docs.expo.dev/workflow/ios-simulator/) and/or [Android](https://docs.expo.dev/workflow/android-studio-emulator/) dev environment setup.
- [Speechmatics Flow Client (React)](https://github.com/speechmatics/speechmatics-js-sdk/tree/main/packages/flow-client-react)
- [`event-target-polyfill`](https://www.npmjs.com/package/event-target-polyfill) package, or any other polyfill for the [`EventTarget` class](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget)

A Speechmatics API key is also needed in order to run the example. The key is injected into the app via environment variable. It can be passed by creating a `.env` file in the same directory as the example with the following content:

```
EXPO_PUBLIC_SPEECHMATICS_API_KEY='YOUR-API-KEY-HERE'
```

An API key can be obtained from the [Speechmatics Portal](https://portal.speechmatics.com)

> [!WARNING]
>
> The example uses the API key to request a temporary token (needed for communicating with flow).
> In a real-world scenario, you should not expose your API key in your client-side code.
> Instead, you should create a server-side endpoint that generates the temporary token (JWT) for you.

## Run the app

In the `examples/flow-api` directory:

1. Install dependencies:

   ```sh
   npm install
   ```

2. Run the app:

   ```sh
   # Run iOS
   npm run ios

   # Run Android
   npm run android
   ```

## Notes

Some audio features of expo-two-way-audio like Acoustic Echo Cancelling, noise reduction or microphone modes (iOS) don't work on simulator. Run the example on a real device to test these features.

```bash
# iOS
npx expo run:ios --device --configuration Release

# Android
npx expo run:android --device --variant release
```
