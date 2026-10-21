# Punch EQ implementation

Implemented locally, 21 October 2026. Native build and headphone validation
are pending. The established hardware evidence remains the earlier Python
investigation on firmware 1.0.1.49.

## Editor

- A fresh editor opens with Punch as its draft; it does not apply on startup.
- Punch and Deep bass are adjustable starting points, not response matches
  to Realme Buds Air 7 or Sony ULT Wear and not calibrated for a particular song.
- Deep bass controls a 50 Hz low shelf (0 to +4 dB); Punch a 95 Hz peak
  (0 to +4 dB, Q 0.85). Clarity combines a 280 Hz cut (0 to -2 dB)
  with a small 2.3 kHz lift (0 to +1.2 dB). These are chosen editor ranges,
  not established firmware limits.
- Sliders regenerate four draft filters and choose negative preamp from
  the requested combined response. All eight manual editor slots remain
  visible. Selecting a band hides the sound-control panel to preserve space.
- Editing an individual band or preamp detaches the sound controls. Selecting
  a preset rebuilds the draft; Undo recovers the previous valid profile.
- Profiles retains the existing Harman reference and AutoEQ import preview.
- Save draft stores the current valid profile locally; opening a saved draft
  does not send it to the headphones. Export .txt requests a browser/WebView
  download of the active filters and preamp in Equalizer APO syntax. A native
  WebView download still needs verification in the Windows build.

## Headroom

`ui/tuning.mjs` samples the existing 48 kHz response model on 2,049 log-spaced
frequencies plus filter centres. Suggested preamp includes 1 dB margin and
rounds toward attenuation. Apply is unavailable when the estimated response
with preamp exceeds 0 dB; Auto headroom adjusts the draft explicitly.

This is a sampled mathematical estimate. It is not a measurement of DSP,
true peaks, acoustic output, driver distortion, or headphone limiting.
Very narrow/extreme filters can need further investigation. Adding bass
changes tonal balance and may reduce overall level after headroom compensation.
No amplifier unlock or additional clean maximum output is claimed.

## Apply and recovery

1. Pair in Windows and select the exact headphone name and Bluetooth address.
2. Choose Custom EQ in Nothing X. For the bass starting points, use ANC High,
   minimum physical bass slider, spatial off, and no additional personalization
   or player EQ for a repeatable comparison. These settings are not changed
   automatically. Close Nothing X if it holds the control connection.
3. Edit a draft, select Apply, and review the target, preamp and filter table.
   The confirmation explicitly asks whether Custom EQ is selected: its
   activation command is still unverified and is not sent.
4. Rust validates the profile and rechecks firmware against the reviewed
   device identity. It reads the current EQ and creates a recovery file before
   attempting the first write. Baselines with any supported active count,
   including seven/eight, are accepted.
5. Recovery files use exclusive creation, `sync_all`, deserialization,
   identity/firmware checks, profile validation and encoded-value comparison.
   Existing files are loaded, never truncated or replaced. Failed or incomplete
   recovery files block Apply; do not delete a backup to silence the error.
6. Write custom EQ with 0xF041, then read with 0xC044 even if acknowledgement
   fails. Compare encoded declared filter/preamp values. An ACK alone does
   not establish success and opaque trailing read bytes are not compared.
7. A matching readback reports verified stored values; a mismatch reports
   different; unreadable readback reports uncertain. No write is automatically
   repeated. Clicking the device EQ line shows requested/readback filter
   tables. Read device can resolve uncertainty without writing.
8. Profiles → Restore original reviews and writes the immutable backup for
   the connected device and firmware, then verifies it. It does not restore
   a factory preset selection, ANC, spatial audio, or physical slider position.

Backups are under the OS application-data folder for `app.cmfeq.desktop`,
in `eq-backups/<address>/<hex-encoded-firmware>/original-eq.json`. Preserve
them when moving machines or reinstalling. They are not part of this Git
checkout. If a file is corrupt, preserve it for inspection; restoration cannot
be claimed from an unreadable file. No writes occur until valid recovery data
is available.

Disconnect/reconnect/app exit never automatically applies or restores an EQ.
A new connection reads actual settings and retains the editor draft. The
last requested comparison is session state; reconnect establishes fresh
device readback rather than claiming the earlier write succeeded.

## Verification status and next steps

JavaScript syntax and source/configuration review are checked separately
from automated tests. Automated tests are not run under AGENTS.md. Browser
preview checks cover the draft UI only; they cannot exercise Tauri commands,
Windows RFCOMM, filesystem recovery, or WebView-specific downloads.

Completed checks: JavaScript syntax for app/tuning modules; JSON/TOML parsing
and lockfile dependency inspection; whitespace review; browser inspection of
Punch/Deep bass switching, Undo, save/reload, invalid-Q feedback and the
440 x 660 minimum layout. Preview capture: `artifacts/preview/punch-editor.png`
(ignored local artifact). No automated suites were executed.

No Rust toolchain is installed in this workspace environment. The native
build is intentionally deferred to GitHub Actions after local implementation
and connecting the user's own repository. The existing workflow uses
`cargo build --release --features desktop --locked` and does not run tests.

Before declaring headphone support for these changes, use the Windows build
to verify backup creation and reuse, missing/corrupt backup rejection,
address/firmware mismatch rejection, write/readback mismatch and timeout
handling, Apply/Restore, reconnect, power-cycle retention, and audible Custom
mode activation. Audition at comparable vocal loudness with the original EQ
and record the chosen ANC/slider/personalization settings. No hardware writes
or listening comparisons have been performed during this implementation.
