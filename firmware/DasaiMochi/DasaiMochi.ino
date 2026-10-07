// ===========================================================================
//  Dasai Mochi - desktop companion firmware
//
//  Restructured from the original single-file sketch by Maritza Aulia
//  (github.com/maraulsav/Dasai-Mochi). The face frames are that project's;
//  the surrounding code has been rewritten.
//
//  Build: Arduino IDE with the ESP32 core (board: "ESP32C3 Dev Module"),
//         or `pio run` from the firmware/ directory.
//  Needs: U8g2 library.
// ===========================================================================

#include "config.h"
#include "display.h"
#include "sound.h"

namespace {

bool     petHeld       = false;
uint32_t petChangedMs  = 0;

constexpr uint32_t kDebounceMs = 25;

// TTP223 modules debounce in hardware, but a short guard costs nothing and
// stops a noisy pad from retriggering the sound every loop.
bool readPet() {
  const bool raw = digitalRead(PIN_TOUCH_PET) == HIGH;
  const uint32_t now = millis();
  if (raw != petHeld && (now - petChangedMs) >= kDebounceMs) {
    petHeld = raw;
    petChangedMs = now;
    return true;    // state changed
  }
  if (raw == petHeld) petChangedMs = now;
  return false;
}

}  // namespace

void setup() {
  Serial.begin(115200);

  pinMode(PIN_TOUCH_PET, INPUT);
#if DM_HAS_TOUCH_TALK
  pinMode(PIN_TOUCH_TALK, INPUT);   // reserved for push-to-talk
#endif

  displayBegin();
  soundBegin();

  displaySetFace(DM_FACE_NORMAL, true);
  soundPlay(DM_MELODY_BOOT, 2);
}

void loop() {
  const bool changed = readPet();

  if (changed && petHeld) {
    displaySetFace(DM_FACE_HAPPY, true);
    soundPlay(DM_MELODY_HAPPY, 3);
  } else if (changed && !petHeld) {
    displaySetFace(DM_FACE_NORMAL, true);
  }

  // Both are non-blocking; the face keeps animating while a sound plays.
  displayUpdate();
  soundUpdate();
}
