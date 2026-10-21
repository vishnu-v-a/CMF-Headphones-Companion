# CMF Headphone Pro Windows App Specification

Status: implementation in progress; updated 21 October 2026. Target: CMF
Headphone Pro (B175 / Forretress), Windows, initially firmware 1.0.1.49.
The Rust/Tauri editor, Bluetooth connection, ANC writes, and EQ Apply/Restore
are implemented in source. Punch/Deep bass drafts, sound controls, headroom
estimation, draft save/export, and durable EQ backups are also implemented.
The native implementation still needs a Windows build and live verification;
Windows volume and spatial writes remain pending. See
[the current implementation notes](PUNCH-IMPLEMENTATION.md), which supersede
older implementation-status descriptions below. This specification does
not establish new hardware results.

Current GUI: Rust backend with an HTML/CSS/JavaScript frontend hosted in
Tauri. Moving the interface entirely into Rust, potentially using
egui/eframe, has been discussed but is not approved or implemented. The
Material 3 Expressive direction and band-settings interaction below apply
independently of that framework decision.

## Product scope and layout

The main feature is an eight-band parametric EQ stored on the headphones,
with AutoEQ file import. Supporting controls are ANC, battery, headphone
spatial audio, and a compact Windows playback-volume slider.

Compact companion layout (updated after feedback on the first build):

1. A 460 × 690 logical-pixel window, minimum 440 × 660, with a custom
   draggable title bar, minimize/close actions, and optional keep-on-top.
2. Persistent device header and three tabs: Controls, Equalizer, Profiles.
3. Controls: one top connection card grouping device selection, firmware/address,
   Connect/Disconnect and readback feedback, followed by ANC, spatial audio
   and Windows volume. Connection actions are not pinned to the page bottom.
4. Equalizer: expandable response graph with a separate EQ preamp control,
   a horizontal strip of eight band buttons, a shared band-settings panel,
   Check draft, and Apply.
5. Profiles: file import and confirmation, reference tuning, and recovery actions.

No page scrolling or stacked landing-page sections. Each tab fits the
supported window dimensions; switching tabs preserves the draft. Import
confirmation replaces the import card, then opens Equalizer when accepted.
Long status messages expand in a popover instead of consuming content space.

Each band button opens settings for that band: enable/disable, filter type,
frequency in Hz, gain in dB, and Q. Show the band number and compact
frequency summary on enabled buttons; label disabled bands Off. Keep all
eight buttons visible while editing. Selected styling identifies the open
band and its marker on the response graph. Closing settings frees space
for the graph; it does not discard edits. Changes update the draft and
requested response immediately, without writing to the headphones.

Support native button keyboard activation and arrow/Home/End navigation
between band selectors. Move focus into settings when opened; closing with
the close button or Escape returns focus to the selected band. Switching
tabs closes settings but preserves the draft. Validate all enabled bands,
including bands whose settings are closed. Mark invalid band buttons,
identify the affected band in the status message, and clear the graph while
the enabled draft is invalid instead of leaving a stale response visible.

Firmware updates, gesture remapping, multipoint management, codecs, and other
Nothing X features are outside this initial scope. Connection does not apply
a profile or change ANC, spatial audio, or volume automatically.

## Visual design direction

Use the requested Material 3 Expressive direction: orange tonal surfaces,
connected button groups, pill-shaped selected controls, asymmetric icon
containers, and emphasized device/profile headings. The current
implementation uses custom dependency-free CSS in `ui/style.css`; it does
not install the React Material UI library or an official Material component
package. The older Python testing page is a historical reference rather
than the current visual specification.

| Element | Current treatment |
| --- | --- |
| Window background | Light `#fff8f5`; dark `#211a17` |
| Panel surface | Light `#f5e9e2`; dark `#332923` |
| Input surface | Light `#ffefe7`; dark `#403129` |
| Primary text | Light `#271914`; dark `#ffdbcb` |
| Secondary text | Light `#71574b`; dark `#d8bbad` |
| Primary accent | Light `#9c4320`; dark `#ffb595` |
| Text on primary accent | Light `#ffffff`; dark `#562008` |
| Tonal selection surface | Light `#ffdbcb`; dark `#753012` |
| Control outlines | Light `#937567`; dark `#a98a7b` |
| Typography | Segoe UI with a system sans-serif fallback; bold headings, small uppercase section labels |
| Shape | Approximately 20–24 px panel corners; connected groups with compact inner corners and pill-shaped selected buttons |
| Spacing | Approximately 14 px window gutters, 10–15 px card padding, and 6–10 px gaps |

Follow system light/dark appearance. Check text/control contrast and
keyboard focus during implementation, particularly small muted labels and
text on orange buttons. Status must also use readable text or icons.

Use tabs to separate headphone controls, the EQ editor, and profiles. Keep
battery and connection status visible in the shared header. Display all
eight band buttons simultaneously; do not require scrolling to find actions.

Use orange for the main Apply action, selected controls, and the combined
EQ response curve. Use quiet outlined buttons for Import, Read settings,
and Restore. Keep preamp alongside the response graph and visibly separate from the Windows volume slider,
with explicit units (`dB` and `%`). Put import feedback near the profile
controls, including active-band count and rejection reasons.

Use concise device/profile headings without a marketing hero. Keep errors
and readback status in a shared status bar with expandable details. Support
keyboard tab navigation, Windows display scaling, and reduced-motion
preferences. Current motion uses 240 ms tab/panel entry transitions with
`cubic-bezier(.2,.9,.2,1.15)`, 150 ms switch movement, and 120 ms hover-state
transitions. This is a CSS approximation of expressive motion, not a
physics-based Material spring implementation. Reduced motion disables
animations and transitions. Panel/tab exits currently change immediately.
Keep selected-band graph markers without background animation loops.

The layout, keyboard behavior, system appearance and reduced-motion path
still require runtime verification in the supported Windows window sizes.
JavaScript syntax and configuration parsing were checked; no rendered
layout, frame-time or native-runtime verification is claimed for this UI
revision. The browser tool blocked local-file preview navigation.

This visual direction is independent of GUI framework choice. Reuse its
appearance whether rendered with native Rust widgets or a web-based UI.

## Feature requirements and evidence

| Feature | Required behavior | Evidence and remaining work |
| --- | --- | --- |
| Battery | One headphone percentage and charging status; unknown/stale state when unavailable | Android parser and macOS reference agree on count-prefixed records and charge bit; verify this unit's record ID and live updates |
| ANC | Off, transparency, and ANC with low/medium/high/adaptive choices where supported | Android command builder and reference enum provide candidate mappings; verify every exposed mode on 1.0.1.49 |
| Spatial audio | Headphone spatial-audio on/off; expose head tracking only when supported and verified | Android Forretress metadata declares spatial/head-tracking support; payload builders exist; no local wire/playback verification yet |
| Windows volume | Small 0–100% master-volume slider for the selected Windows playback endpoint; reflect external changes | Use Windows Core Audio endpoint volume API; implementation pending |
| Parametric EQ | Up to eight enabled filters, per-filter frequency/gain/Q/type, and independent preamp | Eight-filter write/readback and audible eighth-filter effect already verified locally |
| AutoEQ import | Load Equalizer APO parametric text, preview, validate, then apply explicitly | Existing Python importer handles the supplied file; eight/nine-active-filter boundary checked offline |

Do not display a successful toggle merely because a write was acknowledged.
Read back settings and distinguish pending, confirmed, failed, and unknown
states. Unsupported controls should explain their availability status.

## Connection and protocol contract

### Current implementation

`src/bluetooth.rs` implements paired-device enumeration through Win32
Bluetooth APIs and a native Winsock RFCOMM client without new Cargo
dependencies. The app lists authenticated paired Bluetooth Classic devices,
prioritizes headphone/CMF/B175 names, and requires an explicit name/address
selection. Renamed headphones remain selectable. A connection address is
revalidated against the paired-device list before opening the socket.

Controls provides Refresh, Connect and Disconnect in a single connection
card at the top. Hide the inactive device picker while connected, show the
firmware/address beside a secondary Disconnect action, and keep persistent
warning Details and Retry read actions in that same card. Draft-validation
messages do not erase the warning details available through Details.
The selection replaces the decorative headphone stage to preserve the
compact layout. Background
Tauri commands run blocking discovery and serialized socket requests off
the UI thread. Socket connection has a 20-second deadline; protocol/firmware
and EQ requests have eight-second deadlines, optional status reads three
seconds each. The whole Connect operation can take roughly 53 seconds if
all reads reach their deadlines; it is not a 20-second total operation.
The UI prevents overlapping operations while a request is running.

Initialization queries `0xC001`, then reads EQ, battery, ANC and spatial
state; a final matching firmware response verifies the link is still alive
after optional reads. Replies must match command and sequence and have
zero protocol status; the existing stream decoder handles fragmentation,
coalescing and CRC validation. Unsolicited frames are not used as request
completion. Current state uses bounded polling rather than event-driven
updates: refresh starts 15 seconds after the previous completed operation
while the document is visible. Read device also refreshes explicitly.

Optional read failures clear the affected values and record warnings;
firmware heartbeat failure drops the session and clears connected state.
Battery ID 04 or 05 is accepted only when exactly one candidate record is
present. This mapping and the ANC/spatial read payloads still require live
verification in the Rust app. Unknown ANC codes are displayed as Unknown.
The optional head-tracking readback is retained without enabling a control.

Connection never replaces the editor draft. Profiles → Review device EQ
opens a confirmation before copying the latest validated EQ readback into
the editor. No automatic reconnect, settings writes, Apply or snapshot
restore are implemented. There is no durable pre-change snapshot yet; it
must be implemented before enabling any headphone-setting writes. Native
session/socket ownership closes the control link on disconnect; app exit
does not restore or apply EQ.

No automated tests, hardware reads or writes were run during this change.
JavaScript syntax and Rust parsing/formatting are checked separately from
the required GitHub Actions Windows build and live-device acceptance.

### Required transport behavior

Discover/select a paired B175 device; do not retain the prototype's hardcoded
Bluetooth address. Resolve RFCOMM through SDP service UUID
`AEAC4A03-DFF5-498F-843A-34487CF133EB`, then initialize with `0xC001`.
Use the locally verified type-6 framing and CRC from
[the EQ investigation](EQ-investigation.md), rather than copying macOS
header defaults. Parse fragmented/coalesced stream frames with length and
CRC checks; serialize requests and correlate responses without treating
unsolicited events as request completion.

The following command numbers are canonical integers. Some Swift request
enum values are byte-swapped for that implementation's serializer; do not
copy those literal integers into the Rust encoder.

| Operation | Request | Expected reply/event | Candidate payload |
| --- | --- | --- | --- |
| Initialize | `0xC001` | `0x4001` | Empty |
| Firmware | `0xC042` | `0x4042` | Empty |
| Battery | `0xC007` | `0x4007`, event `0xE001` | Empty |
| Read ANC | `0xC01E` | `0x401E`, event `0xE003` | Android builder sends `03`; confirm on device |
| Set ANC | `0xF00F` | `0x700F`, then read back | `01 <mode> 00` |
| Read spatial | `0xC04F` | Expected `0x404F`, unverified locally | Empty |
| Set spatial | `0xF052` | Expected `0x7052`, then read back | `<enabled>` or `<enabled> <head_tracking>`; booleans `00`/`01` |
| Read custom EQ | `0xC044` | `0x4044` | Empty |
| Write custom EQ | `0xF041` | `0x7041`, then read back | Existing verified count/preamp/filter encoding |

ANC mode candidates: high `01`, medium `02`, low `03`, adaptive `04`,
off `05`, transparency `07`. Android parses ANC records as triples
`<type, value, reserved>`; type `01` is the current mode, type `02` the
last ANC level. Parse by record type instead of a fixed full-frame offset.
Unknown values must remain unknown rather than defaulting to an ANC mode.

Battery payload: `<count>`, then `<device_id, packed_level>` pairs.
Percentage is `packed_level & 0x7F`; charging is bit `0x80`. Validate record
length and percentage (0–100). The reference accepts headphone IDs `05`
and `04`; confirm the actual ID before relying on a mapping. `0xE002` is
a device-status event, not a battery report. Do not interpret CRC bytes as
payload. Notification subscription requirements remain to be verified;
use bounded polling while connected if events are unavailable.

Spatial readback candidate: byte 0 is enabled, optional byte 1 is head
tracking. Preserve optional-field support separately from its value. A
missing second byte does not prove head tracking is off. Keep this control
separate from Windows Sonic and other Windows spatial-sound settings.

## Eight-band EQ and AutoEQ import

Represent eight editor slots with at most eight enabled filters. Support
peaking (`PK`), low shelf (`LS`), and high shelf (`HS`), mapped to device
types `1`, `0`, and `2`. Read/write the preamp independently of Windows
volume. Preserve imported values without silent normalization, clipping,
resampling, merging, or dropping enabled bands.

Import rules:

- Accept UTF-8 text, including BOM, blank lines, and `#` comment lines.
- Require one finite `Preamp: <dB> dB` value.
- Parse `Filter <id>: ON|OFF <type> Fc <Hz> Hz Gain <dB> dB Q <Q>`.
- Count **enabled filters**, not the number in the filename, filter IDs,
  or OFF placeholders. Require 1–8 enabled filters for an imported profile.
- Reject more than eight enabled filters before changing the current
  editor, saved profile, or device. Example: `This profile contains 9 active
  filters. Maximum supported: 8.` Never import only the first eight.
- Reject malformed/unsupported active filters, duplicate filter IDs,
  non-finite or non-float32-representable values, frequencies outside
  20–20,000 Hz, and Q <= 0. These are application validation rules, not
  proof of the firmware's complete accepted ranges.
- OFF rows consume no device slots; retain their metadata for display.
  Their zero frequency/Q placeholders must not invalidate an otherwise
  valid import. Show the active and skipped counts in the preview.
- Keep import separate from Apply. Display requested and read-back values
  if the device rejects or modifies a setting.

Gain, Q, and preamp editing bounds beyond those rules need firmware
validation. Do not invent limits and present them as device capabilities.
The graph represents the requested mathematical filter response, not a
measured acoustic response or guaranteed DSP implementation.

### Supplied reference profile

Source: `C:\Users\vinay\Downloads\[8B] CMF Headphones Pro - Harman 2018 Target.txt`.
Its enabled settings match `profiles/autoeq-profile.json` exactly:

| Filter | Frequency (Hz) | Gain (dB) | Q | State |
| --- | --- | --- | --- | --- |
| 1 | 29 | -0.9 | 2.0 | ON |
| 2 | 50 | -5.4 | 0.5 | ON |
| 3 | 60 | +1.0 | 1.0 | ON |
| 4 | 240 | -4.5 | 1.5 | ON |
| 5 | 2000 | +2.5 | 1.2 | ON |
| 6 | 5900 | +3.8 | 1.1 | ON |
| 7 | 10000 | +4.8 | 2.0 | ON |
| 8 | 0 | 0.0 | 0.0 | OFF placeholder |

All rows are PK; preamp is **-6.1 dB**. Import summary: **7/8 active bands,
one disabled row skipped**. The profile's comparison condition is ANC
maximum; show that condition without switching ANC automatically. Its
seven-filter persistence is verified; eight-filter persistence remains a
separate verification task.

## Windows volume behavior

Use `IAudioEndpointVolume` for the selected render endpoint, mapping
0–100% to scalar 0.0–1.0. Show the endpoint name. Initially follow the
Windows default playback endpoint and update that binding when it changes;
allow explicit endpoint selection. The label must make clear which device
the slider controls, including when Windows is playing through speakers.

Subscribe to endpoint volume-change notifications so Windows controls,
keyboard keys, and hardware changes are reflected. Rebind callbacks when
the endpoint changes/disappears and avoid feedback loops. Slider changes
must never modify the EQ preamp. Endpoint-volume API calls and callbacks
belong outside the Bluetooth request queue.

## State, persistence, and recovery

Separate editor draft, last confirmed device settings, and a durable
pre-change snapshot associated with device identity and firmware. Snapshot
the actual current EQ, even when it already has seven/eight filters; the
Rust app must remove the prototype's three-filter startup restriction.

Apply sends only after complete validation and snapshot creation, then
verifies readback. A timeout may follow a successful write: mark device
state uncertain, re-read, and provide explicit restore/retry actions.
Do not overwrite the original snapshot during readback or reconnection.

Applied EQ is expected to remain on the device until explicitly changed;
normal app exit should not silently undo it. Restore means restoring the
chosen snapshot, with verified readback. Reconnect re-queries actual state
and does not automatically resend a draft. Preserve the draft on failure.

## Implementation boundaries and acceptance checks

Keep protocol encoding/decoding, Bluetooth transport, AutoEQ parsing,
Windows volume, and application state independent of the GUI toolkit.
The initial implementation may use modules in a single Rust crate; a
multi-crate workspace is not required. Tauri is the current implementation;
replacing its frontend with an entirely Rust GUI remains a separate,
unapproved migration. Reuse the existing Rust AutoEQ and protocol modules
if that migration is selected.

The acceptance checks below describe remaining release work. Do not run
automated tests locally or in CI unless the user explicitly authorizes
them, as required by the repository guidelines. Continue building the
Windows executable through GitHub Actions without installing local C++
build tools.

Before claiming release support:

1. Unit-test packet CRC, stream fragmentation, malformed lengths, ANC and
   battery records, and one/two-byte spatial responses using fixtures.
2. Test imports with seven, eight, and nine active filters; OFF placeholders;
   BOM/comments; missing/duplicate preamp; duplicate IDs; invalid values;
   unsupported active types. Rejection must leave draft/device unchanged.
3. Read battery/ANC/spatial state on firmware 1.0.1.49. Change each control
   in Nothing X or with physical controls and correlate captured values.
4. Verify each supported ANC mode and spatial/head-tracking change with
   readback and owner observation; restore starting settings afterward.
5. Verify eight-filter Apply and Restore, reconnect, and a distinct
   eight-filter power-cycle test. Confirm custom EQ is active; the current
   prototype assumes Custom mode was selected in Nothing X beforehand.
6. Verify Windows volume synchronization, endpoint switching, disconnects,
   and mute interactions without modifying EQ gain.

Completed for this specification: inspected the provided file; confirmed
its exact match to the stored profile; checked the existing importer accepts
eight active filters and rejects nine. No new Bluetooth or volume writes
were performed. New parser rules such as duplicate-ID validation are
requirements for Rust, not claims about the current Python importer.

## Sources and provenance

- Existing local wire/playback evidence: [EQ investigation](EQ-investigation.md).
- [Reference repository](https://github.com/furkanozer1/nothing-x-macos-cmf),
  inspected at commit `f5f40c0989b5d2f02fdff78096402d245c5d53b0`.
  Relevant files: `framework/NothingServiceImpl.swift`,
  `domain/enums/Commands.swift`, and `domain/enums/device/ANC.swift`, under
  `Nothing X MacOS/`. Reference reports testing firmware 1.0.1.45; that
  does not verify behavior on our 1.0.1.49 unit.
- Local Nothing X 3.10.0 decompilation under `research/nothing-x-source/sources/`:
  `com/nothing/core/ext/TWSDeviceExtKt.java` (builders),
  `com/nothing/base/protocol/constant/ProtocolConstant.java` (commands),
  `com/nothing/base/protocol/entity/BasicBoolean.java` (spatial fields),
  `com/nothing/earbase/anc/entity/DeviceNoiseReduction.java` (ANC records),
  `com/nothing/elekid/core/protocol/entity/DeviceBattery.java` (battery), and
  `com/nothing/forretress/core/device/IOTProductDeviceForretress.java`
  (product capabilities).
- [Microsoft: IAudioEndpointVolume](https://learn.microsoft.com/en-us/windows/win32/api/endpointvolume/nn-endpointvolume-iaudioendpointvolume)
  documents master endpoint volume, scalar access, and change callbacks.
- [Microsoft: BluetoothFindFirstDevice](https://learn.microsoft.com/en-us/windows/win32/api/bluetoothapis/nf-bluetoothapis-bluetoothfindfirstdevice)
  and [Bluetooth search parameters](https://learn.microsoft.com/en-us/windows/win32/api/bluetoothapis/ns-bluetoothapis-bluetooth_device_search_params)
  document paired Bluetooth Classic enumeration.
- [Microsoft: SOCKADDR_BTH](https://learn.microsoft.com/en-us/windows/win32/api/ws2bth/ns-ws2bth-sockaddr_bth)
  documents service-UUID resolution on connect; [Winsock select](https://learn.microsoft.com/en-us/windows/win32/api/winsock2/nf-winsock2-select)
  documents nonblocking connect/read/write readiness and error handling.

Local research exports and hardware captures remain outside source control.
