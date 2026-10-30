window.__ModuleLoader__.load({
  id: 'dsh-peak-hours',
  factory(require) {
    const React = require('react');
    /** 线性图标：viewBox 16×16，stroke 走 currentColor。 */
    function icon(kind, size = 14) {
      const paths = {
        refresh: ['M12.9 8a4.9 4.9 0 1 1-1.5-3.5', 'M13 2.6v3.1h-3.1'],
        download: ['M8 2.6v6.9', 'M5.1 6.9 8 9.8l2.9-2.9', 'M2.9 12.4h10.2'],
        close: ['M4.2 4.2 11.8 11.8', 'M11.8 4.2 4.2 11.8'],
      }
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': '1.6',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          'aria-hidden': 'true',
        },
        ...(paths[kind] || []).map((d, i) => h('path', { key: 'p' + i, d })),
      );
    }

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
        --dshphu-peak-hi: #fbbf24;
        --dshphu-off: #4d6bfe;
        --dshphu-off-hi: #7b93ff;
        --dshphu-hair: var(--dsw-alias-border-l2, rgba(128, 128, 128, .18));
        --dshphu-dim: var(--dsw-alias-label-secondary, #8a8f98);
        display: flex; flex-direction: column; gap: 14px;
        box-sizing: border-box; width: 100%; min-width: 0;
        padding: 16px 18px 14px; border-radius: 14px;
        border: 1px solid var(--dshphu-hair);
        background: var(--dsw-alias-bg-layer-1, transparent);
        font-family: inherit; font-size: 14px; font-size: .875rem;
        line-height: 1.5; color: var(--dsw-alias-label-primary);
      }
      .dshphu-head { display: flex; align-items: flex-start; gap: 12px; min-width: 0; }
      .dshphu-titles { flex: 1 1 auto; min-width: 0; }
      .dshphu-title {
        display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;
        font-weight: 600; font-size: 1.02em; letter-spacing: .01em;
      }
      .dshphu-titleEn {
        font-size: .78em; font-weight: 500; letter-spacing: .06em;
        text-transform: uppercase; color: var(--dshphu-dim);
      }
      .dshphu-desc { margin-top: 3px; color: var(--dshphu-dim); font-size: .86em; max-width: 46em; }
      .dshphu-actions { flex: none; display: flex; align-items: center; gap: 8px; }
      .dshphu-seg {
        display: flex; gap: 2px; padding: 2px; border-radius: 999px;
        background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, .08));
      }
      .dshphu-segBtn {
        font: inherit; font-size: .84em; line-height: 1.4; cursor: pointer;
        padding: 3px 11px; border-radius: 999px; border: 0;
        background: transparent; color: var(--dshphu-dim);
        transition: background-color .15s ease, color .15s ease;
      }
      .dshphu-segBtn:hover { color: var(--dsw-alias-label-primary); }
      .dshphu-segBtn[data-on='1'] {
        color: var(--dsw-alias-label-primary); font-weight: 600;
        background: var(--dsw-alias-bg-layer-1, #fff);
        box-shadow: 0 1px 2px rgba(0, 0, 0, .12);
      }
      .dshphu-refresh {
        flex: none; font: inherit; font-size: .84em; cursor: pointer;
        width: 26px; height: 26px; display: inline-flex;
        align-items: center; justify-content: center;
        border-radius: 999px; border: 1px solid var(--dshphu-hair);
        background: transparent; color: var(--dshphu-dim);
        transition: color .15s ease, border-color .15s ease;
      }
      .dshphu-refresh:hover { color: var(--dsw-alias-label-primary); border-color: var(--dshphu-dim); }
      .dshphu-refresh[data-busy='1'] { opacity: .55; cursor: progress; }

      .dshphu-hero {
        display: flex; align-items: center; justify-content: space-between;
        gap: 14px; flex-wrap: wrap;
        padding: 13px 16px; border-radius: 12px;
        border: 1px solid rgba(77, 107, 254, .18);
        background:
          linear-gradient(135deg, rgba(77, 107, 254, .13), rgba(77, 107, 254, .03));
      }
      .dshphu-heroMain { min-width: 0; }
      .dshphu-heroLabel { color: var(--dshphu-dim); font-size: .84em; letter-spacing: .03em; }
      .dshphu-heroValue {
        font-size: 1.72em; font-weight: 650; letter-spacing: -.012em; line-height: 1.15;
        font-variant-numeric: tabular-nums;
      }
      .dshphu-chip {
        display: inline-flex; align-items: baseline; gap: 5px; flex: none;
        padding: 5px 12px; border-radius: 999px; white-space: nowrap;
        font-size: .84em; font-weight: 500; color: var(--dshphu-off);
        background: rgba(77, 107, 254, .10);
        border: 1px solid rgba(77, 107, 254, .16);
      }
      .dshphu-chip b { font-weight: 650; }
      .dshphu-stats {
        display: flex; gap: 28px; flex-wrap: wrap;
        padding: 0 2px;
      }
      .dshphu-stat { min-width: 74px; }
      .dshphu-statLabel { color: var(--dshphu-dim); font-size: .8em; letter-spacing: .02em; }
      .dshphu-statValue {
        font-size: 1.06em; font-weight: 600; font-variant-numeric: tabular-nums;
        line-height: 1.35;
      }
      .dshphu-statValue[data-tone='peak'] { color: var(--dshphu-peak); }
      .dshphu-statValue[data-tone='off'] { color: var(--dshphu-off); }

      .dshphu-split { display: flex; flex-direction: column; gap: 7px; }
      .dshphu-legend {
        display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
        font-size: .86em; color: var(--dshphu-dim);
      }
      .dshphu-legendItem { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
      .dshphu-legendDot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
      .dshphu-legendDot[data-tone='peak'] { background: var(--dshphu-peak); }
      .dshphu-legendDot[data-tone='off'] { background: var(--dshphu-off); }
      .dshphu-legendNum { color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }
      .dshphu-bar {
        display: flex; height: 10px; border-radius: 999px; overflow: hidden;
        background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, .12));
      }
      .dshphu-barPeak { background: linear-gradient(180deg, var(--dshphu-peak-hi), var(--dshphu-peak)); }
      .dshphu-barOff { background: linear-gradient(180deg, var(--dshphu-off-hi), var(--dshphu-off)); }

      .dshphu-models { display: flex; flex-direction: column; }
      .dshphu-sectionTitle {
        display: flex; align-items: baseline; gap: 7px;
        color: var(--dshphu-dim); font-size: .8em;
        letter-spacing: .06em; text-transform: uppercase;
        padding-bottom: 5px;
      }
      .dshphu-model {
        display: flex; align-items: baseline; gap: 10px;
        padding: 5px 0; font-size: .92em;
        border-top: 1px solid var(--dshphu-hair);
      }
      .dshphu-modelName {
        flex: 1 1 auto; min-width: 0; overflow: hidden;
        text-overflow: ellipsis; white-space: nowrap;
      }
      .dshphu-modelNum {
        flex: none; color: var(--dshphu-dim);
        font-variant-numeric: tabular-nums;
      }
      .dshphu-modelNum b {
        color: var(--dsw-alias-label-primary); font-weight: 600; margin-left: 8px;
      }
      .dshphu-foot {
        display: flex; flex-direction: column; gap: 3px;
        color: var(--dshphu-dim); font-size: .84em;
        border-top: 1px solid var(--dshphu-hair); padding-top: 8px;
      }
      .dshphu-line { color: var(--dshphu-dim); font-size: .88em; }
      .dshphu-trend { display: flex; flex-direction: column; gap: 6px; }
      .dshphu-trendHead {
        display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
        color: var(--dshphu-dim); font-size: .8em;
        letter-spacing: .06em; text-transform: uppercase;
      }
      .dshphu-trendNow {
        letter-spacing: 0; text-transform: none; font-size: 1.06em;
        color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums;
      }
      .dshphu-spark {
        display: flex; align-items: flex-end; gap: 3px;
        height: 42px; padding-bottom: 3px;
        border-bottom: 1px solid var(--dshphu-hair);
      }
      .dshphu-sparkCol > span { display: block; width: 100%; }
      .dshphu-sparkCol {
        flex: 1 1 0; min-width: 0; height: 100%;
        display: flex; flex-direction: column; justify-content: flex-end;
        opacity: .82; transition: opacity .15s ease;
      }
      .dshphu-sparkCol:hover { opacity: 1; }
      .dshphu-sparkCol[data-today='1'] { opacity: 1; }
      .dshphu-sparkCol[data-today='1'] > span:last-child {
        box-shadow: 0 0 0 1.5px rgba(77, 107, 254, .45);
      }
      .dshphu-sparkOff {
        background: linear-gradient(180deg, var(--dshphu-off-hi), var(--dshphu-off));
        border-radius: 2px 2px 0 0;
      }
      .dshphu-sparkPeak {
        background: linear-gradient(180deg, var(--dshphu-peak-hi), var(--dshphu-peak));
        border-radius: 0 0 2px 2px;
      }
      .dshphu-err { color: var(--dsw-alias-state-error-primary, #d33); font-size: .9em; }
      /* ---- 右下悬浮挂件（shell.overlay，点击穿透层里自行接管指针） ---- */
      .dshphf-wrap {
        position: fixed; right: 18px; bottom: 88px; z-index: 60;
        display: flex; justify-content: flex-end;
        pointer-events: none;
      }
      .dshphf-pill {
        pointer-events: auto; cursor: pointer;
        display: inline-flex; align-items: center; gap: 7px;
        padding: 7px 13px; border-radius: 999px;
        font-family: inherit; font-size: .85rem; font-weight: 500;
        color: var(--dsw-alias-label-primary);
        background: var(--dsw-alias-bg-layer-1, #fff);
        border: 1px solid var(--dsw-alias-border-l2, #e4e6ea);
        box-shadow: 0 6px 22px rgba(15, 23, 42, .16);
        transition: border-color .15s ease, transform .15s ease;
      }
      .dshphf-pill:hover { transform: translateY(-1px); }
      .dshphf-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
      .dshphf-dot[data-peak='1'] { background: #f59e0b; box-shadow: 0 0 0 3px rgba(245, 158, 11, .18); }
      .dshphf-dot[data-peak='0'] { background: #4d6bfe; box-shadow: 0 0 0 3px rgba(77, 107, 254, .18); }
      .dshphf-state { font-weight: 600; }
      .dshphf-meta {
        color: var(--dsw-alias-label-secondary);
        font-variant-numeric: tabular-nums;
      }
      .dshphf-panel {
        pointer-events: auto;
        width: 272px; box-sizing: border-box;
        display: flex; flex-direction: column; gap: 10px;
        padding: 13px 14px 12px; border-radius: 14px;
        font-family: inherit; font-size: .85rem; line-height: 1.5;
        color: var(--dsw-alias-label-primary);
        background: var(--dsw-alias-bg-layer-1, #fff);
        border: 1px solid var(--dsw-alias-border-l2, #e4e6ea);
        box-shadow: 0 16px 44px rgba(15, 23, 42, .2);
      }
      .dshphf-head { display: flex; align-items: center; gap: 7px; }
      .dshphf-title { font-weight: 600; }
      .dshphf-close {
        margin-left: auto; flex: none; cursor: pointer;
        width: 20px; height: 20px; border-radius: 999px;
        display: inline-flex; align-items: center; justify-content: center;
        font: inherit; font-size: 1em; line-height: 1;
        color: var(--dsw-alias-label-secondary);
        background: transparent; border: 0;
      }
      .dshphf-close:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }
      .dshphf-status { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
      .dshphf-statusText { font-size: 1.3em; font-weight: 650; letter-spacing: -.01em; }
      .dshphf-next { color: var(--dsw-alias-label-secondary); font-size: .92em; }
      .dshphf-track {
        position: relative; height: 10px; border-radius: 999px; overflow: hidden;
        background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, .12));
      }
      .dshphf-seg { position: absolute; top: 0; bottom: 0; }
      .dshphf-seg[data-peak='1'] { background: linear-gradient(180deg, #fbbf24, #f59e0b); }
      .dshphf-seg[data-peak='0'] { background: linear-gradient(180deg, #7b93ff, #4d6bfe); }
      .dshphf-cursor {
        position: absolute; top: -2px; bottom: -2px; width: 2px;
        background: #fff; box-shadow: 0 0 0 1px rgba(0, 0, 0, .35);
      }
      .dshphf-rows { display: flex; flex-direction: column; }
      .dshphf-row {
        display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
        padding: 5px 0; border-top: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, .18));
      }
      .dshphf-row:first-child { border-top: 0; }
      .dshphf-rowLabel { color: var(--dsw-alias-label-secondary); }
      .dshphf-rowNum { font-weight: 600; font-variant-numeric: tabular-nums; }
      .dshphf-foot { display: flex; gap: 6px; }
      .dshphf-btn {
        flex: 1 1 0; cursor: pointer;
        font: inherit; font-size: .9em; padding: 4px 8px; border-radius: 8px;
        color: var(--dsw-alias-label-secondary);
        background: transparent;
        border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, .2));
        transition: color .15s ease, border-color .15s ease;
      }
      .dshphf-btn:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-label-secondary); }
      .dshphf-btn {
        font-size: .84em; padding: 5px 6px; white-space: nowrap;
        flex: 1 1 0; min-width: 0; gap: 4px;
        display: inline-flex; align-items: center; justify-content: center;
      }
      .dshphf-btn svg { width: 13px; height: 13px; flex: none; opacity: .85; }
      .dshphf-head { height: 18px; margin-bottom: 2px; cursor: grab; touch-action: none; }
      .dshphf-grip {
        font-size: 13px; line-height: 1; letter-spacing: 1px;
        color: var(--dsw-alias-label-secondary); opacity: .65;
      }
      .dshphf-close {
        width: 18px; height: 18px; padding: 0; border-radius: 5px;
        display: inline-flex; align-items: center; justify-content: center;
        color: var(--dsw-alias-label-secondary); background: transparent; border: 0; cursor: pointer;
      }
      .dshphf-close:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }
      .dshphf-close svg { width: 11px; height: 11px; }
      .dshphu-refresh svg { width: 14px; height: 14px; display: block; }
      .dshphf-grab {
        cursor: grab; touch-action: none;
        -webkit-user-select: none; user-select: none;
      }
      .dshphf-grab:active { cursor: grabbing; }
      .dshphf-head { cursor: grab; touch-action: none; }
      .dshphf-head:active { cursor: grabbing; }
      .dshphf-times { display: flex; gap: 18px; flex-wrap: wrap; }
      .dshphf-time { display: flex; flex-direction: column; gap: 1px; min-width: 84px; }
      .dshphf-timeLabel { color: var(--dsw-alias-label-secondary); font-size: .8em; letter-spacing: .03em; }
      .dshphf-timeValue {
        font-size: 1.06em; font-weight: 600;
        font-variant-numeric: tabular-nums; letter-spacing: .02em;
      }
      .dshphf-timeValue[data-off='1'] { color: #3f5efb; }
      .dshphf-timeValue[data-off='0'] { color: #b45309; }
      .dshphf-light {
        width: 8px; height: 8px; border-radius: 50%; flex: none;
      }
      .dshphf-light[data-peak='1'] { background: #f59e0b; box-shadow: 0 0 0 3px rgba(245, 158, 11, .18); }
      .dshphf-light[data-peak='0'] { background: #4d6bfe; box-shadow: 0 0 0 3px rgba(77, 107, 254, .18); }
      /* 紧凑版（覆盖上面同名规则） */
      .dshphf-panel { width: 236px; gap: 5px; padding: 7px 11px 9px; border-radius: 12px; }
      .dshphf-head { height: 13px; margin-bottom: -1px; }
      .dshphf-grip { font-size: 11px; letter-spacing: 0; line-height: 1; }
      .dshphf-close { width: 16px; height: 16px; color: var(--dsw-alias-label-secondary); }
      .dshphf-close svg { width: 10px; height: 10px; }
      .dshphf-status { gap: 6px; }
      .dshphf-statusText { font-size: 1.2em; }
      .dshphf-times { gap: 14px; }
      .dshphf-time { gap: 0; min-width: 76px; }
      .dshphf-timeLabel { font-size: .76em; }
      .dshphf-timeValue { font-size: 1em; }
      /* 底栏内联角标 */
      .dshphic {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 0; margin: 0; border: 0; border-radius: 6px;
        font: inherit; font-size: .92em; line-height: inherit;
        letter-spacing: 0; text-align: inherit;
        color: var(--dsw-alias-label-primary);
        background: transparent; cursor: default; white-space: nowrap;
      }
      .dshphic:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4d6bfe); outline-offset: 2px; }
      .dshphic-pop {
        position: fixed; z-index: 90; width: 264px; box-sizing: border-box;
        padding: 10px 12px; border-radius: 12px;
        display: flex; flex-direction: column; gap: 6px;
        font-family: inherit; font-size: 12px; line-height: 1.5;
        color: var(--dsw-alias-label-primary);
        background: var(--dsw-alias-bg-layer-1, #fff);
        border: 1px solid var(--dsw-alias-border-l2, #e4e6ea);
        box-shadow: 0 18px 44px rgba(15, 23, 42, .18);
        pointer-events: none;
      }
      .dshphic-popHead {
        display: flex; align-items: center; gap: 6px;
        font-weight: 600; padding-bottom: 6px;
        border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, .18));
      }
      .dshphic-popRow { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
      .dshphic-popKey { color: var(--dsw-alias-label-secondary); white-space: nowrap; }
      .dshphic-popVal { font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
      .dshphic-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; }
      .dshphic-dot[data-peak='1'] { background: #f59e0b; box-shadow: 0 0 0 2px rgba(245, 158, 11, .2); }
      .dshphic-dot[data-peak='0'] { background: #4d6bfe; box-shadow: 0 0 0 2px rgba(77, 107, 254, .2); }
      .dshphic-wrap { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; will-change: transform; }
      .dshphic-count { font-variant-numeric: tabular-nums; letter-spacing: 0; }
      .dshphic-sep { opacity: .45; }
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
      'status.peak': 'Busy',
      'status.off': 'Free',
      'price.multiplier': '×2',
      'price.discount': '5 折',
      'next.peak': '后转 Busy',
      'next.off': '后转 Free',
      'unit.day': '天',
      'unit.hour': '小时',
      'unit.minute': '分',
      'unit.sep': '',
      'tip.head': 'DeepSeek 峰谷计费',
      'tip.current': '当前：',
      'tip.window': '高峰时段：工作日 09:00–12:00、14:00–18:00（北京时间）',
      'tip.bar': '日程条：当天 00:00–24:00，橙色 = Busy（高峰）、蓝色 = Free（空闲），白线是当前时刻',
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
      'usage.titleEn': 'Peak / Off-peak usage',
      'usage.desc': '北京时间归类：高峰 ×2、空闲 5 折，按模型价目表折算',
      'usage.range': '区间',
      'usage.range.7': '7 天',
      'usage.range.30': '30 天',
      'usage.range.all': '全部',
      'usage.actual': '实际花费 · Actual',
      'usage.allPeak': '全高峰 · All peak',
      'usage.allOff': '全空闲 · All off-peak',
      'usage.saved': '已省 · Saved',
      'usage.savedDelta': '比全高峰省 {money}（{pct}）',
      'usage.peakTokens': '高峰 · Peak',
      'usage.offTokens': '空闲 · Off-peak',
      'usage.totalTokens': '合计 · Total',
      'usage.peakShare': '高峰占比 · Peak share',
      'usage.trend': '每日花费 · Daily spend',
      'usage.avgDay': '日均 · Avg/day',
      'usage.today': '今日 · Today',
      'usage.export': '导出 CSV',
      'usage.last7': '近 7 天 · 7d',
      'usage.last30': '近 30 天 · 30d',
      'float.title': '峰谷挂件',
      'float.expand': '展开峰谷挂件',
      'float.collapse': '收起',
      'float.drag': '拖动可移动',
      'float.now': '现在 · Now',
      'float.countdown': '距切换 · Countdown',
      'float.tomorrow': '明天 · Tomorrow',
      'float.tomorrowHoliday': '节假日 · 全天 5 折',
      'float.tomorrowWeekend': '周末 · 全天 5 折',
      'float.tomorrowWorkday': '工作日 · 恢复高峰价',
      'float.reload': '刷新',
      'float.export': '导出',
      'float.grip': '按住拖动',
      'usage.models': '分模型 · By model',
      'usage.refresh': '重新统计',
      'usage.refreshHint': '数据 60 秒内复用，点 ↻ 强刷',
      'usage.loading': '统计中…（首次需扫描本地会话日志）',
      'usage.error': '读取失败：',
      'usage.empty': '暂无用量记录',
      'usage.note': '仅 deepseek 系模型按峰谷价折算；其他供应商 {tokens} tokens 只计用量、不计费',
      'usage.meta': '扫描 {sessions} 个会话 · 活跃 {days} 天'

    };

    const EN = {
      label: 'Peak hours',
      'status.peak': 'Busy',
      'status.off': 'Free',
      'price.multiplier': '×2',
      'price.discount': '50% off',
      'next.peak': ' until Busy',
      'next.off': ' until Free',
      'unit.day': 'd',
      'unit.hour': 'h',
      'unit.minute': 'm',
      'unit.sep': ' ',
      'tip.head': 'DeepSeek peak/off-peak pricing',
      'tip.current': 'Now: ',
      'tip.window': 'Peak: weekdays 09:00–12:00 and 14:00–18:00 (Beijing time)',
      'tip.bar': 'Day bar: 00:00–24:00, amber = Busy, blue = Free, white line = now',
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
      'usage.titleEn': 'Beijing time · UTC+8',
      'usage.desc': 'Local session logs, each request bucketed by Beijing time: peak ×2, off-peak 50% off',
      'usage.range': 'Range',
      'usage.range.7': '7d',
      'usage.range.30': '30d',
      'usage.range.all': 'All',
      'usage.actual': 'Actual spend',
      'usage.allPeak': 'All at peak',
      'usage.allOff': 'All off-peak',
      'usage.saved': 'Saved',
      'usage.savedDelta': '{money} saved vs all-peak ({pct})',
      'usage.peakTokens': 'Peak',
      'usage.offTokens': 'Off-peak',
      'usage.totalTokens': 'Total',
      'usage.peakShare': 'Peak share',
      'usage.trend': 'Daily spend',
      'usage.avgDay': 'Avg/day',
      'usage.today': 'Today',
      'usage.export': 'Export CSV',
      'usage.last7': 'Last 7 days',
      'usage.last30': 'Last 30 days',
      'float.title': 'Peak hours',
      'float.expand': 'Open peak-hours widget',
      'float.collapse': 'Collapse',
      'float.drag': 'Drag to move',
      'float.now': 'Now',
      'float.countdown': 'Until switch',
      'float.tomorrow': 'Tomorrow',
      'float.tomorrowHoliday': 'Holiday · 50% off all day',
      'float.tomorrowWeekend': 'Weekend · 50% off all day',
      'float.tomorrowWorkday': 'Weekday · peak rates return',
      'float.reload': 'Reload',
      'float.export': 'Export',
      'float.grip': 'Drag',
      'usage.models': 'By model',
      'usage.refresh': 'Rescan',
      'usage.refreshHint': 'Reused within 60s; press ↻ to rescan',
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

      // 根节点**不要**放 aria-label / aria-labelledby：sidebar.footer.action 的所有者
      // 会把这个属性当行文本投影出来，整个子树被换成一行纯文本（圆点、日程条都会消失，
      // 1.11.0 起踩过这个坑）。无障碍名交给可见文本 + title。
      const common = {
        title,
        tabIndex: 0,
        onClick: onCopy,
        onKeyDown,
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

    /** 按日导出 CSV（卡片与悬浮挂件共用）。 */
    function exportCsv(rows, range, tag) {
      const head = ['day', 'peakTokens', 'offTokens', 'tokens', 'peakCost', 'offCost', 'cost'];
      const lines = [head.join(',')];
      for (const r of rows) {
        lines.push(
          [r.day, r.peakTokens, r.offTokens, r.tokens, r.peakCost.toFixed(4), r.offCost.toFixed(4), r.cost.toFixed(4)].join(','),
        );
      }
      const text = '\ufeff' + lines.join('\n') + '\n';
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'dsh-peak-hours-' + (tag || range) + '-' + new Date().toISOString().slice(0, 10) + '.csv';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // ---------------------------------------------------------------------
    // 右下悬浮挂件：shell.overlay 是点击穿透层，自己在内部接管指针事件
    // ---------------------------------------------------------------------
    const FLOAT_KEY = 'dsh-peak-hours:float-open';

    function readOpenFlag() {
      try {
        return window.localStorage.getItem(FLOAT_KEY) === '1';
      } catch {
        return false;
      }
    }

    const POS_KEY = 'dsh-peak-hours:float-pos';
    const POS_DEFAULT = { x: 18, y: 88 };

    function readPos() {
      try {
        const raw = window.localStorage.getItem(POS_KEY);
        if (raw) {
          const parts = String(raw).split(',');
          const x = Number(parts[0]);
          const y = Number(parts[1]);
          if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
        }
      } catch {
        /* 忽略 */
      }
      return { ...POS_DEFAULT };
    }

    function savePos(pos) {
      try {
        window.localStorage.setItem(POS_KEY, Math.round(pos.x) + ',' + Math.round(pos.y));
      } catch {
        /* 忽略 */
      }
    }

    function clampPos(pos, w, h) {
      return {
        x: Math.min(Math.max(8, pos.x), Math.max(8, w - 8)),
        y: Math.min(Math.max(8, pos.y), Math.max(8, h - 8)),
      };
    }

    /** 北京时间的 MM:SS（含秒）。 */
    function clockSeconds(ms) {
      const b = beijing(ms);
      const sec = Math.floor((ms % 60000) / 1000);
      return b.clock + ':' + pad2(sec);
    }

    /** 倒计时：>=1 天显示 Nd HH:MM，>=1 小时显示 H:MM:SS，否则 MM:SS。 */
    function fmtCountdown(ms) {
      const total = Math.max(0, Math.floor(ms / 1000));
      const days = Math.floor(total / 86400);
      const h = Math.floor((total % 86400) / 3600);
      const m = Math.floor((total % 3600) / 60);
      const sec = total % 60;
      if (days) return days + (days === 1 ? ' day ' : ' days ') + pad2(h) + ':' + pad2(m);
      if (h) return h + ':' + pad2(m) + ':' + pad2(sec);
      return pad2(m) + ':' + pad2(sec);
    }

    function saveOpenFlag(on) {
      try {
        window.localStorage.setItem(FLOAT_KEY, on ? '1' : '0');
      } catch {
        /* 隐私模式等场景直接忽略 */
      }
    }

    /** 悬浮详情卡的键值行。 */
    function popRow(key, value) {
      return h(
        'div',
        { className: 'dshphic-popRow' },
        h('span', { className: 'dshphic-popKey' }, key),
        h('span', { className: 'dshphic-popVal' }, value),
      );
    }

    /** M-D HH:mm（北京时间）。 */
    function fmtDayClock(ms) {
      const b = beijing(ms);
      return pad2(b.month) + '-' + pad2(b.day) + ' ' + b.clock;
    }

    /** 底栏内联角标：状态灯 + 状态 + 当前时间 + 倒计时；按可用宽度自适应，悬停展开详情卡。 */
    function InlineChip() {
      const t = translate;
      const nowState = React.useState(Date.now);
      const now = nowState[0];
      const setNow = nowState[1];
      const openState = React.useState(false);
      const open = openState[0];
      const setOpen = openState[1];
      const posState = React.useState({ left: 0, bottom: 0 });
      const pos = posState[0];
      const setPos = posState[1];
      const nodeState = React.useState(null);
      const node = nodeState[0];
      const setNode = nodeState[1];
      const fitState = React.useState({ shift: 0 });
      const fit = fitState[0];
      const setFit = fitState[1];

      React.useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
      }, []);

      /* 自适应：够宽时把角标居中到空白带；不够宽时优先让尾部（模型名/占用/档位/百分比）换行 */
      React.useEffect(() => {
        if (!node || typeof window === 'undefined' || !window.document || !window.document.body) return;
        const doc = window.document;
        const fitState2 = { shift: 0 };
        let frame = 0;

        const clearWrap = (el) => {
          if (!el || !el.__dshphWrapped) return;
          el.style.flexWrap = '';
          el.style.rowGap = '';
          el.style.maxWidth = '';
          el.style.minWidth = '';
          el.__dshphWrapped = false;
        };

        const measure = () => {
          const rect = node.getBoundingClientRect();
          if (!rect || !rect.width) return;
          const applied = node.__dshphShift || 0;
          const baseLeft = rect.left - applied;
          const baseRight = baseLeft + rect.width;
          const midY = rect.top + rect.height / 2;
          const sameLine = (r) => Math.abs(r.top + r.height / 2 - midY) <= Math.max(rect.height, 12);

          /* 1) 找到 composer 那一行（同一行里左右都有邻居的最内层祖先） */
          let row = node.parentElement;
          let host = doc.body;
          while (row && row !== doc.body) {
            let hasLeft = false;
            let hasRight = false;
            const scan = row.querySelectorAll('span,div,button');
            for (const other of scan) {
              if (other === node || other.contains(node) || node.contains(other)) continue;
              const r = other.getBoundingClientRect();
              if (!r || !r.width || !r.height) continue;
              if (!sameLine(r)) continue;
              if (r.right < baseLeft - 20) hasLeft = true;
              else if (r.left > baseRight + 20) hasRight = true;
              if (hasLeft && hasRight) break;
            }
            if (hasLeft && hasRight) {
              host = row;
              break;
            }
            row = row.parentElement;
          }
          if (host === doc.body || host === node) return;
          const hostDisplay = (window.getComputedStyle ? window.getComputedStyle(host).display : '') || '';
          if (hostDisplay.indexOf('flex') < 0) return;
          if (host.__dshphWrapped) clearWrap(host);

          /* 2) 角标所在的那一组（host 的直接子元素），尾部换行就发生在这里 */
          let group = node;
          while (group && group.parentElement && group.parentElement !== host) group = group.parentElement;
          if (!group || group === host) return;
          const groupDisplay = (window.getComputedStyle ? window.getComputedStyle(group).display : '') || '';
          const groupFlex = groupDisplay.indexOf('flex') >= 0;

          const hostRect = host.getBoundingClientRect();
          const groupRect = group.getBoundingClientRect();
          const room = Math.max(0, hostRect.right - 8 - groupRect.left);

          /* 行内容「自然宽」：递归累加叶子节点宽度 + flex 间距；不能用 scrollWidth（会被 flex 拉伸污染） */
          const gapOf = (el) => {
            const st = window.getComputedStyle ? window.getComputedStyle(el) : null;
            const raw = st ? st.columnGap || st.gap : '';
            const n = parseFloat(raw);
            return isNaN(n) ? 0 : n;
          };
          const naturalOf = (el) => {
            const kids = Array.prototype.slice.call(el.children || []);
            const st = window.getComputedStyle ? window.getComputedStyle(el) : null;
            const isFlex = st ? String(st.display).indexOf('flex') >= 0 : false;
            const r = el.getBoundingClientRect();
            if (!kids.length || !isFlex) return Math.max(Math.ceil(r.width), el.scrollWidth || 0);
            const g = gapOf(el);
            let sum = 0;
            kids.forEach((k, i) => {
              sum += naturalOf(k) + (i ? g : 0);
            });
            return sum;
          };
          const rowGap = gapOf(host);
          let rowNatural = 0;
          Array.prototype.slice.call(host.children || []).forEach((k, i) => {
            rowNatural += naturalOf(k) + (i ? rowGap : 0);
          });
          const available = host.clientWidth || hostRect.width;
          if (typeof node.__dshphTight !== 'boolean') node.__dshphTight = false;
          const tight = groupFlex && (node.__dshphTight ? rowNatural > available - 24 : rowNatural > available - 2);
          node.__dshphTight = tight;

          if (tight) {
            if (!group.__dshphWrapped) {
              group.__dshphWrapped = true;
              group.style.flexWrap = 'wrap';
              group.style.rowGap = '6px';
              group.style.minWidth = '0';
            }
            group.style.maxWidth = Math.round(room) + 'px';
            node.__dshphGroup = group;
            if (applied) {
              node.__dshphShift = 0;
              fitState2.shift = 0;
              setFit({ shift: 0 });
            }
            return;
          }
          if (group.__dshphWrapped) clearWrap(group);
          node.__dshphGroup = group;

          /* 3) 够宽：把角标放到「左侧内容右边缘」与「右侧内容左边缘」之间的空白带中点 */
          let leftLimit = hostRect.left + 8;
          let rightLimit = hostRect.right - 8;
          let sawLeft = false;
          let sawRight = false;
          const scan = host.querySelectorAll('span,div,button');
          for (const other of scan) {
            if (other === node || other.contains(node) || node.contains(other)) continue;
            const r = other.getBoundingClientRect();
            if (!r || !r.width || !r.height) continue;
            if (!sameLine(r)) continue;
            if (r.width > hostRect.width * 0.35) continue;
            const center = r.left + r.width / 2;
            if (r.right <= baseLeft + 2) {
              sawLeft = true;
              leftLimit = Math.max(leftLimit, r.right + 8);
            } else if (r.left >= baseRight - 2) {
              sawRight = true;
              rightLimit = Math.min(rightLimit, r.left - 8);
            } else if (center < baseLeft) {
              sawLeft = true;
              leftLimit = Math.max(leftLimit, r.right + 8);
            } else if (center > baseRight) {
              sawRight = true;
              rightLimit = Math.min(rightLimit, r.left - 8);
            }
          }
          const band = Math.max(0, rightLimit - leftLimit);
          let nextShift = 0;
          if (band > rect.width + 16) {
            nextShift = Math.round(leftLimit + (band - rect.width) / 2 - baseLeft);
            if (nextShift < 0 && !sawLeft) nextShift = 0;
            if (nextShift > 0 && !sawRight) nextShift = 0;
          }
          node.__dshphShift = nextShift;
          if (nextShift !== fitState2.shift) {
            fitState2.shift = nextShift;
            setFit({ shift: nextShift });
          }
        };

        const run = () => {
          if (typeof requestAnimationFrame === 'function') {
            if (frame) cancelAnimationFrame(frame);
            frame = requestAnimationFrame(measure);
          } else {
            measure();
          }
        };
        run();
        window.addEventListener('resize', run);
        const Observer = typeof ResizeObserver === 'function' ? ResizeObserver : null;
        const ro = Observer ? new Observer(run) : null;
        if (ro) ro.observe(doc.body);
        const tick = setInterval(run, 1500);
        return () => {
          window.removeEventListener('resize', run);
          if (ro) ro.disconnect();
          clearInterval(tick);
          if (typeof cancelAnimationFrame === 'function' && frame) cancelAnimationFrame(frame);
          clearWrap(node.__dshphGroup);
          if (node.__dshphHost) clearWrap(node.__dshphHost);
        };
      }, [node]);

      const st = stateAt(now);
      const off = !st.peak;
      const phase = phaseOf(now);
      const stateText = off ? t('status.off') : t('status.peak');
      const countdown = phase.end ? fmtCountdown(phase.end - now) : '—';
      const toLabel = off ? t('status.peak') : t('status.off');
      const tomorrow = kindAt(now + 24 * 60 * MINUTE);

      const anchor = (element) => {
        if (!element) return;
        const rect = element.getBoundingClientRect();
        const width = 246;
        const vw = window.innerWidth || 1200;
        const vh = window.innerHeight || 800;
        setPos({ left: Math.max(8, Math.min(rect.left, vw - width - 8)), bottom: vh - rect.top + 8 });
      };

      const parts = [h('span', { className: 'dshphic-dot', 'data-peak': st.peak ? '1' : '0' })];
      parts.push(h('span', null, stateText));
      parts.push(h('span', { className: 'dshphic-count' }, clockSeconds(now)));
      parts.push(h('span', { className: 'dshphic-sep', 'aria-hidden': 'true' }, '·'));
      parts.push(h('span', { className: 'dshphic-count' }, countdown));

      const chip = h(
        'button',
        {
          type: 'button',
          className: 'dshphic',
          'data-peak': st.peak ? '1' : '0',
          ref: setNode,
          onMouseEnter: (event) => {
            anchor(event.currentTarget);
            setOpen(true);
          },
          onMouseLeave: () => setOpen(false),
          onFocus: (event) => {
            anchor(event.currentTarget);
            setOpen(true);
          },
          onBlur: () => setOpen(false),
        },
        ...parts,
      );

      const chipBox = h('span', { className: 'dshphic-wrap', style: { transform: 'translateX(' + fit.shift + 'px)' } }, chip);

      if (!open) return chipBox;

      const pop = h(
        'div',
        { className: 'dshphic-pop', role: 'tooltip', style: { left: pos.left + 'px', bottom: pos.bottom + 'px' } },
        h(
          'div',
          { className: 'dshphic-popHead' },
          h('span', { className: 'dshphic-dot', 'data-peak': st.peak ? '1' : '0' }),
          h('span', null, stateText),
          h(
            'span',
            { style: { marginLeft: 'auto', fontWeight: 400, opacity: 0.72 } },
            off ? t('price.discount') : t('price.multiplier'),
          ),
        ),
        popRow(t('float.now'), clockSeconds(now)),
        popRow(t('float.countdown'), countdown + ' → ' + toLabel),
        popRow(
          t('tip.phase'),
          phase.start
            ? fmtDayClock(phase.start) + ' → ' + (phase.end ? fmtDayClock(phase.end) : '—')
            : '—',
        ),
        popRow(
          t('float.tomorrow'),
          tomorrow === 'holiday'
            ? t('float.tomorrowHoliday')
            : tomorrow === 'weekend'
              ? t('float.tomorrowWeekend')
              : t('float.tomorrowWorkday'),
        ),
      );

      return [chipBox, pop];
    }

    function FloatingWidget() {
      const t = translate;
      const openState = React.useState(readOpenFlag);
      const open = openState[0];
      const setOpen = openState[1];
      const nowState = React.useState(() => Date.now());
      const now = nowState[0];
      const setNow = nowState[1];
      const dataState = React.useState(usageCache);
      const data = dataState[0];
      const setData = dataState[1];
      const tickState = React.useState(0);
      const tick = tickState[0];
      const reload = tickState[1];
      const errState = React.useState('');
      const err = errState[0];
      const setErr = errState[1];
      const posState = React.useState(readPos);
      const pos = posState[0];
      const setPos = posState[1];

      React.useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
      }, []);

      React.useEffect(() => {
        const onResize = () =>
          setPos((p) => clampPos(p, window.innerWidth - 120, window.innerHeight - 60));
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
      }, []);

      React.useEffect(() => {
        if (!open && usageCache) return undefined;
        let alive = true;
        setErr('');
        const url = USAGE_API + (tick ? '?fresh=1' : '');
        fetch(url, { cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
          .then((j) => {
            if (!alive) return;
            usageCache = j;
            setData(j);
          })
          .catch((e) => {
            if (alive) setErr(String((e && e.message) || e));
          });
        return () => {
          alive = false;
        };
      }, [tick, open]);

      const st = stateAt(now);
      const phase = phaseOf(now);
      const schedule = daySchedule(now);
      const off = !st.peak;
      const stateText = off ? t('status.off') : t('status.peak');
      const nextClock = phase.end ? beijing(phase.end).clock : '';
      const remaining = phase.end ? fmtDuration(phase.end - now, t) : '';
      const ranges = data && data.ranges ? data.ranges : null;
      const series = ranges && ranges['30'] ? ranges['30'].series || [] : [];
      const todayCost = series.length ? series[series.length - 1].cost : 0;

      // 拖拽：按住拖动，位移小于 4px 视为点击
      const drag = { active: false, moved: 0, sx: 0, sy: 0, ox: 0, oy: 0 };

      const onPointerDown = (event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        drag.active = true;
        drag.moved = 0;
        drag.sx = event.clientX;
        drag.sy = event.clientY;
        drag.ox = pos.x;
        drag.oy = pos.y;

        const move = (ev) => {
          if (!drag.active) return;
          const dx = ev.clientX - drag.sx;
          const dy = ev.clientY - drag.sy;
          drag.moved = Math.max(drag.moved, Math.abs(dx) + Math.abs(dy));
          setPos(
            clampPos(
              { x: drag.ox - dx, y: drag.oy - dy },
              window.innerWidth - 120,
              window.innerHeight - 60,
            ),
          );
        };
        const up = () => {
          if (!drag.active) return;
          drag.active = false;
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', up);
          setPos((p) => {
            savePos(p);
            return p;
          });
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
      };

      const wasDrag = () => drag.moved > 4;

      const startDragFromPanel = (event) => {
        const el = event.target;
        if (el && typeof el.closest === 'function' && el.closest('button')) return;
        onPointerDown(event);
      };

      const countdown = phase.end ? fmtCountdown(phase.end - now) : '—';
      const toLabel = off ? t('status.peak') : t('status.off');

      const pill = h(
        'button',
        {
          type: 'button',
          className: 'dshphf-pill dshphf-grab',
          title:
            t('float.expand') +
            ' · ' +
            t('float.drag') +
            ' · ' +
            clockSeconds(now) +
            ' ' +
            countdown +
            toLabel,
          onPointerDown,
          onClick: () => {
            if (wasDrag()) return;
            saveOpenFlag(true);
            setOpen(true);
          },
        },
        h('span', { className: 'dshphf-light', 'data-peak': st.peak ? '1' : '0' }),
        h('span', { className: 'dshphf-state' }, stateText),
        h(
          'span',
          { className: 'dshphf-meta dshphf-clock' },
          clockSeconds(now) + ' · ' + countdown,
        ),
      );

      const wrapStyle = { right: pos.x + 'px', bottom: pos.y + 'px' };

      if (!open) {
        return h('div', { className: 'dshphf-wrap', style: wrapStyle }, pill);
      }

      const track = h(
        'div',
        { className: 'dshphf-track' },
        ...schedule.map((seg, i) =>
          h('span', {
            key: 'fseg' + i,
            className: 'dshphf-seg',
            'data-peak': seg.peak ? '1' : '0',
            style: { left: pct(seg.from), width: pct(seg.to - seg.from) },
          }),
        ),
        h('span', { key: 'fcursor', className: 'dshphf-cursor', style: { left: pct(st.beijing.minute) } }),
      );

      const row = (label, value) =>
        h(
          'div',
          { className: 'dshphf-row' },
          h('span', { className: 'dshphf-rowLabel' }, label),
          h('span', { className: 'dshphf-rowNum' }, value),
        );

      return h(
        'div',
        { className: 'dshphf-wrap', style: wrapStyle },
        h(
          'div',
          { className: 'dshphf-panel', onPointerDown: startDragFromPanel },
          h(
            'div',
            { className: 'dshphf-head', title: t('float.grip'), onPointerDown },
            h('span', { className: 'dshphf-grip', 'aria-hidden': 'true' }, '⠿'),
            h(
              'button',
              {
                type: 'button',
                className: 'dshphf-close',
                title: t('float.collapse'),
                onClick: () => {
                  saveOpenFlag(false);
                  setOpen(false);
                },
              },
              icon('close', 11),
            ),
          ),
          h(
            'div',
            { className: 'dshphf-status' },
            h('span', { className: 'dshphf-light', 'data-peak': st.peak ? '1' : '0' }),
            h('span', { className: 'dshphf-statusText' }, stateText),
            h('span', { className: 'dshphf-next' }, (off ? t('price.discount') : t('price.multiplier'))),
          ),
          h(
            'div',
            { className: 'dshphf-times' },
            h(
              'div',
              { className: 'dshphf-time' },
              h('span', { className: 'dshphf-timeLabel' }, t('float.now')),
              h('span', { className: 'dshphf-timeValue' }, clockSeconds(now)),
            ),
            h(
              'div',
              { className: 'dshphf-time' },
              h('span', { className: 'dshphf-timeLabel' }, t('float.countdown')),
              h(
                'span',
                { className: 'dshphf-timeValue', 'data-off': off ? '1' : '0' },
                countdown + ' → ' + toLabel,
              ),
            ),
          ),
          err ? h('div', { className: 'dshphf-next' }, t('usage.error') + err) : null,

        ),
      );
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

      const refreshBtn = h(
        'button',
        {
          type: 'button',
          className: 'dshphu-refresh',
          title: t('usage.refresh'),
          'aria-label': t('usage.refresh'),
          'data-busy': loading ? '1' : '0',
          disabled: loading,
          onClick: () => reload((n) => n + 1),
        },
        icon('refresh', 14),
      );

      const exportBtn = h(
        'button',
        {
          type: 'button',
          className: 'dshphu-refresh',
          title: t('usage.export'),
          'aria-label': t('usage.export'),
          onClick: () => exportCsv(series, range),
        },
        icon('download', 14),
      );

      const head = h(
        'div',
        { className: 'dshphu-head' },
        h(
          'div',
          { className: 'dshphu-titles' },
          h(
            'div',
            { className: 'dshphu-title' },
            t('usage.title'),
            h('span', { className: 'dshphu-titleEn' }, t('usage.titleEn')),
          ),
          h('div', { className: 'dshphu-desc' }, t('usage.desc')),
        ),
        h('div', { className: 'dshphu-actions' }, seg, exportBtn, refreshBtn),
      );

      if (err) {
        return h(
          'div',
          { className: 'dshphu-card' },
          head,
          h('div', { className: 'dshphu-err' }, t('usage.error') + err),
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
      const series = rep.series || [];
      const todayCost = series.length ? series[series.length - 1].cost : 0;
      const maxTokens = series.reduce((m, r) => Math.max(m, r.tokens), 1);
      const avgDayCost = rep.activeDays > 0 ? cost.actual / rep.activeDays : 0;

  
    const stat = (label, value, tone) =>
        h(
          'div',
          { className: 'dshphu-stat' },
          h('div', { className: 'dshphu-statLabel' }, label),
          h('div', { className: 'dshphu-statValue', 'data-tone': tone || null }, value),
        );

      const legendItem = (tone, label, num) =>
        h(
          'span',
          { className: 'dshphu-legendItem' },
          h('span', { className: 'dshphu-legendDot', 'data-tone': tone }),
          label,
          h('span', { className: 'dshphu-legendNum' }, num),
        );

      return h(
        'div',
        { className: 'dshphu-card' },
        head,
        h(
          'div',
          { className: 'dshphu-hero' },
          h(
            'div',
            { className: 'dshphu-heroMain' },
            h('div', { className: 'dshphu-heroLabel' }, t('usage.actual')),
            h('div', { className: 'dshphu-heroValue' }, fmtMoney(cost.actual)),
          ),
          h(
            'div',
            { className: 'dshphu-chip' },
            t('usage.saved'),
            h('b', null, fmtMoney(cost.saved)),
            '· ' + fmtPct(cost.savedPct),
          ),
        ),
        h(
          'div',
          { className: 'dshphu-stats' },
          stat(t('usage.allPeak'), fmtMoney(cost.allPeak), 'peak'),
          stat(t('usage.allOff'), fmtMoney(cost.allOff), 'off'),
          stat(t('usage.peakShare'), fmtPct(peakPct), null),
          stat(t('usage.today'), fmtMoney(todayCost), null),
        ),
        h(
          'div',
          { className: 'dshphu-split' },
          h(
            'div',
            { className: 'dshphu-legend' },
            legendItem('peak', t('usage.peakTokens'), fmtTokens(tokens.peak.total)),
            legendItem('off', t('usage.offTokens'), fmtTokens(tokens.off.total)),
          ),
          h(
            'div',
            {
              className: 'dshphu-bar',
              role: 'img',
              'aria-label': t('usage.peakShare') + ' ' + fmtPct(peakPct),
            },
            h('span', { className: 'dshphu-barPeak', style: { width: fmtPct(peakPct) } }),
            h('span', { className: 'dshphu-barOff', style: { width: fmtPct(1 - peakPct) } }),
          ),
        ),
        h(
          'div',
          { className: 'dshphu-trend' },
          h(
            'div',
            { className: 'dshphu-trendHead' },
            h('span', null, t('usage.trend')),
            h(
              'span',
              { className: 'dshphu-trendNow' },
              t('usage.avgDay') + ' ' + fmtMoney(avgDayCost),
            ),
          ),
          h(
            'div',
            { className: 'dshphu-spark' },
            ...series.map((row, i) =>
              h(
                'div',
                {
                  key: row.day,
                  className: 'dshphu-sparkCol',
                  'data-today': i === series.length - 1 ? '1' : '0',
                  title: row.day + ' · ' + fmtMoney(row.cost),
                },
                h('span', {
                  className: 'dshphu-sparkOff',
                  style: { height: Math.max(row.tokens ? 2 : 0, Math.round((row.offTokens / maxTokens) * 100)) + '%' },
                }),
                h('span', {
                  className: 'dshphu-sparkPeak',
                  style: { height: Math.max(row.tokens ? 1 : 0, Math.round((row.peakTokens / maxTokens) * 100)) + '%' },
                }),
              ),
            ),
          ),
        ),
        models.length
          ? h(
              'div',
              { className: 'dshphu-models' },
              h('div', { className: 'dshphu-sectionTitle' }, t('usage.models')),
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
                    fmtTokens(m.peak.total + m.off.total),
                    h('b', null, fmtMoney(m.cost || 0)),
                  ),
                ),
              ),
            )
          : null,
        h(
          'div',
          { className: 'dshphu-foot' },
          h('div', null, t('usage.note').replace('{tokens}', fmtTokens(rep.other.tokens))),
          h(
            'div',
            null,
            t('usage.meta')
              .replace('{sessions}', String((data.stats && data.stats.sessions) || 0))
              .replace('{days}', String(rep.activeDays || 0)) +
              ' · ' +
              (loading ? t('usage.loading') : t('usage.refreshHint')),
          ),
        ),
      );
    }
    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(ensureStyle, 'dsh-peak-hours-style');

        // 语言包：untyped 版 register 是 (ns, localeId, dict) 三参；
        // 两参的 { zh, en } 形式只存在于 typed 重载（LocaleNamespaceMap 里有该 ns），
        // 我们的 ns 不在合并表里，用两参会抛 "locale 不是 BCP 47"，字典就永远注册不上。
        ctx.inject(['locale'], (c) => {
          const loc = c && c.locale;
          if (!loc || typeof loc.register !== 'function') return;
          let ids = [];
          try {
            const snap =
              typeof loc.getSnapshot === 'function' ? loc.getSnapshot() : loc.getLocale();
            ids = (snap && snap.locales ? snap.locales : []).map((l) => l.id);
          } catch {
            /* 拿不到语言列表就用内置推断 */
          }
          const pick = (re, fallback) => ids.find((id) => re.test(id)) || fallback;
          const packs = [
            [pick(/^zh/i, 'zh-CN'), ZH],
            [pick(/^en/i, 'en'), EN],
          ];
          for (const [id, dict] of packs) {
            try {
              loc.register(NS, id, dict);
            } catch {
              /* 已注册过（例如热重载），沿用现有字典 */
            }
          }
          try {
            const bound = loc.bind(NS);
            if (typeof bound === 'function') {
              translate = (key) => {
                try {
                  const value = bound(key);
                  if (typeof value === 'string' && value && value !== key) return value;
                } catch {
                  /* 落到内置字典 */
                }
                if (ZH[key] !== undefined) return ZH[key];
                if (EN[key] !== undefined) return EN[key];
                return key;
              };
            }
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
        ctx.slots.inject('conversation.input.right', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.right',
              id: 'peak-hours-inline',
              order: 10,
              locale: NS,
              label: () => translate('label'),
            },
            InlineChip,
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
