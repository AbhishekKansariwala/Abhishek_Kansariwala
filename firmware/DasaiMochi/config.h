#ifndef DM_CONFIG_H
#define DM_CONFIG_H

// ===========================================================================
//  Dasai Mochi - build configuration
//
//  Hardware: Waveshare ESP32-C3 SuperMini, SSD1306/SH1106 128x64 OLED,
//            MAX98357A I2S amp + speaker, TTP223 touch pads,
//            INMP441 I2S microphone (added, not in the original build).
// ===========================================================================

// --- ESP32-C3 strapping pins: 2, 8, 9 -------------------------------------
// These are sampled at reset and decide the boot mode. GPIO9 is the BOOT pin:
// held LOW at reset the chip stays in the serial bootloader and your sketch
// never runs. A stock TTP223 idles LOW and drives push-pull, so a touch pad
// wired to GPIO9 -- as in the original sketch -- holds the board in download
// mode on every power-up. The default map below keeps all three pins clear.
// (If your TTP223 is strapped active-low it idles HIGH and the original
// wiring boots; set DM_LEGACY_WIRING to 1 to keep it.)
#define DM_LEGACY_WIRING 0

// --- Display ---------------------------------------------------------------
// The BOM lists a 1.3" 128x64 panel, which is usually an SH1106 controller,
// but the original sketch drives it as an SSD1306. If the picture is shifted
// a few pixels sideways or wraps, you have an SH1106: set this to 1.
#define DM_DISPLAY_SH1106 0

#define PIN_OLED_SDA 4
#define PIN_OLED_SCL 5

// --- I2S audio bus (shared clock between amp and mic) ----------------------
#define PIN_I2S_BCLK 0
#define PIN_I2S_LRCL 1

#if DM_LEGACY_WIRING
  #define PIN_I2S_DOUT   2   // strapping pin - see note above
  #define PIN_TOUCH_PET  9   // BOOT pin - see note above
  #define DM_HAS_MIC     0
  #define DM_HAS_TOUCH_TALK 0
#else
  #define PIN_I2S_DOUT   3   // -> MAX98357A DIN   (moved off GPIO2)
  #define PIN_I2S_DIN   10   // <- INMP441 SD      (new)
  #define PIN_TOUCH_PET  7   // TTP223 #1, petting (moved off GPIO9)
  #define PIN_TOUCH_TALK 6   // TTP223 #2, push-to-talk (new)
  #define DM_HAS_MIC     1
  #define DM_HAS_TOUCH_TALK 1
#endif

// GPIO8 drives the SuperMini's onboard LED and is also a strapping pin.
// Leave it undriven at boot; only use it once setup() has run.
#define PIN_STATUS_LED 8

// --- Audio -----------------------------------------------------------------
#define DM_SAMPLE_RATE_OUT 22050   // playback, matches the original sketch
#define DM_SAMPLE_RATE_IN  16000   // capture, what most speech APIs expect
#define DM_TONE_VOLUME     60      // 0-100, percent of full scale

// --- Animation -------------------------------------------------------------
#define DM_FRAME_INTERVAL_MS 40    // 25 fps, as in the original

#endif  // DM_CONFIG_H
