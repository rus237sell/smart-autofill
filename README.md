# smart-autofill

A Chrome extension that auto-fills job application forms using a saved profile. Built this to stop re-typing the same info on every application.

All data stays local — nothing leaves the browser (`chrome.storage.local`). Activate with `Ctrl+Shift+F` or the popup button.

---

## How to load it

1. Go to `chrome://extensions` and turn on Developer mode
2. Click **Load unpacked** and select this folder
3. Pin the extension, open the popup, fill in your profile, hit **Save**

---

## What I built / learned

**Shadow DOM traversal** — `querySelectorAll` doesn't pierce shadow roots so I wrote a recursive `visit()` function that manually walks into `shadowRoot` on every node. This was the main thing I didn't know going in.

**React/Angular/Vue input compatibility** — setting `el.value = x` directly doesn't trigger framework state updates. Fixed by pulling the native setter off `HTMLInputElement.prototype` via `Object.getOwnPropertyDescriptor` and calling it, then dispatching `input`, `change`, and `blur` events manually.

**Keyword scoring for field detection** — instead of exact name/id matching, each field label gets scored against keyword lists where longer matches win. So "email address" scores higher than just "email", which avoids misfires on ambiguous fields.

**Phone and date format detection** — reads the placeholder text and `maxlength` attribute to figure out what format the form expects, then reformats the stored value to match (e.g. `(555) 555-5555` vs `555-555-5555` vs `+15555555555`).

**Yes/No radio button logic** — authorization and sponsorship questions come in a lot of phrasings. Built a `YES_CLUES` / `NO_CLUES` array to match label text and pick the right radio regardless of how the question is worded.

**MutationObserver for multi-step forms** — after the initial fill, watches for new inputs added to the DOM (like when you advance to the next step), debounced at 700ms, max 5 cycles, auto-disconnects after 5 minutes.

**Iframe access** — wraps `contentDocument` access in a try/catch to silently skip cross-origin iframes while still filling same-origin ones.

---

## Files

| File | What it does |
|---|---|
| `manifest.json` | MV3 manifest — permissions, keyboard shortcut, content script |
| `content.js` | All field detection and fill logic |
| `popup.html` / `popup.js` | Settings UI — profile fields, save button, fill counter |
| `background.js` | Service worker that handles the keyboard shortcut |
| `icons/` | Extension icons (16, 48, 128px) |
