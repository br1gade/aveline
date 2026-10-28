# Export fonts

Unmodified DejaVu Sans Regular and Bold (2.37), from the DejaVu font project:
https://dejavu-fonts.github.io/ and https://github.com/dejavu-fonts/dejavu-fonts.
The accompanying `LICENSE.txt` retains the Bitstream Vera copyright/grant and
the public-domain notice for DejaVu changes. No Debian packaging code is copied.

These fonts cover the pilot's Latin, French accents, Cyrillic and Armenian,
including the Armenian ligature and combining accents checked by the renderer
rehearsal. PDFKit embeds font subsets; the Docker image carries both source
fonts and their notice. Generation does not download fonts or use host fonts.
Spreadsheets request the same family, with the viewer's normal font fallback.
