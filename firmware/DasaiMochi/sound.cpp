#include "sound.h"
#include "config.h"

#include <driver/i2s.h>

// The speaker is driven by the MAX98357A over I2S -- there is no PWM buzzer
// on a GPIO. The original sketch called ledcWriteTone(BUZZER_CHANNEL, ...)
// with BUZZER_CHANNEL never defined (so it did not compile) and no ledc
// channel ever attached, while the I2S driver it did install was never
// written to. Tones are synthesised into the I2S stream here instead.

const DmNote DM_MELODY_HAPPY[3] = { {988, 120}, {1318, 120}, {1760, 150} };
const DmNote DM_MELODY_BOOT[2]  = { {660, 90},  {990, 120} };

namespace {

constexpr size_t  kChunkSamples = 128;
constexpr uint32_t kFadeSamples = 64;   // ~3 ms at 22.05 kHz, kills clicks

const DmNote* sequence     = nullptr;
uint8_t       sequenceLen  = 0;
uint8_t       notePos      = 0;

uint32_t noteSamplesLeft   = 0;
uint32_t noteSamplesTotal  = 0;
uint32_t phase             = 0;  // 32-bit phase accumulator
uint32_t phaseIncrement    = 0;
int16_t  noteAmplitude     = 0;
bool     ready             = false;

int16_t amplitudeFor(uint16_t freq) {
  if (freq == 0) return 0;
  const int32_t full = 32767L * DM_TONE_VOLUME / 100;
  return static_cast<int16_t>(full);
}

void beginNote(const DmNote& n) {
  noteSamplesTotal = (static_cast<uint32_t>(DM_SAMPLE_RATE_OUT) * n.ms) / 1000UL;
  noteSamplesLeft  = noteSamplesTotal;
  noteAmplitude    = amplitudeFor(n.freq);
  phase            = 0;
  phaseIncrement   = n.freq == 0
      ? 0
      : static_cast<uint32_t>((static_cast<uint64_t>(n.freq) << 32) / DM_SAMPLE_RATE_OUT);
}

// Linear fade at both ends of a note so the square wave does not click.
int32_t envelope(uint32_t samplesLeft, uint32_t total) {
  const uint32_t fade = (total < kFadeSamples * 2) ? total / 2 : kFadeSamples;
  if (fade == 0) return 256;
  const uint32_t elapsed = total - samplesLeft;
  if (elapsed < fade)     return static_cast<int32_t>((elapsed * 256) / fade);
  if (samplesLeft < fade) return static_cast<int32_t>((samplesLeft * 256) / fade);
  return 256;
}

void writeSilence() {
  int16_t quiet[kChunkSamples] = {0};
  size_t written = 0;
  i2s_write(I2S_NUM_0, quiet, sizeof(quiet), &written, 0);
}

}  // namespace

void soundBegin() {
  i2s_config_t cfg = {};
  cfg.mode                 = static_cast<i2s_mode_t>(I2S_MODE_MASTER | I2S_MODE_TX);
  cfg.sample_rate          = DM_SAMPLE_RATE_OUT;
  cfg.bits_per_sample      = I2S_BITS_PER_SAMPLE_16BIT;
  cfg.channel_format       = I2S_CHANNEL_FMT_ONLY_LEFT;
  cfg.communication_format = I2S_COMM_FORMAT_STAND_I2S;
  cfg.intr_alloc_flags     = 0;
  cfg.dma_buf_count        = 8;
  cfg.dma_buf_len          = 64;
  cfg.use_apll             = false;
  cfg.tx_desc_auto_clear   = true;

  i2s_pin_config_t pins = {};
  pins.bck_io_num   = PIN_I2S_BCLK;
  pins.ws_io_num    = PIN_I2S_LRCL;
  pins.data_out_num = PIN_I2S_DOUT;
  pins.data_in_num  = I2S_PIN_NO_CHANGE;

  ready = (i2s_driver_install(I2S_NUM_0, &cfg, 0, nullptr) == ESP_OK) &&
          (i2s_set_pin(I2S_NUM_0, &pins) == ESP_OK);
}

void soundPlay(const DmNote* notes, uint8_t count) {
  if (!ready || notes == nullptr || count == 0) return;
  sequence    = notes;
  sequenceLen = count;
  notePos     = 0;
  beginNote(sequence[0]);
}

bool soundBusy() { return sequence != nullptr; }

void soundUpdate() {
  if (!ready || sequence == nullptr) return;

  int16_t buffer[kChunkSamples];

  while (sequence != nullptr) {
    if (noteSamplesLeft == 0) {
      notePos++;
      if (notePos >= sequenceLen) {   // melody finished
        sequence = nullptr;
        writeSilence();
        return;
      }
      beginNote(sequence[notePos]);
    }

    const size_t want = noteSamplesLeft < kChunkSamples
                            ? static_cast<size_t>(noteSamplesLeft)
                            : kChunkSamples;

    const uint32_t phaseAtStart = phase;
    uint32_t       p            = phase;
    uint32_t       left         = noteSamplesLeft;
    for (size_t i = 0; i < want; i++) {
      const int32_t square = (p & 0x80000000UL) ? noteAmplitude : -noteAmplitude;
      buffer[i] = static_cast<int16_t>((square * envelope(left, noteSamplesTotal)) >> 8);
      p    += phaseIncrement;
      left -= 1;
    }

    size_t written = 0;
    i2s_write(I2S_NUM_0, buffer, want * sizeof(int16_t), &written, 0);
    const size_t samplesWritten = written / sizeof(int16_t);

    // Only consume what the DMA actually accepted, and rewind the phase for
    // the samples that were generated but dropped, or the tone drifts sharp.
    phase            = phaseAtStart + phaseIncrement * samplesWritten;
    noteSamplesLeft -= samplesWritten;

    if (samplesWritten < want) return;   // DMA full, continue next loop()
  }
}
