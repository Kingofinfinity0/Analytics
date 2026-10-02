## 2025-05-18 - Global module promise caching for dynamically loaded heavy libraries

**Learning:** When multiple component instances (e.g., charts on a dashboard) dynamically import heavy external libraries (`echarts`, `echarts-for-react`) independently inside `useEffect`, each instance creates separate import promises and redundant initialization calls (`echarts.use(...)`), causing unnecessary overhead and delayed chart rendering. Caching the import Promise at module scope ensures all component instances reuse a single promise, reducing promise overhead and ensuring near-instant load for subsequent chart mounts.

**Action:** Always cache library dynamic import promises at module level when wrapping dynamic imports in React components.
