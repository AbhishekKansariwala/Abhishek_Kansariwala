#ifndef DM_DISPLAY_H
#define DM_DISPLAY_H

#include <Arduino.h>

enum DmFace : uint8_t {
  DM_FACE_NORMAL = 0,
  DM_FACE_HAPPY  = 1,
};

void displayBegin();

// Switches the active animation. Restarting the same face rewinds it to
// frame 0; switching to the face already playing is a no-op, so calling this
// every loop iteration does not freeze the animation on frame 0.
void displaySetFace(DmFace face, bool restart = false);

// Advances the animation when enough time has passed. Non-blocking: unlike
// the original sketch's delay(40) this returns immediately, so touch stays
// responsive and audio keeps being fed while a face is playing.
void displayUpdate();

// Replaces the animation with two lines of text until the next
// displaySetFace() call. Used for Wi-Fi setup and error states.
void displayMessage(const char* line1, const char* line2 = nullptr);

#endif  // DM_DISPLAY_H
