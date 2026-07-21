import { useEffect } from 'react';

import { InventoryDashboard } from './pages/InventoryDashboard';
import { useConsoleUi } from './stores/consoleUi';

export default function App() {
  const theme = useConsoleUi((s) => s.theme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return <InventoryDashboard />;
}
