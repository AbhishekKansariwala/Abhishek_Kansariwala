// Host-side tests for the notification core. Build and run:
//   g++ -std=c++17 -Wall -Wextra -I DasaiMochi
//       test/test_notify.cpp DasaiMochi/notify.cpp -o /tmp/t && /tmp/t
#include "notify.h"

#include <cstdio>
#include <cstring>
#include <string>

static int failures = 0;
static int checks = 0;

static void check(bool ok, const std::string& what) {
  checks++;
  if (!ok) { failures++; std::printf("  FAIL  %s\n", what.c_str()); }
}

static void eqStr(const char* got, const char* want, const std::string& what) {
  checks++;
  if (std::strcmp(got, want) != 0) {
    failures++;
    std::printf("  FAIL  %s\n        got  \"%s\"\n        want \"%s\"\n", what.c_str(), got, want);
  }
}

static DmNotification make(uint32_t uid, const char* app) {
  DmNotification n{};
  n.uid = uid;
  n.category = DM_CAT_MESSAGE;
  std::snprintf(n.app, sizeof(n.app), "%s", app);
  return n;
}

static void testQueue() {
  std::printf("queue\n");
  DmNotifyQueue q;
  DmNotification out{};

  check(q.empty() && q.size() == 0, "starts empty");
  check(!q.pop(out), "pop on empty returns false");

  check(q.push(make(1, "WhatsApp")), "push reports no drop");
  check(q.size() == 1, "size is 1");
  check(q.peek(out) && out.uid == 1, "peek does not consume");
  check(q.size() == 1, "peek left size alone");
  check(q.pop(out) && out.uid == 1, "pop returns the first");
  check(q.empty(), "empty again");

  // FIFO order
  for (uint32_t i = 1; i <= 5; i++) q.push(make(i, "App"));
  bool fifo = true;
  for (uint32_t i = 1; i <= 5; i++) { q.pop(out); fifo = fifo && out.uid == i; }
  check(fifo, "pops in FIFO order");

  // Overflow drops the oldest
  q.clear();
  for (uint32_t i = 1; i <= DmNotifyQueue::CAPACITY; i++) check(q.push(make(i, "App")), "fits");
  check(!q.push(make(99, "App")), "push past capacity reports a drop");
  check(q.size() == DmNotifyQueue::CAPACITY, "size stays at capacity");
  q.pop(out);
  check(out.uid == 2, "oldest was dropped, not the newest");

  // removeByUid, including order preservation
  q.clear();
  for (uint32_t i = 1; i <= 4; i++) q.push(make(i, "App"));
  check(q.removeByUid(2), "removes a middle entry");
  check(!q.removeByUid(2), "second removal of the same uid fails");
  check(q.size() == 3, "size dropped by one");
  q.pop(out); check(out.uid == 1, "order kept: 1");
  q.pop(out); check(out.uid == 3, "order kept: 3 (2 was removed)");
  q.pop(out); check(out.uid == 4, "order kept: 4");

  // removeByUid across the ring wrap
  q.clear();
  for (uint32_t i = 1; i <= DmNotifyQueue::CAPACITY; i++) q.push(make(i, "A"));
  for (int i = 0; i < 5; i++) q.pop(out);          // head is now mid-array
  for (uint32_t i = 100; i < 104; i++) q.push(make(i, "B"));
  check(q.removeByUid(101), "removes across the wrap");
  check(q.size() == 6, "size after wrapped removal");
  q.pop(out); check(out.uid == 6, "wrapped order kept");
}

static void testWrap() {
  std::printf("wrap\n");
  DmTextLines L{};

  dmWrapText("", 21, L);
  check(L.count == 0, "empty string gives no lines");

  dmWrapText(nullptr, 21, L);
  check(L.count == 0, "null input is safe");

  dmWrapText("   \n\t  ", 21, L);
  check(L.count == 0, "whitespace-only gives no lines");

  dmWrapText("hello", 21, L);
  check(L.count == 1, "short text is one line");
  eqStr(L.line[0], "hello", "short text content");

  dmWrapText("the quick brown fox jumps over the lazy dog", 21, L);
  check(L.count >= 2, "long text wraps");
  bool withinCols = true;
  for (size_t i = 0; i < L.count; i++) withinCols = withinCols && std::strlen(L.line[i]) <= 21;
  check(withinCols, "no line exceeds the column limit");
  eqStr(L.line[0], "the quick brown fox", "breaks on a space, not mid-word");

  // A word longer than a line must be hard-split, not dropped or overflowed.
  dmWrapText("supercalifragilisticexpialidocious", 10, L);
  check(L.count >= 1, "long word produces lines");
  eqStr(L.line[0], "supercalif", "hard-splits an over-long word");

  // Overflow past MAX_LINES ends with an ellipsis that still fits.
  dmWrapText("one two three four five six seven eight nine ten eleven twelve "
             "thirteen fourteen fifteen sixteen", 21, L);
  check(L.count == DmTextLines::MAX_LINES, "fills all lines");
  const char* last = L.line[DmTextLines::MAX_LINES - 1];
  check(std::strlen(last) >= 3 && std::strcmp(last + std::strlen(last) - 3, "...") == 0,
        "last line ends with an ellipsis");
  check(std::strlen(last) <= 21, "ellipsis line still fits the width");

  // Whitespace collapsing
  dmWrapText("a\n\nb\t\tc   d", 21, L);
  check(L.count == 1, "newlines and tabs collapse to one line");
  eqStr(L.line[0], "a b c d", "whitespace runs collapse to single spaces");

  // Non-ASCII: Devanagari and emoji cannot be drawn by the ASCII fonts.
  dmWrapText("\xe0\xa4\xa8\xe0\xa4\xae\xe0\xa4\xb8\xe0\xa5\x8d\xe0\xa4\xa4\xe0\xa5\x87", 21, L);
  check(L.count == 1, "all-Devanagari still yields a line");
  eqStr(L.line[0], "?", "a run of non-ASCII collapses to a single '?'");

  dmWrapText("Call from \xf0\x9f\x98\x80 Mum", 21, L);
  eqStr(L.line[0], "Call from ? Mum", "emoji becomes one '?' and keeps the ASCII around it");

  // Exactly-at-the-boundary cases
  dmWrapText("abcdefghij", 10, L);
  check(L.count == 1, "text exactly the column width is one line");
  eqStr(L.line[0], "abcdefghij", "exact-width content intact");

  dmWrapText("abcdefghijk", 10, L);
  check(L.count == 2, "one char over wraps to two lines");

  // cols larger than MAX_COLS must be clamped, not overflow the buffer
  dmWrapText("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 999, L);
  check(std::strlen(L.line[0]) <= DmTextLines::MAX_COLS, "cols clamped to MAX_COLS");

  dmWrapText("anything", 0, L);
  check(L.count == 0, "zero columns yields nothing rather than looping");
}

int main() {
  testQueue();
  testWrap();
  std::printf("\n%d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
