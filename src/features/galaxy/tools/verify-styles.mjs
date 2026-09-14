import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import selectorParser from 'postcss-selector-parser'

const root = fileURLToPath(new URL('../', import.meta.url))
const publicRoot = fileURLToPath(new URL('../../../../public/', import.meta.url))
let selectorsChecked = 0, assetsChecked = 0, animationsChecked = 0
for (const name of ['styles.css', 'fonts.css', 'components/galaxy.css', 'components/cosmic-backdrop.css', 'components/background-music.css', 'components/rich-text.css', 'components/search-voyage.css', 'components/association-space.css', 'components/wormhole.css', 'components/wormhole-flow.css']) {
  const tree = postcss.parse(fs.readFileSync(path.join(root, name), 'utf8'))
  tree.walkRules(rule => {
    let parent = rule.parent
    while (parent) {
      if (parent.type === 'atrule' && /keyframes$/i.test(parent.name)) return
      parent = parent.parent
    }
    selectorParser(selectors => selectors.each(selector => {
      assert.equal(selector.nodes[0]?.type, 'class', `${name}: ${selector}`)
      assert.equal(selector.nodes[0]?.value, 'galaxy-page', `${name}: ${selector}`)
      selectorsChecked++
    })).processSync(rule.selector)
  })
  tree.walkAtRules(/keyframes$/i, rule => { assert.ok(rule.params.startsWith('ww-galaxy-')); animationsChecked++ })
  tree.walkDecls(declaration => {
    for (const match of declaration.value.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
      assert.ok(match[1].startsWith('/galaxy/'), `${name}: ${match[1]}`)
      assert.ok(fs.existsSync(path.join(publicRoot, match[1])), `${match[1]} is served locally`)
      assetsChecked++
    }
    if (declaration.parent.type === 'atrule' && declaration.parent.name === 'font-face' && declaration.prop === 'font-family') {
      assert.ok(declaration.value.includes('Wanderwise Galaxy'), `${name}: font registry remains separate`)
    }
  })
}
console.log(JSON.stringify({ result: 'passed', selectorsChecked, assetsChecked, animationsChecked }, null, 2))
