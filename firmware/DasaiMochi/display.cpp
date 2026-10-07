#include "display.h"
#include "config.h"
#include "faces_normal.h"
#include "faces_happy.h"

#include <U8g2lib.h>
#include <Wire.h>

#if DM_DISPLAY_SH1106
  U8G2_SH1106_128X64_NONAME_F_HW_I2C
#else
  U8G2_SSD1306_128X64_NONAME_F_HW_I2C
#endif
  u8g2(U8G2_R0, U8X8_PIN_NONE, PIN_OLED_SCL, PIN_OLED_SDA);

namespace {

DmFace   activeFace   = DM_FACE_NORMAL;
uint16_t frameIndex   = 0;
uint32_t lastFrameMs  = 0;
bool     showingText  = false;

struct Animation {
  const unsigned char* const* frames;
  uint16_t count;
};

Animation animationFor(DmFace face) {
  if (face == DM_FACE_HAPPY) return { dmHappyFrames,  DMHAPPY_FRAME_COUNT };
  return { dmNormalFrames, DMNORMAL_FRAME_COUNT };
}

}  // namespace

void displayBegin() {
  Wire.begin(PIN_OLED_SDA, PIN_OLED_SCL);
  u8g2.begin();
  u8g2.setBitmapMode(0);
}

void displaySetFace(DmFace face, bool restart) {
  // Compare BEFORE assigning, otherwise the change is never detected and a
  // switch from happy (98 frames) to normal (90) would keep an index that is
  // past the end of the shorter table.
  const bool changed = (face != activeFace) || showingText;
  if (!changed && !restart) return;

  activeFace  = face;
  showingText = false;
  if (changed || restart) frameIndex = 0;
}

void displayUpdate() {
  if (showingText) return;

  const uint32_t now = millis();
  if (now - lastFrameMs < DM_FRAME_INTERVAL_MS) return;
  lastFrameMs = now;

  const Animation anim = animationFor(activeFace);
  if (anim.count == 0) return;
  if (frameIndex >= anim.count) frameIndex = 0;  // belt and braces

  // The frame table itself lives in flash, so read the pointer through
  // pgm_read_ptr rather than dereferencing the table directly.
  const unsigned char* frame =
      reinterpret_cast<const unsigned char*>(pgm_read_ptr(&anim.frames[frameIndex]));

  u8g2.clearBuffer();
  u8g2.drawXBMP(0, 0, 128, 64, frame);
  u8g2.sendBuffer();

  frameIndex++;
  if (frameIndex >= anim.count) frameIndex = 0;
}

void displayMessage(const char* line1, const char* line2) {
  showingText = true;
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_6x12_tr);
  if (line1) u8g2.drawStr(0, 26, line1);
  if (line2) u8g2.drawStr(0, 44, line2);
  u8g2.sendBuffer();
}
