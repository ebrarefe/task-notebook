# Task Notebook (Görev Defteri)

A personal daily & weekly task and memorization tracker built with React Native and Expo. Every morning, a local notification reminds you of the day's tasks and a "memory of the day" — all data stays on your device.

## Features

- **Daily / Weekly / Memorization** tabs to organize tasks and things to memorize
- **Local push notifications** — a daily reminder at a time you choose
- **Offline-first** — all data persisted locally with `AsyncStorage`, no backend required
- **Cross-platform** — iOS, Android, and Web from a single codebase

## Tech Stack

- [React Native](https://reactnative.dev/) + [Expo](https://expo.dev/) SDK 57
- `expo-notifications` for scheduled local notifications
- `expo-calendar`, `expo-device`
- `AsyncStorage` for local persistence

## Getting Started

```bash
npm install
npx expo start
```

- Quick preview: scan the QR code with **Expo Go**.
- ⚠️ **Notifications require a development build.** As of Expo SDK 53+, local notifications are limited in Expo Go. For real push/reminder behavior:
  ```bash
  npx expo run:android   # or: npx expo run:ios (macOS required)
  ```

## Notifications

- Only works on a real device (not in an emulator/simulator).
- On first launch the app requests notification permission. Set a time on the **Daily reminder** card under the "Today" tab and save — it repeats every day at that time.

## Project Structure

- `App.js` — all screens (Today / Daily / Weekly / Memorization), styles, and the data layer
- Data: `AsyncStorage` (`gd-config`, `gd-progress`, `gd-remind`)
- Notifications: `expo-notifications` (daily repeating local notification)

## Building an APK / AAB

Builds are produced in the cloud with EAS Build (a free Expo account is enough):

```bash
npm install -g eas-cli
eas login
eas init

# Installable APK for testing/sideloading:
eas build -p android --profile preview

# AAB for the Google Play Store:
eas build -p android --profile production
```

## License

MIT — see [LICENSE](LICENSE).
