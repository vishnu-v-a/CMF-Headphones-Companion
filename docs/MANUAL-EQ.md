# Manual preamp and EQ gain

Updated 25 October 2026. This shared Rust/UI change applies to Windows and
Android. No hardware settings were changed while implementing it.

Equalizer Apply no longer blocks positive preamp or combined response peaks
above zero. The Rust apply command also accepts positive preamp. Estimated
peaks and possible clipping remain informational and do not disable Apply.
If the response model cannot calculate an estimate for otherwise valid
values, manual Apply remains available. No limiter is added.

Preamp is independent of tuning. Changing a preset, its sound sliders, band
values or the graph does not automatically reduce or reset it. New drafts
start at zero; loading a saved/imported profile uses that profile's preamp.
Preset tone controls remain available after manually editing preamp, including
when reopening saved drafts and named profiles. Auto headroom is optional;
only selecting its button applies the recommended attenuation.

Controls Output gain has no -30/+10 dB application bounds. Minus/plus still
change the actual device preamp by one dB while retaining its filters. This
uses the same stored preamp as Equalizer, not a second amplifier stage. Values
must fit finite 32-bit numbers; a step too small to be represented at an
extreme preamp is rejected before staging an Undo record. Hardware may still
reject, limit or clip requested settings; app restrictions cannot change that.

At least one and at most eight enabled filters, supported filter types,
20–20,000 Hz frequencies, positive finite Q and finite gain/preamp remain
required by the existing profile format. The graph retains its practical drag
range; numeric gain entry has no dB range. Device/firmware review, Custom EQ
confirmation, original backups, stale-state checks, readback and gain Undo
are retained. No setting is written on launch, editing or reconnect.

Validation is JavaScript syntax/whitespace review and the Windows/Android
GitHub builds. Automated tests are not run under AGENTS.md. Owner checks:
apply a manually selected positive preamp with non-flat bands, confirm stored
readback, change sound sliders/presets and confirm the draft preamp stays
fixed, reopen saved profiles, and check gain steps across the old -30/+10
boundaries. Capture target, firmware, requested/read settings and restoration
under ignored artifacts/reports/. No acoustic or hardware result is claimed
by a successful build.
