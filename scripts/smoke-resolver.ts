import {
  resolveVersion,
  listEngines,
  getEngineDefaults,
  getSupportedMajorVersions,
} from '../lib/resolver.js'

let pass = 0
let fail = 0

for (const e of listEngines()) {
  const majors = getSupportedMajorVersions(e)
  const defaults = getEngineDefaults(e)
  const resolved = majors.map((m) => `${m}=${resolveVersion(e, m) ?? '?'}`)

  const allResolved = majors.every((m) => resolveVersion(e, m) !== null)
  const verdict = allResolved ? 'OK' : 'FAIL'
  if (allResolved) pass++
  else fail++

  console.log(
    `${verdict} ${e.padEnd(28)} default=${(defaults.defaultVersion ?? '-').padEnd(13)} latest=${(defaults.latestVersion ?? '-').padEnd(13)} | ${resolved.join(', ')}`,
  )
}

console.log(`\n${pass}/${pass + fail} engines resolve every declared major`)
process.exit(fail > 0 ? 1 : 0)
