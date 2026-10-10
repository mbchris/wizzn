import { describe, expect, it } from 'vitest'
import { licenseUrl, parseLicense } from '../../src/providers/stock-images/license.js'
import { stockKey, StockSearchError } from '../../src/providers/stock-images/types.js'

describe('parseLicense', () => {
  it.each([
    [['by-sa', '4.0'], { license: 'by-sa', version: '4.0' }],
    [['cc0', '1.0'], { license: 'cc0', version: '1.0' }],
    [['pdm', ''], { license: 'pdm', version: null }],
    [['CC BY-SA 3.0 de'], { license: 'by-sa', version: '3.0' }],
    [['CC BY 2.0'], { license: 'by', version: '2.0' }],
    [['CC0'], { license: 'cc0', version: null }],
    [['Public domain'], { license: 'pdm', version: null }],
  ] as const)('parses %j', ([raw, version], expected) => {
    expect(parseLicense(raw, version)).toEqual(expected)
  })

  it.each([[['by-nc', '2.0']], [['CC BY-NC-SA 4.0']], [['CC BY-ND 4.0']], [['GFDL']], [['']]] as const)(
    'rejects %j',
    ([raw, version]) => {
      expect(parseLicense(raw, version)).toBeNull()
    },
  )
})

describe('licenseUrl', () => {
  it('builds canonical urls', () => {
    expect(licenseUrl('by-sa', '4.0')).toBe('https://creativecommons.org/licenses/by-sa/4.0/')
    expect(licenseUrl('cc0', null)).toBe('https://creativecommons.org/publicdomain/zero/1.0/')
    expect(licenseUrl('pdm', null)).toBe('https://creativecommons.org/publicdomain/mark/1.0/')
    expect(licenseUrl('by', null)).toBe('https://creativecommons.org/licenses/by/4.0/')
  })
})

describe('stock helpers', () => {
  it('keys by provider and id', () => {
    expect(stockKey({ provider: 'commons', providerId: '42' })).toBe('commons:42')
  })
  it('StockSearchError carries provider and status', () => {
    const e = new StockSearchError('openverse', 429, 'slow down')
    expect(e).toBeInstanceOf(Error)
    expect(e.provider).toBe('openverse')
    expect(e.status).toBe(429)
  })
})
