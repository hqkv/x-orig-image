// ==UserScript==
// @name         X 原图直载 + 原生右键菜单
// @name:en      X Original Image + Native Context Menu
// @namespace    x-orig-image
// @version      1.0.0
// @description  在 X（Twitter）直接把图片地址换成 ?name=orig 原图加载，并禁用站点的自定义右键菜单、恢复浏览器原生菜单；右键“在新标签页中打开图片 / 图片另存为”拿到的就是原图，没有二次跳转。
// @description:en  Load original images on X (Twitter) with ?name=orig, restore the native browser context menu, and avoid redirect hops when opening or saving images.
// @author       local
// @match        https://x.com/*
// @match        https://www.x.com/*
// @match        https://twitter.com/*
// @match        https://mobile.x.com/*
// @match        https://mobile.twitter.com/*
// @match        https://pbs.twimg.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // #region url-helpers
  const PBS_HOST = 'pbs.twimg.com';
  const ORIG = 'orig';

  // 是否把头像也换成原图。头像原图往往很大（单张可达数 MB），
  // 时间线里几十个头像会明显增加流量，默认关闭；需要时改成 true。
  const UPGRADE_AVATARS = false;

  // 带扩展名的 pbs 路径（如 /media/xxx.jpg）：没有 name 参数时本身就是原文件；
  // 带 name=small 之类的参数时，name 决定尺寸，需改成 orig。
  const FILE_EXT_RE = /\.[a-z0-9]{2,5}$/i;
  // 头像地址里的尺寸后缀：_normal / _bigger / _400x400 ...
  const PROFILE_SIZE_RE = /_(normal|bigger|mini|reasonably_small|200x200|400x400)(?=\.(?:jpe?g|png|gif|webp)$)/i;

  /**
   * 把 pbs.twimg.com 的图片地址转换为原图地址。
   *
   * - /media/、/card_img/ 这类图片：把 name 参数改成 orig（没有就补上）
   * - /profile_images/ 头像：去掉 _normal / _400x400 等尺寸后缀（UPGRADE_AVATARS 开启时）
   * - 视频封面、横幅等其他路径：保持原样
   * - 已经是原图：原样返回，避免无意义的重复赋值，也避免打开时多一次跳转
   *
   * @param {string} raw 原始地址
   * @returns {string} 原图地址（无法处理时返回原值）
   */
  function toOrigUrl(raw) {
    if (typeof raw !== 'string' || raw.toLowerCase().indexOf(PBS_HOST) === -1) return raw;

    let url;
    try {
      url = new URL(raw, 'https://x.com/');
    } catch (e) {
      return raw;
    }

    if (url.hostname !== PBS_HOST) return raw;
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return raw;

    let changed = false;
    if (url.protocol !== 'https:') {
      url.protocol = 'https:';
      changed = true;
    }

    const path = url.pathname;

    if (path.indexOf('/profile_images/') === 0) {
      if (!UPGRADE_AVATARS) return changed ? url.href : raw;

      const nextPath = path.replace(PROFILE_SIZE_RE, '');
      if (nextPath !== path) {
        url.pathname = nextPath;
        if (url.searchParams.has('name')) url.searchParams.delete('name');
        changed = true;
      }
      return changed ? url.href : raw;
    }

    if (path.indexOf('/media/') === 0 || path.indexOf('/card_img/') === 0) {
      if (url.searchParams.get('name') === ORIG) return changed ? url.href : raw;

      if (url.searchParams.has('name')) {
        // 形如 https://pbs.twimg.com/media/xxx.jpg?name=small 的缩放版本
        url.searchParams.set('name', ORIG);
        changed = true;
      } else if (!FILE_EXT_RE.test(path)) {
        // 形如 https://pbs.twimg.com/media/xxx?format=jpg 的无扩展名版本
        url.searchParams.set('name', ORIG);
        changed = true;
      }
      // 形如 https://pbs.twimg.com/media/xxx.jpg 的地址已经是原文件，保持原样
      return changed ? url.href : raw;
    }

    return changed ? url.href : raw;
  }

  /**
   * 改写 srcset 里的每个候选地址，保留 1x / 2x / 640w 之类的描述符。
   *
   * @param {string} value srcset 属性值
   * @returns {string} 改写后的 srcset
   */
  function rewriteSrcset(value) {
    if (typeof value !== 'string' || value.indexOf(PBS_HOST) === -1) return value;

    let changed = false;
    const parts = value.split(',').map(function (part) {
      const match = /^(\s*)(\S+)(\s[\s\S]*)?$/.exec(part);
      if (!match) return part;

      const next = toOrigUrl(match[2]);
      if (next !== match[2]) changed = true;
      return match[1] + next + (match[3] || '');
    });

    return changed ? parts.join(',') : value;
  }
  // #endregion url-helpers

  /* -------------------------------------------------------------------------
   * 一、直接打开 pbs.twimg.com 图片时（从别处点开、粘贴地址等）
   *     不是 orig 就自动替换为 orig 再加载，全程只跳转一次。
   * ---------------------------------------------------------------------- */
  if (location.hostname === PBS_HOST) {
    if (window.top === window) {
      const target = toOrigUrl(location.href);
      if (target !== location.href) location.replace(target);
    }
    return;
  }

  /* -------------------------------------------------------------------------
   * 二、在 x.com / twitter.com 页面内
   * ---------------------------------------------------------------------- */
  const fallbackSrc = new WeakMap(); // img -> 原始缩略图地址（orig 加载失败时回退）
  const gaveUp = new WeakSet();      // orig 加载失败、已回退的 img

  const srcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  const rawSetAttribute = Element.prototype.setAttribute;
  const rawRemoveAttribute = Element.prototype.removeAttribute;

  function rememberFallback(img, value) {
    if (!fallbackSrc.has(img)) fallbackSrc.set(img, value);
  }

  function rewriteImage(img) {
    if (!img || img.tagName !== 'IMG' || gaveUp.has(img)) return;

    const src = img.getAttribute('src');
    if (src) {
      const next = toOrigUrl(src);
      if (next !== src) {
        rememberFallback(img, src);
        img.setAttribute('src', next);
      }
    }

    const srcset = img.getAttribute('srcset');
    if (srcset) {
      const next = rewriteSrcset(srcset);
      if (next !== srcset) img.setAttribute('srcset', next);
    }
  }

  function rewriteSource(source) {
    if (!source || source.tagName !== 'SOURCE') return;

    const srcset = source.getAttribute('srcset');
    if (!srcset) return;

    const next = rewriteSrcset(srcset);
    if (next !== srcset) source.setAttribute('srcset', next);
  }

  // 拦截 React / 页面脚本设置 src、srcset 的时机，尽量在浏览器发起请求前就换成 orig，
  // 避免“先下载缩略图、再下载原图”的重复流量。
  Element.prototype.setAttribute = function (name, value) {
    if (
      typeof value === 'string' &&
      value.indexOf(PBS_HOST) !== -1 &&
      (this.tagName === 'IMG' || this.tagName === 'SOURCE') &&
      !gaveUp.has(this)
    ) {
      const attr = typeof name === 'string' ? name.toLowerCase() : '';
      if (attr === 'src' && this.tagName === 'IMG') value = toOrigUrl(value);
      else if (attr === 'srcset') value = rewriteSrcset(value);
    }
    return rawSetAttribute.call(this, name, value);
  };

  if (srcDescriptor && srcDescriptor.set) {
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: true,
      enumerable: srcDescriptor.enumerable,
      get: srcDescriptor.get,
      set: function (value) {
        if (typeof value === 'string' && !gaveUp.has(this)) value = toOrigUrl(value);
        return srcDescriptor.set.call(this, value);
      },
    });
  }

  // orig 地址偶尔不可用（媒体被删除、格式特殊等）时回退到原缩略图，
  // 保证图片不会因为本脚本变成裂图。
  window.addEventListener(
    'error',
    function (event) {
      const target = event.target;
      if (!target || target.tagName !== 'IMG' || gaveUp.has(target)) return;

      const current = target.getAttribute('src');
      if (!current || toOrigUrl(current) !== current) return;

      const fallback = fallbackSrc.get(target);
      if (!fallback) return;

      gaveUp.add(target);
      rawRemoveAttribute.call(target, 'srcset');
      if (srcDescriptor && srcDescriptor.set) srcDescriptor.set.call(target, fallback);
    },
    true
  );

  // 页面上所有新增的图片（React 渲染、翻页、打开大图）以及属性变化都重新检查一遍。
  function scan(root) {
    if (!root || root.nodeType !== 1) return;

    if (root.tagName === 'IMG') rewriteImage(root);
    else if (root.tagName === 'SOURCE') rewriteSource(root);

    if (!root.querySelectorAll) return;

    const nodes = root.querySelectorAll('img[src], img[srcset], source[srcset]');
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].tagName === 'IMG') rewriteImage(nodes[i]);
      else rewriteSource(nodes[i]);
    }
  }

  const observer = new MutationObserver(function (mutations) {
    for (let i = 0; i < mutations.length; i++) {
      const mutation = mutations[i];

      if (mutation.type === 'attributes') {
        if (mutation.target.tagName === 'IMG') rewriteImage(mutation.target);
        else if (mutation.target.tagName === 'SOURCE') rewriteSource(mutation.target);
        continue;
      }

      for (let j = 0; j < mutation.addedNodes.length; j++) scan(mutation.addedNodes[j]);
    }
  });

  observer.observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'srcset'],
  });

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      function () {
        scan(document.documentElement);
      },
      { once: true }
    );
  } else {
    scan(document.documentElement);
  }

  /* -------------------------------------------------------------------------
   * 三、恢复浏览器原生右键菜单
   *
   * X 会在 contextmenu 事件里弹出自己的菜单并 preventDefault。
   * 这里在 window 的捕获阶段截住事件（只停止传播，绝不 preventDefault），
   * 事件到不了 X 的处理器，而浏览器原生菜单照常弹出。
   * ---------------------------------------------------------------------- */
  window.addEventListener(
    'contextmenu',
    function (event) {
      event.stopImmediatePropagation();
    },
    true
  );
})();
