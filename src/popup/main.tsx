import { render } from 'preact';
import { App } from './App';
import { uiLang } from './i18n';
import { installMotion } from './motion';
import { cachedTheme } from './theme';
import './styles.css';

document.documentElement.lang = uiLang();
// Paint the first frame in the theme the user chose (see theme.ts).
const theme = cachedTheme();
if (theme) document.documentElement.dataset.theme = theme;
installMotion();
render(<App />, document.getElementById('app')!);
