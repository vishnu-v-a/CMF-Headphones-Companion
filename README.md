# CMF Headphone Pro EQ investigation

The EQ graph supports mouse/pen dragging and Android touch: move numbered
points for frequency/gain, or tap for precise band settings. Output gain now
allows one-dB steps up to +10 dB, with the existing confirmation and recovery
checks. See [graph editing and gain notes](docs/TOUCH-EQ.md).

## Android

The Android build keeps the same Rust logic and monochrome interface. Download
the `cmf-eq-android-arm64` APK artifact from **Build Android app**, pair the
headphones in Android settings and allow Nearby devices. A small native
adapter handles Android Bluetooth and file pickers. See [Android setup and
build details](docs/ANDROID.md), including trial signing and local data.

## Saved profile library

Use **Equalizer → Save profile** to keep multiple named tunings on this
computer. Open their cards in **Profiles**, then Apply to listen. Search,
explicit Update existing, rename and Remove with Undo are available; the
original recovery backup stays separate. See [profile library details](docs/PROFILE-LIBRARY.md).

The interface now has a Nothing-inspired black-and-white glossy finish,
with local dot-matrix display typography and monochrome controls. See
[the design notes](docs/MONOCHROME-DESIGN.md). This visual update does not
change EQ, gain or Bluetooth behavior.

## Direct gain, spatial audio and preset previews

The current UI uses **Controls → Output gain → − / +**, preserving the
headphone's current EQ bands. **Undo step** restores the previous gain,
including after reconnect when the stored EQ still matches. First use in
each connection asks for confirmation; later steps apply directly.
Spatial Off/Cinema/Concert now have a reference-backed mode mapping and
require matching mode readback. Owner validation of audible modes remains
pending. Preset cards are explicitly marked as editor previews.
See [the redesign notes](docs/CONTROL-REDESIGN.md) for behavior and checks.

## Earlier flat-only gain trial

The previous build added **Controls → Bluetooth gain trial**, with explicit
flat-EQ trials at +1/+2/+3 dB and a **Flat 0 dB** reset. Start at +1 dB;
the backend permits increases of at most 1 dB from a fresh flat-EQ read.
Positive gain may clip, be limited, be rejected, or have no audible effect.
This is not a verified amplifier/volume-cap unlock. Original backups and
write/readback verification are retained. No hardware gain validation has
been completed. See [the gain trial notes](docs/BLUETOOTH-GAIN-TRIAL.md).

Fresh editor drafts now start at Flat, 0 dB. Saved drafts reopen without
applying, and ordinary EQ Apply still prevents positive preamp.

## Established EQ evidence

The earlier EQ investigation was tested on firmware **1.0.1.49** with
Nothing X **3.10.0**, 14 October 2026. This is separate from the unverified
positive-gain trial described above.

The headphone accepts **eight custom EQ filters** through `0xF041`; nine and ten did not retain their requested settings. The owner confirmed eighth-filter playback effect. A seven-filter AutoEQ profile with **−6.1 dB preamp** was verified and survived a power cycle.

Read [the full investigation](docs/EQ-investigation.md) for packet format, command distinctions, APK findings, experiments, evidence, reproduction instructions, and remaining unknowns.

## Run the local page

The Rust desktop editor lives in `src/` and `ui/`. Its compact window has
Controls, Equalizer, and Profiles tabs; no page scrolling is needed. GitHub
Actions builds the Windows executable without automated tests. Push changes
and download `cmf-eq-windows-x64` from the workflow's artifacts.

The desktop app now includes a Windows Bluetooth Classic
connection. Pair the headphones in Windows Bluetooth settings, power them
on, then use **Controls → Refresh**, select the headphone name and Bluetooth
address, and click **Connect headphones**. Close the Python probe/server or
Nothing X if it holds the control connection. The app resolves the Nothing
service through SDP rather than assuming RFCOMM channel 28.

Connection reads protocol/firmware, custom EQ, battery, ANC and spatial-audio
state. Optional read failures remain unknown and appear in status details.
Settings refresh while the app is visible; **Profiles → Read device** also
refreshes them. **Review device EQ → Use in editor** explicitly copies the
readback into the draft. Connection and reconnect never apply the draft.
Disconnect closes the control connection without changing headphone EQ.

Noise control offers **Off**, **Transparency**, and **ANC**. Selecting ANC
reveals a matching horizontal row of **Low**, **Medium**, **High**, and
**Adaptive** buttons. It restores the device's last reported ANC level when
available; otherwise choose a level explicitly. Each ANC write requires
matching device readback before the app reports success.

Spatial audio displays **Off**, **Cinema**, and **Concert**. These buttons
remain disabled pending a confirmed Headphone Pro mode command mapping;
the existing boolean readback cannot distinguish Cinema from Concert.
The desktop source now includes **Punch** and **Deep bass** starting presets,
Deep bass / Punch / Clarity controls, estimated headroom, local draft saving
and Equalizer APO text export. The Harman reference remains available under
Profiles. Presets are listening starting points, not measured Sony or Realme
matches, and the graph is not an acoustic measurement or loudness meter.

**Apply to headphones** reviews the device address, firmware and all active
filters. Select **Custom EQ** in Nothing X first; Custom-preset activation is
not automatically detected or changed. The app saves the current EQ before
the first write, then requires matching EQ readback. **Profiles → Restore
original** restores that backup and verifies it. Existing backups are never
replaced by later applies or reconnections. Settings may remain on the
headphones after closing the app; exit does not restore them.

Backups are stored under the Tauri application-data folder:
`%APPDATA%\app.cmfeq.desktop\eq-backups\<address>\<encoded-firmware>\original-eq.json`.
They are specific to the device and firmware and are separate from the
Python prototype's backups. Readback verifies stored values, not audible
Custom-mode activation. More bass can require more preamp attenuation;
these features do not unlock additional Bluetooth amplifier output.

Windows endpoint-volume control remains unavailable. Spatial writes use
the new mode-valued readback path described in the redesign notes.
The earlier desktop build (`6640bf1`) compiled on GitHub on 21 October 2026;
the owner subsequently confirmed audible preamp and peak-filter changes and
preferred flat Custom EQ at 0 dB. Those observations do not establish the
new positive-gain trial's behavior.

See [the Punch implementation notes](docs/PUNCH-IMPLEMENTATION.md) for
usage, failure handling, and the remaining Windows/hardware checks. This
gain revision still needs a GitHub build and live headphone validation.

The commands below run the older Python investigation page.

```powershell
Set-Location 'D:\Projects\CMF-Rev'
python .\tools\python\eq_web_server.py
```

Open `http://127.0.0.1:8765/`. Keep the phone disconnected, use the headphones as Windows audio output, and set ANC to maximum for this AutoEQ profile.

The tools currently target this unit’s Bluetooth address. A fresh server expects the original three-filter baseline; see the full document’s recovery instructions if the headphones retain AutoEQ from an earlier session. Closing the browser does not restore EQ.

Private Android bug reports, Bluetooth captures and the copied APK are local investigation artifacts. Review them before sharing this folder.

## Workspace layout

The planned Windows Rust app is specified in
[Rust app specification](docs/RUST-APP-SPEC.md): ANC, battery, spatial audio,
Windows playback volume, and eight-band parametric EQ with AutoEQ import.

- `tools/python/`: working Python EQ prototype and its static web UI.
- `profiles/`: active EQ profile configuration.
- `tests/fixtures/`: captured packet fixture used by the offline self-check.
- `docs/`: protocol investigation and recovery instructions.
- `artifacts/`: local backups, logs, reports, and private captures.
- `research/`: copied Nothing X APK and decompiled reference sources.
- `vendor/`: bundled Android platform-tools and JADX, including their notices.

`Cargo.toml`, `src/`, and `ui/` contain the Rust/Tauri app. `.github/workflows/`
contains its Windows build workflow.

Automated tests and self-checks are not run unless explicitly requested.
Generated Python files go into `artifacts/` regardless of the working
directory. Existing backup filenames and contents have been preserved.

`.gitignore` excludes local artifacts, research exports, bundled tools, caches,
and Rust build output. Preserve the local backups; ignored files are not
protected by Git. Agent-specific settings remain in `.claude/`.
