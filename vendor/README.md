# Pinned browser parser bundles

The DOCX email page is deployable as ordinary static files and therefore ships
its required browser parser distributions here instead of referring to
`node_modules` or a CDN.

| Asset | npm package | Pinned version | Package-lock integrity |
| --- | --- | --- | --- |
| `jszip-3.10.1.min.js` | `jszip` | 3.10.1 | `sha512-xXDvecyTpGLrqFrvkrUSoxxfJI5AH7U8zxxtVclpsUtMCq4JQ290LY8AW5c7Ggnr/Y/oK+bQMbqK2qmtk3pN4g==` |

The exact package versions and transitive dependencies remain locked in the
repository `package-lock.json`. Copies of the upstream licenses are in
