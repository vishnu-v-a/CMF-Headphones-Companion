# Android: the same Rust app

The Android app shares the desktop HTML/CSS/JavaScript interface and Rust EQ
parser, packet codec, controller, readback verification, gain history, original
backups and named-profile library. It is not a separate Kotlin implementation.
`src/main.rs` starts the shared library on Windows; Tauri's mobile entry point
in `src/lib.rs` starts it on Android.

Only the platform adapter differs. `android/BluetoothPlugin.kt` opens the
paired headphone's Bluetooth Classic RFCOMM service through Android's public
API and passes bytes to/from Rust. The service UUID is the same as Windows;
there is no hard-coded RFCOMM channel, BLE substitute or hidden API. A small
native file-picker adapter supports importing/exporting the same parametric
.txt profiles. Kotlin does not construct EQ commands or bypass readback.

## Install and connect

Download the `cmf-eq-android-arm64` artifact from **Build Android app** on
GitHub Actions, extract it, and install its APK on a 64-bit ARM Android phone
running Android 7.0 or later. This is a debug-signed trial APK for sideloading,
not a Play Store release. Android may ask you to allow installation from your
browser/file manager.

1. Pair CMF Headphone Pro in Android Bluetooth settings and enable Bluetooth.
2. Open the app and allow Nearby devices when Android 12+ asks. Only paired
   devices are listed; the app does not scan or ask for location access.
3. Close Nothing X and disconnect the PC companion if either holds the control
   service. Use Refresh, select the correct name/address, and Connect.
4. Check firmware and device EQ. Writes retain the existing device/firmware
   confirmation, original-baseline backup and matching readback requirements.
5. Use the same Controls, Equalizer and Profiles screens. Desktop window
   buttons are hidden; the monochrome design and all eight band slots remain.

No automatic EQ changes occur on launch or reconnect. Confirming gain or
spatial control is still necessary on first use per connection. A stored gain
is not proof of louder playback, and Android support does not unlock a louder
amplifier mode.

## Data and lifecycle

Profiles and original backups live in Android's private app-data directory.
They persist across normal restarts and compatible APK updates, independently
of the Windows library. They do not automatically sync between phone and PC.
Use Export .txt/Import .txt to transfer tunings. Clearing app data or
uninstalling deletes the phone's profiles and recovery files; export important
profiles first. System backup is disabled for these device-specific files.

The companion controls headphone settings; it does not process music or keep
a background playback service running. UI polling stops when the page is
hidden. Android may suspend or kill the app in the background. A destroyed
activity closes transport sockets; reconnect if the control link is lost.
Closing the app does not reset settings already stored on the headphones.

Bluetooth work runs off the UI thread. Requests have bounded waits; a
watchdog closes a stuck connect/write. Rust still checks response framing,
CRC, sequence, firmware and requested values. Android transport/audible
behavior needs owner verification on the actual phone; a successful APK
build alone does not establish hardware compatibility.

## Build

The Android workflow installs the pinned Tauri CLI 2.12.4, Android SDK and NDK
28.2, initializes Tauri's generated Android project, then applies
`tools/prepare_android.py`. Generated Gradle files and native build outputs
are ignored. The shared app uses Cargo feature `app`; `desktop` remains an
alias so the existing Windows build command continues working.

The root package.json/package-lock.json configure only the pinned Tauri build
launcher and its `tauri` script, which the generated Gradle task calls.
Command: `npm run tauri -- android build --debug --apk --target aarch64 --features app --ci`.
No automated tests are run, in accordance with AGENTS.md. The debug signing
key is cached on GitHub Actions for convenient updates, but cache loss may
change the debug signature and require uninstalling before another trial
APK can install. Stable public distribution requires a separately managed
release signing key; no private signing key is committed to the repository.

References: [Tauri mobile plugins](https://v2.tauri.app/develop/plugins/develop-mobile/),
[Android RFCOMM](https://developer.android.com/develop/connectivity/bluetooth/connect-bluetooth-devices),
[Android Bluetooth permissions](https://developer.android.com/develop/connectivity/bluetooth/bt-permissions).
