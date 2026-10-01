import { createElement, useEffect, useState } from 'react'

// Module-level cached promise for ECharts imports and plugin registration.
// Performance Optimization: Prevents redundant Promise.all dynamic imports and multiple echarts.use(...) registrations
// when multiple chart components (Sankey, Gauge, Line, Bar) mount simultaneously or remount during navigation.
let echartsModulePromise = null

function getEChartsModule() {
  if (!echartsModulePromise) {
    echartsModulePromise = Promise.all([
      import('echarts-for-react/lib/core'),
      import('echarts/core'),
      import('echarts/charts'),
      import('echarts/components'),
      import('echarts/renderers'),
    ]).then(([{ default: ReactECharts }, echarts, charts, components, renderers]) => {
      echarts.use([
        charts.FunnelChart,
        charts.GaugeChart,
        charts.LineChart,
        charts.BarChart,
        charts.SankeyChart,
        components.TooltipComponent,
        components.LegendComponent,
        components.GridComponent,
        renderers.CanvasRenderer,
      ])
      return { component: ReactECharts, echarts }
    }).catch((error) => {
      // Reset cached promise on failure so subsequent attempts can retry loading
      echartsModulePromise = null
      throw error
    })
  }
  return echartsModulePromise
}

export default function ClientEChart({ className, option }) {
  const [Chart, setChart] = useState(null)

  useEffect(() => {
    let active = true
    getEChartsModule()
      .then((loaded) => {
        if (active) setChart(loaded)
      })
      .catch(() => {
        if (active) setChart({ error: true })
      })
    return () => { active = false }
  }, [])

  if (!Chart || Chart.error) return <div className={className + ' chart-loading'} aria-hidden="true" />
  return createElement(Chart.component, {
    className,
    style: { width: '100%', height: 'var(--chart-height, 300px)' },
    echarts: Chart.echarts,
    opts: { renderer: 'canvas' },
    option: typeof option === 'function' ? option(Chart.echarts) : option,
  })
}
