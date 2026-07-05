/**
 * Pure geometry for the D3 flavor radar. Kept free of DOM/React so it's unit
 * testable: given flavor tags (each 0..5), produce the polygon points and the
 * axis endpoints on a regular pentagon. Angles start at 12 o'clock and go
 * clockwise so the axes read in FLAVOR_AXES order.
 */
import type { FlavorTags } from './types'
import { FLAVOR_AXES } from './types'

export const RADAR_MAX = 5

export interface Point {
  x: number
  y: number
}

export interface RadarAxis {
  key: keyof FlavorTags
  label: string
  /** Full-length axis endpoint (value === RADAR_MAX). */
  end: Point
  /** Slightly-beyond-end point for the text label. */
  labelPos: Point
  value: number
  /** The data vertex for this axis at its actual value. */
  vertex: Point
}

/** Angle (radians) for axis `i`, starting at top, clockwise. */
export function axisAngle(i: number, count: number): number {
  return (Math.PI * 2 * i) / count - Math.PI / 2
}

function pointAt(cx: number, cy: number, r: number, angle: number): Point {
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) }
}

export interface RadarGeometry {
  cx: number
  cy: number
  radius: number
  axes: RadarAxis[]
  /** The data polygon vertices in axis order (closeable by the caller). */
  polygon: Point[]
  /** Concentric grid ring radii (1..RADAR_MAX). */
  rings: number[]
}

/**
 * Build the full radar geometry for one flavor profile inside a `size` box.
 * `padding` reserves room for the axis labels at the edges.
 */
export function radarGeometry(
  flavor: FlavorTags,
  size: number,
  padding = 46,
): RadarGeometry {
  const cx = size / 2
  const cy = size / 2
  const radius = size / 2 - padding
  const count = FLAVOR_AXES.length

  const axes: RadarAxis[] = FLAVOR_AXES.map((key, i) => {
    const angle = axisAngle(i, count)
    const value = clamp(flavor[key])
    return {
      key,
      label: key,
      end: pointAt(cx, cy, radius, angle),
      labelPos: pointAt(cx, cy, radius + 16, angle),
      value,
      vertex: pointAt(cx, cy, (value / RADAR_MAX) * radius, angle),
    }
  })

  return {
    cx,
    cy,
    radius,
    axes,
    polygon: axes.map((a) => a.vertex),
    rings: [1, 2, 3, 4, 5],
  }
}

/** SVG `points` string for a polygon. */
export function toPointsAttr(points: Point[]): string {
  return points.map((p) => `${round(p.x)},${round(p.y)}`).join(' ')
}

function clamp(n: number): number {
  if (Number.isNaN(n)) return 0
  return Math.max(0, Math.min(RADAR_MAX, n))
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
