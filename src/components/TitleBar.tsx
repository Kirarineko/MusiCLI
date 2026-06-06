export function TitleBar() {
  return (
    <div id="titlebar">
      <span id="titlebar-text"> Musicli v2.0</span>
      <div id="titlebar-btns">
        <button id="btn-minimize" title="Minimize" onClick={() => window.musicPlayer.minimize()}>
          ─
        </button>
        <button id="btn-close" title="Close" onClick={() => window.close()}>
          x
        </button>
      </div>
    </div>
  );
}
