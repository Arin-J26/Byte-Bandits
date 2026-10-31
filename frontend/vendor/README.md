# Vendored libraries

| File | Library | Version | Licence | Source |
|---|---|---|---|---|
| `cytoscape.min.js` | Cytoscape.js | 3.30.2 | MIT (Copyright 2016-2024, The Cytoscape Consortium) | https://unpkg.com/cytoscape@3.30.2/dist/cytoscape.min.js |

Vendored so the app needs no CDN at runtime and no `npm install`. The licence header is kept at the top of the file.

To replace it, download the same file from the URL above (or any 3.x `dist/cytoscape.min.js`) and save it here with the same name. If it is missing, the Graph page shows an error telling you so; every other page keeps working.
