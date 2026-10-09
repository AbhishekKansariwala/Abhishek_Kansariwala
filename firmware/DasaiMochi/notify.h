#ifndef DM_NOTIFY_H
#define DM_NOTIFY_H

// Notification model, queue and text layout.
//
// Deliberately free of Arduino and BLE headers so it builds on a host
// compiler and can be unit-tested -- this is where the fiddly bugs live
// (wrapping, truncation, non-ASCII), not in the radio code.

#include <stddef.h>
#include <stdint.h>

enum DmCategory : uint8_t {
  DM_CAT_OTHER = 0,
  DM_CAT_CALL,
  DM_CAT_MESSAGE,
  DM_CAT_EMAIL,
  DM_CAT_SOCIAL,
  DM_CAT_SCHEDULE,
};

struct DmNotification {
  uint32_t   uid;       // ANCS notification UID, or a counter on Android
  DmCategory category;
  char       app[24];
  char       title[40];
  char       body[96];
};

// Fixed-capacity ring. When full the oldest entry is dropped: a desk pet
// should show the newest thing, not stall on a backlog.
class DmNotifyQueue {
 public:
  static const size_t CAPACITY = 8;

  // Returns false if an older entry had to be dropped to make room.
  bool push(const DmNotification& n);
  bool pop(DmNotification& out);
  // ANCS also sends "notification removed"; drop it if still queued.
  bool removeByUid(uint32_t uid);
  bool peek(DmNotification& out) const;

  size_t size() const { return count_; }
  bool   empty() const { return count_ == 0; }
  void   clear() { head_ = 0; count_ = 0; }

 private:
  DmNotification items_[CAPACITY];
  size_t head_ = 0;
  size_t count_ = 0;
};

// Lines of text sized for the 128x64 panel.
struct DmTextLines {
  static const size_t MAX_LINES = 4;
  static const size_t MAX_COLS  = 21;   // 128 px / 6 px glyph
  char   line[MAX_LINES][MAX_COLS + 1];
  size_t count;
};

// Word-wraps `text` to `cols` columns.
//
// - Collapses runs of whitespace, including newlines and tabs.
// - Hard-splits a single word longer than `cols`.
// - If the text does not fit in MAX_LINES, the last line ends in "...".
// - Bytes >= 0x80 become '?', collapsed: the U8g2 ASCII fonts cannot draw
//   Devanagari or emoji, and drawing the raw bytes produces garbage. A
//   message that is entirely non-ASCII therefore renders as a short run of
//   '?' rather than nothing at all.
void dmWrapText(const char* text, size_t cols, DmTextLines& out);

#endif  // DM_NOTIFY_H
