## 2025-05-18 - Global module promise caching for dynamically loaded heavy libraries

**Learning:** When multiple component instances (e.g., charts on a dashboard) dynamically import heavy external libraries (`echarts`, `echarts-for-react`) independently inside `useEffect`, each instance creates separate import promises and redundant initialization calls (`echarts.use(...)`), causing unnecessary overhead and delayed chart rendering. Caching the import Promise at module scope ensures all component instances reuse a single promise, reducing promise overhead and ensuring near-instant load for subsequent chart mounts.

**Action:** Always cache library dynamic import promises at module level when wrapping dynamic imports in React components.

## 2025-05-19 - Avoid separate fetching effects for subsets of already-loaded dataset queries

**Learning:** When a main component query already fetches a full dataset (e.g. `gumroad_daily_summary` inside `data.summary`), creating a secondary `useEffect` hook to fetch a subset of that same dataset creates redundant concurrent network calls on mount and causes loading state flickers whenever local parameters (like timeframes) change. Deriving transformed series directly via `useMemo` from memory eliminates network requests and provides instant 0ms timeframe switches.

**Action:** Before writing a dedicated `useEffect` data-fetching hook for a component section, verify whether the required dataset is already retrieved by parent or sibling queries. Derive derived view models directly via `useMemo`.
