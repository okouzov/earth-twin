# Earth Twin

Static browser app that combines a Three.js orbital Earth with a lazily loaded MapLibre terrain view. The orbital scene handles realistic globe rendering, cloud and atmosphere toggles, day/night switching, city lights, and zoom audio. The surface mode takes over once you zoom deep enough and gives you terrain, streets, and 3D buildings.

## Run

Serve the folder with any static server. For example:

```powershell
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Public assets and layers

- Earth textures: official Three.js example textures from `raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/`
- Surface vector style: OpenFreeMap public style service
- Surface satellite layer: EOX Sentinel-2 cloudless WMTS tiles
- Terrain DEM: public Terrarium elevation tiles hosted on AWS

## Notes

- The surface map is initialized only when you zoom close enough to keep the initial load lighter.
- Sound effects are synthesized in the browser with Web Audio, so there are no audio asset downloads.
- Internet access is required at runtime because the app references public CDN libraries and public map/texture services.
