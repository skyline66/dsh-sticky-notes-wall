# Changelog

## 1.2.1

- Fixed: with many notes the wall could not be scrolled to the end, so the last rows were unreachable. The page now measures the space between its top edge and the viewport bottom, applies it as `max-height`, and keeps its own scrollport (`overscroll-behavior: contain`, stable scrollbar gutter). The settings page uses the same fit.
- The filter/search/New toolbar now sticks to the top of the wall while scrolling.
- Slightly larger bottom padding so the last row is never hidden behind the composer.

## 1.2.0

- Appearance engine: note colour scheme (follow theme / light paper / dark paper), paper surface (auto / solid / frosted glass), contrast mode, default colour, font family, text size, line height, corner radius and density — notes keep their own readable paper colour on any background.
- New Settings → Sticky Notes page with a live preview.
- Native Windows desktop window: an always-on-top WebView2 note window compiled from the shipped C# source on first use, with drag, collapse, resize, tray menu and host-focus on click.
- Login start toggle (HKCU Run entry), reported from the real registry state.
- Manual note ordering with drag and drop, persisted per note.
- Floating window: width, opacity, position lock, auto-open on start, edge snapping while dragging.
- Preferences are stored in `prefs.json`, cached in `localStorage`, and clamped on both sides.
- Packaging for the DSH marketplace: English/Chinese READMEs, raster icon, repository metadata, changelog.

## 1.1.0

- Pinned notes and a frame-wide floating note window above every Harness panel.
- Quick capture inside the floating window, inline editing, due chips and image thumbnails.
- `Ctrl/Cmd+Shift+P` to show or hide the floating window.
- Pin toggles on wall cards and inside the note editor.

## 1.0.0

- Sidebar entry and masonry sticky-note wall.
- Pasted images and text, due reminders with desktop notifications, done state, filters, search and keyboard shortcuts.
- Local persistence in `~/.dsh/sticky-notes` with a hardened Host API.