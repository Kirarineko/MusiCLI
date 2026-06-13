import { getBridge } from '../bridge';
import { version } from '../../package.json';

export function TitleBar() {
  return (
    <div id="titlebar">
      <span id="titlebar-text"> Musicli v{version}</span>
      <div id="titlebar-btns">
        <button id="btn-minimize" title="Minimize" onClick={() => getBridge().minimize()}>
          ─
        </button>
        <button id="btn-close" title="Close" onClick={() => getBridge().close()}>
          x
        </button>
      </div>
    </div>
  );
}
