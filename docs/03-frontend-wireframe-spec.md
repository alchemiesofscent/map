# 03. Front-end wireframe spec

The interface should work like a guided route notebook. The canonical
implementation is the Atlas viewer in `app/`.

## Primary layout

Desktop layout:

```text
+---------------------------------------------------------------+
| Header: corpus selector / route-view selector / explore toggle |
+-------------------------------+-------------------------------+
|                               | Dossier panel                 |
| Map                           |                               |
|                               | Site title                    |
| - selected route view         | Translation / snippets        |
| - current site marker         | Materia chips when available  |
| - land/sea route styling      | Greek source                  |
| - context pins when available | Source reference              |
+-------------------------------+-------------------------------+
| Route strip: ordered focus sites for the selected view          |
+---------------------------------------------------------------+
```

Mobile layout:

```text
+-------------------------------+
| Header / drawer toggle         |
+-------------------------------+
| Map                           |
+-------------------------------+
| Dossier panel                 |
+-------------------------------+
| Prev / Next                   |
+-------------------------------+
```

## Components

### Header

Shows:

- active corpus title
- active route view
- corpus and route-view controls
- desktop explore-map toggle

### Map

Required layers:

- selected route-view line
- route-site markers
- context or materia markers when the selected generated view provides them

Marker rules:

- selected-view route sites are visible by default
- Galen context and materia pins render without becoming route-line endpoints
- unresolved or geometry-null places remain in route metadata and dossier text, but do not draw markers
- land and sea sites get visually distinct pin treatments

Line rules:

- sea route: solid blue sequence guide
- land/caravan route: dashed warm sequence guide
- Galen route lines connect only `primary` stops
- Periplus route lines omit region-style sites so the line does not imply sailing across land

### Dossier panel

Required fields:

- active route/view label
- site type
- Periplus section or Galen Kuhn citation
- display name
- Greek name when available
- translation or context snippets
- Greek source when available
- materia medica chips for Galen sites when available
- source reference and Pleiades link when available

### Route strip

A compact ordered list of normalized focus sites. Clicking a stop moves the tour to that site in the current route view.

Example:

```text
1 Myos Hormos -> 2 Berenike -> 3 Ptolemais -> 4 Adulis
```

### Data adapter

The Atlas app is split across two JavaScript files:

- `app/viewer-data.js`: corpus configuration, JSON fetches, lookup indexes, normalized focus lists, and route-leg derivation.
- `app/viewer.js`: Leaflet layers, dossier/strip rendering, navigation, keyboard/wheel/touch input, and corpus/view switching.

The runtime contract between them is the focus list: one item per rendered site in the selected generated route view, with corpus-specific reading fields already normalized.

## Interaction behavior

On load:

1. Load the default corpus through `viewer-data.js`.
2. Build corpus indexes and the selected view's focus list.
3. Draw route-view sites and eligible route legs.
4. Fit the map to the selected view.
5. Open the first dossier entry.

On Previous / Next:

1. Update the active dossier.
2. Highlight the active marker and incoming leg.
3. Fly or set the map to the active mapped site unless explore mode is enabled.
4. Scroll the route strip if needed.

On marker click:

1. Move the focus list to the clicked site.
2. Update the dossier and strip selection.
3. Apply the same map focus behavior as Previous / Next.

## Accessibility

- Previous and Next must be keyboard-focusable buttons.
- The active site title should be a real heading.
- Materia lists should be semantic lists.
- Do not encode route status by color alone where a text label is available.
- Keep translations readable in a single column.

## Prototype included

The included `app/` directory implements the canonical Atlas viewer with vanilla JavaScript and Leaflet. Syntax-check both runtime files after edits:

```bash
node --check app/viewer-data.js
node --check app/viewer.js
```
