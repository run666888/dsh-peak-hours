import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const SOURCE = fileURLToPath(new URL('../client.js', import.meta.url));

/** 最小 React 替身：只满足 client.js 用到的 hook 与 createElement。 */
function makeReact() {
  const createElement = (type, props, ...children) => ({
    type,
    props: { ...(props || {}), children: children.flat() },
  });
  return {
    createElement,
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: () => {},
  };
}

/** 最小 locale 服务替身：对应真实 API —— register(ns, localeId, dict) 三参 + bind(ns)。 */
function makeLocale(activeLocale) {
  const packs = new Map();
  let active = activeLocale;
  return {
    packs,
    service: {
      register(ns, localeId, dict) {
        packs.set(ns + '|' + localeId, dict);
        return () => packs.delete(ns + '|' + localeId);
      },
      bind(ns) {
        return (key) => {
          const order = String(active).startsWith('zh')
            ? [active, 'en']
            : [active, 'zh-CN'];
          for (const id of order) {
            const dict = packs.get(ns + '|' + id);
            if (dict && dict[key] !== undefined) return dict[key];
          }
          return key;
        };
      },
      getSnapshot: () => ({
        active,
        locales: [
          { id: 'zh-CN', label: '简体中文' },
          { id: 'en', label: 'English' },
        ],
        revision: 0,
      }),
      subscribe: () => () => {},
    },
    setActive: (next) => {
      active = next;
    },
  };
}

async function loadPlugin({ locale = 'zh-CN', clipboard, now } = {}) {
  const code = await readFile(SOURCE, 'utf8');
  let factory = null;
  const writes = [];
  const sandbox = {
    window: { __ModuleLoader__: { load: ({ factory: f }) => (factory = f) } },
    document: {
      getElementById: () => null,
      createElement: () => ({
        style: {},
        setAttribute() {},
        select() {},
        appendChild() {},
        removeChild() {},
      }),
      head: { appendChild() {} },
      body: { appendChild() {}, removeChild() {} },
      execCommand: () => true,
    },
    navigator: clipboard
      ? { clipboard: { writeText: (text) => (writes.push(text), Promise.resolve()) } }
      : {},
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    console,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'client.js' });
  if (now !== undefined) {
    sandbox.__frozenNow = now;
    vm.runInContext('Date.now = () => __frozenNow;', sandbox);
  }
  assert.ok(factory, 'ModuleLoader 应当收到 factory');

  const React = makeReact();
  const mod = factory((name) => (name === 'react' ? React : undefined));
  const localeStub = makeLocale(locale);
  const slots = [];
  const ctx = {
    effect: (fn) => fn(),
    inject: (names, cb) => {
      if (Array.isArray(names) && names.includes('locale')) cb({ locale: localeStub.service });
    },
    slots: {
      inject: (_name, cb) => cb(),
      register: (meta, comp) => slots.push({ meta, comp }),
    },
  };
  mod.apply(ctx);
  const sidebar = slots.filter((s) => s.meta.name === 'sidebar.footer.action');
  assert.equal(slots.length, 3, '应注册侧栏动作 + 设置页卡片 + 底栏内联角标');
  assert.equal(sidebar.length, 1, '侧栏动作只有一个');
  assert.equal(
    slots.filter((s) => s.meta.name === 'conversation.input.right').length,
    1,
    '内联角标挂在 conversation.input.right',
  );
  return {
    meta: sidebar[0].meta,
    Component: sidebar[0].comp,
    slots,
    writes,
    packs: localeStub.packs,
    setLocale: localeStub.setActive,
  };
}

/** 以固定时刻渲染（冻结 Date.now），返回组件树与文本。 */
async function renderAt(isoUtc, props = { wide: true }, opts = {}) {
  const fixed = Date.parse(isoUtc);
  const plugin = await loadPlugin({ ...opts, now: fixed });
  const tree = plugin.Component(props);
  return { tree, text: textOf(tree), plugin };
}

function textOf(node) {
  if (node === null || node === undefined || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  const kids = node.props && node.props.children ? node.props.children : [];
  return textOf(kids);
}

const classes = (node) => (node.props && node.props.className) || '';

function findByClass(node, needle, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((n) => findByClass(n, needle, out));
    return out;
  }
  if (classes(node).includes(needle)) out.push(node);
  const kids = node.props && node.props.children ? node.props.children : [];
  kids.forEach((k) => findByClass(k, needle, out));
  return out;
}

// 2026-10-29 是周四（工作日）；UTC+8 的 10:30 = 02:30Z。
test('工作日 10:30 处于高峰，显示 ×2 与剩余空闲倒计时', async () => {
  const { tree, text } = await renderAt('2026-10-29T02:30:00Z');
  assert.match(text, /Busy/);
  assert.match(text, /×2/);
  assert.match(text, /后转 Free/);
  assert.match(classes(tree), /dshph-peak/);
  assert.doesNotMatch(classes(tree), /dshph-soon/);
});

test('工作日 13:00 处于空闲，显示 5 折与转高峰倒计时', async () => {
  const { text } = await renderAt('2026-10-29T05:00:00Z');
  assert.match(text, /Free/);
  assert.match(text, /5 折/);
  assert.match(text, /后转 Busy/);
});

test('午休 12:00 与 18:00 边界归为空闲', async () => {
  assert.match((await renderAt('2026-10-29T04:00:00Z')).text, /Free/);
  assert.match((await renderAt('2026-10-29T10:00:00Z')).text, /Free/);
});

test('14:00 边界归为高峰，09:00 之前是空闲', async () => {
  assert.match((await renderAt('2026-10-29T06:00:00Z')).text, /Busy/);
  assert.match((await renderAt('2026-10-29T00:30:00Z')).text, /Free/);
});

test('周末 10:30 全天空闲，tooltip 说明今天周末', async () => {
  const { tree, text } = await renderAt('2026-10-31T02:30:00Z');
  assert.match(text, /Free/);
  assert.match(tree.props.title, /今天：周末/);
});

test('国庆假期 10:30 全天空闲，tooltip 说明法定节假日', async () => {
  const { tree, text } = await renderAt('2026-10-02T02:30:00Z');
  assert.match(text, /Free/);
  assert.match(tree.props.title, /今天：法定节假日/);
});

test('tooltip 预告明天：周五提示周末、周四提示工作日', async () => {
  const fri = await renderAt('2026-10-09T02:30:00Z');
  assert.match(fri.tree.props.title, /明天：周末/);
  const thu = await renderAt('2026-10-08T02:30:00Z');
  assert.match(thu.tree.props.title, /明天：工作日/);
});

test('临近切换（≤10 分钟）进入强调态', async () => {
  const tree = (await renderAt('2026-10-29T03:55:00Z')).tree; // 11:55 → 12:00
  assert.match(classes(tree), /dshph-soon/);
  const dots = findByClass(tree, 'dshph-dot');
  assert.equal(dots.length, 1);
  assert.match(classes(dots[0]), /dshph-dot-soon/);
});

test('折叠态只渲染圆点与迷你条，不带文字', async () => {
  const { tree, text } = await renderAt('2026-10-29T02:30:00Z', { wide: false });
  assert.match(classes(tree), /dshph-rail/);
  assert.equal(text, '');
  assert.equal(findByClass(tree, 'dshph-track').length, 1);
});

test('工作日日程条 5 段、周末 1 段，宽度按分钟百分比', async () => {
  const workday = (await renderAt('2026-10-29T02:30:00Z')).tree;
  const segs = findByClass(workday, 'dshph-seg');
  assert.equal(segs.length, 5);
  const noonPeakWidth = (((12 - 9) * 60) / 1440) * 100;
  assert.equal(segs[1].props.style.width, noonPeakWidth.toFixed(3) + '%');

  const weekend = (await renderAt('2026-10-31T02:30:00Z')).tree;
  assert.equal(findByClass(weekend, 'dshph-seg').length, 1);
});

test('游标位置等于当前分钟占比', async () => {
  const tree = (await renderAt('2026-10-29T02:30:00Z')).tree; // 10:30 = 630 分钟
  const cursor = findByClass(tree, 'dshph-cursor')[0];
  assert.equal(cursor.props.style.left, ((630 / 1440) * 100).toFixed(3) + '%');
});

test('tooltip 含点击提示、时区与真实配色用词（非红绿）', async () => {
  const { tree } = await renderAt('2026-10-29T02:30:00Z');
  const tip = tree.props.title;
  assert.match(tip, /点击复制当前状态/);
  assert.match(tip, /北京时间/);
  assert.doesNotMatch(tip, /红色=高峰/);
  assert.match(tip, /橙色 = Busy（高峰）、蓝色 = Free（空闲）/);
  assert.ok(!tip.includes('\\n'), 'tooltip 不应含字面反斜杠 n');
});

test('点击复制把状态摘要写入剪贴板', async () => {
  const plugin = await loadPlugin({
    clipboard: true,
    now: Date.parse('2026-10-29T02:30:00Z'),
  });
  const tree = plugin.Component({ wide: true });
  tree.props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(plugin.writes.length, 1);
  assert.match(plugin.writes[0], /Busy/);
  assert.match(plugin.writes[0], /北京时间/);
});

test('英文语言包：不泄漏 key，且用词与配色一致', async () => {
  const en = await renderAt('2026-10-29T02:30:00Z', { wide: true }, { locale: 'en' });
  assert.match(en.text, /Busy/);
  assert.match(en.text, /×2/);
  assert.doesNotMatch(en.text, /tip\.|copy\.|status\./);
  assert.match(en.tree.props.title, /amber = Busy, blue = Free/);
  const off = await renderAt('2026-10-29T05:00:00Z', { wide: true }, { locale: 'en' });
  assert.match(off.text, /50% off/);
});

test('中英文语言包的 key 完全对齐', async () => {
  const zh = await loadPlugin({ locale: 'zh-CN' });
  const dict = {
    zh: zh.packs.get('dsh-peak-hours|zh-CN'),
    en: zh.packs.get('dsh-peak-hours|en'),
  };
  assert.ok(dict, '应注册 dsh-peak-hours 语言包');
  const zhKeys = Object.keys(dict.zh).sort();
  const enKeys = Object.keys(dict.en).sort();
  assert.deepEqual(zhKeys, enKeys, 'zh 与 en 的 key 必须一一对应');
  assert.ok(zhKeys.length >= 30, '字典不应退化成少量 key');
  for (const key of zhKeys) {
    if (key === 'unit.sep') continue; // 中文时间单位之间不需要分隔符，允许空串
    assert.ok(String(dict.zh[key]).length > 0, 'zh.' + key + ' 不应为空');
    assert.ok(String(dict.en[key]).length > 0, 'en.' + key + ' 不应为空');
  }
  assert.equal(zh.meta.id, 'dsh-peak-hours');
  assert.equal(zh.meta.key, 'dsh-peak-hours');
  assert.equal(zh.meta.order, 20);
});

test('中文环境：设置页卡片用中文渲染（register 走三参 API）', async () => {
  const plugin = await loadPlugin({ locale: 'zh-CN', now: Date.parse('2026-10-29T02:30:00Z') });
  const card = plugin.slots.find((s) => s.meta.name === 'settings.general.item');
  assert.ok(card, '应注册设置页卡片');
  assert.ok(plugin.packs.get('dsh-peak-hours|zh-CN'), '中文语言包必须用 (ns, localeId, dict) 三参注册');
  const tree = card.comp();
  const text = textOf(tree);
  assert.match(text, /高峰/, '设置页卡片应是中文');
  assert.doesNotMatch(text, /usage\.(title|desc|actual)|Peak share/, '不应泄漏 key 或退化成英文');
});
