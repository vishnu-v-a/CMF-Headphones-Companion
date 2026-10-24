# Monochrome glossy design

Implemented 24 October 2026. This is a Nothing-inspired presentation for
the unofficial companion; no official Nothing app artwork or proprietary
typeface has been copied.

The appearance is now consistently dark, independent of the Windows theme:
black shell, layered charcoal panels, white selected controls, white EQ
curve, gray secondary text, and subtle inset highlights/shadows. Gloss is
drawn with CSS gradients, not operating-system blur or a downloaded image.
The device header has a restrained dot pattern and a new vector dot mark.
Display headings and gain numerals use the locally bundled Doto variable
font; small functional labels retain the system font for readability.

`ui/style.css` retains the compact layout with monochrome semantic colors.
`ui/monochrome.css` provides surface/typography treatments. All tabs, gain
steps, modal confirmations, readback rules, snapshots and hardware behavior
are unchanged by this design commit. The Tauri window background matches
the CSS background to avoid a warm flash on startup.

Selected controls use white with black text; inactive controls stay dark.
Disabled controls are dimmed, while selected read-only/busy states remain
recognizable. Keyboard focus keeps a visible white outline. Warning text
uses a dotted underline or a white side rule; error notifications also have
a stronger side rule so status is not dependent on a colored accent.
The existing reduced-motion preference remains supported.

All eight bands remain in the existing strip and the Controls/Equalizer/
Profiles organization stays in place. No navigation or audio settings are
changed for this visual redesign.

Font source and license:
[Doto upstream](https://github.com/oliverlalan/Doto),
`ui/fonts/OFL-Doto.txt`. Font assets are bundled; no internet request is
made by the app for typography.

Validation: JavaScript syntax, JSON/SVG parsing, whitespace and asset-path
review, plus a GitHub Windows build. No automated test suite is run under
AGENTS.md. Browser automation currently fails at initialization, so no live
screenshot or visual layout verification is claimed. Hardware gain/spatial
validation status is unchanged from the previous build.
