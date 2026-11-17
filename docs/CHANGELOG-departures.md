# Departures app — changelog (krisztiannagy-gh build)

Builds of the official MatrixBOX Departures app (based on official v0.985, 15 Nov 2026) with Budapest/BKK support.
Install/update from the box's **Apps** page with `repository_url` set to this fork. Restart the box after a new release so it sees the new version.

## 0.989 — No more dark board (2026-11-17)
- **Shorter wait for stalled requests:** a data request now gives up after **10 seconds instead of 50**. Before, one stuck request could freeze the board for up to a minute. The T-skylt server can no longer raise this limit remotely.
- **BKK FUTÁR skin:** the general "No more departures" text setting is hidden while the skin is active, because the skin now has its own status screens (see BKK skin v6, which installs automatically).

Update from the box's **Apps** page (restart the box first so it sees the new version).

## 0.988 — BKK static mode simplified (2026-11-17)
- The BKK FUTÁR skin's static mode is now a single switch: **Show BKK FUTÁR instead of departures**. The picture option from 0.987 has been removed.

## 0.987 — Brightness control (2026-11-17)
- **New Brightness setting (1–5)** under *Advanced*, next to *Tone*. The setting already existed in the app but had no control on the settings page.
  Tip: at the lowest level the orange can briefly shift lighter while new data loads; level 2 or higher keeps it steady.
- **BKK FUTÁR skin:** setting to show static content instead of departures. Its picture option was removed again in 0.988.

## 0.986 — Budapest (BKK FUTÁR) support: first release of this build (2026-11-17)
**New**
- **BKK FUTÁR (Budapest) skin** available in the skin picker. Skins can now be downloaded from their own repository; this one comes from `krisztiannagy-gh/departures_skins`.
- **Departures under 1 minute stay on the board** instead of disappearing.
  - Skins can ask for them (the BKK skin does).
  - In the stock list view, the new **Departing / at stop** switch keeps them on the board with the minutes column empty and the destination blinking, until 15 s after departure. Blink speed is adjustable.
- **Route before destination (►)**: BKK headsigns like "Alkotás utca ► Bécsi út / Vörösvári út" now show only the final destination by default.
  - Switch to *Show* to see the full headsign.
  - Any arrow-like separator is recognised. The stock fonts draw it as `>` instead of an empty box.
  - The option appears next to the stop picker when the operator is Budapest.

**Improved**
- **The settings page only shows what applies to the active skin.** Skins declare which general settings they don't use; those are hidden while the skin is active. Other skins are unchanged.

**Fixed**
- The periodic "show station name" text is no longer drawn over skins that hide that setting.

**Installing**
Set the box's `repository_url` to `https://raw.githubusercontent.com/krisztiannagy-gh/matrixbox/refs/heads/main/`, then update **Departures** from the **Apps** page.
