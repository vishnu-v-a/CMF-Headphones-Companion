# Bluetooth volume investigation and Sony ULT Wear tuning direction

Research date: 21 October 2026. Repository reviewed at `8b7caac`.
This is research and an implementation brief, not a verified fix or an applied headphone profile.

## User's reported behavior

- Model: CMF Headphone Pro.
- Windows Bluetooth, phone Bluetooth, and phone AUX have roughly the same maximum perceived volume. Only Windows AUX is much louder.
- Firmware: 1.0.1.49, confirmed by the user's screenshot.
- Desired sound: bass impact and punch when listening to an Anirudh track, as enjoyed on the user's Realme Buds Air 7. Sony ULT Wear remains a style reference, not a mandatory exact target.
- Phone model, current EQ/preamp, and roller/source synchronization remain unconfirmed.

The comparison shows higher effective output specifically through Windows AUX. It does not establish a Bluetooth fault, universal AUX advantage, identical input gain staging, or an adjustable firmware volume cap. Stronger PC analog output and different input gain remain hypotheses.

## Updated tuning goal: bass impact

Prioritize the user's perceived bass impact and rhythmic punch. Keep the maximum-volume investigation separate; the new description does not establish that all dissatisfaction is caused by insufficient loudness.

Proposed listening controls are Deep Bass, Punch, and Clarity. Broad starting regions for exploration are roughly 30-60 Hz for rumble, 60-120 Hz for bass weight/kick body, and 200-400 Hz for excessive warmth. These are design heuristics, not analysis of the named track or a measured Realme-to-CMF correction. Attack perception also depends on higher frequencies and cannot be reduced to one bass band.

Develop a modest adjustable Punch preset first, with explicit headroom handling, original-state restore, and comparison at similar vocal loudness. Do not assume maximum bass boosts yield stronger impact: overload, limiting, or masking could worsen it. Fit/seal differences and different device processing may also affect the comparison.

No Realme Buds Air 7 measurements or exact transfer profile have been obtained. Manufacturer bass marketing is not evidence of a measured response difference. The existing Harman profile's bass cuts are not the default direction for this preference.

## What owners report

| Observation | Evidence | Interpretation |
| --- | --- | --- |
| Low maximum volume, with very different results between source devices | [CMFTech volume thread](https://www.reddit.com/r/CMFTech/comments/1sv2pxa/cmf_headphone_pro_low_volume/) and [iPad comparison](https://www.reddit.com/r/NOTHING/comments/1qixrya/cmf_headphones_pro_volume_doubts/) | Investigate source/headphone volume synchronization before changing EQ. |
| Custom EQ sounds quieter than factory presets | [Owner's 24-hour review](https://www.reddit.com/r/CMFTech/comments/1o7mbnp/cmf_headphone_pro_24_hour_review/) | A preset-versus-Custom comparison is relevant; the report alone does not establish a firmware bug. |
| Owners suggest volume sync; one reports success while another says it did not fix the problem | [October discussion](https://www.reddit.com/r/headphonesindia/comments/1x7e973/regrettttttt/) | This is a diagnostic branch, not a universal solution. |
| Loudness temporarily rises after seeking, then falls on bass-heavy music | [Spotify thread](https://www.reddit.com/r/CMFTech/comments/1stfgzc/spotify_low_volume_problem_on_cmf_headphone_pro/) | Consistent with several possible processing or limiting behaviors; the author's explanation is speculation, not measured limiter evidence. |
| Complaints remain alongside firmware 1.0.1.49 | [Nothing Community discussion](https://nothing.community/d/61191) | Its changelog mentions notification volume and audio performance, but does not establish a fix for maximum music volume. |

Posts cross-posted by the same author are not independent confirmations. Reports also include owners satisfied with volume; this evidence does not establish that every unit is faulty or quiet.

## Relevant technical evidence

### Volume synchronization

[Android's documentation](https://source.android.com/docs/core/connect/bluetooth/services) explains that absolute volume coordinates source and headphone volume. Turning **Disable absolute volume** ON disables that coordination. This setting name is easy to misread. OEMs may instead expose a device-volume-sync option.

[Nothing's wired/Bluetooth FAQ](https://support.nothing.tech/hc/en-us/articles/39520867607697-Why-is-the-default-volume-much-higher-when-I-use-the-type-C-audio-cable-or-the-3-5mm-aux-in-cable-as-compared-to-Bluetooth) describes different default wired/Bluetooth levels. A default around 50% is not evidence of a permanent Bluetooth 50% cap. [CMF's control instructions](https://support.nothing.tech/hc/en-us/articles/38910369048465-How-do-I-adjust-the-volume-on-CMF-Headphone-Pro) confirm the roller adjusts Bluetooth volume.

### EQ and level

The repository's `docs/EQ-investigation.md` records that Nothing X calculates custom-EQ preamp as `-max(0, slider gains)`. Raising one slider therefore also attenuates overall level. This is the friend's documented APK/capture finding; the private decompiled sources are not in this clone.

The included reference profile applies -6.1 dB preamp and substantial bass cuts, including -5.4 dB at 50 Hz. Its purpose is Harman correction, not ULT-style bass. It only affects playback if actually applied; opening the desktop editor does not apply it.

[Equalizer APO's documentation](https://sourceforge.net/p/equalizerapo/wiki/Configuration%20reference/) explains negative preamp as a way to provide headroom for positive EQ filters. Removing attenuation or adding global positive gain can produce clipping or trigger downstream limiting. Software gain cannot guarantee additional clean acoustic output.

### Volume-dependent tuning

[Kuulokenurkka's original CMF measurements](https://kuulokenurkka.com/en/review-cmf-headphone-pro/) report volume-dependent bass/treble compensation over Bluetooth, absent in Custom mode and AUX. They also show response changes with ANC settings and the physical slider. These are the reviewer's observations for their unit, not verification of this user's firmware.

For a repeatable EQ comparison, record ANC, preset/Custom mode, slider position, personalization, spatial mode, source, and volume. Do not assume a single curve describes every combination.

### Windows playback mode and music-player processing

[Microsoft](https://learn.microsoft.com/en-us/windows-hardware/drivers/bluetooth/bluetooth-classic-audio) documents that Bluetooth Classic microphone use can switch playback from stereo A2DP to mono HFP. This matters for poor Windows sound, but cannot by itself explain low phone music volume.

[Spotify](https://support.spotify.com/us/article/volume-normalization/) documents normalization and its Quiet/Normal/Loud levels. Compare the same passage with player EQ/normalization controlled. Different services and masters are not reliable level comparisons.

## First diagnostic sequence

Perform one change at a time and start playback at a low source level before checking the roller: an unsynchronized headphone level could rise unexpectedly.

1. Connect only one source. Use a familiar music passage and keep ANC fixed. Temporarily disable spatial audio, personalization, and additional player/system EQ to establish a comparison baseline.
2. Select a stock Nothing X preset such as Pop. Compare it with Custom set flat. Record whether Custom alone causes a marked level drop.
3. During Bluetooth playback, turn the headphone roller up gradually. Observe whether the source volume indicator follows it. If the roller increases actual volume while the source was already showing its maximum, independent levels were involved.
4. On Android, first try normal absolute-volume synchronization (Disable absolute volume OFF, or device volume sync ON). Reconnect. If this still misbehaves, temporarily test the opposite state, reconnect, and adjust source and roller separately. Keep the setting that behaves correctly; neither toggle state is a guaranteed boost.
5. On Windows, check endpoint and per-app mixer levels. Close applications using the headphone microphone or select another microphone for the comparison. Retest the same music passage.
6. Compare ANC Off versus High and a modest versus high bass-slider setting. Note whether louder bass makes vocals/overall level sag. This can suggest limiting, but listening alone cannot identify its exact implementation.
7. Check the firmware version and available updates in Nothing X. If Bluetooth remains abnormally quiet with stock settings, both volume controls checked, and multiple sources, request manufacturer diagnosis or compare another unit. Do not assume a firmware patch is a proven remedy.

Useful results to record: phone/OS, firmware, stock-versus-Custom difference, whether roller tracks source, and whether the problem occurs across players.

## Sony ULT Wear target

[Sony's guide](https://helpguide.sony.net/mdr/2981/v1/en/contents/TP1001375636.html) distinguishes ULT1 deep bass from the more forceful ULT2 mode. The intended target mode must be named when fitting a profile.

The same reviewer provides [ULT Wear measurements](https://kuulokenurkka.com/en/nightclub-always-with-you-sony-ult-wear/) and a [measurement comparison tool](https://kuulokenurkka.squig.link/). Their two reviews describe the same type of measurement setup, making this a useful starting point for a response-difference fit. Check the individual measurement conditions before using data.

Proposed fitting method:

1. Choose a measured CMF Custom/ANC/slider condition that can be reproduced.
2. Choose Sony ULT1 or ULT2 under a stated condition from the same measurement source.
3. Align midrange levels, calculate target minus CMF response, and fit up to eight supported PK/LS/HS filters. Avoid overfitting narrow treble features or treating measurements from different rigs as directly interchangeable.
4. Choose preamp from the combined requested response with additional margin, then audition within verified firmware ranges. A graph-based headroom estimate is not proof of transient or acoustic headroom.
5. Save a milder bass option as well. Verify actual device readback, audible behavior, and restoration before calling a preset supported.

An EQ fit can approximate tonal balance. It cannot reproduce Sony's driver excursion, amplifier output, fit, distortion, or dynamic processing. No exact Sony clone or additional clean Bluetooth output is established by this research.

## Proposed app work

Reuse the current Rust/Tauri project and implement in this order:

1. **Diagnostic view:** show firmware, current readback EQ/preamp, Windows endpoint/per-app levels where available, and a guided source/roller comparison. Mark unavailable measurements unknown. The current protocol does not expose a verified headphone master-volume or limiter control.
2. **Reliable Apply/Restore:** persist a pre-change EQ snapshot by device identity and firmware; validate; write; read back; compare; preserve uncertain state after a timeout; offer verified restore. Connection must never apply a draft automatically. Preset activation also needs verification because the Python experiments assumed Custom was already selected in Nothing X.
3. **Bass presets:** add clearly labeled ULT-inspired Deep/Punch profiles with documented conditions and conservative headroom. Retain the existing Harman profile as a separate choice.
4. **Profile storage:** save/export drafts and the selected comparison conditions. Retain originals and provide bypass/restore.
5. **Optional Windows processing:** assess an Equalizer APO export/integration separately if host processing is needed. This affects Windows playback, not phone playback, and is not an amplifier unlock. Compression/limiting requires a real audio-processing path; ordinary RFCOMM control commands do not process PCM audio.

No source code, device settings, firmware, Windows registry, or installed audio drivers were changed for this research. No automated tests or hardware experiments were run.
