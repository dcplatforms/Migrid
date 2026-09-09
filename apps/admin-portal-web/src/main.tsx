import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FluentProvider, webDarkTheme, webLightTheme, makeStyles } from '@fluentui/react-components';
import App from './App.tsx';
import './index.css';
import { ThemeContext, type ThemeMode } from './theme/ThemeContext';

const useProviderStyles = makeStyles({
  provider: {
    backgroundColor: 'transparent',
    height: '100%',
  },
});

function readInitialMode(): ThemeMode {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('migrid-theme') : null;
  return saved === 'light' ? 'light' : 'dark';
}

function Root() {
  const styles = useProviderStyles();
  const [mode, setMode] = useState<ThemeMode>(readInitialMode);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode);
    try {
      localStorage.setItem('migrid-theme', mode);
    } catch {
      /* ignore persistence errors */
    }
  }, [mode]);

  const toggle = useCallback(() => setMode((m) => (m === 'dark' ? 'light' : 'dark')), []);

  return (
    <ThemeContext.Provider value={{ mode, toggle }}>
      <FluentProvider theme={mode === 'dark' ? webDarkTheme : webLightTheme} className={styles.provider}>
        <App />
      </FluentProvider>
    </ThemeContext.Provider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
