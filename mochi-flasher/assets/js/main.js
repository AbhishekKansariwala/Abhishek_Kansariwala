/* =======================================================================
   Fills the page from firmware/manifest.json so the version number and
   supported chips are never stale. Everything here is cosmetic — the
   actual flashing is handled by <esp-web-install-button>.
   ======================================================================= */

// The hotspot the firmware opens on first boot. Must match the firmware.
const SETUP_SSID = "Mochi-Setup";

const MANIFEST_URL = "firmware/manifest.json";

function text(id, value) {
  const el = document.getElementById(id);
  if (el && value) el.textContent = value;
}

async function hydrate() {
  text("setup-ssid", SETUP_SSID);

  let manifest;
  try {
    const res = await fetch(MANIFEST_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manifest = await res.json();
  } catch (err) {
    text("fw-meta", "Firmware manifest unavailable — see firmware/README.md");
    console.warn("[mochi] could not read manifest:", err);
    return;
  }

  const name = manifest.name || "Firmware";
  const version = manifest.version ? `v${manifest.version}` : "";
  text("fw-meta", [name, version].filter(Boolean).join(" · "));

  const chips = [...new Set((manifest.builds || []).map((b) => b.chipFamily))];
  if (chips.length) text("chip-badge", chips.join(" / "));

  document.title = `${name} — Firmware Installer`;
}

document.addEventListener("DOMContentLoaded", hydrate);
