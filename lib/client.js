window.__ModuleLoader__.load({
	id: 'auto-compact',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
		let React = require('react');

		//#region auto-compact client
		/** 自动压缩阈值圆环 + 面板（会话级，输入区右侧）。 */
		const NS = 'auto-compact';
		const CSS_ID = 'auto-compact/styles';
		const css = `.ac-ring{position:relative;display:inline-flex;align-items:center}
.ac-trigger{width:28px;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:transparent;border:none;border-radius:999px;flex:none;place-items:center;display:grid;padding:0}
.ac-trigger:hover{background:var(--dsw-alias-interactive-bg-hover)}
.ac-trigger:focus-visible{outline:2px solid var(--dsw-alias-border-l3);outline-offset:-2px}
.ac-track{fill:none;stroke:var(--dsw-alias-border-l3);stroke-width:2px}
.ac-arc{fill:none;stroke:var(--dsw-alias-state-warn-primary,#f59e0b);stroke-width:2px;stroke-linecap:round}
.ac-panel{z-index:100;box-sizing:border-box;border:1px solid var(--dsw-alias-border-inverted);background:var(--dsw-specific-menu);width:248px;box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-secondary);cursor:default;border-radius:12px;padding:12px;font-size:12px;line-height:20px;position:absolute;bottom:calc(100% + 8px);right:0}
.ac-panel-title{color:var(--dsw-alias-label-primary);font-weight:500;font-size:13px}
.ac-slider{width:100%;accent-color:var(--dsw-alias-state-warn-primary,#f59e0b);margin:10px 0 4px}
.ac-panel-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:2px 0}
.ac-panel-value{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);font-weight:500}
.ac-panel-hint{color:var(--dsw-alias-label-caption);margin-top:8px;font-size:11px;line-height:16px}`;
		if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + CSS_ID + '"]') === null) {
			const tag = document.createElement('style');
			tag.setAttribute('data-plugin-css', CSS_ID);
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		const RADIUS = 6.5;
		const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

		const inject = ['slots', 'connection'];

		function apply(ctx) {
			const slots = ctx.get('slots');
			if (slots === void 0) return;
			const connection = ctx.get('connection');
			const api = connection === void 0 ? void 0 : connection.api;

			/** 读当前 auto-compact 命名空间的 thresholds 表。 */
			const readThresholds = async () => {
				if (!api) return {};
				try {
					const response = await api.settings.describe({});
					if (!response || !response.result || !response.result.ok) return {};
					const namespaces = response.result.value && response.result.value.namespaces;
					if (!Array.isArray(namespaces)) return {};
					const found = namespaces.find((item) => item && item.ns === NS);
					const value = found && found.value;
					if (!value || typeof value.thresholds !== 'object' || value.thresholds === null) return {};
					const out = {};
					for (const key of Object.keys(value.thresholds)) {
						const n = Number(value.thresholds[key]);
						if (Number.isFinite(n) && n > 0 && n <= 1) out[key] = n;
					}
					return out;
				} catch (error) {
					return {};
				}
			};

			/** 写入本会话阈值。 */
			const writeRatio = async (sessionId, ratio) => {
				if (!api) return;
				try {
					const thresholds = await readThresholds();
					thresholds[sessionId] = ratio;
					await api.settings.update({ ns: NS, patch: { thresholds } });
				} catch (error) { /* ignore */ }
			};

			slots.inject('conversation.input.right', () => slots.register(
				{ name: 'conversation.input.right', id: 'auto-compact-ring', order: 10 },
				(props) => {
					const sessionId = props && (props.sessionId || (props.session && props.session.sessionId));
					if (!sessionId) return null;
					const useProjection = props && props.useProjection;
					const [open, setOpen] = React.useState(false);
					const [ratio, setRatio] = React.useState(0.5);
					const closeTimerRef = React.useRef(null);

					// 实时用量：contextPressure 投影（与自带 ContextMeter 同源，响应式更新）
					const pressure = useProjection ? useProjection('contextPressure') : null;
					const usedTokens = pressure == null ? void 0 : (pressure.projectedTokens ?? pressure.pressureTokens);
					const contextWindow = pressure == null ? void 0 : pressure.contextWindow;
					const usagePercent = usedTokens != null && contextWindow != null && contextWindow > 0
						? Math.min(100, Math.round(usedTokens / contextWindow * 100))
						: null;

					// 初始读取本会话阈值
					React.useEffect(() => {
						let alive = true;
						readThresholds().then((thresholds) => {
							const value = thresholds[sessionId];
							if (alive && typeof value === 'number') setRatio(value);
						}).catch(() => {});
						return () => { alive = false; };
					}, [sessionId]);

					const cancelClose = () => {
						if (closeTimerRef.current) {
							try { closeTimerRef.current(); } catch (e) { /* ignore */ }
							closeTimerRef.current = null;
						}
					};
					const scheduleClose = () => {
						cancelClose();
						closeTimerRef.current = setTimeout(() => setOpen(false), 120);
					};

					const percent = Math.round(ratio * 100);
					const arc = (CIRCUMFERENCE * ratio).toFixed(2) + ' ' + CIRCUMFERENCE.toFixed(2);

					return React.createElement('span', {
						className: 'ac-ring',
						onPointerEnter: cancelClose,
						onPointerLeave: scheduleClose,
					},
						React.createElement('button', {
							type: 'button',
							className: 'ac-trigger',
							'aria-label': '自动压缩阈值 ' + percent + '%',
							'aria-expanded': open,
							title: '自动压缩阈值 ' + percent + '%',
							onClick: () => setOpen(!open),
						},
							React.createElement('svg', { viewBox: '0 0 18 18', width: 16, height: 16, 'aria-hidden': true },
								React.createElement('circle', { className: 'ac-track', cx: 9, cy: 9, r: RADIUS }),
								React.createElement('circle', { className: 'ac-arc', cx: 9, cy: 9, r: RADIUS, strokeDasharray: arc, transform: 'rotate(-90 9 9)' }),
							),
						),
						open && React.createElement('div', { className: 'ac-panel', role: 'dialog' },
							React.createElement('div', { className: 'ac-panel-title' }, '自动压缩阈值'),
							React.createElement('input', {
								type: 'range',
								className: 'ac-slider',
								min: 1,
								max: 90,
								step: 1,
								value: percent,
								onChange: (e) => {
									const next = Number(e.target.value) / 100;
									setRatio(next);
									writeRatio(sessionId, next);
								},
							}),
							React.createElement('div', { className: 'ac-panel-row' },
								React.createElement('span', null, '触发阈值'),
								React.createElement('strong', { className: 'ac-panel-value' }, percent + '%'),
							),
							usagePercent != null && React.createElement('div', { className: 'ac-panel-row' },
								React.createElement('span', null, '当前用量'),
								React.createElement('span', { className: 'ac-panel-value' }, usagePercent + '%'),
							),
							React.createElement('div', { className: 'ac-panel-hint' }, '上下文超过阈值时回合结束自动 compact，压缩摘要注入上下文后正常继续'),
						),
					);
				},
			));
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
