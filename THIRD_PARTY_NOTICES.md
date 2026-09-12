# Third-party notices

Evercast ships four runtime dependencies to the browser. Two of them are
Apache-2.0, which asks that a copy of the licence and any `NOTICE` travel with
the distributed work — this file is that copy. Everything else on the tree is a
build-time tool and never reaches a player.

Regenerate the list with:

```bash
node -e "for (const d of Object.keys(require('./package.json').dependencies)) \
  { const m = require('./node_modules/' + d + '/package.json'); \
    console.log(d, m.version, m.license); }"
```

## Shipped to the browser

| Package | Version | Licence |
| --- | --- | --- |
| `@babylonjs/core` | 9.25.x | Apache-2.0 |
| `@babylonjs/loaders` | 9.25.x | Apache-2.0 |
| `react` | 19.2.x | MIT |
| `react-dom` | 19.2.x | MIT |
| `break_eternity.js` | 2.1.x | MIT |

### Babylon.js — Apache License 2.0

> Copyright 2023 The Babylon.js team
>
> Licensed under the Apache License, Version 2.0 (the "License"); you may not
> use this file except in compliance with the License. You may obtain a copy of
> the License at <http://www.apache.org/licenses/LICENSE-2.0>.
>
> Unless required by applicable law or agreed to in writing, software
> distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
> WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
> License for the specific language governing permissions and limitations under
> the License.

Babylon.js carries its own `NOTICE` covering components vendored into it. The
full text is in `node_modules/@babylonjs/core/NOTICE.md`; the components are
Draco Compression, the Basis transcoder, GLSLang and TWGSL (all Apache-2.0).

Evercast's glTF assets are uncompressed and it registers only the glTF 2.0
loader and the `KHR_materials_specular` extension, so none of those components
is reached at runtime — they are listed because they are present in the
package, which is what the licence asks for.

### React and React DOM — MIT

> Copyright (c) Meta Platforms, Inc. and affiliates.
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in
> all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

### break_eternity.js — MIT

> Copyright (c) 2018 Patashu
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the conditions above, which are the same MIT
> terms reproduced for React.

## Build-time only

Not shipped, and listed for completeness: `typescript`, `vite`, `vitest`,
`@vitejs/plugin-react` and their trees are MIT, ISC, BSD-3-Clause or, in the
case of `lightningcss`, MPL-2.0. MPL-2.0 is file-level copyleft and applies to
the tool's own sources rather than to anything it processes, so it places no
obligation on Evercast's output.

## Fonts

None are bundled or fetched. `--font-ui` names Inter first and falls back
through `ui-sans-serif` and the platform UI stack, so a player who happens to
have Inter installed sees it and everyone else sees their own system font.
Nothing is requested from a font CDN — see `docs/PRIVACY.md`.

## Art

Everything under `art/` and `public/models/` is authored for this project by
its Blender build scripts in `tools/blender/`. No third-party model, texture or
audio sample is vendored, and all sound is synthesised at runtime by
`src/game/audio`.
