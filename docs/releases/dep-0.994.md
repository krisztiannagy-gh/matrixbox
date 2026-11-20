### Smoother PA scrolling

- **Settings page:** the announcements card now checks the box's status only while the page is visible, and every 10 s instead of 5. Each check stops the board's animation for a moment.
- **New page `/pa/perf`:** scrolling statistics from the box: stalls, memory clean-ups, requests, main-loop time and free memory. Add `?reset=1` to start a new measurement. It's linked at the bottom of the announcements card.
- The announcement engine no longer makes garbage on every animation frame. BKK skin v12, which installs automatically, brings the rest of the smoothing.

Update from the box's **Apps** page (restart the box first so it sees the new version).
