# Firmware files

`manifest.json` is what the Install button reads. **The `.bin` files it points at are
not in this repo yet** — drop them in and the installer starts working. Until then the
page loads but flashing fails with a 404.

Expected layout:

```
firmware/
  manifest.json
  esp32c3/
    bootloader.bin
    partitions.bin
    boot_app0.bin
    mochi.bin        <- your application
```

## Where the files come from

**Arduino IDE** — `Sketch → Export compiled binary`, then look in `build/esp32.esp32.*/`.
You want the four files above. `boot_app0.bin` ships with the core, under
`packages/esp32/hardware/esp32/<ver>/tools/partitions/boot_app0.bin`.

**PlatformIO** — `.pio/build/<env>/firmware.bin` is the application; the bootloader and
partition table are in the same folder.

**ESP-IDF** — `idf.py build`, then take `build/bootloader/bootloader.bin`,
`build/partition_table/partition-table.bin` and `build/<project>.bin`.

## The offsets matter

| Part | Offset (dec) | Offset (hex) |
|---|---|---|
| bootloader | 0 | `0x0` |
| partition table | 32768 | `0x8000` |
| boot_app0 | 57344 | `0xe000` |
| application | 65536 | `0x10000` |

Those are the **ESP32-C3** offsets. Note the bootloader sits at `0x0` on the C3 —
on a plain ESP32 it sits at `0x1000` (4096). Getting this wrong flashes cleanly and
then boot-loops, so double-check against your own build log, which prints each offset.

## Single merged binary instead

If you'd rather ship one file (`esptool.py merge_bin` output), replace the `parts`
array with a single entry at offset 0:

```json
"parts": [{ "path": "esp32c3/mochi-merged.bin", "offset": 0 }]
```

## Adding another board

Append another object to `builds` with its own `chipFamily` — `ESP32`, `ESP32-S3`,
`ESP32-C6`, `ESP8266` and others are supported. The installer detects the connected
chip and picks the matching build on its own; the badge on the page updates from
this list automatically.

Bump `version` on every release — it's shown on the page and used to decide whether
a connected device is already up to date.
