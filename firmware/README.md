# Dasai Mochi firmware

ESP32-C3 firmware for the Dasai Mochi desktop companion. Restructured from the
original single-file sketch in
[maraulsav/Dasai-Mochi](https://github.com/maraulsav/Dasai-Mochi) — the 188 face
frames are from that project, the surrounding code has been rewritten.

> That repository carries **no licence file**, so the frame data has no explicit
> grant of reuse. Worth asking the author before publishing this anywhere.

## What was wrong with the original

| Problem | Effect |
|---|---|
| `BUZZER_CHANNEL` used but never defined | **The sketch did not compile** |
| No `ledcSetup` / `ledcAttach` anywhere | No PWM channel existed to make a tone |
| `setupI2S()` installed, never written to | The MAX98357A amp was silent |
| Touch on **GPIO9** | GPIO9 is the BOOT strapping pin — a stock TTP223 idles LOW and drives push-pull, holding the board in the serial bootloader at every reset |
| I2S data out on **GPIO2** | Also a strapping pin; leaving it floating at reset is not recommended |
| `delay()` per note and per frame | Animation froze during sounds and touch was ignored |

The speaker is driven by the MAX98357A over I2S — there is no PWM buzzer on a
GPIO at all, which is why `SPEAKER_PIN` was defined and never used. Tones are
now synthesised into the I2S stream.

## Pin map

Defaults avoid all three ESP32-C3 strapping pins (2, 8, 9).

| Signal | GPIO | Change |
|---|---|---|
| OLED SDA | 4 | unchanged |
| OLED SCL | 5 | unchanged |
| I2S BCLK | 0 | unchanged, shared by amp and mic |
| I2S LRCLK / WS | 1 | unchanged, shared |
| I2S DOUT → MAX98357A DIN | 3 | **moved** from GPIO2 |
| I2S DIN ← INMP441 SD | 10 | **new** |
| TTP223 #1 (petting) | 7 | **moved** from GPIO9 |
| TTP223 #2 (push-to-talk) | 6 | **new**, second pad from the BOM |
| Onboard LED | 8 | status only, never driven at boot |

Set `DM_LEGACY_WIRING 1` in `config.h` to keep the original wiring — only do
that if your TTP223 is strapped active-low, otherwise the board will not boot
into the sketch.

If the picture is shifted sideways or wraps, your 1.3" panel is an SH1106 and
not the SSD1306 the original assumed: set `DM_DISPLAY_SH1106 1`.

## Layout

```
DasaiMochi/
  DasaiMochi.ino    state machine: touch -> face + sound
  config.h          pin map, feature flags, tunables
  display.h/.cpp    OLED + non-blocking animation
  sound.h/.cpp      I2S tone synthesis, non-blocking melodies
  faces_normal.h    90 frames   (generated)
  faces_happy.h     98 frames   (generated)
platformio.ini      CI build
```

`faces_*.h` are generated from the original sketch and verified byte-for-byte
against it — don't hand-edit them.

## Building

**Arduino IDE** — open `DasaiMochi/DasaiMochi.ino`, board *ESP32C3 Dev Module*,
install the **U8g2** library.

**PlatformIO** — `cd firmware && pio run`.

**CI** — `.github/workflows/firmware.yml` builds on every push and uploads the
flashable parts plus a `manifest.json` the web installer can serve.

## Status

Implemented: display, animation, touch, working audio.
Not yet implemented: Wi-Fi, setup portal, microphone capture, AI. The pin map
and the second touch pad are in place for them.
