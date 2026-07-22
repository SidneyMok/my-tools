# Pinned browser parser bundles

The DOCX email page is deployable as ordinary static files and therefore ships
its required browser parser distributions here instead of referring to
`node_modules` or a CDN.

| Asset | npm package | Pinned version | Package-lock integrity |
| --- | --- | --- | --- |
| `jszip-3.10.1.min.js` | `jszip` | 3.10.1 | `sha512-xXDvecyTpGLrqFrvkrUSoxxfJI5AH7U8zxxtVclpsUtMCq4JQ290LY8AW5c7Ggnr/Y/oK+bQMbqK2qmtk3pN4g==` |
| `mammoth-1.11.0.browser.js` | `mammoth` | 1.11.0 | `sha512-BcEqqY/BOwIcI1iR5tqyVlqc3KIaMRa4egSoK83YAVrBf6+yqdAAbtUcFDCWX8Zef8/fgNZ6rl4VUv+vVX8ddQ==` |

The exact package versions and transitive dependencies remain locked in the
repository `package-lock.json`. Copies of the upstream licenses are in
`licenses/`: JSZip is used under its MIT option and Mammoth is BSD-2-Clause.
