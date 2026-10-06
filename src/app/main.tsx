import { render } from 'preact';
import { uiLang } from '../popup/i18n';
import { installMotion } from '../popup/motion';
import { cachedTheme } from '../popup/theme';
import '../popup/styles.css';
import './app.css';
import { AppPage } from './App';

document.documentElement.lang = uiLang();
document.title = chrome.i18n.getMessage('appTitle') || 'Grabby';
const theme = cachedTheme();
if (theme) document.documentElement.dataset.theme = theme;
installMotion();
render(<AppPage />, document.getElementById('app')!);
