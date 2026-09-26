// 첫 화면이 그려지기 전에 테마를 적용한다. 기본값은 다크(예외 E1). 이 기기에만 저장된다.
(function () {
  try {
    var saved = localStorage.getItem('album-theme');
    if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
    else if (saved === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches) document.documentElement.dataset.theme = 'light';
  } catch (e) { /* 저장소를 쓸 수 없으면 기본 다크 */ }
})();
