#ifndef DM_SOUND_H
#define DM_SOUND_H

#include <Arduino.h>

// A note in a melody. freq == 0 is a rest.
struct DmNote {
  uint16_t freq;  // Hz
  uint16_t ms;    // duration
};

void soundBegin();

// Starts a melody. The sequence is NOT copied, so it must outlive playback --
// point it at a const array in flash. Starting a new melody cancels the
// previous one.
void soundPlay(const DmNote* notes, uint8_t count);

// Feeds the I2S DMA. Must be called often from loop(); it never blocks, so
// the face animation keeps running while a sound plays. (The original sketch
// used delay() per note, which froze the display and ignored touch.)
void soundUpdate();

bool soundBusy();

extern const DmNote DM_MELODY_HAPPY[3];
extern const DmNote DM_MELODY_BOOT[2];

#endif  // DM_SOUND_H
