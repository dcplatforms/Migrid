import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { FluentProvider, webDarkTheme, makeStyles } from '@fluentui/react-components';
import App from './App.tsx';
import './index.css';

const useProviderStyles = makeStyles({
  provider: {
    backgroundColor: 'transparent',
    height: '100%',
  },
});

function Root() {
  const styles = useProviderStyles();
  return (
    <FluentProvider theme={webDarkTheme} className={styles.provider}>
      <App />
    </FluentProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
