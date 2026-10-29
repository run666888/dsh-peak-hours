window.__ModuleLoader__.load({
  id: 'dsh-peak-hours',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'dsh-peak-hours';
    const MINUTE = 60 * 1000;
    const BEIJING_OFFSET = 8 * 60 * MINUTE;

    // 高峰时段（北京时间，分钟数）：09:00–12:00、14:00–18:00
    const PEAK_WINDOWS = [
      [9 * 60, 12 * 60],
      [14 * 60, 18 * 60],
    ];

    // 距峰↔谷切换不足该分钟数时，倒计时与圆点进入强调态。
    const SOON_MINUTES = 10;

    /**
     * 中国法定节假日（全天空闲计价）。来源：2026-09-19 官方说明
     * 「法定节假日全天、调休上班的周末全天均按空闲时段计费」。
     * 已核对 2026 年中秋、国庆；新一年的放假安排公布后按公告补充，
     * 未收录的年份只按周末规则判定（周末本就全天空闲，因此不会判错方向）。
     */
    const HOLIDAYS = {
      2026: [
        '2026-09-25', '2026-09-26', '2026-09-27',
        '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
        '2026-10-05', '2026-10-06', '2026-10-07',
      ],
    };
    const HOLIDAY_YEARS = Object.keys(HOLIDAYS).sort();
    const holidayCache = new Map();
    function holidaySet(year) {
      if (holidayCache.has(year)) return holidayCache.get(year);
      const list = HOLIDAYS[year];
      const set = list ? new Set(list) : null;
      holidayCache.set(year, set);
      return set;
    }

    const pad2 = (n) => (n < 10 ? '0' + n : '' + n);

    /** 把瞬间投影到北京时间墙上时钟。 */
    function beijing(ms) {
      const d = new Date(ms + BEIJING_OFFSET);
      const year = d.getUTCFullYear();
      const month = d.getUTCMonth() + 1;
      const day = d.getUTCDate();
      return {
        year,
        month,
        day,
        key: year + '-' + pad2(month) + '-' + pad2(day),
        dow: d.getUTCDay(),
        minute: d.getUTCHours() * 60 + d.getUTCMinutes(),
        clock: pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()),
      };
    }

    function stateAt(ms) {
      const t = beijing(ms);
      const holidays = holidaySet(t.year);
      const isWeekend = t.dow === 0 || t.dow === 6;
      const isHoliday = holidays ? holidays.has(t.key) : false;
      const allDayOff = isWeekend || isHoliday;
      const inWindow = PEAK_WINDOWS.some(
        (w) => t.minute >= w[0] && t.minute < w[1],
      );
      return {
        peak: !allDayOff && inWindow,
        isWeekend,
        isHoliday,
        allDayOff,
        beijing: t,
      };
    }

    /** 次日的计价形态：holiday / weekend / workday。 */
    function kindAt(ms) {
      const t = beijing(ms);
      const holidays = holidaySet(t.year);
      if (holidays && holidays.has(t.key)) return 'holiday';
      if (t.dow === 0 || t.dow === 6) return 'weekend';
      return 'workday';
    }

    /** 下一个峰↔谷切换的瞬间（分钟对齐），最多向前找 14 天。 */
    function nextSwitch(ms) {
      const current = stateAt(ms);
      const base = Math.floor(ms / MINUTE) * MINUTE;
      const limit = 14 * 1440;
      for (let i = 1; i <= limit; i += 1) {
        const at = base + i * MINUTE;
        if (stateAt(at).peak !== current.peak) return at;
      }
      return null;
    }

    /** 当前这一段（高峰段或空闲段）的起点。 */
    function prevSwitch(ms) {
      const current = stateAt(ms);
      const base = Math.floor(ms / MINUTE) * MINUTE;
      const limit = 14 * 1440;
      for (let i = 1; i <= limit; i += 1) {
        const at = base - i * MINUTE;
        if (stateAt(at).peak !== current.peak) return at + MINUTE;
      }
      return null;
    }

    function phaseOf(ms) {
      const start = prevSwitch(ms);
      const end = nextSwitch(ms);
      let progress = 0;
      if (start !== null && end !== null && end > start) {
        progress = Math.min(1, Math.max(0, (ms - start) / (end - start)));
      }
      return { start, end, progress };
    }

    /** 当天 00:00–24:00 的峰谷分段（分钟），画成橙蓝相间的日程条。 */
    function daySchedule(ms) {
      const st = stateAt(ms);
      if (st.allDayOff) return [{ from: 0, to: 1440, peak: false }];
      const segs = [];
      let cur = 0;
      for (const w of PEAK_WINDOWS) {
        if (w[0] > cur) segs.push({ from: cur, to: w[0], peak: false });
        segs.push({ from: w[0], to: w[1], peak: true });
        cur = w[1];
      }
      if (cur < 1440) segs.push({ from: cur, to: 1440, peak: false });
      return segs;
    }

    const pct = (minute) => ((minute / 1440) * 100).toFixed(3) + '%';

    function fmtDuration(ms, t) {
      const total = Math.max(1, Math.round(ms / MINUTE));
      const days = Math.floor(total / 1440);
      const hours = Math.floor((total % 1440) / 60);
      const minutes = total % 60;
      const parts = [];
      if (days) parts.push(days + t('unit.day'));
      if (hours) parts.push(hours + t('unit.hour'));
      if (!days && minutes) parts.push(minutes + t('unit.minute'));
      const sep = t('unit.sep') || '';
      return parts.join(sep);
    }

    function clockLabel(ms) {
      const b = beijing(ms);
      return b.month + '-' + pad2(b.day) + ' ' + b.clock;
    }

    function holidayNote(t) {
      return (t('tip.table') || '').replace('{years}', HOLIDAY_YEARS.join(' / '));
    }

    function tooltip(t, st, phase, now) {
      const lines = [
        t('tip.head'),
        t('tip.current') + (st.peak ? t('status.peak') : t('status.off')),
        t('tip.window'),
        t('tip.bar'),
        t('tip.rule'),
        t('tip.weekend'),
      ];
      if (st.isHoliday) lines.push(t('tip.holidayToday'));
      else if (st.isWeekend) lines.push(t('tip.weekendToday'));
      const tomorrow = kindAt(now + 1440 * MINUTE);
      lines.push(
        tomorrow === 'holiday'
          ? t('tip.tomorrowHoliday')
          : tomorrow === 'weekend'
            ? t('tip.tomorrowWeekend')
            : t('tip.tomorrowWorkday'),
      );
      if (phase.start !== null && phase.end !== null) {
        lines.push(
          t('tip.phase') + clockLabel(phase.start) + ' → ' + clockLabel(phase.end),
        );
        lines.push(
          t('tip.next') +
            fmtDuration(phase.end - now, t) +
            (st.peak ? t('next.off') : t('next.peak')),
        );
      }
      lines.push(
        '',
        t('tip.prices'),
        t('tip.flash'),
        t('tip.pro'),
        '',
        holidayNote(t),
        t('tip.tz'),
        t('tip.hint'),
      );
      return lines.join('\n');
    }

    function copySummary(t, st, phase, now) {
      const pill = st.peak ? t('price.multiplier') : t('price.discount');
      const rest =
        phase.end !== null
          ? t('tip.next') +
            fmtDuration(phase.end - now, t) +
            (st.peak ? t('next.off') : t('next.peak'))
          : '';
      return (
        'DeepSeek ' +
        (st.peak ? t('status.peak') : t('status.off')) +
        ' ' +
        pill +
        ' · ' +
        rest +
        ' ' +
        t('copy.suffix')
      );
    }

    /** 复制到剪贴板：Clipboard API 优先，失败退回临时 textarea。 */
    function writeClipboard(text) {
      try {
        if (
          typeof navigator !== 'undefined' &&
          navigator.clipboard &&
          typeof navigator.clipboard.writeText === 'function'
        ) {
          return Promise.resolve(navigator.clipboard.writeText(text)).then(
            () => true,
            () => fallbackCopy(text),
          );
        }
      } catch {
        /* 落到兜底 */
      }
      return Promise.resolve(fallbackCopy(text));
    }

    function fallbackCopy(text) {
      try {
        if (typeof document === 'undefined' || !document.body) return false;
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand && document.execCommand('copy');
        document.body.removeChild(area);
        return !!ok;
      } catch {
        return false;
      }
    }

    // 字族跟随宿主，字号显式压到侧栏次级字号（0.8125rem ≈ 13px），
    // 因为 footer 动作行从根节点继承的是 1rem，直接用 inherit 会比菜单项大一号。
    const CSS = `
      .dshph-root {
        --dshph-peak: #f59e0b;
        --dshph-off: #4d6bfe;
        --dshph-peak-hi: #fbbf24;
        --dshph-off-hi: #6383ff;
        display: flex; flex-direction: column; gap: 4px;
        box-sizing: border-box; width: 100%; min-width: 0;
        padding: 4px 8px 5px; border-radius: 8px;
        font-family: inherit; font-size: 14px; font-size: .875rem;
        font-weight: 400; line-height: 1.45;
        color: var(--dsw-alias-label-primary);
        user-select: none; cursor: pointer; outline: none;
        transition: background-color .15s ease;
      }
      .dshph-root:hover { background: var(--dsw-alias-bg-layer-2); }
      .dshph-root:focus-visible {
        outline: 2px solid var(--dsw-alias-brand-primary, #4d6bfe);
        outline-offset: 1px;
      }
      .dshph-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
      .dshph-dot { flex: none; width: 7px; height: 7px; border-radius: 50%; }
      .dshph-peak .dshph-dot {
        background: var(--dshph-peak);
        box-shadow: 0 0 0 3px rgba(245, 158, 11, .22);
      }
      .dshph-off .dshph-dot {
        background: var(--dshph-off);
        box-shadow: 0 0 0 3px rgba(77, 107, 254, .2);
      }
      .dshph-dot-soon { animation: dshph-pulse 1.6s ease-in-out infinite; }
      @keyframes dshph-pulse {
        0%, 100% { box-shadow: 0 0 0 2px rgba(245, 158, 11, .22); }
        50% { box-shadow: 0 0 0 5px rgba(245, 158, 11, .06); }
      }
      .dshph-label,
      .dshph-pill,
      .dshph-next {
        font-family: inherit; font-size: inherit; font-weight: inherit;
        line-height: inherit; letter-spacing: inherit; color: inherit;
      }
      .dshph-label { flex: none; }
      .dshph-pill { flex: none; }
      .dshph-spacer { flex: 1 1 auto; min-width: 4px; }
      .dshph-next {
        flex: 0 1 auto; min-width: 0; overflow: hidden;
        text-overflow: ellipsis; white-space: nowrap;
      }
      .dshph-soon .dshph-next { color: #f59e0b; font-weight: 600; }
      .dshph-toast { color: var(--dsw-alias-label-secondary); }
      .dshph-track {
        position: relative; height: 8px; border-radius: 999px;
        background: var(--dsw-alias-bg-layer-2); overflow: hidden;
      }
      .dshph-seg { position: absolute; top: 0; bottom: 0; }
      .dshph-seg-off {
        background: linear-gradient(180deg, var(--dshph-off-hi), var(--dshph-off));
      }
      .dshph-seg-peak {
        background: linear-gradient(180deg, var(--dshph-peak-hi), var(--dshph-peak));
      }
      .dshph-cursor {
        position: absolute; top: 0; bottom: 0; width: 2px;
        border-radius: 1px; background: #fff;
        box-shadow: 0 0 0 1px rgba(0, 0, 0, .45);
        transform: translateX(-1px);
        transition: left .6s linear;
      }
      .dshph-rail {
        align-items: center; justify-content: center; gap: 4px;
        padding: 0;
      }
      .dshph-rail .dshph-track { width: 26px; height: 6px; }
      .dshph-rail .dshph-cursor { width: 1.5px; }

      /* ---- 峰谷用量与费用卡片（设置页） ---- */
      .dshphu-card {
        --dshphu-peak: #f59e0b;
        --dshphu-off: #4d6bfe;
        display: flex; flex-direction: column; gap: 10px;
        box-sizing: border-box; width: 100%; min-width: 0;
        padding: 12px 14px; border-radius: 10px;
        border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, .18));
        background: var(--dsw-alias-bg-layer-1, transparent);
        font-family: inherit; font-size: 14px; font-size: .875rem;
        line-height: 1.45; color: var(--dsw-alias-label-primary);
      }
      .dshphu-head { display: flex; align-items: flex-start; gap: 10px; min-width: 0; }
      .dshphu-titles { flex: 1 1 auto; min-width: 0; }
      .dshphu-title { font-weight: 600; }
      .dshphu-desc { color: var(--dsw-alias-label-secondary); font-size: .92em; }
      .dshphu-seg { flex: none; display: flex; gap: 4px; }
      .dshphu-segBtn {
        font: inherit; font-size: .92em; cursor: pointer;
        padding: 2px 9px; border-radius: 999px;
        border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, .18));
        background: transparent; color: var(--dsw-alias-label-secondary);
      }
      .dshphu-segBtn[data-on='1'] {
        color: #fff; border-color: transparent; background: var(--dshphu-off);
      }
      .dshphu-kpis { display: flex; flex-wrap: wrap; gap: 14px; }
      .dshphu-kpi { min-width: 96px; }
      .dshphu-kpiLabel { color: var(--dsw-alias-label-secondary); font-size: .92em; }
      .dshphu-kpiValue { font-size: 1.18em; font-weight: 600; }
      .dshphu-kpiValue[data-tone='peak'] { color: var(--dshphu-peak); }
      .dshphu-kpiValue[data-tone='save'] { color: var(--dshphu-off); }
      .dshphu-bar {
        display: flex; height: 8px; border-radius: 999px; overflow: hidden;
        background: var(--dsw-alias-bg-layer-2);
      }
      .dshphu-barPeak { background: var(--dshphu-peak); }
      .dshphu-barOff { background: var(--dshphu-off); }
      .dshphu-line { color: var(--dsw-alias-label-secondary); font-size: .92em; }
      .dshphu-models { display: flex; flex-direction: column; gap: 3px; }
      .dshphu-model { display: flex; gap: 8px; align-items: baseline; font-size: .92em; }
      .dshphu-modelName { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dshphu-modelNum { flex: none; color: var(--dsw-alias-label-secondary); }
      .dshphu-note { color: var(--dsw-alias-label-secondary); font-size: .88em; }
      .dshphu-err { color: var(--dsw-alias-state-error-primary, #d33); font-size: .92em; }
          @media (prefers-reduced-motion: reduce) {
        .dshph-root, .dshph-root * {
          animation: none !important; transition: none !important;
        }
      }
    `;

    function ensureStyle() {
      if (typeof document === 'undefined') return () => {};
      const id = 'dsh-peak-hours-style';
      if (document.getElementById(id)) return () => {};
      const el = document.createElement('style');
      el.id = id;
      el.textContent = CSS;
      document.head.appendChild(el);
      return () => {
        if (el.parentNode) el.parentNode.removeChild(el);
      };
    }

    const ZH = {
      label: '峰谷时段',
      'status.peak': '高峰',
      'status.off': '空闲',
      'price.multiplier': '×2',
      'price.discount': '5 折',
      'next.peak': '后转高峰',
      'next.off': '后转空闲',
      'unit.day': '天',
      'unit.hour': '小时',
      'unit.minute': '分',
      'unit.sep': '',
      'tip.head': 'DeepSeek 峰谷计费',
      'tip.current': '当前：',
      'tip.window': '高峰时段：工作日 09:00–12:00、14:00–18:00（北京时间）',
      'tip.bar': '日程条：当天 00:00–24:00，橙色=高峰、蓝色=空闲，白线是当前时刻',
      'tip.rule': '其余时间按空闲计价，闲时价为高峰价的一半',
      'tip.weekend': '周末与法定节假日全天按空闲计价',
      'tip.holidayToday': '今天：法定节假日，全天按空闲计价',
      'tip.weekendToday': '今天：周末，全天按空闲计价',
      'tip.tomorrowHoliday': '明天：法定节假日，全天按空闲计价',
      'tip.tomorrowWeekend': '明天：周末，全天按空闲计价',
      'tip.tomorrowWorkday': '明天：工作日，恢复按 09:00–12:00、14:00–18:00 计价',
      'tip.phase': '本段：',
      'tip.next': '距切换：',
      'tip.prices': '价格（元/百万 tokens，空闲 → 高峰）',
      'tip.flash': 'deepseek-flash：缓存命中 0.02 → 0.04｜未命中 1 → 2｜输出 4 → 8',
      'tip.pro': 'deepseek-v4-pro：缓存命中 0.15 → 0.30｜未命中 4.5 → 9.0｜输出 13.5 → 27.0',
      'tip.table': '节假日表已收录 {years} 年中秋、国庆；新一年安排公布后随版本更新',
      'tip.tz': '判定时区：北京时间（UTC+8）',
      'tip.hint': '点击复制当前状态',
      'copy.ok': '已复制',
      'copy.fail': '复制失败',
      'copy.suffix': '（北京时间）',
      'usage.title': '峰谷用量与费用',
      'usage.desc': '来自本地会话日志：按高峰/空闲拆分 tokens，并按峰谷价折算费用',
      'usage.range': '统计区间',
      'usage.range.7': '近 7 天',
      'usage.range.30': '近 30 天',
      'usage.range.all': '全部',
      'usage.actual': '实际花费',
      'usage.allPeak': '全在高峰',
      'usage.saved': '比全高峰省',
      'usage.peakTokens': '高峰',
      'usage.offTokens': '空闲',
      'usage.totalTokens': '合计',
      'usage.peakShare': '高峰占比',
      'usage.refresh': '重新统计',
      'usage.refreshHint': '点击右上角区间可切换',
      'usage.loading': '统计中…（首次需扫描本地会话日志）',
      'usage.error': '读取失败：',
      'usage.empty': '暂无用量记录',
      'usage.note': '仅 deepseek 系模型按峰谷价折算；其他供应商 {tokens} tokens 计入用量、不计费',
      'usage.meta': '扫描 {sessions} 个会话 · 活跃 {days} 天',

    };

    const EN = {
      label: 'Peak hours',
      'status.peak': 'Peak',
      'status.off': 'Off-peak',
      'price.multiplier': '×2',
      'price.discount': '50% off',
      'next.peak': ' until peak',
      'next.off': ' until off-peak',
      'unit.day': 'd',
      'unit.hour': 'h',
      'unit.minute': 'm',
      'unit.sep': ' ',
      'tip.head': 'DeepSeek peak/off-peak pricing',
      'tip.current': 'Now: ',
      'tip.window': 'Peak: weekdays 09:00–12:00 and 14:00–18:00 (Beijing time)',
      'tip.bar': 'Day bar: 00:00–24:00, amber = peak, blue = off-peak, white line = now',
      'tip.rule': 'Everything else is off-peak, priced at half of the peak rate',
      'tip.weekend': 'Weekends and public holidays are off-peak all day',
      'tip.holidayToday': 'Today: public holiday, off-peak all day',
      'tip.weekendToday': 'Today: weekend, off-peak all day',
      'tip.tomorrowHoliday': 'Tomorrow: public holiday, off-peak all day',
      'tip.tomorrowWeekend': 'Tomorrow: weekend, off-peak all day',
      'tip.tomorrowWorkday': 'Tomorrow: weekday, peak windows apply again',
      'tip.phase': 'This block: ',
      'tip.next': 'Switch in ',
      'tip.prices': 'Price (CNY / million tokens, off-peak → peak)',
      'tip.flash': 'deepseek-flash: cache hit 0.02 → 0.04 | miss 1 → 2 | output 4 → 8',
      'tip.pro': 'deepseek-v4-pro: cache hit 0.15 → 0.30 | miss 4.5 → 9.0 | output 13.5 → 27.0',
      'tip.table': 'Holiday table covers {years} (Mid-Autumn, National Day); updated per release',
      'tip.tz': 'Evaluated in Beijing time (UTC+8)',
      'tip.hint': 'Click to copy the current state',
      'copy.ok': 'Copied',
      'copy.fail': 'Copy failed',
      'copy.suffix': '(Beijing time)',
      'usage.title': 'Peak / off-peak usage and cost',
      'usage.desc': 'From local session logs: tokens split by peak/off-peak, priced at the peak/off-peak rates',
      'usage.range': 'Range',
      'usage.range.7': '7 days',
      'usage.range.30': '30 days',
      'usage.range.all': 'All',
      'usage.actual': 'Actual spend',
      'usage.allPeak': 'All at peak',
      'usage.saved': 'Saved vs all-peak',
      'usage.peakTokens': 'Peak',
      'usage.offTokens': 'Off-peak',
      'usage.totalTokens': 'Total',
      'usage.peakShare': 'Peak share',
      'usage.refresh': 'Rescan',
      'usage.refreshHint': 'Switch ranges above',
      'usage.loading': 'Scanning… (first run reads local session logs)',
      'usage.error': 'Failed to load: ',
      'usage.empty': 'No usage yet',
      'usage.note': 'Only DeepSeek models are priced here; {tokens} tokens from other providers count as usage, not money',
      'usage.meta': '{sessions} sessions scanned · {days} active days',

    };

    let translate = (key) => (EN[key] !== undefined ? EN[key] : key);

    function PeakBadge(props) {
      const t = translate;
      const [now, setNow] = React.useState(() => Date.now());
      const [toast, setToast] = React.useState('');

      React.useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 15000);
        return () => clearInterval(id);
      }, []);

      const st = stateAt(now);
      const phase = phaseOf(now);
      const schedule = daySchedule(now);
      const off = !st.peak;
      const wide = !props || props.wide !== false;
      const stateText = off ? t('status.off') : t('status.peak');
      const title = tooltip(t, st, phase, now);
      const soon =
        phase.end !== null && phase.end - now <= SOON_MINUTES * MINUTE;
      const rootClass =
        'dshph-root ' +
        (off ? 'dshph-off' : 'dshph-peak') +
        (soon ? ' dshph-soon' : '');
      const cursorLeft = pct(st.beijing.minute);
      const remaining = phase.end
        ? fmtDuration(phase.end - now, t) + (off ? t('next.peak') : t('next.off'))
        : '';

      const onCopy = () => {
        const text = copySummary(t, st, phase, now);
        let result;
        try {
          result = writeClipboard(text);
        } catch {
          result = Promise.resolve(false);
        }
        Promise.resolve(result)
          .then((ok) => setToast(ok ? t('copy.ok') : t('copy.fail')))
          .catch(() => setToast(t('copy.fail')));
        setTimeout(() => setToast(''), 1500);
      };

      const onKeyDown = (event) => {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
          event.preventDefault();
          onCopy();
        }
      };

      const headText = toast
        ? h('span', { className: 'dshph-next dshph-toast' }, toast)
        : h('span', { className: 'dshph-next' }, remaining);

      const track = h(
        'div',
        { className: 'dshph-track' },
        ...schedule.map((seg, i) =>
          h('span', {
            key: 'seg' + i,
            className:
              'dshph-seg ' + (seg.peak ? 'dshph-seg-peak' : 'dshph-seg-off'),
            style: { left: pct(seg.from), width: pct(seg.to - seg.from) },
          }),
        ),
        h('span', { key: 'cursor', className: 'dshph-cursor', style: { left: cursorLeft } }),
      );

      const common = {
        title,
        role: 'button',
        tabIndex: 0,
        onClick: onCopy,
        onKeyDown,
        'aria-label':
          t('label') + ': ' + stateText + ', ' + remaining + '. ' + t('tip.hint'),
      };

      if (!wide) {
        return h(
          'div',
          { ...common, className: rootClass + ' dshph-rail' },
          h('span', {
            className: 'dshph-dot' + (soon ? ' dshph-dot-soon' : ''),
          }),
          track,
        );
      }

      return h(
        'div',
        { ...common, className: rootClass },
        h(
          'div',
          { className: 'dshph-head' },
          h('span', {
            className: 'dshph-dot' + (soon ? ' dshph-dot-soon' : ''),
          }),
          h('span', { className: 'dshph-label' }, stateText),
          h(
            'span',
            { className: 'dshph-pill' },
            off ? t('price.discount') : t('price.multiplier'),
          ),
          h('span', { className: 'dshph-spacer' }),
          headText,
        ),
        track,
      );
    }


    // ---------------------------------------------------------------------
    // 峰谷用量与费用（设置页卡片）
    // ---------------------------------------------------------------------
    const USAGE_API = '/dsh-peak-hours/api/usage';
    const RANGES = ['7', '30', 'all'];
    let usageCache = null;

    function fmtTokens(n) {
      const v = Number(n) || 0;
      if (v >= 1e8) return (v / 1e8).toFixed(2) + ' 亿';
      if (v >= 1e4) return (v / 1e4).toFixed(1) + ' 万';
      return String(Math.round(v));
    }

    function fmtMoney(n) {
      const v = Number(n) || 0;
      if (v > 0 && v < 0.01) return '¥' + v.toFixed(4);
      if (v < 1) return '¥' + v.toFixed(3);
      return '¥' + v.toFixed(2);
    }

    function fmtPct(x) {
      return ((Number(x) || 0) * 100).toFixed(1) + '%';
    }

    function modelParts(name) {
      const s = String(name || '');
      const i = s.indexOf('/');
      return i >= 0 ? { provider: s.slice(0, i), model: s.slice(i + 1) } : { provider: '', model: s };
    }

    /** Short name; when two providers expose the same model, keep the provider tag. */
    function shortModel(name, duplicated) {
      const { provider, model } = modelParts(name);
      if (!duplicated) return model;
      const tag = provider.replace(/^deepseek-/, '').replace(/-?account$/, 'personal');
      return tag ? model + ' · ' + tag : model;
    }

    function UsageCard() {
      const t = translate;
      const rangeState = React.useState('30');
      const range = rangeState[0];
      const setRange = rangeState[1];
      const dataState = React.useState(usageCache);
      const data = dataState[0];
      const setData = dataState[1];
      const errState = React.useState('');
      const err = errState[0];
      const setErr = errState[1];
      const loadState = React.useState(!usageCache);
      const loading = loadState[0];
      const setLoading = loadState[1];
      const tickState = React.useState(0);
      const tick = tickState[0];
      const reload = tickState[1];

      React.useEffect(() => {
        let alive = true;
        setLoading(true);
        fetch(USAGE_API + (tick > 0 ? '?fresh=1' : ''), { cache: 'no-store' })
          .then((r) =>
            r.json().then(
              (j) => {
                if (!r.ok) throw new Error((j && j.error) || 'HTTP ' + r.status);
                return j;
              },
              () => {
                throw new Error('HTTP ' + r.status);
              },
            ),
          )
          .then((j) => {
            if (!alive) return;
            usageCache = j;
            setData(j);
            setErr('');
          })
          .catch((e) => {
            if (!alive) return;
            setErr(String((e && e.message) || e));
          })
          .then(() => {
            if (alive) setLoading(false);
          });
        return () => {
          alive = false;
        };
      }, [tick]);

      const rep = data && data.ranges ? data.ranges[range] : null;
      const seg = h(
        'div',
        { className: 'dshphu-seg', role: 'group', 'aria-label': t('usage.range') },
        ...RANGES.map((key) =>
          h(
            'button',
            {
              key,
              type: 'button',
              className: 'dshphu-segBtn',
              'data-on': range === key ? '1' : '0',
              'aria-pressed': range === key ? 'true' : 'false',
              onClick: () => setRange(key),
            },
            t('usage.range.' + key),
          ),
        ),
      );

      const head = h(
        'div',
        { className: 'dshphu-head' },
        h(
          'div',
          { className: 'dshphu-titles' },
          h('div', { className: 'dshphu-title' }, t('usage.title')),
          h('div', { className: 'dshphu-desc' }, t('usage.desc')),
        ),
        seg,
      );

      if (err) {
        return h(
          'div',
          { className: 'dshphu-card' },
          head,
          h('div', { className: 'dshphu-err' }, t('usage.error') + err),
          h(
            'div',
            null,
            h('button', { type: 'button', className: 'dshphu-segBtn', onClick: () => reload((n) => n + 1) }, t('usage.refresh')),
          ),
        );
      }

      if (!rep) {
        return h(
          'div',
          { className: 'dshphu-card' },
          head,
          h('div', { className: 'dshphu-line' }, loading ? t('usage.loading') : t('usage.empty')),
        );
      }

      const tokens = rep.tokens;
      const cost = rep.cost;
      const peakPct = Math.max(0, Math.min(1, tokens.peakShare));
      const modelRows = rep.classByModel || [];
      const modelNames = new Map();
      for (const row of modelRows) {
        const base = modelParts(row.model).model;
        modelNames.set(base, (modelNames.get(base) || 0) + 1);
      }
      const models = modelRows.slice(0, 4);

      return h(
        'div',
        { className: 'dshphu-card' },
        head,
        h(
          'div',
          { className: 'dshphu-kpis' },
          h(
            'div',
            { className: 'dshphu-kpi' },
            h('div', { className: 'dshphu-kpiLabel' }, t('usage.actual')),
            h('div', { className: 'dshphu-kpiValue' }, fmtMoney(cost.actual)),
          ),
          h(
            'div',
            { className: 'dshphu-kpi' },
            h('div', { className: 'dshphu-kpiLabel' }, t('usage.allPeak')),
            h('div', { className: 'dshphu-kpiValue', 'data-tone': 'peak' }, fmtMoney(cost.allPeak)),
          ),
          h(
            'div',
            { className: 'dshphu-kpi' },
            h('div', { className: 'dshphu-kpiLabel' }, t('usage.saved')),
            h(
              'div',
              { className: 'dshphu-kpiValue', 'data-tone': 'save' },
              fmtMoney(cost.saved) + ' · ' + fmtPct(cost.savedPct),
            ),
          ),
        ),
        h(
          'div',
          { className: 'dshphu-bar', role: 'img', 'aria-label': t('usage.peakShare') + ' ' + fmtPct(peakPct) },
          h('span', { className: 'dshphu-barPeak', style: { width: fmtPct(peakPct) } }),
          h('span', { className: 'dshphu-barOff', style: { width: fmtPct(1 - peakPct) } }),
        ),
        h(
          'div',
          { className: 'dshphu-line' },
          t('usage.peakTokens') + ' ' + fmtTokens(tokens.peak.total) +
            ' · ' + t('usage.offTokens') + ' ' + fmtTokens(tokens.off.total) +
            ' · ' + t('usage.totalTokens') + ' ' + fmtTokens(tokens.total) +
            ' · ' + t('usage.peakShare') + ' ' + fmtPct(peakPct),
        ),
        models.length
          ? h(
              'div',
              { className: 'dshphu-models' },
              ...models.map((m) =>
                h(
                  'div',
                  { key: m.model, className: 'dshphu-model' },
                  h(
                    'span',
                    { className: 'dshphu-modelName' },
                    shortModel(m.model, (modelNames.get(modelParts(m.model).model) || 0) > 1),
                  ),
                  h(
                    'span',
                    { className: 'dshphu-modelNum' },
                    fmtTokens(m.peak.total + m.off.total) + ' · ' + fmtMoney(m.cost || 0),
                  ),
                ),
              ),
            )
          : null,
        h('div', { className: 'dshphu-note' }, t('usage.note').replace('{tokens}', fmtTokens(rep.other.tokens))),
        h(
          'div',
          { className: 'dshphu-line' },
          t('usage.meta')
            .replace('{sessions}', String((data.stats && data.stats.sessions) || 0))
            .replace('{days}', String(rep.activeDays || 0)) +
            ' · ' +
            (loading ? t('usage.loading') : t('usage.refreshHint')),
        ),
      );
    }
    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(ensureStyle, 'dsh-peak-hours-style');

        // 语言包晚到也不影响：locale 可用时立刻补注册并接管文案。
        ctx.inject(['locale'], (c) => {
          if (!c.locale || typeof c.locale.register !== 'function') return;
          try {
            c.locale.register(NS, { zh: ZH, en: EN });
          } catch {
            /* 已注册过（例如热重载），沿用现有字典 */
          }
          try {
            const bound = c.locale.bind(NS);
            if (typeof bound === 'function') translate = bound;
          } catch {
            /* 保留内置兜底 */
          }
        });

        ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register(
            {
              name: 'sidebar.footer.action',
              id: 'dsh-peak-hours',
              key: 'dsh-peak-hours',
              order: 20,
              locale: NS,
              label: () => translate('label'),
            },
            PeakBadge,
          ),
        );
        ctx.slots.inject('settings.general.item', () =>
          ctx.slots.register(
            {
              name: 'settings.general.item',
              id: 'peak-hours-usage',
              order: 31,
              locale: NS,
              label: () => translate('usage.title'),
            },
            UsageCard,
          ),
        );
      },
    };
  },
});
