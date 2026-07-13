import { describe, expect, it } from 'vitest'
import { radarGeometry, toPointsAttr, axisAngle, RADAR_MAX } from './radar'
import { EMPTY_FLAVOR, FLAVOR_AXES, type FlavorTags } from './types'

describe('FLAVOR_AXES', () => {
  it('lists every FlavorTags key exactly once', () => {
    // EMPTY_FLAVOR is annotated as FlavorTags, so its keys are the full set;
    // the `as const` axes array is not compiler-checked for completeness.
    expect([...FLAVOR_AXES].sort()).toEqual(Object.keys(EMPTY_FLAVOR).sort())
    expect(new Set(FLAVOR_AXES).size).toBe(FLAVOR_AXES.length)
  })
})

describe('radar geometry', () => {
  const size = 300
  const geo = radarGeometry(
    { ...EMPTY_FLAVOR, sweet: 5, smoky: 0, fruity: 3, oaky: 5, spicy: 1 },
    size,
  )

  it('centres the chart in the box', () => {
    expect(geo.cx).toBe(size / 2)
    expect(geo.cy).toBe(size / 2)
    expect(geo.radius).toBeGreaterThan(0)
    expect(geo.radius).toBeLessThan(size / 2)
  })

  it('produces one axis per flavor tag, in order', () => {
    expect(geo.axes.map((a) => a.key)).toEqual([...FLAVOR_AXES])
  })

  it('first axis points straight up (12 o’clock)', () => {
    const first = geo.axes[0]
    // top of the chart => same x as centre, smaller y
    expect(Math.abs(first.end.x - geo.cx)).toBeLessThan(0.001)
    expect(first.end.y).toBeLessThan(geo.cy)
  })

  it('scales a max value to the full radius and 0 to the centre', () => {
    const sweet = geo.axes.find((a) => a.key === 'sweet')! // value 5 = max
    const smoky = geo.axes.find((a) => a.key === 'smoky')! // value 0
    const distSweet = Math.hypot(sweet.vertex.x - geo.cx, sweet.vertex.y - geo.cy)
    const distSmoky = Math.hypot(smoky.vertex.x - geo.cx, smoky.vertex.y - geo.cy)
    expect(distSweet).toBeCloseTo(geo.radius, 5)
    expect(distSmoky).toBeCloseTo(0, 5)
  })

  it('mid values land proportionally along the axis', () => {
    const fruity = geo.axes.find((a) => a.key === 'fruity')! // value 3 of 5
    const dist = Math.hypot(fruity.vertex.x - geo.cx, fruity.vertex.y - geo.cy)
    expect(dist).toBeCloseTo((3 / RADAR_MAX) * geo.radius, 5)
  })

  it('an empty profile collapses to the centre point', () => {
    const empty = radarGeometry(EMPTY_FLAVOR, size)
    for (const axis of empty.axes) {
      expect(axis.vertex.x).toBeCloseTo(empty.cx, 5)
      expect(axis.vertex.y).toBeCloseTo(empty.cy, 5)
    }
  })

  it('clamps out-of-range values into 0..5', () => {
    const geo2 = radarGeometry(
      { ...EMPTY_FLAVOR, sweet: 99, smoky: -4, fruity: 3 },
      size,
    )
    const sweet = geo2.axes.find((a) => a.key === 'sweet')!
    const smoky = geo2.axes.find((a) => a.key === 'smoky')!
    expect(sweet.value).toBe(5)
    expect(smoky.value).toBe(0)
  })

  it('renders finite geometry for a 5-axis profile from a pre-expansion API', () => {
    // An API build that predates the 8-axis expansion serves profiles missing
    // floral/acidity/body entirely; the radar must not emit NaN coordinates.
    const legacy = {
      sweet: 3,
      smoky: 5,
      fruity: 2,
      oaky: 3,
      spicy: 2,
    } as unknown as FlavorTags
    const geo5 = radarGeometry(legacy, size)
    for (const axis of geo5.axes) {
      expect(Number.isFinite(axis.value)).toBe(true)
      expect(Number.isFinite(axis.vertex.x)).toBe(true)
      expect(Number.isFinite(axis.vertex.y)).toBe(true)
    }
    expect(toPointsAttr(geo5.polygon)).not.toMatch(/NaN/)
  })

  it('serialises polygon points as an SVG points attribute', () => {
    const attr = toPointsAttr(geo.polygon)
    expect(attr.split(' ')).toHaveLength(FLAVOR_AXES.length)
    expect(attr).toMatch(/^[\d.,\s-]+$/)
  })

  it('axisAngle steps evenly around the circle', () => {
    const a0 = axisAngle(0, 5)
    const a1 = axisAngle(1, 5)
    expect(a0).toBeCloseTo(-Math.PI / 2, 5)
    expect(a1 - a0).toBeCloseTo((Math.PI * 2) / 5, 5)
  })
})
