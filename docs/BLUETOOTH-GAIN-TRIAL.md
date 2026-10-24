# Experimental Bluetooth digital gain

Implemented 24 October 2026. No headphone gain writes or audible boost have
been verified while authoring this change.

The owner confirmed that flat Custom EQ at 0 dB sounded better after
removing -9.5 dB attenuation. That establishes a useful baseline, not a
verified gain setting beyond 0 dB or a way to match PC AUX maximum output.

## Behavior

Controls > Bluetooth gain trial explicitly writes flat custom EQ with
preamp 0, +1, +2 or +3 dB through the existing 0xF041 path. Positive preamp
support and audible effect remain unverified on firmware 1.0.1.49.
The feature is experimental digital gain, not a Bluetooth transport,
Windows endpoint-volume, amplifier, safety-cap or limiter unlock.

Flat 0 dB is available independently of the editor draft. It replaces the
current custom EQ with one neutral 980 Hz peak filter at gain 0 / Q 0.66,
then verifies the readback. This is a flat custom-EQ reset, not restoration
of an arbitrary previous preset or the original snapshot.

For a positive trial, the backend independently requires:

- The same reviewed device address and freshly queried firmware.
- Explicit Custom-mode confirmation and acknowledgement of the gain trial.
- A fresh EQ read with every filter gain exactly zero and preamp in [0,3].
- A finite integer request in [0,3], increasing at most 1 dB from that read.
- The existing durable, device/firmware-scoped original snapshot before any write.

The review names the device, shows the exact flat filter and gain, and says
that the write replaces custom EQ. It explains that gain can clip, trigger
limiting, or have no audible effect, and that this app adds no PCM limiter.
There is no gain change on selection, connect, startup, modal cancellation,
or disconnect. The backend always queries readback after a write, including
an acknowledgement timeout. It never automatically retries or escalates.
Matching readback confirms stored values only. Firmware rejection/mismatch
or an unreadable response retains the existing different/uncertain handling.

Ordinary Apply rejects a positive preamp in both frontend and backend; the
exception is confined to this dedicated flat-gain operation. Existing
Restore original remains available and does not overwrite its backup.
The editor draft is kept when the gain operation writes the device.

A fresh editor now starts with Flat, 0 dB; previously saved drafts still
reopen without applying themselves. A Flat preset button gives an explicit
return point. Auto headroom keeps flat/cut-only filters at 0 dB instead of
adding an unnecessary 1 dB attenuation. Positive filter peaks still receive
the existing estimated 1 dB margin. That estimate is not a true-peak or
acoustic measurement.

## Owner listening check

1. Use the new Windows build with the exact reviewed headphone address.
   Select Custom EQ in Nothing X and close it before the Windows operation.
2. Lower playback volume, choose Controls > Flat 0 dB, review and apply.
   Confirm the device readback is flat and preamp 0 dB.
3. Choose +1 dB > Review gain, read the details and explicitly apply.
   Record firmware, requested gain, readback, source/player volume and
   whether the same music passage sounds louder or distorted. Preserve the
   original backup. No headphone sound or clipping is measured by the app.
4. If the readback differs or is uncertain, stop escalation. Read device or
   reconnect to establish actual state. Do not assume the boost took effect.
5. If the gain matches but sounds worse, use Flat 0 dB and verify its
   readback. Only consider +2/+3 if each previous step matches and has a
   useful audible effect. Restore and verify Flat 0 dB after the trial.

Gain may remain stored across disconnect or reboot and may affect other
sources when Custom EQ is active. Positive-gain persistence is unverified;
the earlier EQ persistence evidence should not be relabeled as gain testing.
Save listening reports under artifacts/reports/; no report should claim
hardware verification until the owner has actually performed it.

## Validation

JavaScript syntax/configuration parsing, source review and manual browser
layout checks are separate from hardware validation. No automated tests
are run under AGENTS.md. Native compilation uses the existing GitHub Actions
build. The old executable does not contain this new command or control.

Digital headroom background:
[Equalizer APO configuration reference](https://sourceforge.net/p/equalizerapo/wiki/Configuration%20reference/).
