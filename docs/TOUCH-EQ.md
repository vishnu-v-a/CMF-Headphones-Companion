# Editable EQ graph and +10 dB gain ceiling

Updated 25 October 2026. The owner reports hearing a gain increase; its size
and distortion have not been measured. The app now allows device preamp
steps from -30 to +10 dB instead of +3 dB. This is an application bound, not
a manufacturer specification. Each change remains one dB, preserves the
actual device filters, saves recovery/undo records and verifies readback.
There is no automatic jump to +10. Normal EQ Apply retains its existing
headroom and positive-preamp restrictions; Output gain remains separate.

## Graph editing on Windows and Android

- Every enabled band has a numbered point on the combined response curve.
  Drag horizontally for frequency (20–20,000 Hz on a logarithmic axis),
  vertically for band gain. The preamp and Q stay unchanged.
- Tap/click a point to open numeric frequency, gain, Q, type and enable
  controls. Disabled bands must first be enabled using their band slot.
  For coincident points, select the desired band in the eight-band strip.
- Graph gestures have a 48 CSS-pixel hit diameter. Pointer capture stays on
  the stable SVG root while points are redrawn. Single-finger touch, mouse
  and pen share the same implementation; additional pointers are ignored.
- The scale stays fixed while dragging, then fits the new curve on release.
  Finger-to-point offset is preserved. Peak/shelf cutoff response is accounted
  for when mapping the combined curve back to the selected filter's gain.
- Direct dragging normally bounds gain to ±24 dB. Existing values outside
  that range are preserved as reachable endpoints; numeric controls retain
  their original validation. This is an editor interaction range, not a
  claim about headphone filter limits.
- Arrow keys on the graph adjust the selected enabled band. Left/right
  changes frequency by a twelfth octave, up/down changes gain by 0.5 dB.
  Shift gives finer steps. Enter/Space opens numeric controls.
- Undo draft recovers the state before a drag. Escape, a cancelled pointer,
  lost capture, page hiding or a window resize cancels an unfinished drag.
  No native headphone command is invoked by graph editing. Apply is explicit;
  headroom is not silently changed during dragging.

Validation uses source syntax/whitespace checks and the Windows/Android
build workflows. No automated tests are run under AGENTS.md. Live pointer
and Android touch behavior require visual/device confirmation; build success
alone does not prove those interactions or acoustic output.
