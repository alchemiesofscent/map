# Louvre reliefs — susinum / lily perfume

Two objects from the Département des Antiquités égyptiennes, cited in the
susinum section of the dossier (`mendes/content-2.html`, §3). The markup,
captions and credits are already in place; these are the image files they
reference.

## Expected files

| Filename | Object | Record |
| --- | --- | --- |
| `e11377-relief-du-lirinon.jpg` | **E 11377** — *Relief du lirinon*. Limestone lintel, raised relief, 29 × 119 × 8 cm. Psammetichus II (Neferibre), c. 595–589 BCE, attributed by style. From the monument of Pairkep, called Psametikmeryneith. Seated owner, lily harvest, perfume-making, offerings. | [cl010029901](https://collections.louvre.fr/en/ark:/53355/cl010029901) |
| `e11162-fabrication-du-parfum.jpg` | **E 11162** — relief fragment, raised relief, 25.8 × 37 × 4 cm. 26th–30th Dynasty, 664–341 BCE, attributed by style. Four women; one carries a basket of lilies, two work crossed rods over a jar on a stand. Displayed Sully, room 644. | [cl010012761](https://collections.louvre.fr/en/ark:/53355/cl010012761) |

Filenames are referenced verbatim from the dossier markup — renaming a file
means editing `mendes/content-2.html` to match.

## Credit line

Both photographs carry, and must display:

> © 2002 Musée du Louvre, Dist. GrandPalaisRmn / Christian Décamps

## Rights

The credit above is a **photograph** credit (photographer and distributing
agency). The objects are Late Period Egyptian reliefs, long out of copyright;
the only live right is in the photographs.

Under the collections site's terms of use
([collections.louvre.fr/en/page/cgu](https://collections.louvre.fr/en/page/cgu)):

- **Catalogue text** — the entries and thematic albums are public information
  under the **Etalab Open Licence**: free re-use, commercial included, with
  attribution and the date of the last update.
- **Photographs** — property of the Rmn. **Non-commercial re-use is
  authorised provided the source and the author are acknowledged.**
  Commercial and/or editorial re-use requires a written request to Rmn-GP.
- A separate clause requires prior agreement with the crediting institution
  for `GrandPalaisRmn` credits **produced for institutions other than the
  Musée du Louvre**. It does not apply here: both credits name the Musée du
  Louvre.

This dossier is a non-commercial research site, and each caption names both
the source (Musée du Louvre, Dist. GrandPalaisRmn) and the author (Christian
Décamps), so the display sits inside the permitted non-commercial re-use.

Two caveats worth keeping in view:

1. The terms pair "commercial **and/or editorial**" as the case needing a
   written request. In agency vocabulary "editorial" means press and
   publishing use. If this material ever goes into a printed publication, or
   the site takes advertising or sells anything, the Rmn-GP request applies.
2. `collections.louvre.fr` is unreachable from the build environment (egress
   proxy), so the terms above were read through search-engine summaries of
   the CGU rather than the page itself. The substance was consistent across
   independent queries, but it is second-hand — worth one confirming read of
   the primary page from an unblocked network.

If the terms turn out to be narrower than the above, the fallback is to
remove the two `<img>` elements from the susinum section and keep the
catalogue entries and record links — the entries carry the substance without
the pictures.
