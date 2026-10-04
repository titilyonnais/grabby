import { render } from 'preact';
import { App } from './App';
import { uiLang } from './i18n';
import './styles.css';

document.documentElement.lang = uiLang();
render(<App />, document.getElementById('app')!);
