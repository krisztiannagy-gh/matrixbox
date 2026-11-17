### Budapest (BKK FUTÁR) support: first release of this build

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
