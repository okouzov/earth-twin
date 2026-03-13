# Earth Twin Restored

This is the restored Earth digital twin app, kept separate from the other project in the workspace.

## Run locally

From this folder:

```powershell
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Files

- `index.html`
- `styles.css`
- `app.js`
- `.nojekyll`

## Notes

- Runtime internet access is required because the app loads public textures, map styles, and terrain tiles.
- Search uses OpenStreetMap Nominatim and is suitable for light public use, not heavy production traffic.
