# 03. Front-end wireframe spec

The interface should work like a guided sailor's notebook.

## Primary layout

Desktop layout:

```text
+---------------------------------------------------------------+
| Header: Periplus Tour / text selector / layer toggles          |
+-------------------------------+-------------------------------+
|                               | Passage card                  |
| Map                           |                               |
|                               | Section title                 |
| - main sea route              | Translation                   |
| - current stop marker         | Places                        |
| - dashed side movements       | Goods                         |
| - uncertainty styling         | Movement notes                |
|                               | Source reference              |
+-------------------------------+-------------------------------+
| Route strip: 1 Myos → 2 Berenike → 3 Ptolemais → 4 Adulis      |
+---------------------------------------------------------------+
```

Mobile layout:

```text
+-------------------------------+
| Header                        |
+-------------------------------+
| Map                           |
+-------------------------------+
| Passage card                  |
+-------------------------------+
| Prev / Next                   |
+-------------------------------+
```

## Components

### Header

Shows:

- project title
- active text title
- layer toggles: route, movements, unresolved places

### Map

Required layers:

- main route line
- stop markers
- side movement lines
- optional candidate markers

Marker rules:

- primary route stops are visible by default
- side-route places are visible when they have coordinates
- unresolved places remain in the passage panel
- low-certainty places get a low-certainty badge and a visually distinct marker

Line rules:

- main sea route: solid
- inferred sea route: visually distinct from text-explicit route
- inland movement: dashed
- island supply: dashed or dotted

### Passage card

Required fields:

- section number
- title
- subtitle
- short summary
- draft translation
- places mentioned
- goods mentioned
- movement notes
- source reference
- uncertainty note, if any

### Route strip

A compact ordered list of primary stops. Clicking a stop moves the tour to the corresponding card or nearest section.

Example:

```text
1 Myos Hormos → 2 Berenike → 3 Ptolemais → 4 Adulis
```

### Place drawer

Optional for the next version. When a marker is clicked, show:

- display name
- Greek name(s)
- aliases
- Pleiades URI
- certainty
- notes

## Interaction behavior

On load:

1. Load all JSON files.
2. Build a place-key index.
3. Draw all primary stops.
4. Draw main route legs.
5. Draw mapped movement overlays.
6. Open the first tour card.

On Previous / Next:

1. Update the active card.
2. Highlight places listed in `place_keys`.
3. Fit the map to mapped places on that card.
4. Scroll the route strip if needed.

On marker click:

1. Open a popup with place metadata.
2. Offer a link to the Pleiades URI when available.
3. Show certainty and notes.

## Accessibility

- Previous and Next must be keyboard-focusable buttons.
- The active section title should be a real heading.
- Place and goods lists should be semantic lists.
- Do not encode uncertainty by color alone; also display text badges.
- Keep translations readable in a single column.

## Prototype included

The included `app/` directory implements the base wireframe with vanilla JavaScript and Leaflet. It is deliberately simple so the data model remains the focus.
