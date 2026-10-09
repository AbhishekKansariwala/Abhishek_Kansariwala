#include "notify.h"

#include <string.h>

// ------------------------------------------------------------------ queue --
bool DmNotifyQueue::push(const DmNotification& n) {
  bool dropped = false;
  if (count_ == CAPACITY) {
    head_ = (head_ + 1) % CAPACITY;   // drop oldest
    count_--;
    dropped = true;
  }
  items_[(head_ + count_) % CAPACITY] = n;
  count_++;
  return !dropped;
}

bool DmNotifyQueue::pop(DmNotification& out) {
  if (count_ == 0) return false;
  out = items_[head_];
  head_ = (head_ + 1) % CAPACITY;
  count_--;
  return true;
}

bool DmNotifyQueue::peek(DmNotification& out) const {
  if (count_ == 0) return false;
  out = items_[head_];
  return true;
}

bool DmNotifyQueue::removeByUid(uint32_t uid) {
  for (size_t i = 0; i < count_; i++) {
    const size_t idx = (head_ + i) % CAPACITY;
    if (items_[idx].uid != uid) continue;
    // Shift the remaining entries down one slot to close the gap.
    for (size_t j = i; j + 1 < count_; j++) {
      items_[(head_ + j) % CAPACITY] = items_[(head_ + j + 1) % CAPACITY];
    }
    count_--;
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- wrapping --
namespace {

inline bool isSpace(char c) {
  return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v';
}

// Normalise into a scratch buffer: collapse whitespace, turn unprintable and
// non-ASCII bytes into a single '?', trim the ends.
size_t normalise(const char* in, char* out, size_t outCap) {
  if (in == nullptr || outCap == 0) { if (outCap) out[0] = '\0'; return 0; }

  size_t n = 0;
  bool pendingSpace = false;
  bool lastWasQuery = false;

  for (const unsigned char* p = (const unsigned char*)in; *p && n + 1 < outCap; p++) {
    const unsigned char c = *p;

    if (isSpace((char)c)) { pendingSpace = (n > 0); lastWasQuery = false; continue; }

    char emit;
    if (c >= 0x80 || c < 0x20 || c == 0x7f) {
      if (lastWasQuery) continue;      // collapse a multi-byte run into one '?'
      emit = '?';
      lastWasQuery = true;
    } else {
      emit = (char)c;
      lastWasQuery = false;
    }

    if (pendingSpace) { out[n++] = ' '; pendingSpace = false; if (n + 1 >= outCap) break; }
    out[n++] = emit;
  }

  out[n] = '\0';
  return n;
}

}  // namespace

void dmWrapText(const char* text, size_t cols, DmTextLines& out) {
  out.count = 0;
  for (size_t i = 0; i < DmTextLines::MAX_LINES; i++) out.line[i][0] = '\0';

  if (cols == 0) return;
  if (cols > DmTextLines::MAX_COLS) cols = DmTextLines::MAX_COLS;

  char buf[256];
  const size_t len = normalise(text, buf, sizeof(buf));
  if (len == 0) return;

  size_t pos = 0;
  while (pos < len && out.count < DmTextLines::MAX_LINES) {
    while (pos < len && buf[pos] == ' ') pos++;
    if (pos >= len) break;

    size_t take = len - pos;
    if (take > cols) {
      // Break at the last space that fits; if there is none the word is
      // longer than a line, so hard-split it.
      size_t brk = 0;
      for (size_t i = 0; i <= cols && pos + i < len; i++) {
        if (buf[pos + i] == ' ') brk = i;
      }
      take = brk > 0 ? brk : cols;
    }

    const bool lastLine = (out.count + 1 == DmTextLines::MAX_LINES);
    size_t more = pos + take;
    while (more < len && buf[more] == ' ') more++;

    if (lastLine && more < len) {
      // Leave room for the ellipsis rather than overflowing the line.
      size_t keep = take;
      if (keep + 3 > cols) keep = (cols > 3) ? cols - 3 : 0;
      memcpy(out.line[out.count], buf + pos, keep);
      memcpy(out.line[out.count] + keep, "...", 3);
      out.line[out.count][keep + 3] = '\0';
      out.count++;
      return;
    }

    memcpy(out.line[out.count], buf + pos, take);
    out.line[out.count][take] = '\0';
    out.count++;
    pos += take;
  }
}
