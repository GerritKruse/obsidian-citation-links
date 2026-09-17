# Third-party notices

Citation Links is released under the MIT license (see [LICENSE](LICENSE)). Its build output (`main.js`) also bundles the third-party components listed below under their own licenses. citeproc-js and the locale are bundled unmodified; the APA style carries one documented local change, described in its section.

## citeproc-js

- Package: `citeproc` 2.4.63 (npm), based on citeproc-js
- Copyright: (c) 2009-2019 Frank Bennett
- License: dual-licensed, at the recipient's option, under the Common Public Attribution License (CPAL) 1.0 or later, or the GNU Affero General Public License (AGPL) 3.0 or later
- Source: https://github.com/Juris-M/citeproc-js

citeproc-js is the citation and bibliography formatting engine that turns the CSL style and the bibliography data into rendered citations. It is bundled into `main.js` unmodified. Its license file grants:

> This program is free software: you can redistribute it and/or modify it under EITHER
>
> - the terms of the Common Public Attribution License (CPAL) as published by the Open Source Initiative, either version 1 of the CPAL, or (at your option) any later version; OR
> - the terms of the GNU Affero General Public License (AGPL) as published by the Free Software Foundation, either version 3 of the AGPL, or (at your option) any later version.
>
> This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.

## CSL style: APA Style 7th edition

- File bundled with the plugin: `resources/apa.csl`
- Authors: Brenton M. Wiernik, Andrew Dunning
- License: Creative Commons Attribution-ShareAlike 3.0 (CC BY-SA 3.0), http://creativecommons.org/licenses/by-sa/3.0/
- Source: https://github.com/citation-style-language/styles
- Modification: in the `bibliography` macro, the author and date of a reference entry are wrapped in an additional `<group delimiter=". " font-weight="bold">` so that the plugin's reference list can set them in bold. The change is marked with a `Citation Links:` XML comment in the file; everything else, including the `<info>` metadata, is unchanged from the upstream file. In-text citations are not affected.

## CSL locale: en-US

- File bundled with the plugin: `resources/locales-en-US.xml`
- Translators: Andrew Dunning, Sebastian Karcher, Rintze M. Zelle, Denis Meier, Brenton M. Wiernik
- License: Creative Commons Attribution-ShareAlike 3.0 (CC BY-SA 3.0), http://creativecommons.org/licenses/by-sa/3.0/
- Source: https://github.com/citation-style-language/locales

Citation Style Language (CSL) styles and locales are provided by the CSL project, https://citationstyles.org/.

Both files are bundled with their `<info>` metadata (authors/translators, license, and source links) intact, as required by their license.
