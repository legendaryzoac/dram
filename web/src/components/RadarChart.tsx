/**
 * D3-driven flavor radar. The FLAVOR_AXES (eight shared tasting axes) are
 * placed on a regular polygon; the profile is drawn as a filled shape.
 *
 * React owns the SVG DOM; D3 provides the geometry helpers and the line
 * generator for the grid rings. `radarGeometry` (unit-tested, DOM-free)
 * computes every coordinate so this component stays declarative and the same
 * chart drives both the bottle detail view and the live note-form preview.
 */
import { useMemo } from 'react'
import { lineRadial, curveLinearClosed } from 'd3-shape'
import type { FlavorTags } from '../lib/types'
import {
  RADAR_MAX,
  axisAngle,
  radarGeometry,
  toPointsAttr,
} from '../lib/radar'

interface Props {
  flavor: FlavorTags
  size?: number
  /** Optional faint reference polygon (e.g. the bottle's saved profile). */
  reference?: FlavorTags | null
  /** Show the numeric value beside each axis label. */
  showValues?: boolean
}

export default function RadarChart({
  flavor,
  size = 260,
  reference = null,
  showValues = false,
}: Props) {
  const geo = useMemo(() => radarGeometry(flavor, size), [flavor, size])

  // d3 radial line generator for the concentric guide rings — one closed ring
  // per integer level, sampled at each axis angle.
  const ringPath = useMemo(() => {
    const gen = lineRadial<number>()
      .angle((_, i) => axisAngle(i, geo.axes.length) + Math.PI / 2)
      .radius((level) => (level / RADAR_MAX) * geo.radius)
      .curve(curveLinearClosed)
    return (level: number) =>
      gen(new Array(geo.axes.length).fill(level)) ?? ''
  }, [geo])

  const refPoints = useMemo(
    () => (reference ? radarGeometry(reference, size).polygon : null),
    [reference, size],
  )

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width="100%"
      // `overflow: visible` lets the axis labels (e.g. "smoky" at 3 o'clock)
      // spill into the surrounding panel padding instead of being clipped by
      // the viewBox edge.
      style={{ overflow: 'visible' }}
      className="mx-auto block max-w-[280px]"
      role="img"
      aria-label="Flavor profile radar chart"
    >
      <g transform={`translate(${geo.cx}, ${geo.cy})`}>
        {/* concentric grid rings */}
        {geo.rings.map((level) => (
          <path
            key={level}
            d={ringPath(level)}
            fill="none"
            stroke="var(--color-line)"
            strokeWidth={1}
            opacity={level === RADAR_MAX ? 0.8 : 0.35}
          />
        ))}
      </g>

      {/* axis spokes */}
      {geo.axes.map((axis) => (
        <line
          key={axis.key}
          x1={geo.cx}
          y1={geo.cy}
          x2={axis.end.x}
          y2={axis.end.y}
          stroke="var(--color-line)"
          strokeWidth={1}
          opacity={0.5}
        />
      ))}

      {/* faint reference polygon (saved profile) behind the live one */}
      {refPoints && (
        <polygon
          points={toPointsAttr(refPoints)}
          fill="var(--color-muted)"
          fillOpacity={0.08}
          stroke="var(--color-muted)"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      )}

      {/* the profile polygon */}
      <polygon
        points={toPointsAttr(geo.polygon)}
        fill="var(--color-warm)"
        fillOpacity={0.18}
        stroke="var(--color-warm)"
        strokeWidth={2}
        strokeLinejoin="round"
      />

      {/* vertex dots */}
      {geo.axes.map((axis) => (
        <circle
          key={axis.key}
          cx={axis.vertex.x}
          cy={axis.vertex.y}
          r={3}
          fill="var(--color-warm)"
        />
      ))}

      {/* axis labels */}
      {geo.axes.map((axis) => (
        <text
          key={axis.key}
          x={axis.labelPos.x}
          y={axis.labelPos.y}
          textAnchor={anchorFor(axis.labelPos.x, geo.cx)}
          dominantBaseline="middle"
          className="font-mono"
          fontSize={11}
          fill="var(--color-muted)"
        >
          {axis.label}
          {showValues && (
            <tspan fill="var(--color-warm)"> {axis.value}</tspan>
          )}
        </text>
      ))}
    </svg>
  )
}

/** Keep edge labels from overrunning: anchor by side of the chart. */
function anchorFor(x: number, cx: number): 'start' | 'middle' | 'end' {
  if (Math.abs(x - cx) < 8) return 'middle'
  return x > cx ? 'start' : 'end'
}
