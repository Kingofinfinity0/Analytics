import { createElement, useEffect, useState } from 'react'

export default function ClientEChart({ className, option }) {
  const [Chart, setChart] = useState(null)

  useEffect(() => {
    let active = true
    async function load() {
      const [{ default: ReactECharts }, echarts, charts, components, renderers] = await Promise.all([
        import('echarts-for-react/lib/core'),
        import('echarts/core'),
        import('echarts/charts'),
        import('echarts/components'),
        import('echarts/renderers'),
      ])
      echarts.use([charts.FunnelChart, charts.GaugeChart, charts.LineChart, charts.BarChart, charts.SankeyChart, components.TooltipComponent, components.LegendComponent, components.GridComponent, renderers.CanvasRenderer])
      if (active) setChart(() => ({ component: ReactECharts, echarts }))
    }
    load().catch(() => active && setChart({ error: true }))
    return () => { active = false }
  }, [])

  if (!Chart || Chart.error) return <div className={className + ' chart-loading'} aria-hidden="true" />
  return createElement(Chart.component, { className, style: { width: '100%', height: 'var(--chart-height, 300px)' }, echarts: Chart.echarts, opts: { renderer: 'canvas' }, option: typeof option === 'function' ? option(Chart.echarts) : option })
}
