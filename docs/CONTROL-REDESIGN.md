# Controls and preset redesign

Updated 24 October 2026. Native build and owner hardware checks for this
revision are tracked separately. No hardware settings were changed while
authoring the implementation.

## Gain without replacing EQ

Controls now has minus/plus buttons, the current headphone preamp in dB,
an estimated device peak, and Undo step. There is no dropdown or flat-EQ
requirement. Each step changes the current device preamp by exactly 1 dB;
filter types, order, frequency, Q, and per-filter gain remain unchanged.
For example, a seven-filter profile at -6.1 dB becomes the same seven-filter
profile at -5.1 dB after one plus step. These are global EQ gain changes,
not Windows volume changes or an amplifier-output unlock.

The first gain operation in each connection reviews the device, firmware,
before/after preamp and filters, and confirms Custom EQ selection and
clipping risk. Following operations apply directly. Consent is held in the
UI only for that device/firmware and clears on disconnect or restart;
firmware/address changes require fresh confirmation. Startup, selection
and reconnect never write gain automatically.

The backend validates one-dB steps without imposing a dB range. Finite
32-bit numbers and representable one-dB changes are required. Positive gain
and acoustic output remain unmeasured. Clipping, limiting, rejection or little
audible benefit remain possible. Ordinary Apply accepts manually chosen
preamp and band gains; headroom estimates are informational. See
[manual EQ](MANUAL-EQ.md).

Before each gain write, firmware and actual EQ are read again. The encoded
EQ must match the UI's expected EQ; stale expectations cause a refusal with
updated state. The immutable original EQ backup is retained. A separate
device/firmware-scoped last-gain-change.json records before/after profiles
before the write, using a synced temporary file and file replacement. It
is re-read and compared before sending EQ. Corrupt records block further
gain operations rather than being overwritten.

Undo restores only the last step's prior gain, and only if fresh device EQ
exactly matches that step's after profile. New external/device EQ changes
disable Undo. The record also supports Undo after reconnect when EQ matches.
An uncertain write has no automatic retry or escalation; a later matching
read can recover Undo availability. The editor stays a separate draft;
gain controls operate on the headphone's actual stored EQ.

## Spatial audio

The previous C04F parser treated spatial state as a boolean, losing mode
values. The new parser recognizes a mode byte and optional head-tracking
byte. Mode 1/4 remains Other mode, and unexpected bytes remain unavailable;
they are never guessed as Off.

Off/Cinema/Concert use the reference mapping 0/3/2 with head byte 0 in F052.
The first selection in a connection asks for confirmation; later selections
apply directly. The backend confirms the reviewed device and firmware,
limits writes to the CMF Headphone Pro name, reads the prior mode, writes
once, and queries C04F even if acknowledgement fails. Only matching mode
readback without enabled head tracking reports success. Unreadable or
different state is reported and never automatically retried. No spatial
write is sent on connection or startup.

This mapping has not yet been acoustically confirmed on the owner's
firmware. Primary references:

- [Ear (web) mode table and commands](https://github.com/radiance-project/ear-web/blob/main/res/js/bluetooth_socket.js)
- [B175 capability configuration](https://github.com/radiance-project/ear-web/blob/main/res/js/ear_config_file.json)
- [BudsLink spatial constants](https://github.com/maniacx/BudsLink/blob/main/src/lib/devices/nothingBuds/nothingBudsConfig.js)
- [Nothing's mode descriptions](https://support.nothing.tech/hc/en-us/articles/38910305345041-What-is-Spatial-Audio)

Protocol facts were independently implemented; downloaded references stay
under ignored artifacts/spatial-reference/. No reference code or vendor
app assets are distributed with this change.

## Presets and state

Flat, Punch and Deep bass have equally sized cards with short descriptions.
They preview an editor draft; Apply sends that draft. Undo draft is separate
from gain Undo step. The Equalizer view and gain card show the sound stored
on the headphones separately. Known filter shapes are labeled Flat/Punch/
Deep bass irrespective of global gain; others show Custom and filter count.

## Validation and owner checks

Automated tests are not run under AGENTS.md. JavaScript syntax, whitespace,
source review and the GitHub native build are separate checks. Browser
preview tooling currently fails to initialize, so visual layout verification
cannot be claimed from that tooling.

Owner checks after building: exercise gain on non-flat EQ and verify all
filters match before/after; verify one-dB changes and Undo; reconnect and
verify Undo scope; change EQ and check stale Undo is rejected. Confirm
Off/Cinema/Concert against Nothing X while recording firmware, requested/
read modes, audible behavior and verified restoration to the original mode.
Preserve backups and save reports under artifacts/reports/. No such hardware
verification is claimed by the implementation or a successful compiler build.
