/* ═══════════ 套利监控大屏 · 宽基（沪深300基金筛选 · 实时版） ═══════════
   数据实时调用天天基金网公开接口：
   - script 标签直连：基金清单 fundcode_search.js / pingzhongdata（免跨域）
   - JSONP：push2his 指数K线（官方支持 CORS/JSONP）
   - 本地中继 /api/east（server.py）：F10 页面与 FundArchivesDatas（服务端补 Referer）
   无中继时自动降级为离线数据 data.js。 */
(function () {
  "use strict";

  /* ══════════ 1. 列与分组定义 ══════════ */
  var FUNNEL = '<svg width="10" height="10" viewBox="0 0 16 16"><path d="M1.3 2.2h13.4a.6.6 0 0 1 .46.98L9.9 9.9v4.3a.6.6 0 0 1-.88.53l-2.6-1.6a.6.6 0 0 1-.28-.5V9.9L.84 3.18a.6.6 0 0 1 .46-.98z" fill="currentColor"/></svg>';

  var YEAR_COLS = [];
  for (var y = 2015; y <= 2025; y++) {
    YEAR_COLS.push({ key: "y" + y, label: String(y), w: 74, num: true });
  }
  var PERIOD_COLS = [
    { key: "m1", label: "近1月", w: 76, num: true },
    { key: "m3", label: "近3月", w: 76, num: true },
    { key: "m6", label: "近6月", w: 76, num: true },
    { key: "y1", label: "近1年", w: 76, num: true },
    { key: "y2", label: "近2年", w: 76, num: true },
    { key: "y3", label: "近3年", w: 76, num: true },
    { key: "y5", label: "近5年", w: 76, num: true },
  ];
  YEAR_COLS.forEach(function (c) {
    c.s = { d: c.label + " 自然年度的涨跌幅：当年最后一个交易日收盘相对上一年末的变化（复权口径，分红已再投资）。", f: "年末复权净值 ÷ 上年末复权净值 − 1；2018 年起为天天基金官方口径，2015-2017 由日增长率复权链计算。", b: "high",
      h: "当年策略与行情契合；连续多年为正的基金，策略稳定性更好。",
      l: "当年亏损需对照同期大盘与同类均值判断，单年亏损不构成否定。" };
  });
  PERIOD_COLS.forEach(function (c) {
    c.s = { d: "近 " + c.label.slice(1) + " 的区间累计涨跌幅，反映中短周期表现。", f: "区间末复权净值 ÷ 区间初复权净值 − 1（天天基金官方口径）。", b: "high",
      h: "近期动量强、短周期胜率高；注意短期收益受行情影响大，应结合更长区间看。",
      l: "近期表现弱，观察是否与同类、大盘同步下跌——同步跌是市场因素，逆势跌才是基金问题。" };
  });
  var GROUPS = [
    { key: "base", label: "基本信息", cols: [
      { key: "code", label: "代码", w: 72, text: true,
        s: { d: "基金在天天基金的 6 位唯一编码，是查询与交易的身份证号。", f: "无计算，直接取自基金档案。", b: null } },
      { key: "name", label: "简称", w: 200, text: true,
        s: { d: "基金对外展示的简称，后缀 A/C/E/I/Y 代表同一策略的不同收费份额。", f: "无计算。", b: null,
             h: "A 类申购收费适合长持；C 类销售服务费按日计提适合短持；I/Y 多为机构或个人养老金份额。" } },
      { key: "ftype", label: "类型", w: 96, text: true,
        s: { d: "按投资范围与策略对基金的官方分类。", f: "无计算。", b: null,
             h: "决定比较基准：只应与同类型基金对比，跨类型比较没有意义。" } },
      { key: "company", label: "管理人", w: 118, text: true,
        s: { d: "基金管理公司，负责投资决策与运营，是基金的『出品方』。", f: "无计算。", b: null } },
      { key: "manager", label: "经理", w: 138, text: true,
        s: { d: "实际做出买卖决策的人，基金的灵魂。主动型基金看经理，被动型看跟踪质量。", f: "无计算。", b: null } },
    ]},
    { key: "mgr", label: "基金经理", cols: [
      { key: "tenure", label: "任职年限", w: 88, num: true,
        s: { d: "现任基金经理从接管这只基金至今的年数，衡量『这份业绩是谁做出来的』。", f: "由任职公告日期推算（如 17年又168天 ≈ 17.5 年）。", b: null,
             h: "任职满一轮牛熊（3~5 年以上），业绩才可归因于本人，可信度高。",
             l: "刚接手不久，页面上的历史业绩大部分是前任留下的，参考价值有限。" } },
      { key: "tenureGain", label: "任期回报", w: 92, num: true,
        s: { d: "现任经理任职期间的累计涨跌幅，是剥离前任影响后经理真实能力的直接证据。", f: "任职日复权净值 ÷ 当前复权净值 − 1。", b: "high",
             h: "经理在任期内创造了真实超额收益，是主动型基金最硬核的选基证据。",
             l: "任期内跑输，需要警惕——但要结合是否熊市接手、任职长短一起看。" } },
    ]},
    { key: "scale", label: "规模", cols: [
      { key: "familyScale", label: "总规模(亿)", w: 92, num: true,
        s: { d: "同一策略产品全部份额合并后的资产盘子，代表市场认可度与清盘距离。", f: "A/C/Y/I 等各份额最新净资产之和。", b: null,
             h: "认可度高、流动性好、清盘风险小；但巨无霸调仓不灵活，可能摊薄超额收益。",
             l: "规模低于 5000 万会触发清盘条款，且容易被大额申赎冲击净值。" } },
      { key: "scale", label: "单支规模(亿)", w: 102, num: true,
        s: { d: "当前这只份额自己的净资产规模。", f: "最新定期报告披露的基金资产净值。", b: null,
             h: "同族内对比可看出资金对不同收费份额的偏好流向。",
             l: "重点盯 5000 万清盘线。" } },
    ]},
    { key: "found", label: "成立信息", cols: [
      { key: "inception", label: "成立日期", w: 88, text: true, dtype: "date",
        s: { d: "基金合同生效日，业绩回溯的起点。", f: "无计算。", b: null } },
      { key: "years", label: "成立年限", w: 78, num: true,
        s: { d: "基金存续的年数，决定业绩样本的长度。", f: "(今天 − 成立日期) ÷ 365.25。", b: null,
             h: "穿越过牛熊周期的老基金，任何业绩数字都更有说服力。",
             l: "成立不满 3 年的，排名与年化都可能只是赶上了行情。" } },
      { key: "issueDate", label: "发行日期", w: 88, text: true, dtype: "date",
        s: { d: "基金公开发售的日子，通常早于成立日期数周。", f: "无计算。", b: null } },
      { key: "divTotal", label: "累计分红(元/份)", w: 118, num: true,
        s: { d: "成立以来每份基金份额累计分发的现金，代表『落袋』回报的厚度。", f: "Σ 历史每份分红金额（来自分红公告）。", b: null,
             h: "分红多说明现金流回报实在，适合需要现金流的投资者；注意分红当日净值除权，总涨幅已含分红再投。",
             l: "不分红不代表差——成长定位的基金倾向把收益滚入再投资，复利效率更高。" } },
      { key: "divCount", label: "分红次数", w: 80, num: true,
        s: { d: "成立以来分红的总次数，反映管理人对现金回报的态度与合同的分红机制。", f: "历史分红公告计数。", b: null,
             h: "次数多通常设有『定期分红』条款，适合定支取规划。",
             l: "次数少更多是策略选择，与好坏无关。" } },
    ]},
    { key: "perf", label: "收益表现", cols: [
      { key: "ytd", label: "今年", w: 78, num: true,
        s: { d: "从当年第一个交易日至最新净值的区间涨跌幅。", f: "最新复权净值 ÷ 上年末复权净值 − 1。", b: "high",
             h: "当年行情中把握能力强，需结合当年市场风格解读。",
             l: "当年节奏与市场风格不符，单看一年不构成结论。" } },
      { key: "total", label: "总涨幅", w: 84, num: true,
        s: { d: "成立以来的累计涨跌幅，反映长周期总回报。", f: "最新复权净值 ÷ 成立日净值 − 1。", b: "high",
             h: "总回报高说明长期方向正确，但应结合成立年限与年化看效率。",
             l: "总涨幅为负的老基金，长期资金增值失败。" } },
      { key: "annualized", label: "成立来平均年化", w: 124, num: true,
        s: { d: "把成立以来的累计收益折算成『每年复利多少』，衡量长跑能力的第一指标。", f: "(1 + 总涨幅) ^ (365.25 ÷ 成立天数) − 1，几何年化。", b: "high",
             h: "复利效率高：年化 15% 十年即翻 4 倍，是判断『值不值得长期持有』的核心。",
             l: "长期增值速度慢，可能跑不赢通胀和稳健理财，资金在低效运转。" } },
      { key: "spark", label: "走势", w: 96,
        s: { d: "近一年复权净值的迷你走势线；点击单元格弹出与基准指数对比的大图（可选近1年/近3年/成立以来）。", f: "净值序列归一化为百分比收益后绘制的折线。", b: null,
             h: "线形陡峭上扬代表区间动量强。",
             l: "线形下探代表区间回撤，结合最大回撤列看更深。" } },
    ]},
    { key: "rank", label: "同类对比", cols: [
      { key: "rankYtd", label: "今年同类排名", w: 104, rank: true,
        s: { d: "在同类型基金中按今年收益排第几名，分子是名次，分母是参与排名的同类总数。", f: "名次 ÷ 总数 = 百分位，越靠前越强。", b: "rank",
             h: "跻身同类前 15% 属于第一梯队；但短期排名常有『均值回归』，别只追冠军。",
             l: "垫底并不必然代表差——若投资逻辑没变，有时反而是风格逆风期。" } },
      { key: "rankY1", label: "近1年同类排名", w: 110, rank: true,
        s: { d: "近一年收益在同类中的名次，比单年度排名更能滤掉短期噪音。", f: "名次 ÷ 总数 = 百分位。", b: "rank",
             h: "长期稳居前 1/4，通常意味着策略有效且稳定。",
             l: "持续靠后则应审视策略是否失效。" } },
    ]},
    { key: "yearly", label: "年度涨幅", cols: YEAR_COLS },
    { key: "stage", label: "阶段涨幅", cols: PERIOD_COLS },
    { key: "fee", label: "费率", cols: [
      { key: "mgmtFee", label: "管理费", w: 74, num: true,
        s: { d: "付给管理公司的『工资』，每年从净值里直接扣除。", f: "年费率 × 每日净资产，已隐含在净值涨跌里。", b: "low",
             h: "费率是每年确定扣除的成本：同样业绩下，费率低 0.5% 长期复利差巨大。",
             l: "低费率是指数/债券基金的天然优势；主动基金费率高不必然差，但需要业绩证明。" } },
      { key: "custFee", label: "托管费", w: 74, num: true,
        s: { d: "付给托管银行保管资金的费用，防止资金被挪用。", f: "年费率 × 每日净资产。", b: "low",
             h: "行业高度同质（多为 0.05%~0.15%），差异不大。",
             l: "差别很小，选基时优先级远低于管理费。" } },
      { key: "salesFee", label: "销售服务费", w: 92, num: true,
        s: { d: "C 类份额免申购费、改为按日计提的销售费用，本质是『把一次性费用摊成租金』。", f: "年费率 × 每日净资产。", b: "low",
             h: "C 类费率越高，长期持有越不划算（A 类反而便宜）。",
             l: "适合短持：C 类免申购费，持有 1~2 年内通常比 A 类总成本更低。" } },
      { key: "feeTotal", label: "费用合计", w: 82, num: true,
        s: { d: "每年从净值里扣走的总成本，是复利公式中确定的减分项。", f: "管理费 + 托管费 + 销售服务费。", b: "low",
             h: "成本每降 0.5%，20 年复利差距约 10%。",
             l: "费用越低，长期持有的复利损耗越小——指数基金的核心优势就在这里。" } },
    ]},
    { key: "asset", label: "资产配置", cols: [
      { key: "stockPct", label: "股票占比", w: 82, num: true,
        s: { d: "股票市值占净资产的比例，直接决定基金的进攻性和波动来源。", f: "最新定期报告的股票市值 ÷ 基金资产净值。", b: null,
             h: "仓位高=进攻性强、回撤风险大；债券型基金若股票占比突然上升，说明风格变激进。",
             l: "低仓位=防守型，牛市可能跑输。" } },
      { key: "bondPct", label: "债券占比", w: 82, num: true,
        s: { d: "债券市值占净资产比例，是债基收益与回撤的主要来源。", f: "最新定期报告的债券市值 ÷ 基金资产净值。", b: null,
             h: "债基杠杆（债券占比>100%）是常态：通过回购放大仓位，收益与风险同步放大。",
             l: "债券占比过低而现金高，通常在等待建仓或防御。" } },
      { key: "cashPct", label: "现金占比", w: 82, num: true,
        s: { d: "银行存款和现金类资产的比例，反映基金弹药与防御姿态。", f: "最新定期报告。", b: null,
             h: "现金多通常在等机会、应对巨额赎回，或股票仓位被限制。",
             l: "现金少说明资金满仓运作。" } },
      { key: "reportDate", label: "报告期", w: 84, text: true, dtype: "date",
        s: { d: "资产配置与持有人数据所属的季报截止日，季度披露有滞后。", f: "无计算。", b: null,
             h: "看占比类数据时，先确认报告期够不够新（滞后一个季度以上要小心）。" } },
    ]},
    { key: "holder", label: "持有人结构", cols: [
      { key: "indivPct", label: "个人占比", w: 82, num: true,
        s: { d: "个人投资者持有的份额比例，反映『散户浓度』。", f: "半年报/年报披露的个人持有份额 ÷ 总份额。", b: null,
             h: "散户占比高：申赎受情绪驱动大，规模波动剧烈，追涨杀赎可能放大波动。",
             l: "散户占比低通常意味着机构主导，筹码更稳定。" } },
      { key: "instPct", label: "机构占比", w: 82, num: true,
        s: { d: "机构投资者（银行/保险/FOF 等）持有的比例，代表专业资金的信任票。", f: "最新披露期的机构持有份额 ÷ 总份额。", b: null,
             h: "机构占比高说明经过专业尽调筛选；但机构大额赎回也会造成净值跳空。",
             l: "机构占比极低的迷你基金要留意清盘与持续营销风险。" } },
    ]},
    { key: "risk", label: "风险指标", cols: [
      { key: "sd1", label: "标准差-近1年", w: 112, num: true,
        s: { d: "近一年收益率的波动幅度（离散程度），是『坐过山车』的剧烈程度。", f: "日收益率标准差年化。", b: "low",
             h: "波动大=持有体验差，必须用更高的收益来补偿（对照夏普）。",
             l: "波动小收益曲线平稳，适合大资金和低风险偏好。" } },
      { key: "sd2", label: "标准差-近2年", w: 112, num: true,
        s: { d: "近两年口径的收益波动幅度，样本更长更稳定。", f: "日收益率标准差年化。", b: "low",
             h: "持续高波动说明组合风格激进或持仓集中。",
             l: "持续低波动是稳健型定位的标志。" } },
      { key: "sd3", label: "标准差-近3年", w: 112, num: true,
        s: { d: "近三年口径的波动幅度，覆盖一轮小周期。", f: "日收益率标准差年化。", b: "low",
             h: "跨牛熊仍高波动的基金，风险属性是刻在策略里的。",
             l: "长期低波动 + 正收益，是最理想的持有体验。" } },
      { key: "sp1", label: "夏普-近1年", w: 96, num: true,
        s: { d: "每承担一份波动风险，换回多少超出无风险利率的收益——风险的『性价比』。", f: "(年化收益 − 无风险利率) ÷ 年化标准差。", b: "high",
             h: "夏普越高，说明收益不是靠蛮力堆风险换来的；大于 1 属于优秀。",
             l: "为负说明连存款利息都没跑赢，承担的波动全部白费。" } },
      { key: "sp2", label: "夏普-近2年", w: 96, num: true,
        s: { d: "近两年口径的风险调整后收益。", f: "(年化收益 − 无风险利率) ÷ 年化标准差。", b: "high",
             h: "两年以上仍保持高夏普，说明风险控制是能力而非运气。",
             l: "夏普随行情大起大落，说明收益主要靠风格暴露。" } },
      { key: "sp3", label: "夏普-近3年", w: 96, num: true,
        s: { d: "近三年口径的风险调整后收益，覆盖一轮牛熊更可信。", f: "(年化收益 − 无风险利率) ÷ 年化标准差。", b: "high",
             h: "三年维度的夏普是晨星等机构最看重的质量指标之一。",
             l: "三年夏普为负，基本可以判定风险收益不成立。" } },
      { key: "ir1", label: "信息-近1年", w: 96, num: true,
        s: { d: "相对于业绩比较基准，每单位主动风险创造出多少超额收益——衡量『经理主动操作值不值』。", f: "(基金收益 − 基准收益) ÷ 跟踪误差。", b: "high",
             h: "信息比率高说明经理的主动决策稳定创造超额收益。",
             l: "为负说明主动操作反而拖累，不如直接买指数。" } },
      { key: "ir2", label: "信息-近2年", w: 96, num: true,
        s: { d: "近两年口径的信息比率。", f: "(基金收益 − 基准收益) ÷ 跟踪误差。", b: "high",
             h: "持续为正且走高，是主动管理能力的证据。",
             l: "长期为负应考虑换成被动产品。" } },
      { key: "ir3", label: "信息-近3年", w: 96, num: true,
        s: { d: "近三年口径的信息比率，检验主动能力的持续性。", f: "(基金收益 − 基准收益) ÷ 跟踪误差。", b: "high",
             h: "三年持续正信息比率，说明超额收益来自可重复的流程。",
             l: "信息比率主要评价主动型；纯指数基金参考意义有限。" } },
      { key: "mdd1y", label: "最大回撤-近1年", w: 120, num: true,
        s: { d: "近一年内从净值最高点到随后最低点的最大跌幅——持有期内『最惨时刻』亏多少。", f: "max(1 − 净值 ÷ 区间内历史最高净值)，用复权净值计算。", b: "low",
             h: "回撤深意味着若买在山顶、浮亏体验重、容易被迫割肉；股基常见 20%~40%。",
             l: "回撤浅是抗跌能力的直接体现，买入容错率高。" } },
      { key: "mdd3y", label: "最大回撤-近3年", w: 120, num: true,
        s: { d: "近三年内净值从峰到谷的最大跌幅，覆盖完整牛熊更能反映风险底线。", f: "同近1年口径，窗口拉长到三年。", b: "low",
             h: "三年最大回撤能揭示极端行情下的真实风险敞口，是定投与仓位管理的依据。",
             l: "三年回撤浅且收益不低的基金，风险收益结构最健康。" } },
      { key: "calmar3", label: "卡玛-近3年", w: 92, num: true,
        s: { d: "近三年年化收益除以同期最大回撤——每承受一份『最惨亏损』换回多少年化收益，回撤版夏普。", f: "近3年年化收益 ÷ |近3年最大回撤|。", b: "high",
             h: "卡玛大于 1 表示收益足以补偿最深的坑；债基普遍高于股基。",
             l: "卡玛低说明回撤大而收益补偿不足，风险性价比差。" } },
    ]},
    { key: "track", label: "跟踪与基准", cols: [
      { key: "te", label: "年化跟踪误差", w: 108, num: true,
        s: { d: "基金与跟踪标的指数收益率之差的标准差年化值——『贴标紧不紧』。", f: "日收益差（基金 − 指数）标准差 × √250。", b: "low",
             h: "误差大：可能是增强策略主动偏离、费率高、或仓位不满；纯被动基金应 <2%。",
             l: "误差小=复制紧密，是被动工具基金的核心竞争力。" } },
      { key: "track", label: "跟踪标的", w: 110, text: true,
        s: { d: "基金合同约定跟随的指数或目标基金。", f: "无计算。", b: null,
             h: "先看标的再谈业绩：标的不同的基金没有可比性。" } },
      { key: "peerTe", label: "同类平均跟踪误差", w: 138, num: true,
        s: { d: "同类型所有基金跟踪误差的平均值，用来给自己的基金定位。", f: "同类基金年化跟踪误差均值。", b: null,
             h: "自己基金的误差低于同类平均，说明管理精细。",
             l: "高于同类平均又非增强策略，复制水平欠佳。" } },
      { key: "benchmark", label: "比较基准", w: 240, text: true,
        s: { d: "基金合同约定的业绩比较基准，是评价主动管理成败的『及格线』。", f: "无计算。", b: null,
             h: "长期能跑赢自己基准的基金才算及格；基准也可以看出基金的真实股债仓位。" } },
    ]},
  ];

  var ALL_COLS = [];
  GROUPS.forEach(function (g) { g.cols.forEach(function (c) { ALL_COLS.push(c); }); });
  var COL_BY_KEY = {};
  ALL_COLS.forEach(function (c) { COL_BY_KEY[c.key] = c; });

  var STORE_KEY = "hs300.cols.v1";
  var LS_SETTINGS = "hs300.settings.v1";
  var LS_LIVE = "hs300.live.v3.";   // 每基金缓存前缀
  var LIVE_TTL = 6 * 3600 * 1000;   // 6 小时

  /* ══════════ 1.5 页签（指数 + 债基） ══════════ */
  // kind: 'index' 按名称关键词匹配并带指数基准行；'bond' 按天天基金类型字段匹配
  var INDEX_TABS = [
    { key: "hs300", label: "沪深300", kind: "index", indexName: "沪深300指数", indexCode: "000300",
      secid: "1.000300", beg: "20050408", inception: "2005-04-08", abbr: "HSSZ300",
      keys: ["沪深300"], meta: "沪深300指数基金" },
    { key: "kc50", label: "科创50", kind: "index", indexName: "科创50指数", indexCode: "000688",
      secid: "1.000688", beg: "20191231", inception: "2019-12-31", abbr: "KC50",
      keys: ["科创50"], meta: "科创50指数基金" },
    { key: "cyb", label: "创业板", kind: "index", indexName: "创业板指", indexCode: "399006",
      secid: "0.399006", beg: "20100601", inception: "2010-06-01", abbr: "CYBZ",
      keys: ["创业板指", "创业板ETF"], meta: "创业板指数基金" },
    { key: "zz500", label: "中证500", kind: "index", indexName: "中证500指数", indexCode: "000905",
      secid: "1.000905", beg: "20050104", inception: "2005-01-04", abbr: "ZZ500",
      keys: ["中证500"], meta: "中证500指数基金" },
    { key: "sz50", label: "上证50", kind: "index", indexName: "上证50指数", indexCode: "000016",
      secid: "1.000016", beg: "20040102", inception: "2004-01-02", abbr: "SZ50",
      keys: ["上证50"], meta: "上证50指数基金" },
    { key: "spx", label: "标普500", kind: "index", indexName: "标普500指数", indexCode: "SPX",
      secid: "100.SPX", beg: "20050103", inception: "2005-01-03", abbr: "SPX",
      keys: ["标普500"], meta: "标普500指数基金(QDII)" },
    { key: "ndx", label: "纳指100", kind: "index", indexName: "纳斯达克100指数", indexCode: "NDX100",
      secid: "100.NDX100", beg: "20050103", inception: "2005-01-03", abbr: "NDX100",
      keys: ["纳斯达克100", "纳指100"], meta: "纳斯达克100指数基金(QDII)" },
    { key: "djia", label: "道琼斯", kind: "index", indexName: "道琼斯工业平均指数", indexCode: "DJIA",
      secid: "100.DJIA", beg: "20050103", inception: "2005-01-03", abbr: "DJIA",
      keys: ["道琼斯"], meta: "道琼斯指数基金(QDII)" },
  ];
  var BOND_TABS = [
    { key: "short", label: "短债", kind: "bond", types: ["债券型-中短债"],
      tip: "短债/中短债基金：久期短、波动小", meta: "短债/中短债基金" },
    { key: "pure", label: "中长期纯债", kind: "bond", types: ["债券型-长债"],
      tip: "中长期纯债基金（不含权益）", meta: "中长期纯债基金" },
    { key: "rate", label: "利率债", kind: "bond", types: ["债券型-利率债"],
      tip: "利率债基金（国债/政金债/政策性金融债）", meta: "利率债基金" },
    { key: "credit", label: "信用债", kind: "bond", types: ["债券型-信用债"],
      tip: "信用债基金", meta: "信用债基金" },
    { key: "tier1", label: "一级债", kind: "bond", types: ["债券型-混合一级"],
      tip: "一级债基：可参与可转债与新债申购，不主动买股票", meta: "一级债基" },
    { key: "tier2", label: "二级债", kind: "bond", types: ["债券型-混合二级"],
      tip: "二级债基：可主动投资股票（比例≤20%），含可转债基金", meta: "二级债基" },
    { key: "partial", label: "偏债混合", kind: "bond", types: ["混合型-偏债"],
      tip: "偏债混合基金：股债搭配、以债为主", meta: "偏债混合基金" },
    { key: "bondEtf", label: "债券ETF", kind: "bond", types: ["指数型-固收"],
      tip: "债券ETF/固收指数基金（国债、信用债、可转债、城投债等）", meta: "债券ETF/固收指数基金" },
  ];
  var FAV_TABS = [
    { key: "fav", label: "我的自选", kind: "fav", meta: "我的自选基金" },
  ];
  var TAB_GROUPS = [
    { key: "broad", navLabel: "宽基", tabs: INDEX_TABS },
    { key: "bond", navLabel: "债基", tabs: BOND_TABS },
    { key: "fav", navLabel: "我的自选", tabs: FAV_TABS },
  ];

  /* ══════════ 2. 状态 ══════════ */
  var funds = [];              // 当前页签的记录数组（含指数基准行）
  var activeGroup = TAB_GROUPS[0];
  var groupTab = { broad: "hs300", bond: "short" };  // 每个分组记住的页签
  var activeTab = INDEX_TABS[0];
  var allFundsList = null;     // 全量基金清单（加载一次）
  var tabData = {};            // key -> { funds, updated, failed }
  var dataMode = "loading";    // loading | live | snapshot | offline
  var snapshotMeta = null;     // 静态快照元信息
  var liveUpdated = null;      // 当前页签更新时间
  var liveFailed = 0;
  var loadGen = 0;             // 加载代际令牌（切换页签时使旧加载作废）
  var loadingTabKey = null;    // 正在加载的页签（用于 spinner）
  var rafPending = false;
  var visible = {};
  var sortState = null;
  var keyword = "";
  var filteredRows = [];
  var filters = {};            // key -> {min,max,kw,top10,above,below}
  var coFilter = null;         // 公司筛选（公司全名）
  var abortLoad = false;
  var FAV_KEY = "hs300.fav.v1";
  var favStore = {};           // code -> {name, abbr, type0, ts}
  var favDirty = false;        // 自选变更后未重建 fav 页签数据
  var cmpSel = [];             // 对比所选基金 code（有序，最多 4）
  var CMP_MAX = 4;

  var $ = window.Util.$;   /* 共享工具别名（tbody 捕获前必须就绪） */
  /* 页面骨架由路由懒加载注入（assets/pages/page-fundtable.js 先于本脚本执行），
     引擎脚本加载时 DOM 已就绪；此处仍走懒绑定以兼容直接打开的异常场景 */
  var tbody = $("tbody"), thead = $("thead"), scrollBox = $("tableScroll");
  var pop = $("filterPop");

  /* ══════════ 2.5 公司主题色（确定性哈希 → 品牌色板） ══════════ */
  /* 公司主题色：低饱和编辑风格色板（哈希映射逻辑不变） */
  var CO_PALETTE = ["#5E7CA0", "#B98545", "#4D896A", "#B85C5C", "#7C8BB0", "#6B8E9E",
    "#8E7C9E", "#8F845C", "#946B62", "#5C7E8C", "#A89B62", "#7E6B5C",
    "#8C9464", "#6E9AA3", "#9C8AA8", "#A0705E"];
  var coColorCache = {};
  // 公司拼音首字母表（按实际数据整理，搜索用）
  var CO_PINYIN = {
    "万家基金": "WJ", "东方基金": "DF", "东财基金": "DC", "中信保诚基金": "ZXBC",
    "中信建投基金": "ZXJT", "中加基金": "ZJ", "中欧基金": "ZO", "中泰证券(上海)资管": "ZTZQ",
    "中金基金": "ZJ", "中银基金": "ZY", "人保资产": "RBZC", "光大保德信基金": "GDBD",
    "兴业基金": "XY", "兴证全球基金": "XZQQ", "农银汇理基金": "NYHL", "创金合信基金": "CJHX",
    "前海开源基金": "QHKY", "华商基金": "HS", "华夏基金": "HX", "华安基金": "HA",
    "华宝基金": "HB", "华富基金": "HF", "华泰保兴基金": "HTBX", "华泰柏瑞基金": "HTBR",
    "南方基金": "NF", "博时基金": "BS", "博道基金": "BD", "同泰基金": "TT",
    "嘉实基金": "JS", "国寿安保基金": "GSAB", "国投瑞银基金": "GTRY", "国泰基金": "GT",
    "国泰海通资管": "GTHT", "国海富兰克林基金": "GHFLK", "国联基金": "GL", "国联安基金": "GLA",
    "大成基金": "DC", "天弘基金": "TH", "安信基金": "AX", "宏利基金": "HL",
    "富国基金": "FG", "富安达基金": "FAD", "富荣基金": "FR", "工银瑞信基金": "GYRX",
    "平安基金": "PA", "广发基金": "GF", "建信基金": "JX", "德邦基金": "DB",
    "招商基金": "ZS", "摩根基金(中国)": "MG", "新华基金": "XH", "方正富邦基金": "FZFB",
    "易方达基金": "YFD", "景顺长城基金": "JSCC", "民生加银基金": "MSJY", "永赢基金": "YY",
    "汇安基金": "HJA", "汇添富基金": "HTF", "泰康基金": "TK", "浙商基金": "ZSC",
    "浦银基金": "PY", "海富通基金": "HFT", "申万菱信基金": "SWLX", "西部利得基金": "XBLD",
    "诺安基金": "NA", "贝莱德基金管理": "BLD", "财通基金": "CT", "财通资管": "CTZG",
    "银华基金": "YH", "银河基金": "YH2", "长信基金": "CX", "长城基金": "CC",
    "长安基金": "CA", "长江证券(上海)资管": "CJZQ", "长盛基金": "CS", "鹏华基金": "PH",
    "鹏扬基金": "PYC"
  };
  function coColor(name) {
    if (!name || name === "--") return "#8b96ad";
    if (coColorCache[name]) return coColorCache[name];
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    var c = CO_PALETTE[h % CO_PALETTE.length];
    coColorCache[name] = c;
    return c;
  }

  /* ══════════ 3. 工具（通用部分复用 assets/core/util.js，仅保留引擎专属） ══════════ */
  var esc = window.Util.esc;
  var debounce = window.Util.debounce;
  var pad2 = window.Util.pad2;
  function parseNum(v) {
    if (v === null || v === undefined) return null;
    var s = String(v).replace(/%/g, "").replace(/,/g, "").trim();
    if (s === "" || s === "--" || s === "---") return null;
    var n = parseFloat(s);
    return isNaN(n) ? null : n;
  }
  function stripTags(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ").trim();
  }
  function cleanCell(v) {
    v = stripTags(v);
    return (!v || v === "---" || v === "--" || v === "-") ? "--" : v;
  }
  function firstNumber(s) {
    var m = String(s || "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }
  function pctOrDash(v) {
    var n = firstNumber(v);
    return n === null ? "--" : n.toFixed(2) + "%";
  }
  function normDate(s) {
    s = String(s || "");
    var m = s.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (m) return m[1] + "-" + pad2(+m[2]) + "-" + pad2(+m[3]);
    m = s.match(/^\d{4}-\d{1,2}-\d{1,2}/);
    return m ? m[0] : "--";
  }
  function familyKey(name) {
    var n = String(name || "").replace(/\s+/g, "");
    for (var i = 0; i < 2; i++) {
      n = n.replace(/[（(]\s*(?:LOF|OF)\s*[)）]$/, "").replace(/[（(]\s*后端\s*[)）]$/, "");
      n = n.replace(/(?:发起式)?[（(]?[A-Z][）)]?$/, function (m, off, s) {
        // 仅当尾字母前的字符是 CJK 或 '）' 时视为份额字母
        var prev = s.charAt(off - 1);
        return (/[\u4e00-\u9fff）)]/.test(prev)) ? "" : m;
      });
    }
    return n;
  }

  /* ══════════ 4. 网络层 ══════════ */
  var PROXY = false;

  function scriptLoad(url, timeout, onReadySync) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      var done = false;
      var t = setTimeout(function () {
        if (!done) { done = true; s.remove(); reject(new Error("script timeout")); }
      }, timeout || 25000);
      s.src = url;
      s.onload = function () {
        if (done) return;
        done = true; clearTimeout(t); s.remove();
        try {
          resolve(onReadySync ? onReadySync() : undefined);
        } catch (e) { reject(e); }
      };
      s.onerror = function () { if (!done) { done = true; clearTimeout(t); s.remove(); reject(new Error("script error")); } };
      document.head.appendChild(s);
    });
  }
  function jsonp(url, cbName) {
    return new Promise(function (resolve, reject) {
      var to = setTimeout(function () { cleanup(); reject(new Error("jsonp timeout")); }, 25000);
      function cleanup() {
        clearTimeout(to);
        try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
        var s = document.getElementById(cbName);
        if (s) s.remove();
      }
      window[cbName] = function (data) { cleanup(); resolve(data); };
      var s = document.createElement("script");
      s.id = cbName;
      s.src = url;
      s.onerror = function () { cleanup(); reject(new Error("jsonp error")); };
      document.head.appendChild(s);
    });
  }
  // 获取闸门：挂起时所有请求在此排队，页面其余功能照常
  var fetchPaused = false;
  var gateWaiters = [];
  function gateWait() {
    if (!fetchPaused) return Promise.resolve();
    return new Promise(function (res) { gateWaiters.push(res); });
  }
  function setPaused(p) {
    fetchPaused = p;
    if (!p) {
      var w = gateWaiters.slice();
      gateWaiters.length = 0;
      w.forEach(function (f) { f(); });
    }
    var b = $("btnPause");
    if (b) b.textContent = p ? "▶ 继续获取" : "⏸ 暂停获取";
    setModeChip();
    if (p && !$("loadOverlay").hidden) {
      $("loadStage").textContent = "已挂起——完成前端调整后点「▶ 继续获取」恢复排队";
    }
  }
  function relayOnce(url) {
    var ctrl = ("AbortController" in window) ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 40000) : null;
    return fetch("/api/east?u=" + encodeURIComponent(url), ctrl ? { signal: ctrl.signal } : {})
      .then(function (r) {
        if (timer) clearTimeout(timer);
        if (!r.ok) throw new Error("relay HTTP " + r.status);
        return r.text();
      })
      .catch(function (e) {
        if (timer) clearTimeout(timer);
        throw e;
      });
  }
  function relay(url) {
    if (!PROXY) return Promise.reject(new Error("no-proxy"));
    // 退避重试（每次尝试均经节奏限速器 + 挂起闸门）：应对限流（514 等）
    var delays = [0, 1500, 3500, 7000];
    function attempt(i) {
      return gateWait().then(function () {
        return paceRelay(function () { return relayOnce(url); });
      }).catch(function (e) {
        if (i >= delays.length - 1) throw e;
        return gateWait().then(function () {
          return new Promise(function (resolve) {
            setTimeout(resolve, delays[i + 1]);
          });
        }).then(function () { return attempt(i + 1); });
      });
    }
    return attempt(0);
  }
  function rnd() { return Math.random().toString().slice(2, 10); }

  function makeSemaphore(n) {
    var active = 0;
    var queue = [];
    function next() {
      if (!queue.length || active >= n) return;
      active++;
      var job = queue.shift();
      job().then(function (v) {
        active--;
        if (queue.length) next();
        job.__resolve(v);
      }, function (e) {
        active--;
        if (queue.length) next();
        job.__reject(e);
      });
    }
    return function (fn) {
      return new Promise(function (resolve, reject) {
        var job = fn;
        job.__resolve = resolve;
        job.__reject = reject;
        queue.push(job);
        next();
      });
    };
  }
  // 节奏限速器：两次请求起始间隔至少 minGap 毫秒，避免触发东财突发限流
  function makePacer(minGap) {
    var lastStart = 0;
    var queue = [];
    var pumping = false;
    function pump() {
      if (pumping) return;
      pumping = true;
      (function step() {
        if (!queue.length) { pumping = false; return; }
        var job = queue.shift();
        var wait = Math.max(0, lastStart + minGap - Date.now());
        setTimeout(function () {
          lastStart = Date.now();
          job().then(function (v) { job.__resolve(v); step(); },
                     function (e) { job.__reject(e); step(); });
        }, wait);
      })();
    }
    return function (fn) {
      return new Promise(function (resolve, reject) {
        fn.__resolve = resolve; fn.__reject = reject;
        queue.push(fn); pump();
      });
    };
  }
  var paceRelay = makePacer(140);
  var semPz = makeSemaphore(3);

  /* ══════════ 5. 解析器（与采集脚本同口径的 JS 实现） ══════════ */
  function extractContent(text) {
    var i = text.indexOf('content:"');
    if (i < 0) return "";
    var j = text.lastIndexOf('"');
    return text.substring(i + 9, j).replace(/\\"/g, '"');
  }
  var JDZF_ORDER = ["今年来", "近1周", "近1月", "近3月", "近6月", "近1年", "近2年", "近3年", "近5年", "成立来"];
  function parseJdzfText(text) {
    var html = extractContent(text);
    var d = {}, ranks = {};
    // 每个区间一个 <ul>，li 序列：标题 / 涨幅 / 同类平均 / 沪深300 / 同类排名(r|t) / ...
    var uls = html.split(/<ul[^>]*>/);
    for (var i = 1; i < uls.length; i++) {
      var lis = uls[i].match(/<li[^>]*>([\s\S]*?)<\/li>/g) || [];
      var texts = lis.map(function (x) { return cleanCell(x); });
      if (texts.length < 3) continue;
      var period = texts[0];
      if (JDZF_ORDER.indexOf(period) < 0) continue;
      d[period] = texts[1] || "--";
      for (var j = 2; j < texts.length; j++) {
        var t = texts[j].replace(/\s+/g, "");
        if (/^\d+\|\d+$/.test(t)) { ranks[period] = t; break; }
      }
    }
    return { d: d, ranks: ranks };
  }
  function parseYearzfText(text) {
    var html = extractContent(text);
    var out = { ann: {}, ranks: {} };
    var mt = html.match(/<thead>([\s\S]*?)<\/thead>/);
    var mb = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
    if (!mt || !mb) return out;
    var years = [];
    var yre = /(\d{4})年度/g, ym;
    while ((ym = yre.exec(mt[1]))) years.push(ym[1]);
    var trs = mb[1].match(/<tr[^>]*>([\s\S]*?)<\/tr>/g) || [];
    // 第 1 行=阶段涨幅，第 4 行=同类排名
    var annRow = null, rankRow = null;
    for (var i = 0; i < trs.length; i++) {
      var label = stripTags(trs[i].split(/<\/td>/)[0] || "");
      if (label.indexOf("阶段涨幅") >= 0) annRow = trs[i];
      if (label.indexOf("同类排名") >= 0) rankRow = trs[i];
    }
    function rowVals(tr) {
      var vals = [];
      var tdre = /<td[^>]*>([\s\S]*?)<\/td>/g, tm;
      while ((tm = tdre.exec(tr))) vals.push(cleanCell(tm[1]));
      return vals.slice(1);
    }
    if (annRow) {
      var vals = rowVals(annRow);
      for (var k = 0; k < years.length && k < vals.length; k++) out.ann[years[k]] = pctOrDash(vals[k]);
    }
    if (rankRow) {
      var rv = rowVals(rankRow);
      for (var k2 = 0; k2 < years.length && k2 < rv.length; k2++) {
        var tv = rv[k2].replace(/\s+/g, "");
        if (/^\d+\|\d+$/.test(tv)) out.ranks[years[k2]] = tv;
      }
    }
    return out;
  }
  function parseCyrjgText(text) {
    var html = extractContent(text);
    var out = { instPct: "--", indivPct: "--" };
    var tr = html.match(/<tr[^>]*>([\s\S]*?)<\/tr>/);
    if (!tr) return out;
    var tds = [], tdre = /<td[^>]*>([\s\S]*?)<\/td>/g, m;
    while ((m = tdre.exec(tr[1]))) tds.push(cleanCell(m[1]));
    if (tds.length >= 3) { out.instPct = pctOrDash(tds[1]); out.indivPct = pctOrDash(tds[2]); }
    return out;
  }
  function parseJbgkHtml(html) {
    var i = html.indexOf('<table class="info w790">');
    var out = {};
    if (i < 0) return out;
    var table = html.substring(i, html.indexOf("</table>", i));
    var chunks = table.split("<th");
    var pairs = {}, raws = {};
    for (var k = 1; k < chunks.length; k++) {
      var ch = chunks[k];
      var p = ch.indexOf("</th>");
      if (p < 0) continue;
      var label = stripTags(ch.substring(0, p)).replace(/^>\s*/, "");
      var value = stripTags(ch.substring(p + 5));
      if (label) { pairs[label] = value; raws[label] = ch.substring(p + 5); }
    }
    // 经理人（含个人主页 id）与公司 orgId，用于超链接
    var mlinks = [];
    var mgrRaw = raws["基金经理人"] || "";
    var mre = /<a[^>]+href="[^"]*manager\/(\d+)\.html"[^>]*>([\s\S]*?)<\/a>/g, mm;
    while ((mm = mre.exec(mgrRaw))) {
      var nm = stripTags(mm[2]);
      if (nm) mlinks.push({ id: mm[1], name: nm });
    }
    if (mlinks.length) out.managerList = mlinks;
    var coRaw = raws["基金管理人"] || "";
    var mc = coRaw.match(/company\/(\d+)\.html/);
    if (mc) out.orgId = mc[1];
    // 成立来分红："每份累计0.88元（14次）"
    var fh = pairs["成立来分红"] || "";
    var fm1 = fh.match(/([\d.]+)\s*元/), fm2 = fh.match(/(\d+)\s*次/);
    out.divTotal = fm1 ? fm1[1] : "--";
    out.divCount = fm2 ? fm2[1] : "--";
    out.ftype = cleanCell(pairs["基金类型"]);
    out.issueDate = normDate(pairs["发行日期"]);
    var seg = pairs["成立日期/规模"] || "";
    var m = seg.match(/(\d{4}年\d{1,2}月\d{1,2}日)/);
    out.inception = m ? normDate(m[1]) : "--";
    seg = pairs["净资产规模"] || "";
    m = seg.match(/([\d,\.]+)\s*亿/);
    out.scale = m ? parseFloat(m[1].replace(/,/g, "")) : null;
    var md = seg.match(/截止至[：:]\s*(\d{4}年\d{1,2}月\d{1,2}日|\d{4}-\d{1,2}-\d{1,2})/);
    out.scaleDate = md ? normDate(md[1]) : "--";
    out.company = cleanCell(pairs["基金管理人"]);
    out.manager = cleanCell(pairs["基金经理人"]);
    out.mgmtFee = pctOrDash(pairs["管理费率"]);
    out.custFee = pctOrDash(pairs["托管费率"]);
    out.salesFee = pctOrDash(pairs["销售服务费率"]);
    out.benchmark = cleanCell(pairs["业绩比较基准"]);
    out.track = cleanCell(pairs["跟踪标的"]);
    return out;
  }
  function parseTsdataHtml(html) {
    function row3(label) {
      var re = new RegExp("<td>\\s*" + label + "\\s*</td>([\\s\\S]*?)</tr>");
      var m = html.match(re);
      var vals = [];
      if (m) {
        var tdre = /<td[^>]*>([^<]*)<\/td>/g, tm;
        while ((tm = tdre.exec(m[1])) && vals.length < 3) vals.push(cleanCell(tm[1]));
      }
      while (vals.length < 3) vals.push("--");
      return vals;
    }
    var out = {};
    var sd = row3("标准差"), sp = row3("夏普比率"), ir = row3("信息比率");
    out.sd1 = sd[0]; out.sd2 = sd[1]; out.sd3 = sd[2];
    out.sp1 = sp[0]; out.sp2 = sp[1]; out.sp3 = sp[2];
    out.ir1 = ir[0]; out.ir2 = ir[1]; out.ir3 = ir[2];
    out.te = "--"; out.peerTe = "--"; out.trackTs = "--";
    var j = html.indexOf("年化跟踪误差");
    if (j >= 0) {
      var block = html.substr(j, 2500);
      var m = block.match(/<\/tr>\s*<tr>([\s\S]*?)<\/tr>/);
      if (m) {
        var vals = [], tdre = /<td[^>]*>([\s\S]*?)<\/td>/g, tm;
        while ((tm = tdre.exec(m[1]))) vals.push(cleanCell(tm[1]));
        if (vals.length >= 3) { out.trackTs = vals[0]; out.te = vals[1]; out.peerTe = vals[2]; }
      }
    }
    return out;
  }
  function parseZcpzHtml(html) {
    var out = { reportDate: "--", stockPct: "--", bondPct: "--", cashPct: "--" };
    var i = html.indexOf("comm tzxq");
    if (i < 0) i = html.indexOf("资产配置");
    if (i < 0) return out;
    var seg = html.substring(i, i + 20000);
    var tb = seg.match(/<tbody>([\s\S]*?)<\/tbody>/);
    if (!tb) return out;
    var tr = tb[1].match(/<tr[^>]*>([\s\S]*?)<\/tr>/);
    if (!tr) return out;
    var tds = [], tdre = /<td[^>]*>([\s\S]*?)<\/td>/g, m;
    while ((m = tdre.exec(tr[1]))) tds.push(cleanCell(m[1]));
    if (tds.length >= 4) {
      out.reportDate = normDate(tds[0]);
      out.stockPct = pctOrDash(tds[1]);
      out.bondPct = pctOrDash(tds[2]);
      out.cashPct = pctOrDash(tds[3]);
    }
    return out;
  }
  var PZ_VARS = ["Data_netWorthTrend", "Data_ACWorthTrend", "Data_grandTotal", "Data_rateInSimilarType",
    "Data_rateInSimilarPersent", "Data_fluctuationScale", "Data_holderStructure", "Data_assetAllocation",
    "Data_performanceEvaluation", "Data_currentFundManager", "Data_buySedemption", "Data_fundSharesPositions",
    "stockCodes", "zqCodes", "stockCodesNew", "zqCodesNew", "swithSameType"];
  function grabPingzhong() {
    var nwt = window.Data_netWorthTrend || [];
    var adj = [], cur = 1;
    for (var i = 0; i < nwt.length; i++) {
      var er = nwt[i].equityReturn;
      if (er !== null && er !== undefined) cur = cur * (1 + er / 100);
      adj.push([nwt[i].x, cur]);
    }
    var manager = "";
    var tenure = null, tenureGain = null;
    var cfm = window.Data_currentFundManager;
    if (cfm && cfm.length) {
      manager = cfm.map(function (x) { return x.name; }).join("、");
      var wt = (cfm[0].workTime || "").toString();
      var mY = wt.match(/(\d+)年/), mD = wt.match(/(\d+)天/);
      if (mY || mD) {
        tenure = Math.round(((mY ? +mY[1] : 0) + (mD ? +mD[1] / 365 : 0)) * 10) / 10;
      }
      try {
        var py = cfm[0].profit && cfm[0].profit.series && cfm[0].profit.series[0] &&
          cfm[0].profit.series[0].data && cfm[0].profit.series[0].data[0];
        if (py && py.y !== null && py.y !== undefined) tenureGain = py.y;
      } catch (e) {}
    }
    var out = { adj: adj, manager: manager, tenure: tenure, tenureGain: tenureGain };
    PZ_VARS.forEach(function (k) { try { window[k] = undefined; } catch (e) {} });
    return out;
  }
  function mddFromSeries(series, days) {
    if (!series || !series.length) return null;
    var last = series[series.length - 1];
    var target = last[0] - days * 86400 * 1000;
    var peak = null, mdd = 0, started = false;
    for (var i = 0; i < series.length; i++) {
      if (series[i][0] < target) continue;
      started = true;
      if (peak === null || series[i][1] > peak) peak = series[i][1];
      else if (peak > 0) {
        var dd = (series[i][1] / peak - 1) * 100;
        if (dd < mdd) mdd = dd;
      }
    }
    if (!started || peak === null) return null;
    return mdd;
  }
  function annualFromSeries(series, years) {
    if (!series.length) return {};
    var byYear = {};
    for (var i = 0; i < series.length; i++) {
      var d = new Date(series[i][0]);
      var yy = d.getUTCFullYear();
      (byYear[yy] = byYear[yy] || []).push([series[i][0], series[i][1]]);
    }
    var ys = Object.keys(byYear).map(Number).sort(function (a, b) { return a - b; });
    var out = {};
    ys.forEach(function (yy, idx) {
      if (years.indexOf(yy) < 0) return;
      var rows = byYear[yy].slice().sort(function (a, b) { return a[0] - b[0]; });
      var endV = rows[rows.length - 1][1];
      var baseV = idx > 0 ? byYear[ys[idx - 1]].slice(-1)[0][1] : rows[0][1];
      if (baseV && endV) out[String(yy)] = ((endV / baseV - 1) * 100).toFixed(2) + "%";
    });
    return out;
  }
  function periodFromSeries(series, days) {
    if (!series.length) return null;
    var last = series[series.length - 1];
    var target = last[0] - days * 86400 * 1000;
    var baseV = null;
    for (var i = 0; i < series.length; i++) {
      if (series[i][0] <= target) baseV = series[i][1]; else break;
    }
    if (baseV && last[1] && target > series[0][0]) return ((last[1] / baseV - 1) * 100).toFixed(2) + "%";
    return null;
  }

  /* ══════════ 6. 实时数据加载 ══════════ */
  var progressCb = null;
  function setProgress(pct, msg) { if (progressCb) progressCb(pct, msg); }

  function loadAllFunds() {
    if (allFundsList) return Promise.resolve(allFundsList);
    return scriptLoad("https://fund.eastmoney.com/js/fundcode_search.js", 30000).then(function () {
      var arr = window.r || [];
      window.r = null;
      var seen = {}, out = [];
      for (var i = 0; i < arr.length; i++) {
        var row = arr[i];
        if (row[2] && !seen[row[0]]) {
          seen[row[0]] = 1;
          out.push({ code: row[0], abbr: row[1], name: row[2], type0: row[3] });
        }
      }
      out.sort(function (a, b) { return a.code < b.code ? -1 : 1; });
      allFundsList = out;
      return out;
    });
  }
  function universeFor(tab) {
    if (tab.kind === "fav") {
      return Object.keys(favStore).map(function (code) {
        var m = favStore[code];
        return { code: code, name: m.name, abbr: m.abbr || "", type0: m.type0 || "" };
      }).sort(function (a, b) { return a.code < b.code ? -1 : 1; });
    }
    return allFundsList.filter(function (f) {
      if (tab.kind === "bond") {
        for (var i = 0; i < tab.types.length; i++) {
          if (f.type0 === tab.types[i]) return true;
        }
        return false;
      }
      for (var j = 0; j < tab.keys.length; j++) {
        if (f.name.indexOf(tab.keys[j]) >= 0) return true;
      }
      return false;
    });
  }

  function buildIndexRow(tab, today) {
    var cbName = "__kline_" + tab.key;
    var url = "https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=" + tab.secid +
      "&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f53&klt=101&fqt=1&beg=" + tab.beg + "&end=20500101" +
      "&cb=" + cbName;
    return jsonp(url, cbName).then(function (payload) {
      var klines = (payload.data && payload.data.klines) || [];
      var series = [];
      for (var i = 0; i < klines.length; i++) {
        var parts = klines[i].split(",");
        var ts = Date.UTC(+parts[0].slice(0, 4), +parts[0].slice(5, 7) - 1, +parts[0].slice(8, 10));
        series.push([ts, parseFloat(parts[1])]);
      }
      if (!series.length) return null;
      idxSeriesCache = series;   // 供对比图使用
      var last = series[series.length - 1];
      var firstV = series[0][1];
      var row = {
        code: tab.indexCode, name: tab.indexName, abbr: tab.abbr, ftype: "指数基准",
        company: "--", manager: "--", issueDate: "--", inception: tab.inception,
        benchmark: "--", track: "--", mgmtFee: "--", custFee: "--", salesFee: "--", feeTotal: "--",
        scale: null, scaleDate: "--", familyScale: null,
        stockPct: "--", bondPct: "--", cashPct: "--", reportDate: "--",
        instPct: "--", indivPct: "--",
        sd1: "--", sd2: "--", sd3: "--", sp1: "--", sp2: "--", sp3: "--",
        ir1: "--", ir2: "--", ir3: "--", te: "--", peerTe: "--",
        __isIndex: true,
      };
      var y0 = +tab.inception.slice(0, 4), m0 = +tab.inception.slice(5, 7), d0d = +tab.inception.slice(8, 10);
      var d0 = Date.UTC(y0, m0 - 1, d0d);
      var days = Math.floor((Date.now() - d0) / 86400000);
      row.years = days > 0 ? Math.round(days / 365.25 * 10) / 10 : null;
      var totalPct = (last[1] / firstV - 1) * 100;
      row.total = totalPct.toFixed(2) + "%";
      row.annualized = days > 30 ? ((Math.pow(1 + totalPct / 100, 365.25 / days) - 1) * 100).toFixed(2) + "%" : "--";
      var curYear = new Date(last[0]).getUTCFullYear();
      var ytd = annualFromSeries(series, [curYear]);
      row.ytd = ytd[String(curYear)] || "--";
      row.m1 = periodFromSeries(series, 30.4375) || "--";
      row.m3 = periodFromSeries(series, 91.3125) || "--";
      row.m6 = periodFromSeries(series, 182.625) || "--";
      row.y1 = periodFromSeries(series, 365.25) || "--";
      row.y2 = periodFromSeries(series, 2 * 365.25) || "--";
      row.y3 = periodFromSeries(series, 3 * 365.25) || "--";
      row.y5 = periodFromSeries(series, 5 * 365.25) || "--";
      var ann = annualFromSeries(series, [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]);
      for (var yy = 2015; yy <= 2025; yy++) row["y" + yy] = ann[String(yy)] || "--";
      return row;
    });
  }

  var SYNC_KEY = "hs300.sync.v1";
  var SYNC_INTERVAL = 32 * 86400 * 1000;   // 间隔超过 1 个月才重新同步
  var syncInfo = { ts: 0, tabs: {} };
  function loadSync() {
    syncInfo = Util.store.get(SYNC_KEY, { ts: 0, tabs: {} });
    if (!syncInfo || typeof syncInfo !== "object") syncInfo = { ts: 0, tabs: {} };
    if (!syncInfo.tabs) syncInfo.tabs = {};
    syncInfo.ts = syncInfo.ts || 0;
  }
  function syncedRecently(key) {
    var ts = syncInfo.tabs[key] || 0;
    return ts > 0 && (Date.now() - ts) < SYNC_INTERVAL;
  }
  function markSynced(key) {
    syncInfo.tabs[key] = Date.now();
    syncInfo.ts = Date.now();
    Util.store.set(SYNC_KEY, syncInfo);
  }
  function cacheGet(k, ttlOverride) {
    try {
      var o = Util.store.get(LS_LIVE + k);
      // ttlOverride：1 个月同步间隔内，完整记录视为新鲜（40 天）；残缺记录仍按自身短 TTL
      var ttl = ttlOverride
        ? (o && o.partial ? (o.ttl || LIVE_TTL) : ttlOverride)
        : ((o && o.ttl) || LIVE_TTL);
      if (o && o.t && Date.now() - o.t < ttl) return o.v;
    } catch (e) {}
    return null;
  }
  function cacheSet(k, v, ttl, partial) {
    var payload = JSON.stringify({ t: Date.now(), v: v, ttl: ttl || LIVE_TTL, partial: !!partial });
    try {
      localStorage.setItem(LS_LIVE + k, payload);
    } catch (e) {
      // 配额不足：按时间淘汰最旧的一半缓存后重试一次
      try {
        var entries = [];
        for (var i = 0; i < localStorage.length; i++) {
          var key = localStorage.key(i);
          if (key && key.indexOf(LS_LIVE) === 0) {
            var o2 = Util.store.get(key, {});
            entries.push([key, (o2 && o2.t) || 0]);
          }
        }
        entries.sort(function (a, b) { return a[1] - b[1]; });
        var drop = Math.max(1, Math.floor(entries.length / 2));
        for (var j = 0; j < drop && j < entries.length; j++) localStorage.removeItem(entries[j][0]);
        localStorage.setItem(LS_LIVE + k, payload);
      } catch (e3) { /* 彻底失败则放弃缓存（数据仍可显示，只是下次需重取） */ }
    }
  }
  function loadFav() {
    favStore = Util.store.get(FAV_KEY, {});
    if (!favStore || typeof favStore !== "object") favStore = {};
  }
  function saveFav() {
    Util.store.set(FAV_KEY, favStore);
    updateFavBadge();
  }
  function isFav(code) { return !!favStore[code]; }
  function toggleFav(f) {
    if (isFav(f.code)) delete favStore[f.code];
    else favStore[f.code] = { name: f.name, abbr: f.abbr || "", type0: f.type0 || f.ftype || "", ts: Date.now() };
    saveFav();
  }
  function updateFavBadge() {
    /* 角标实现上移至壳服务（assets/core/shell.js），自选页签未挂载时也能显示 */
    if (window.Shell && Shell.refreshFavBadge) { Shell.refreshFavBadge(); return; }
    var b = $("favBadge");
    if (b) b.textContent = Object.keys(favStore).length;
  }
  function cacheClearAll() {
    var kill = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf(LS_LIVE) === 0) kill.push(k);
    }
    kill.forEach(function (k) { localStorage.removeItem(k); });
  }

  function fetchOne(fund, force, today, cached) {
    var code = fund.code;
    if (!force) {
      // cached = 该页签 1 个月内已同步 → 本地缓存视为新鲜（40 天 TTL）
      var c = cacheGet(code, cached ? 40 * 86400 * 1000 : null);
      if (c) return Promise.resolve({ rec: c, cached: true, errors: [] });
    }
    var F10 = "https://fundf10.eastmoney.com/";
    var rec = { code: code, name: fund.name, abbr: fund.abbr };
    var errs = [];
    function p(name, v) {
      if (v.status === "fulfilled") return v.value;
      errs.push(name);
      return null;
    }
    return Promise.allSettled([
      relay(F10 + "jbgk_" + code + ".html"),
      relay(F10 + "tsdata_" + code + ".html"),
      relay(F10 + "zcpz_" + code + ".html"),
      relay(F10 + "FundArchivesDatas.aspx?type=cyrjg&code=" + code),
      relay(F10 + "FundArchivesDatas.aspx?type=jdzf&code=" + code),
      relay(F10 + "FundArchivesDatas.aspx?type=yearzf&code=" + code),
    ]).then(function (R) {
      var jbgk = p("jbgk", R[0]) ? parseJbgkHtml(R[0].value) : {};
      var tsd = p("tsdata", R[1]) ? parseTsdataHtml(R[1].value) : {};
      var zcpz = p("zcpz", R[2]) ? parseZcpzHtml(R[2].value) : {};
      var cyrjg = p("cyrjg", R[3]) ? parseCyrjgText(R[3].value) : {};
      var jdzf = p("jdzf", R[4]) ? parseJdzfText(R[4].value) : { d: {}, ranks: {} };
      var yearzf = p("yearzf", R[5]) ? parseYearzfText(R[5].value) : { ann: {}, ranks: {} };

      rec.ftype = jbgk.ftype || fund.type0 || "--";
      rec.company = jbgk.company || "--";
      rec.orgId = jbgk.orgId || null;
      rec.managerList = jbgk.managerList || null;
      rec.manager = jbgk.manager || "--";
      rec.issueDate = jbgk.issueDate || "--";
      rec.divTotal = jbgk.divTotal || "--";
      rec.divCount = jbgk.divCount || "--";
      rec.benchmark = jbgk.benchmark || "--";
      rec.track = (jbgk.track && jbgk.track !== "--") ? jbgk.track : (tsd.trackTs || "--");
      rec.mgmtFee = jbgk.mgmtFee || "--";
      rec.custFee = jbgk.custFee || "--";
      rec.salesFee = jbgk.salesFee || "--";
      rec.scale = (jbgk.scale === undefined) ? null : jbgk.scale;
      rec.scaleDate = jbgk.scaleDate || "--";
      rec.reportDate = zcpz.reportDate || "--";
      rec.stockPct = zcpz.stockPct || "--";
      rec.bondPct = zcpz.bondPct || "--";
      rec.cashPct = zcpz.cashPct || "--";
      rec.instPct = cyrjg.instPct || "--";
      rec.indivPct = cyrjg.indivPct || "--";
      ["sd1", "sd2", "sd3", "sp1", "sp2", "sp3", "ir1", "ir2", "ir3", "te", "peerTe"].forEach(function (k) {
        rec[k] = tsd[k] || "--";
      });
      rec.ytd = pctOrDash(jdzf.d["今年来"]);
      rec.m1 = pctOrDash(jdzf.d["近1月"]);
      rec.m3 = pctOrDash(jdzf.d["近3月"]);
      rec.m6 = pctOrDash(jdzf.d["近6月"]);
      rec.y1 = pctOrDash(jdzf.d["近1年"]);
      rec.y2 = pctOrDash(jdzf.d["近2年"]);
      rec.y3 = pctOrDash(jdzf.d["近3年"]);
      rec.y5 = pctOrDash(jdzf.d["近5年"]);
      rec.total = pctOrDash(jdzf.d["成立来"]);
      // 同类排名（r|t）
      rec.rankYtd = jdzf.ranks["今年来"] || yearzf.ranks[String(new Date().getFullYear())] || "--";
      rec.rankY1 = jdzf.ranks["近1年"] || "--";

      var inception = jbgk.inception || "--";
      rec.inception = inception;
      // 费用合计
      var mg = firstNumber(rec.mgmtFee), cu = firstNumber(rec.custFee), sa = firstNumber(rec.salesFee);
      rec.feeTotal = (mg !== null && cu !== null) ? (mg + cu + (sa || 0)).toFixed(2) + "%" : "--";
      // 成立年限 / 年化
      if (inception !== "--") {
        var d0 = new Date(inception + "T00:00:00Z").getTime();
        var days = Math.floor((Date.now() - d0) / 86400000);
        rec.years = days > 0 ? Math.round(days / 365.25 * 10) / 10 : null;
        var tr = firstNumber(rec.total);
        rec.annualized = (tr !== null && days > 30)
          ? ((Math.pow(1 + tr / 100, 365.25 / days) - 1) * 100).toFixed(2) + "%" : "--";
      } else { rec.years = null; rec.annualized = "--"; }

      // 早期年度涨幅（2015-2017）与近5年兜底：pingzhongdata 直连
      // onReadySync 保证在脚本执行完的同一时钟周期内读取全局变量，避免并发覆盖
      var needPz = (inception !== "--" && inception < "2018-01-01") ||
        (rec.y5 === "--" && inception !== "--" && inception <= "2021-11-15");
      var pzPromise = needPz
        ? semPz(function () {
            return scriptLoad("https://fund.eastmoney.com/pingzhongdata/" + code + ".js",
              30000, grabPingzhong);
          }).catch(function () { return null; })   // 部分后端/清盘份额无净值数据，失败不影响整条记录
        : Promise.resolve(null);
      return pzPromise.then(function (pz) {
        if (pz && pz.adj && pz.adj.length) {
          if (!rec.manager || rec.manager === "--") rec.manager = pz.manager || "--";
          var est = annualFromSeries(pz.adj, [2015, 2016, 2017]);
          [2015, 2016, 2017].forEach(function (yy) {
            var key = "y" + yy;
            if ((yearzf.ann[String(yy)] || "--") === "--" && est[String(yy)]) rec[key] = est[String(yy)];
          });
          if (rec.y5 === "--") {
            var v = periodFromSeries(pz.adj, 5 * 365.25);
            if (v) rec.y5 = v;
          }
          // 最大回撤 / 经理任期（顺手从同一次净值数据里算出）
          var m1y = mddFromSeries(pz.adj, 365.25);
          var m3y = mddFromSeries(pz.adj, 3 * 365.25);
          rec.mdd1y = m1y === null ? "--" : m1y.toFixed(2) + "%";
          rec.mdd3y = m3y === null ? "--" : m3y.toFixed(2) + "%";
          rec.tenure = pz.tenure === null || pz.tenure === undefined ? "--" : pz.tenure.toFixed(1);
          rec.tenureGain = pz.tenureGain === null || pz.tenureGain === undefined ? "--" : pz.tenureGain.toFixed(2) + "%";
          adjStore[code] = pz.adj;   // 内存保存净值链，供走势迷你图与对比图使用
        }
        // 卡玛-近3年 = 近3年年化 ÷ |近3年最大回撤|
        var y3v = firstNumber(rec.y3), m3v = firstNumber(rec.mdd3y);
        if (y3v !== null && m3v !== null && m3v !== 0) {
          var ann3 = (Math.pow(1 + y3v / 100, 1 / 3) - 1) * 100;
          rec.calmar3 = (ann3 / Math.abs(m3v)).toFixed(2);
        } else {
          rec.calmar3 = "--";
        }
        for (var yy = 2015; yy <= 2025; yy++) {
          rec["y" + yy] = yearzf.ann[String(yy)] || rec["y" + yy] || "--";
        }
        // 完整记录缓存 6 小时（1 个月同步期内视为新鲜）；残缺记录只缓存 5 分钟便于自动补齐
        cacheSet(code, rec, errs.length ? 5 * 60 * 1000 : LIVE_TTL, !!errs.length);
        return { rec: rec, cached: false, errors: errs };
      });
    });
  }

  function loadTabData(tabKey, force, onProgress) {
    var tab = null;
    TAB_GROUPS.forEach(function (g) {
      var hit = g.tabs.find(function (x) { return x.key === tabKey; });
      if (hit) tab = hit;
    });
    var gen = ++loadGen;
    var stale = function () { return gen !== loadGen || abortLoad; };
    var cached = !force && syncedRecently(tabKey);
    setProgress(2, "正在加载基金清单…");
    return loadAllFunds().then(function () {
      if (stale()) throw new Error("aborted");
      var universe = universeFor(tab);
      setProgress(6, "基金清单就绪：共 " + universe.length + " 只" + tab.meta +
        (cached ? "（1 个月内已同步，直接读取缓存）" :
          (universe.length > 600 ? "（规模较大，首次加载需要几分钟）" : "")));
      idxSeriesCache = null;
      var idxPromise = tab.kind === "index"
        ? buildIndexRow(tab, new Date())
          .catch(function () { return new Promise(function (r) { setTimeout(r, 900); }).then(function () { return buildIndexRow(tab, new Date()); }); })
          .catch(function () { return new Promise(function (r) { setTimeout(r, 2000); }).then(function () { return buildIndexRow(tab, new Date()); }); })
          .catch(function () { return null; })
        : Promise.resolve(null);
      setProgress(8, tab.kind === "index" ? "正在获取" + tab.label + "指数…" : "正在获取基金档案…");

      var done = 0, failed = 0, cachedN = 0;
      var recs = {};
      var total = universe.length;
      function runOne(f) {
        return fetchOne(f, force, new Date(), cached).then(function (r) {
          if (stale()) return;
          recs[f.code] = r.rec;
          if (r.cached) cachedN++;
          if (r.errors.length) failed++;
          done++;
          if (done % 8 === 0 || done === total) {
            setProgress(8 + 88 * done / total,
              "正在获取基金详情 " + done + "/" + total + "（缓存 " + cachedN + " · 失败 " + failed + "）");
          }
        }).catch(function () {
          if (stale()) return;
          failed++; done++;
        });
      }
      var poolSize = 8, idx = 0;
      var workers = [];
      for (var w = 0; w < poolSize; w++) {
        workers.push((function () {
          return new Promise(function (doneAll) {
            function loop() {
              if (stale()) return doneAll();
              if (idx >= total) return doneAll();
              var f = universe[idx++];
              runOne(f).then(loop, loop);
            }
            loop();
          });
        })());
      }
      return Promise.all([Promise.all(workers), idxPromise]).then(function (results) {
        if (stale()) throw new Error("aborted");
        // 补漏：第一轮整体失败的基金，顺序温和重试一次
        var missing = universe.filter(function (f) { return !recs[f.code]; });
        if (missing.length && !stale()) {
          setProgress(94, "补齐失败基金 " + missing.length + " 只…");
          var chain = Promise.resolve();
          missing.forEach(function (f) {
            chain = chain.then(function () { return runOne(f); });
          });
          return chain.then(function () { return [results]; });
        }
        return [results];
      }).then(function (results) {
        if (stale()) throw new Error("aborted");
        var resultsArr = results[0];
        var rows = [];
        for (var i = 0; i < universe.length; i++) {
          var r = recs[universe[i].code];
          if (r) rows.push(r);
        }
        // 总规模 = 同族份额合计
        var famSum = {};
        rows.forEach(function (r) {
          if (r.scale) {
            var k = familyKey(r.name);
            famSum[k] = (famSum[k] || 0) + r.scale;
          }
        });
        rows.forEach(function (r) { r.familyScale = Math.round((famSum[familyKey(r.name)] || 0) * 100) / 100; });
        var idxRow = resultsArr[1];
        if (idxRow) rows.unshift(idxRow);
        if (!failed || rows.length > universe.length * 0.8) markSynced(tabKey);
        return { rows: rows, failed: failed, universe: universe, cached: cached };
      });
    });
  }

  /* —— 二阶段补充：后台逐批拉取净值详情，计算最大回撤 / 卡玛 / 经理任期 —— */
  var enrichState = null;
  function enrichTab(tabKey, myGen, skip) {
    var td = tabData[tabKey];
    if (!td) return;
    var todo = td.funds.filter(function (r) {
      return !r.__isIndex && (r.mdd1y === undefined || r.mdd1y === null || r.mdd1y === "--" || (!skip && !adjStore[r.code]));
    });
    if (!todo.length) return;
    enrichState = { tab: tabKey, total: todo.length, done: 0 };
    setModeChip();
    var byCode = {};
    td.funds.forEach(function (r) { byCode[r.code] = r; });
    var i = 0;
    function loop() {
      if (myGen !== loadGen || abortLoad) return;
      gateWait().then(function () {
        if (myGen !== loadGen || abortLoad) return;
        step2();
      });
    }
    function step2() {
      if (myGen !== loadGen || abortLoad) return;
      if (i >= todo.length) {
        enrichState = null;
        if (activeTab.key === tabKey) setModeChip();
        return;
      }
      var fund = todo[i++];
      semPz(function () {
        return scriptLoad("https://fund.eastmoney.com/pingzhongdata/" + fund.code + ".js",
          30000, grabPingzhong);
      }).catch(function () { return null; }).then(function (pz) {
        if (myGen !== loadGen || abortLoad) return;
        var rec = byCode[fund.code];
        if (pz && pz.adj && pz.adj.length && rec) {
          var m1y = mddFromSeries(pz.adj, 365.25);
          var m3y = mddFromSeries(pz.adj, 3 * 365.25);
          rec.mdd1y = m1y === null ? "--" : m1y.toFixed(2) + "%";
          rec.mdd3y = m3y === null ? "--" : m3y.toFixed(2) + "%";
          rec.tenure = pz.tenure === null || pz.tenure === undefined ? "--" : pz.tenure.toFixed(1);
          rec.tenureGain = pz.tenureGain === null || pz.tenureGain === undefined ? "--" : pz.tenureGain.toFixed(2) + "%";
          var y3v = firstNumber(rec.y3), m3v = firstNumber(rec.mdd3y);
          rec.calmar3 = (y3v !== null && m3v !== null && m3v !== 0)
            ? (((Math.pow(1 + y3v / 100, 1 / 3) - 1) * 100) / Math.abs(m3v)).toFixed(2) : "--";
          var est = annualFromSeries(pz.adj, [2015, 2016, 2017]);
          [2015, 2016, 2017].forEach(function (yy) {
            if ((rec["y" + yy] || "--") === "--" && est[String(yy)]) rec["y" + yy] = est[String(yy)];
          });
          if (rec.y5 === "--") {
            var v = periodFromSeries(pz.adj, 5 * 365.25);
            if (v) rec.y5 = v;
          }
          adjStore[fund.code] = pz.adj;   // 内存保存净值链（走势图用）
          cacheSet(fund.code, rec, LIVE_TTL);
        }
        enrichState.done = i;
        if (activeTab.key === tabKey && (i % 25 === 0 || i === todo.length)) {
          setModeChip();
          pendingAnim = false;
          updateVirtualWindow(true);
        }
      }).then(loop, loop);
    }
    loop();
  }

  /* ══════════ 7. 列可见性（分组勾选） ══════════ */
  function loadVisible() {
    var saved = Util.store.get(STORE_KEY, null);
    ALL_COLS.forEach(function (c) { visible[c.key] = true; });
    if (saved && typeof saved === "object") {
      ALL_COLS.forEach(function (c) { if (c.key in saved) visible[c.key] = !!saved[c.key]; });
    }
  }
  function saveVisible() {
    var o = {};
    ALL_COLS.forEach(function (c) { o[c.key] = visible[c.key]; });
    Util.store.set(STORE_KEY, o);
  }
  function visibleCols() {
    var out = [];
    GROUPS.forEach(function (g) {
      g.cols.forEach(function (c) { if (visible[c.key]) out.push(c); });
    });
    return out;
  }
  function renderChecks() {
    var host = $("colChecks");
    var html = '<span class="chk-group master"><label class="chk master" data-master>' +
      '<input type="checkbox" id="chkAll"><span class="box"></span>全选</label>' +
      '<span class="chk-hint">点击组名可整组开关 · 勾选项决定表格列</span></span>';
    GROUPS.forEach(function (g) {
      html += '<span class="chk-group"><span class="chk-group-name" data-group="' + g.key + '" title="点击整组开关">' + esc(g.label) + '</span>';
      g.cols.forEach(function (c) {
        html += '<label class="chk"><input type="checkbox" data-col="' + c.key + '"' +
          (visible[c.key] ? " checked" : "") + '><span class="box"></span>' + esc(c.label) + "</label>";
      });
      html += "</span>";
    });
    host.innerHTML = html;
    var master = host.querySelector("[data-master] input");
    master.addEventListener("change", function () {
      var on = master.checked;
      host.querySelectorAll("input[data-col]").forEach(function (cb) {
        cb.checked = on;
        visible[cb.getAttribute("data-col")] = on;
      });
      saveVisible(); renderAll();
    });
    host.addEventListener("change", function (ev) {
      var t = ev.target;
      if (t && t.hasAttribute && t.hasAttribute("data-col")) {
        visible[t.getAttribute("data-col")] = t.checked;
        syncMaster(); saveVisible(); renderAll();
      }
    });
    host.addEventListener("click", function (ev) {
      var g = ev.target.closest(".chk-group-name");
      if (!g) return;
      var group = GROUPS.find(function (x) { return x.key === g.getAttribute("data-group"); });
      if (!group) return;
      var anyOff = group.cols.some(function (c) { return !visible[c.key]; });
      group.cols.forEach(function (c) { visible[c.key] = anyOff; });
      saveVisible(); renderChecks(); renderAll();
    });
    syncMaster();
  }
  function syncMaster() {
    var all = ALL_COLS.every(function (c) { return visible[c.key]; });
    var none = ALL_COLS.every(function (c) { return !visible[c.key]; });
    var m = $("chkAll");
    if (m) { m.checked = all; m.indeterminate = !all && !none; }
    var nVis = ALL_COLS.filter(function (c) { return visible[c.key]; }).length;
    var cnt = $("colsCount");
    if (cnt) cnt.textContent = none ? "未选列" : (all ? ALL_COLS.length + " 列全选" : "已选 " + nVis + "/" + ALL_COLS.length + " 列");
  }

  /* ══════════ 8. 筛选引擎 ══════════ */
  function kwMatch(f) {
    var kw = keyword.trim().toLowerCase();
    if (!kw) return true;
    var hay = (f.name + " " + f.code + " " + (f.abbr || "") + " " +
      (f.manager || "") + " " + (f.company || "") + " " + (f.ftype || "")).toLowerCase();
    return hay.indexOf(kw) >= 0;
  }
  function filterActive(f) {
    return f && (f.kw || f.min !== null && f.min !== undefined ||
      f.max !== null && f.max !== undefined || f.top10 || f.above || f.below);
  }
  function rangePass(v, f, col) {
    if (col.dtype === "date") {
      var s = String(v === undefined || v === null ? "" : v);
      if (s === "--" || s === "") return false;
      if (f.min !== null && f.min !== undefined && s < f.min) return false;
      if (f.max !== null && f.max !== undefined && s > f.max) return false;
      return true;
    }
    var n = parseNum(v);
    if (n === null) return false;
    if (f.min !== null && f.min !== undefined && n < f.min) return false;
    if (f.max !== null && f.max !== undefined && n > f.max) return false;
    return true;
  }
  // excludeKey: 计算统计/命中数时排除某列自身的筛选
  function applyPipeline(excludeKey) {
    var rows = funds.filter(kwMatch);
    if (coFilter) rows = rows.filter(function (r) { return r.company === coFilter; });
    Object.keys(filters).forEach(function (key) {
      if (key === excludeKey) return;
      var f = filters[key];
      if (!filterActive(f)) return;
      var col = COL_BY_KEY[key];
      rows = rows.filter(function (r) {
        if (f.kw) {
          var hay = String(r[key] === undefined || r[key] === null ? "" : r[key]).toLowerCase();
          if (hay.indexOf(f.kw) < 0) return false;
        }
        if ((f.min !== null && f.min !== undefined) || (f.max !== null && f.max !== undefined)) {
          if (!rangePass(r[key], f, col)) return false;
        }
        return true;
      });
    });
    // 快捷筛选：按列顺序依次应用
    GROUPS.forEach(function (g) {
      g.cols.forEach(function (c) {
        if (c.key === excludeKey) return;
        var f = filters[c.key];
        if (!f || !(f.top10 || f.above || f.below)) return;
        if (f.top10) {
          var arr = rows.map(function (r, i) { return { i: i, n: parseNum(r[c.key]) }; })
            .filter(function (o) { return o.n !== null; })
            .sort(function (a, b) { return b.n - a.n; })
            .slice(0, 10);
          var keep = {};
          arr.forEach(function (o) { keep[o.i] = 1; });
          rows = rows.filter(function (r, i) { return keep[i]; });
        } else {
          var nums = rows.map(function (r) { return parseNum(r[c.key]); }).filter(function (n) { return n !== null; });
          if (!nums.length) { rows = []; return; }
          var mean = nums.reduce(function (a, b) { return a + b; }, 0) / nums.length;
          rows = rows.filter(function (r) {
            var n = parseNum(r[c.key]);
            if (n === null) return false;
            return f.above ? n >= mean : n < mean;
          });
        }
      });
    });
    return rows;
  }
  function statsFor(key, includeOwn) {
    var rows = applyPipeline(includeOwn ? null : key);
    var col = COL_BY_KEY[key];
    if (!col) return null;
    var nums = rows.map(function (r) { return parseNum(r[key]); }).filter(function (n) { return n !== null; });
    var mean = nums.length ? nums.reduce(function (a, b) { return a + b; }, 0) / nums.length : null;
    return { mean: mean, valid: nums.length, rows: rows.length };
  }

  /* ══════════ 9. 表头筛选弹窗 ══════════ */
  var popKey = null;
  function openFilter(key, anchor) {
    popKey = key;
    var col = COL_BY_KEY[key];
    $("fpTitle").textContent = "筛选 · " + col.label;
    var isNum = !!col.num && !col.dtype;
    var isDate = col.dtype === "date";
    $("fpQuick").style.display = isNum ? "flex" : "none";
    $("fpStats").style.display = isNum ? "block" : "none";
    $("fpRange").style.display = (isNum || isDate) ? "flex" : "none";
    $("fpContains").style.display = (col.text && !isDate) ? "flex" : "none";
    $("fpMin").type = isNum ? "number" : "text";
    $("fpMax").type = isNum ? "number" : "text";
    if (isDate) { $("fpMin").placeholder = "如 2015-01-01"; $("fpMax").placeholder = "如 2020-12-31"; }
    else { $("fpMin").placeholder = ""; $("fpMax").placeholder = ""; }
    var f = filters[key] || {};
    $("fpMin").value = f.min !== null && f.min !== undefined ? f.min : "";
    $("fpMax").value = f.max !== null && f.max !== undefined ? f.max : "";
    $("fpKw").value = f.kw || "";
    $("fpQuick").querySelector('[data-q="top10"]').classList.toggle("on", !!f.top10);
    $("fpQuick").querySelector('[data-q="above"]').classList.toggle("on", !!f.above);
    $("fpQuick").querySelector('[data-q="below"]').classList.toggle("on", !!f.below);
    refreshPopStats();
    pop.hidden = false;
    var rect = anchor.getBoundingClientRect();
    var left = Math.max(8, Math.min(rect.left - 40, window.innerWidth - 346));
    var top = rect.bottom + 8;
    if (top + 260 > window.innerHeight) top = Math.max(8, rect.top - 262);
    pop.style.left = left + "px";
    pop.style.top = top + "px";
    if (isNum) $("fpMin").focus(); else if (col.text && !isDate) $("fpKw").focus();
  }
  function refreshPopStats() {
    if (!popKey) return;
    var st = statsFor(popKey, false);   // 统计口径：排除本列筛选
    var stAll = statsFor(popKey, true); // 命中口径：包含本列筛选
    var col = COL_BY_KEY[popKey];
    var f = filters[popKey] || {};
    if (col.num && !col.dtype) {
      $("fpStats").innerHTML = st && st.mean !== null
        ? '平均 <b>' + st.mean.toFixed(2) + "</b> · " + st.valid + " 个有效值"
        : "暂无有效数值";
    }
    $("fpHit").textContent = stAll ? "命中 " + stAll.rows + " 只" : "";
    var active = filterActive(f);
    $("fpClear").disabled = !active;
  }
  function closePop() { pop.hidden = true; popKey = null; }
  function setFilter(key, patch) {
    var f = filters[key] || {};
    var nf = {
      min: "min" in patch ? patch.min : (f.min !== undefined ? f.min : null),
      max: "max" in patch ? patch.max : (f.max !== undefined ? f.max : null),
      kw: "kw" in patch ? patch.kw : (f.kw || ""),
      top10: "top10" in patch ? patch.top10 : !!f.top10,
      above: "above" in patch ? patch.above : !!f.above,
      below: "below" in patch ? patch.below : !!f.below,
    };
    if (filterActive(nf)) filters[key] = nf; else delete filters[key];
    renderAll({ resetScroll: true });
    refreshPopStats();
  }
  function initPop() {
    $("fpClose").addEventListener("click", closePop);
    $("fpClear").addEventListener("click", function () {
      if (popKey) { delete filters[popKey]; renderAll({ resetScroll: true }); refreshPopStats(); }
    });
    pop.addEventListener("click", function (ev) { ev.stopPropagation(); });
    $("fpQuick").addEventListener("click", function (ev) {
      var b = ev.target.closest("button");
      if (!b || !popKey) return;
      var q = b.getAttribute("data-q");
      var f = filters[popKey] || {};
      var patch = {};
      patch[q] = !f[q];
      setFilter(popKey, patch);
    });
    var debounced = debounce(function () {
      if (!popKey) return;
      var col = COL_BY_KEY[popKey];
      var patch = {};
      if ((col.num && !col.dtype) || col.dtype === "date") {
        patch.min = $("fpMin").value.trim() === "" ? null : $("fpMin").value.trim();
        patch.max = $("fpMax").value.trim() === "" ? null : $("fpMax").value.trim();
      }
      if (col.text && !col.dtype) {
        patch.kw = $("fpKw").value.trim().toLowerCase();
      }
      setFilter(popKey, patch);
    }, 280);
    $("fpMin").addEventListener("input", debounced);
    $("fpMax").addEventListener("input", debounced);
    $("fpKw").addEventListener("input", debounced);
    $("fpMin").addEventListener("keydown", function (e) { if (e.key === "Enter") debounced.flush && debounced.flush(); });
    var sp = $("statPop");
    sp.addEventListener("mouseenter", function () { clearTimeout(statHideT); });
    sp.addEventListener("mouseleave", function () { $("statPop").hidden = true; });
    document.addEventListener("mousedown", function (ev) {
      if (!pop.hidden && !pop.contains(ev.target)) closePop();
      var cpop = $("coPop");
      if (cpop && !cpop.hidden && !cpop.contains(ev.target) && !ev.target.closest("#coBtn")) cpop.hidden = true;
      if (!sp.hidden && !sp.contains(ev.target) && !ev.target.closest(".fund-table th")) sp.hidden = true;
      var cp = $("colsPop");
      if (cp && !cp.hidden && !cp.contains(ev.target) && !ev.target.closest("#btnCols")) {
        cp.hidden = true;
        $("btnCols").classList.remove("open");
      }
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") {
        if (!$("cmpVeil").hidden) closeCompare();
        if (!$("chartVeil").hidden) closeChart();
        if (!pop.hidden) closePop();
        var cp = $("colsPop");
        if (cp && !cp.hidden) { cp.hidden = true; $("btnCols").classList.remove("open"); }
      }
    });
  }

  /* ══════════ 10. 排序与渲染 ══════════ */
  function applySort(rows) {
    if (!sortState) return rows;
    var col = COL_BY_KEY[sortState.key];
    var numeric = col ? !col.text : false;
    var sorted = rows.slice().sort(function (a, b) {
      var va = a[sortState.key], vb = b[sortState.key];
      if (numeric) {
        var na = parseNum(va), nb = parseNum(vb);
        if (na === null && nb === null) return 0;
        if (na === null) return 1;
        if (nb === null) return -1;
        return (na - nb) * sortState.dir;
      }
      va = (va === "--" || va === null || va === undefined) ? "" : String(va);
      vb = (vb === "--" || vb === null || vb === undefined) ? "" : String(vb);
      if (!va && !vb) return 0;
      if (!va) return 1;
      if (!vb) return -1;
      return va.localeCompare(vb, "zh") * sortState.dir;
    });
    return sorted;
  }

  function renderHeader() {
    var cols = visibleCols();
    var html = '<tr class="group-row"><th class="corner num-th" rowspan="2" style="left:0;width:46px;min-width:46px">序号</th>' +
      '<th class="corner cmp-head" rowspan="2" style="left:46px;width:40px;min-width:40px">对比</th>';
    GROUPS.forEach(function (g) {
      var cnt = 0;
      g.cols.forEach(function (c) { if (visible[c.key]) cnt++; });
      if (cnt) html += '<th class="group-th" colspan="' + cnt + '">' + esc(g.label) + "</th>";
    });
    html += "</tr><tr class=\"col-row\">";
    var left = 86;
    cols.forEach(function (c) {
      var sticky = (c.key === "code" || c.key === "name");
      html += '<th data-key="' + c.key + '" class="' + (c.num ? "num " : "") + (sticky ? "sticky-col" : "") +
        (filters[c.key] ? " filtered" : "") + '"' +
        ' style="width:' + c.w + "px;min-width:" + c.w + "px" +
        (sticky ? ";left:" + left + "px" : "") + '"' +
        ">" + esc(c.label) +
        '<span class="arrow"></span>' +
        '<span class="flt" data-flt="' + c.key + '" title="筛选此列">' + FUNNEL + '</span>' +
        '<span class="info-ico" data-info="' + c.key + '" title="指标说明">?</span></th>';
      if (sticky) left += c.w;
    });
    html += "</tr>";
    thead.innerHTML = html;
    // 列宽定义（table-layout:fixed 依赖 colgroup 保证对齐，与虚拟滚动 spacer 行兼容）
    var totalW = 86 + cols.reduce(function (s, c) { return s + c.w; }, 0);
    var cg = '<colgroup><col style="width:46px;min-width:46px"><col style="width:40px;min-width:40px">';
    cols.forEach(function (c) { cg += '<col style="width:' + c.w + 'px;min-width:' + c.w + 'px">'; });
    cg += "</colgroup>";
    var ft = $("fundTable");
    var old = ft.querySelector("colgroup");
    if (old) old.remove();
    ft.insertAdjacentHTML("afterbegin", cg);
    ft.style.width = Math.max(totalW, scrollBox.clientWidth - 2) + "px";
    currentHeadH = thead.offsetHeight;
    thead.querySelectorAll("th[data-key]").forEach(function (th) {
      var key = th.getAttribute("data-key");
      if (sortState && sortState.key === key) {
        th.classList.add("sorted");
        th.querySelector(".arrow").textContent = sortState.dir === -1 ? "▼" : "▲";
      } else {
        th.querySelector(".arrow").textContent = "▾";
      }
      th.addEventListener("click", function (ev) {
        if (ev.target.closest(".flt") || ev.target.closest(".info-ico")) return;
        if (!sortState || sortState.key !== key) sortState = { key: key, dir: -1 };
        else if (sortState.dir === -1) sortState.dir = 1;
        else sortState = null;
        renderAll({ resetScroll: true });
      });
      var flt = th.querySelector(".flt");
      flt.addEventListener("click", function (ev) {
        ev.stopPropagation();
        if (popKey === key && !pop.hidden) { closePop(); return; }
        openFilter(key, th);
      });
      th.addEventListener("mouseenter", function () {
        clearTimeout(statHideT);
        clearTimeout(statShowT);
        statShowT = setTimeout(function () { showStatPop(key, th); }, 240);
      });
      th.addEventListener("mouseleave", function () {
        clearTimeout(statShowT);
        statHideT = setTimeout(function () { $("statPop").hidden = true; }, 220);
      });
    });
  }

  /* —— 表头指标说明卡（第一性原理） —— */
  var statShowT = null, statHideT = null;
  function showStatPop(key, anchor) {
    var col = COL_BY_KEY[key];
    if (!col || !col.s) { $("statPop").hidden = true; return; }
    var st = col.s;
    var dir = st.b === "high" ? '<span class="dir dir-high">▲ 越高越好</span>'
      : st.b === "low" ? '<span class="dir dir-low">▼ 越低越好</span>'
      : '<span class="dir dir-na">◆ 无绝对好坏</span>';
    var html = '<div class="sp-head"><b>' + esc(col.label) + '</b><span class="sp-close">×</span></div>'
      + '<div class="sp-def">' + esc(st.d) + '</div>'
      + '<div class="sp-f"><b>怎么算：</b>' + esc(st.f) + '</div>'
      + '<div class="sp-dir">' + dir + '</div>'
      + (st.h ? '<div class="sp-h"><b>偏高说明：</b>' + esc(st.h) + '</div>' : '')
      + (st.l ? '<div class="sp-l"><b>偏低说明：</b>' + esc(st.l) + '</div>' : '');
    var sp = $("statPop");
    sp.innerHTML = html;
    sp.hidden = false;
    sp.querySelector(".sp-close").addEventListener("click", function () { sp.hidden = true; });
    var rect = anchor.getBoundingClientRect();
    var left = Math.max(8, Math.min(rect.left - 30, window.innerWidth - 416));
    var top = rect.bottom + 8;
    if (top + 320 > window.innerHeight) top = Math.max(8, rect.top - 330);
    sp.style.left = left + "px";
    sp.style.top = top + "px";
  }

  /* —— 虚拟滚动：只渲染可视窗口内的行（行高固定，上下用 spacer 行占位） —— */
  var virtual = { start: 0, end: 0 };
  var measuredRowH = 34;
  var currentHeadH = 62;
  var pendingAnim = false;

  function rowHeight() {
    return measuredRowH || (document.body.classList.contains("dense") ? 26 : 34);
  }

  function sparkSVG(adj, days) {
    var last = adj[adj.length - 1];
    var t0 = last[0] - days * 86400 * 1000;
    var pts = [], i;
    for (i = 0; i < adj.length; i++) {
      if (adj[i][0] >= t0) pts.push(adj[i]);
    }
    if (pts.length < 2) return '<svg class="sparksvg" width="84" height="24"></svg>';
    var W = 84, H = 24, P = 2;
    var mn = Infinity, mx = -Infinity;
    for (i = 0; i < pts.length; i++) {
      if (pts[i][1] < mn) mn = pts[i][1];
      if (pts[i][1] > mx) mx = pts[i][1];
    }
    var span = (mx - mn) || 1;
    var d = "";
    for (i = 0; i < pts.length; i++) {
      var x = P + (W - 2 * P) * i / (pts.length - 1);
      var y = H - P - (H - 2 * P) * (pts[i][1] - mn) / span;
      d += (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
    }
    var up = pts[pts.length - 1][1] >= pts[0][1];
    var col = up ? "#0ba14e" : "#B85C5C";
    return '<svg class="sparksvg" width="' + W + '" height="' + H + '"><path d="' + d +
      '" fill="none" stroke="' + col + '" stroke-width="1.4"/></svg>';
  }

  var goodOn = true;
  var goodMarks = {};
  var adjStore = {};      // code -> 复权净值链（仅内存，不落盘）
  var idxSeriesCache = null;  // 指数日K序列（供对比图）
  function colMetric(col, f) {
    var v = f[col.key];
    if (v === null || v === undefined) return null;
    var sv = String(v);
    if (col.rank) {
      var m = sv.match(/^\s*(\d+)\s*\|\s*(\d+)/);
      if (!m || !+m[2]) return null;
      return (+m[1]) / (+m[2]) * 100;  // 百分位，越小越好
    }
    return parseNum(v);
  }
  var GOOD_RULES = {
    mgmtFee: { op: "<=", v: 0.5 },
    feeTotal: { op: "<=", v: 0.5 },
    sp1: { op: ">=", v: 1 },
    sp2: { op: ">=", v: 1 },
    sp3: { op: ">=", v: 1 },
    calmar3: { op: ">=", v: 1 },
    mdd1y: { op: ">=", v: -10 },
    mdd3y: { op: ">=", v: -10 },
    scale: { op: ">=", v: 2 },
    tenure: { op: ">=", v: 3 },
    rankY1: { op: "<=", v: 20 },
    rankYtd: { op: "<=", v: 20 },
  };
  function computeGoodMarks() {
    goodMarks = {};
    if (!goodOn) return;
    ALL_COLS.forEach(function (col) {
      var st = col.s;
      if (!st || !st.b || st.b === "na") return;
      if (!col.num && !col.rank) return;
      var vals = [];
      for (var i = 0; i < filteredRows.length; i++) {
        var v = colMetric(col, filteredRows[i]);
        if (v !== null && !isNaN(v)) vals.push(v);
      }
      if (vals.length < 10) return;
      var rule = GOOD_RULES[col.key] || null;
      var best = (st.b === "high") ? Math.max.apply(null, vals) : Math.min.apply(null, vals);
      if (rule) {
        goodMarks[col.key] = { b: st.b, rule: rule, best: best };
        return;
      }
      vals.sort(function (a, b) { return a - b; });
      // 分位回退：高好取 P75（优于前 25%），低好取 P25
      var th = (st.b === "high") ? vals[Math.floor(vals.length * 0.75)] : vals[Math.floor(vals.length * 0.25)];
      goodMarks[col.key] = { b: st.b, th: th, best: best };
    });
  }

  function rowHtml(f, i, cols, codeW) {
    var colorize = document.body.classList.contains("colorize");
    var pctCols = { ytd: 1, total: 1, annualized: 1, m1: 1, m3: 1, m6: 1, y1: 1, y2: 1, y3: 1, y5: 1 };
    YEAR_COLS.forEach(function (c) { pctCols[c.key] = 1; });
    var html = ["<tr>"];
    html.push('<td class="sticky-col dim" style="left:0;width:46px;min-width:46px">' + (i + 1) + "</td>");
    // 对比勾选（结构列）
    var cmpOn = cmpSel.indexOf(f.code) >= 0;
    html.push('<td class="sticky-col cmp-cell" style="left:46px;width:40px;min-width:40px">' +
      '<input type="checkbox" class="cmp-chk" data-cmp="' + f.code + '"' + (cmpOn ? " checked" : "") +
      (cmpOn || cmpSel.length < CMP_MAX ? "" : " disabled") + ' title="加入对比（最多' + CMP_MAX + '只）"></td>');
    cols.forEach(function (c) {
      var v = f[c.key];
      var sticky = (c.key === "code" || c.key === "name");
      var cls = c.num ? "num" : "";
      if (f.__isIndex) cls += " idx-row";
      if (sticky) cls += " sticky-col";
      if (c.key === "name") cls += " name";
      var cmpLeft = 86;
      var style = sticky ? ' style="left:' + (c.key === "code" ? cmpLeft : cmpLeft + codeW) + 'px"' : "";
      // 星标（收藏）
      var star = "";
      var text = (v === null || v === undefined || v === "") ? "--" : v;
      if (c.key === "name") {
        var fav = isFav(f.code);
        star = '<span class="fav-star' + (fav ? " on" : "") + '" data-fav="' + f.code +
          '" title="' + (fav ? "移出自选" : "加入我的自选") + '">' + (fav ? "★" : "☆") + '</span>';
      }
      var dim = (text === "--") ? " dim" : "";
      var extra = "";
      if (colorize && pctCols[c.key]) {
        var n = parseNum(v);
        if (n !== null && n > 0) extra = " up";
        else if (n !== null && n < 0) extra = " down";
      }
      var gm = goodMarks[c.key];
      if (gm) {
        var mv = colMetric(c, f);
        if (mv !== null && !isNaN(mv)) {
          var isGood = gm.rule
            ? (gm.rule.op === ">=" ? mv >= gm.rule.v : mv <= gm.rule.v)
            : (gm.b === "high" ? mv > gm.th : mv < gm.th);
          if (isGood) extra += " good";
          if (mv === gm.best) extra += " best";
        }
      }
      // 走势迷你图：点击弹出与指数对比的大图
      if (c.key === "spark") {
        var adj = adjStore[f.code];
        if (adj && adj.length > 10) {
          html.push('<td class="' + cls + '"' + style + '><span class="spark" data-code="' + f.code +
            '" title="点击查看业绩走势对比图">' + sparkSVG(adj, 365) + '</span></td>');
        } else {
          html.push('<td class="' + cls + dim + '"' + style + '><span class="spark-wait">…</span></td>');
        }
        return;
      }
      // 简称 → 基金详情页链接 + 公司色点
      if (c.key === "name" && text !== "--") {
        html.push('<td class="' + cls + '" style="left:' + (cmpLeft + codeW) + 'px">' + star +
          '<span class="co-dot" style="background:' + coColor(f.company) + '" title="' + esc(f.company || "") + '"></span>' +
          '<a class="flink" href="https://fund.eastmoney.com/' + encodeURIComponent(f.code) + '.html" target="_blank" rel="noopener" title="打开基金页">' + esc(text) + '</a></td>');
        return;
      }
      // 经理 → 经理主页链接
      if (c.key === "manager" && f.managerList && f.managerList.length && text !== "--") {
        var links = f.managerList.map(function (m) {
          return '<a class="flink" href="https://fund.eastmoney.com/manager/' + encodeURIComponent(m.id) +
            '.html" target="_blank" rel="noopener" title="打开经理主页">' + esc(m.name) + '</a>';
        }).join("、");
        html.push("<td" + (cls ? ' class="' + cls + '"' : ' class="' + dim + '"') + style + ">" + links + "</td>");
        return;
      }
      // 管理人 → 公司主题色文字
      if (c.key === "company" && text !== "--") {
        html.push('<td class="' + cls + dim + extra + '" style="color:' + coColor(f.company) + ';font-weight:500">' + esc(text) + '</td>');
        return;
      }
      html.push("<td" + (cls ? ' class="' + cls + dim + extra + '"' : ' class="' + dim + '"') + style + ">" + esc(text) + "</td>");
    });
    html.push("</tr>");
    return html.join("");
  }

  function renderBodySlice(animate) {
    var cols = visibleCols();
    var codeW = 0;
    cols.forEach(function (c) { if (c.key === "code") codeW = c.w; });
    var total = filteredRows.length;
    var loading = dataMode === "loading";
    var html = [];
    if (loading && total === 0) {
      // 骨架屏：数据加载中的占位行
      var n = Math.max(8, Math.min(20, Math.ceil((scrollBox.clientHeight - 80) / rowHeight())));
      for (var r = 0; r < n; r++) {
        html.push('<tr class="skel"><td class="sticky-col" style="left:0;width:46px;min-width:46px"><span class="skel-bar" style="width:55%"></span></td>' +
          '<td class="sticky-col" style="left:46px;width:40px;min-width:40px"><span class="skel-bar" style="width:50%"></span></td>');
        cols.forEach(function (c, ci) {
          var sticky = (c.key === "code" || c.key === "name");
          var style = sticky ? ' style="left:' + (c.key === "code" ? 46 : 46 + codeW) + 'px"' : "";
          html.push('<td' + (sticky ? ' class="sticky-col"' : "") + style + '><span class="skel-bar" style="width:' + (40 + ((r * 17 + ci * 11) % 45)) + '%"></span></td>');
        });
        html.push("</tr>");
      }
      tbody.innerHTML = html.join("");
      tbody.classList.remove("anim");
      var tip = $("emptyTip");
      tip.hidden = true;
      return;
    }
    var start = Math.min(virtual.start, Math.max(0, total - 1));
    var end = Math.min(virtual.end, total);
    if (start < 0 || start >= end) { start = 0; end = Math.min(total, 20); }
    if (start > 0) {
      html.push('<tr class="vspacer"><td colspan="' + (cols.length + 2) + '" style="height:' + (start * rowHeight()) + 'px;padding:0;border:none"></td></tr>');
    }
    for (var i = start; i < end; i++) {
      html.push(rowHtml(filteredRows[i], i, cols, codeW));
    }
    if (end < total) {
      html.push('<tr class="vspacer"><td colspan="' + (cols.length + 2) + '" style="height:' + ((total - end) * rowHeight()) + 'px;padding:0;border:none"></td></tr>');
    }
    tbody.innerHTML = html.join("");
    tbody.classList.toggle("anim", !!animate);
    // 实测行高，供虚拟窗口计算使用
    var tr = tbody.querySelector("tr:not(.vspacer):not(.skel)");
    if (tr && tr.offsetHeight > 10) measuredRowH = tr.offsetHeight;
    var tip = $("emptyTip");
    tip.hidden = total > 0;
    tip.textContent = keyword ? ("无匹配基金（关键词：" + keyword + "）") : "暂无数据";
    renderCmpBar();
    // 月度同步期内净值序列按需补取：仅当前可视窗口内缺失的基金，取完刷新一次切片
    if ((dataMode === "live" || dataMode === "snapshot") && total > 0) {
      var need = [];
      for (var vi = start; vi < end; vi++) {
        var rf = filteredRows[vi];
        if (rf && !rf.__isIndex && !adjStore[rf.code] && !seriesPending[rf.code]) need.push(rf.code);
      }
      if (need.length) {
        ensureSeries(need, function () {
          if (dataMode === "live" || dataMode === "snapshot") renderBodySlice(false);
        });
      }
    }
  }

  function renderCmpBar() {
    var bar = $("cmpBar");
    if (!bar) return;
    var n = cmpSel.length;
    bar.hidden = n === 0;
    $("cmpCount").textContent = n;
    $("cmpGo").disabled = n < 2;
  }
  function renderCmpBarNames() {
    var host = $("cmpNames");
    if (!host) return;
    host.innerHTML = cmpSel.map(function (c) {
      var f = funds.find(function (x) { return x.code === c; });
      var nm = f ? f.name : c;
      return '<span class="cmp-name">' + esc(nm) + '<span class="cmp-x" data-x="' + c + '">×</span></span>';
    }).join("");
  }
  function toggleCmp(code) {
    var i = cmpSel.indexOf(code);
    if (i >= 0) cmpSel.splice(i, 1);
    else if (cmpSel.length < CMP_MAX) cmpSel.push(code);
    renderCmpBar();
    renderCmpBarNames();
  }

  function updateVirtualWindow(force) {
    var total = filteredRows.length;
    var st = scrollBox.scrollTop, vh = scrollBox.clientHeight;
    var rowH = rowHeight();
    var first = Math.max(0, Math.floor((st - currentHeadH) / rowH) - 6);
    var last = Math.min(total, Math.ceil((st + vh - currentHeadH) / rowH) + 8);
    if (force || first !== virtual.start || last !== virtual.end) {
      virtual.start = first;
      virtual.end = last;
      renderBodySlice(pendingAnim);
      pendingAnim = false;
    }
  }

  function renderAll(opts) {
    opts = opts || {};
    filteredRows = applySort(applyPipeline(null));
    computeGoodMarks();
    renderHeader();
    if (opts.resetScroll) scrollBox.scrollTop = 0;
    pendingAnim = true;
    updateVirtualWindow(true);
    var note = $("filteredNote");
    var nActive = Object.keys(filters).filter(function (k) { return filterActive(filters[k]); }).length;
    note.textContent = (keyword || nActive || coFilter)
      ? "　筛选出 " + filteredRows.length + " 只" + (nActive ? "（" + nActive + " 个列筛选生效）" : "") +
        (coFilter ? " · 公司 " + coFilter.replace(/基金$/, "") : "")
      : "";
  }

  /* ══════════ 10.5 业绩走势对比图 ══════════ */
  var chartState = null;

  function pctSeries(series, days) {
    if (!series || !series.length) return null;
    var last = series[series.length - 1];
    var t0 = days > 0 ? last[0] - days * 86400 * 1000 : series[0][0];
    var pts = [];
    for (var i = 0; i < series.length; i++) {
      if (series[i][0] >= t0) pts.push([series[i][0], series[i][1]]);
    }
    if (pts.length < 2) return null;
    var base = pts[0][1];
    var out = [];
    var stepv = Math.max(1, Math.floor(pts.length / 360));
    for (var k = 0; k < pts.length; k += stepv) {
      out.push([pts[k][0], (pts[k][1] / base - 1) * 100]);
    }
    var lastP = [last[0], (last[1] / base - 1) * 100];
    if (out[out.length - 1][0] !== lastP[0]) out.push(lastP);
    return out;
  }

  function winMdd(series, days) {
    if (!series || !series.length) return null;
    var last = series[series.length - 1];
    var t0 = days > 0 ? last[0] - days * 86400 * 1000 : series[0][0];
    var peak = null, mdd = 0, started = false;
    for (var i = 0; i < series.length; i++) {
      if (series[i][0] < t0) continue;
      started = true;
      if (peak === null || series[i][1] > peak) peak = series[i][1];
      else if (peak > 0) {
        var dd = (series[i][1] / peak - 1) * 100;
        if (dd < mdd) mdd = dd;
      }
    }
    return started ? mdd : null;
  }

  function fmtDate(ts) {
    var d = new Date(ts);
    return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1);
  }

  function drawChart() {
    var st = chartState;
    var adj = adjStore[st.code];
    var box = $("cmSvg");
    var series = pctSeries(adj, st.days);
    if (!series) { box.innerHTML = '<div class="cm-empty">走势数据补充中，请稍后再点开。</div>'; return; }
    var bench = null;
    if (idxSeriesCache) bench = pctSeries(idxSeriesCache, st.days);

    var t0 = series[0][0], t1 = series[series.length - 1][0];
    var mn = Infinity, mx = -Infinity;
    var all = bench ? series.concat(bench) : series;
    all.forEach(function (p) {
      if (p[1] < mn) mn = p[1];
      if (p[1] > mx) mx = p[1];
    });
    var pad = (mx - mn) * 0.08 || 1;
    mn -= pad; mx += pad;
    var W = 680, H = 320, L = 56, R = 74, T = 12, B = 30;
    var iw = W - L - R, ih = H - T - B;
    var X = function (ts) { return L + iw * (ts - t0) / Math.max(1, t1 - t0); };
    var Y = function (v) { return T + ih * (1 - (v - mn) / Math.max(1e-9, mx - mn)); };

    var g = "";
    var k;
    for (k = 0; k <= 4; k++) {
      var v = mn + (mx - mn) * k / 4;
      var y = Y(v).toFixed(1);
      g += '<line x1="' + L + '" y1="' + y + '" x2="' + (W - R) + '" y2="' + y +
        '" stroke="var(--grid)" stroke-width="1"/>' +
        '<text x="' + (L - 8) + '" y="' + (+y + 4) + '" text-anchor="end" class="tick">' + v.toFixed(0) + "%</text>";
    }
    if (mn < 0 && mx > 0) {
      g += '<line x1="' + L + '" y1="' + Y(0).toFixed(1) + '" x2="' + (W - R) + '" y2="' + Y(0).toFixed(1) +
        '" stroke="var(--zero)" stroke-dasharray="4 3"/>';
    }
    for (var kx = 0; kx <= 4; kx++) {
      var tsx = t0 + (t1 - t0) * kx / 4;
      g += '<text x="' + X(tsx).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" class="tick">' + fmtDate(tsx) + "</text>";
    }
    function pathOf(pts2) {
      var d = "";
      for (var i = 0; i < pts2.length; i++) {
        d += (i ? "L" : "M") + X(pts2[i][0]).toFixed(1) + " " + Y(pts2[i][1]).toFixed(1);
      }
      return d;
    }
    g += '<path d="' + pathOf(series) + '" fill="none" stroke="#476B9C" stroke-width="2"/>';
    if (bench) {
      g += '<path d="' + pathOf(bench) + '" fill="none" stroke="#9aa8c0" stroke-width="1.6" stroke-dasharray="5 4"/>';
    }
    var fe = series[series.length - 1][1];
    g += '<circle cx="' + X(series[series.length - 1][0]).toFixed(1) + '" cy="' + Y(fe).toFixed(1) +
      '" r="3" fill="#476B9C"/>';
    g += '<text x="' + Math.min(X(series[series.length - 1][0]) + 6, W - R - 4) + '" y="' + Y(fe).toFixed(1) +
      '" class="tick" fill="#476B9C">' + (fe >= 0 ? "+" : "") + fe.toFixed(1) + "%</text>";
    if (bench) {
      var be = bench[bench.length - 1][1];
      g += '<text x="' + Math.min(X(bench[bench.length - 1][0]) + 6, W - R - 4) + '" y="' + (Y(be) - 8).toFixed(1) +
        '" class="tick" fill="#7b8aa6">' + (be >= 0 ? "+" : "") + be.toFixed(1) + "%</text>";
    }
    box.innerHTML =
      '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" height="' + H + '">' +
      '<rect x="' + L + '" y="' + T + '" width="' + iw + '" height="' + ih + '" fill="none" stroke="var(--grid)"/>' +
      g + "</svg>";
  }

  /* 按需拉取净值序列：月度同步期内 enrich 跳过全量 pz 拉取，
     迷你走势/对比曲线用到时才现取（每基金每次会话仅 1 个直连请求）。
     同一基金的在途请求：后到的调用挂等待者，完成后一并通知 */
  var seriesPending = {};
  var seriesWaiters = {};
  function ensureSeries(codes, done) {
    var remain = 0, fired = false;
    function one() { remain--; if (remain === 0 && !fired) { fired = true; if (done) done(); } }
    codes.forEach(function (c) {
      if (!c || adjStore[c]) return;
      remain++;
      if (seriesPending[c]) { seriesWaiters[c].push(one); return; }
      seriesPending[c] = true;
      seriesWaiters[c] = [];
      semPz(function () {
        return scriptLoad("https://fund.eastmoney.com/pingzhongdata/" + c + ".js", 30000, grabPingzhong);
      }).catch(function () { return null; }).then(function (pz) {
        if (pz && pz.adj && pz.adj.length) adjStore[c] = pz.adj;
        var ws = seriesWaiters[c] || [];
        delete seriesPending[c];
        delete seriesWaiters[c];
        ws.forEach(function (w) { try { w(); } catch (e) {} });
        one();
      });
    });
    if (remain === 0 && !fired) { fired = true; if (done) done(); }
  }

  function openChart(code) {
    var rec = null;
    funds.forEach(function (f) { if (f.code === code) rec = f; });
    if (!rec) return;
    chartState = { code: code, days: 365 };
    $("cmTitle").textContent = rec.name + "（" + rec.code + "）";
    $("cmSub").textContent = "成立 " + rec.inception;
    $("cmRange").querySelectorAll("button").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-days") === "365");
    });
    $("chartVeil").hidden = false;
    renderChartStats();
    drawChart();
    ensureSeries([code], function () {
      if (!$("chartVeil").hidden && chartState && chartState.code === code) { renderChartStats(); drawChart(); }
    });
  }
  function renderChartStats() {
    var st = chartState;
    var adj = adjStore[st.code];
    var fs = pctSeries(adj, st.days);
    var fe = fs ? fs[fs.length - 1][1] : null;
    var be = null;
    if (idxSeriesCache) {
      var bs = pctSeries(idxSeriesCache, st.days);
      if (bs) be = bs[bs.length - 1][1];
    }
    var mdd = winMdd(adj, st.days);
    var html = '<span class="cm-k">区间收益</span><span class="cm-v">' +
      (fe === null ? "--" : (fe >= 0 ? "+" : "") + fe.toFixed(1) + "%") + "</span>";
    if (be !== null) {
      html += '<span class="cm-k">基准同期</span><span class="cm-v">' + (be >= 0 ? "+" : "") + be.toFixed(1) + "%</span>";
      var ex = (fe !== null) ? fe - be : null;
      html += '<span class="cm-k">超额</span><span class="cm-v">' + (ex === null ? "--" : (ex >= 0 ? "+" : "") + ex.toFixed(1) + "%") + "</span>";
    }
    html += '<span class="cm-k">区间最大回撤</span><span class="cm-v">' + (mdd === null ? "--" : mdd.toFixed(1) + "%") + "</span>";
    $("cmStats").innerHTML = html;
  }
  function closeChart() { $("chartVeil").hidden = true; }

  /* ══════════ 10.6 基金对比 ══════════ */
  var cmpDays = 365;
  var CMP_LINE = ["#476B9C", "#B85C5C", "#B98545", "#8496B4"];
  function cmpRecords() {
    return cmpSel.map(function (code) {
      var f = funds.find(function (x) { return x.code === code; }) || null;
      if (!f) {
        Object.keys(tabData).forEach(function (k) {
          if (!f) {
            var hit = tabData[k].funds.find(function (x) { return x.code === code; });
            if (hit) f = hit;
          }
        });
      }
      if (!f) {
        var o = Util.store.get("hs300.live.v3." + code);
        if (o && o.v) f = o.v;
      }
      return f || { code: code, name: code };
    });
  }
  var CMP_METRICS = [
    { label: "成立年限", get: function (r) { return r.years !== null && r.years !== undefined ? r.years : "--"; }, dir: null },
    { label: "规模(亿)", get: function (r) { return r.scale || "--"; }, dir: null },
    { label: "费用合计", get: function (r) { return r.feeTotal || "--"; }, dir: "low" },
    { label: "今年", get: function (r) { return r.ytd || "--"; }, dir: "high" },
    { label: "近1年", get: function (r) { return r.y1 || "--"; }, dir: "high" },
    { label: "近3年", get: function (r) { return r.y3 || "--"; }, dir: "high" },
    { label: "近5年", get: function (r) { return r.y5 || "--"; }, dir: "high" },
    { label: "成立来年化", get: function (r) { return r.annualized || "--"; }, dir: "high" },
    { label: "最大回撤-近3年", get: function (r) { return r.mdd3y || "--"; }, dir: "low" },
    { label: "夏普-近3年", get: function (r) { return r.sp3 || "--"; }, dir: "high" },
    { label: "卡玛-近3年", get: function (r) { return r.calmar3 || "--"; }, dir: "high" },
    { label: "同类排名(近1年)", get: function (r) { return r.rankY1 || "--"; }, dir: "rank" },
    { label: "任期回报", get: function (r) { return r.tenureGain || "--"; }, dir: "high" },
  ];
  function cmpVal(v) {
    if (v === null || v === undefined) return null;
    var s = String(v);
    var m = s.match(/^\s*(\d+)\s*\|\s*(\d+)/);
    if (m && +m[2]) return (+m[1]) / (+m[2]) * 100;
    var n = parseFloat(s.replace(/%/g, ""));
    return isNaN(n) ? null : n;
  }
  function openCompare() {
    var recs = cmpRecords();
    $("cmpVeil").hidden = false;
    cmpDays = 365;
    $("cmpRange").querySelectorAll("button").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-days") === "365");
    });
    renderCompareTable(recs);
    renderCompareChart(recs);
    ensureSeries(cmpSel.slice(), function () {
      if (!$("cmpVeil").hidden) renderCompareChart(cmpRecords());
    });
  }
  function renderCompareTable(recs) {
    var head = '<tr><th class="cmpml">指标</th>' + recs.map(function (r, i) {
      return '<th><span class="cmp-line-dot" style="background:' + CMP_LINE[i % CMP_LINE.length] + '"></span>' +
        esc(r.name) + '<br><span class="cmp-code">' + esc(r.code) + '</span></th>';
    }).join("") + "</tr>";
    var body = CMP_METRICS.map(function (m) {
      var vals = recs.map(function (r) { return { txt: m.get(r), num: cmpVal(m.get(r)) }; });
      var best = null;
      if (m.dir === "high") best = Math.max.apply(null, vals.map(function (v) { return v.num === null ? -Infinity : v.num; }));
      if (m.dir === "low" || m.dir === "rank") best = Math.min.apply(null, vals.map(function (v) { return v.num === null ? Infinity : v.num; }));
      var tds = vals.map(function (v) {
        var isBest = best !== null && isFinite(best) && v.num !== null && v.num === best;
        return '<td class="' + (isBest ? "best" : "") + '">' + esc(v.txt) + "</td>";
      }).join("");
      return "<tr><td class=\"cmpml\">" + esc(m.label) + "</td>" + tds + "</tr>";
    }).join("");
    $("cmpTable").innerHTML = "<table><thead>" + head + "</thead><tbody>" + body + "</tbody></table>";
  }
  function renderCompareChart(recs) {
    var box = $("cmpSvg");
    var seriesList = [];
    cmpSel.forEach(function (code, i) {
      var s2 = pctSeries(adjStore[code], cmpDays);
      if (s2) seriesList.push({ pts: s2, color: CMP_LINE[i % CMP_LINE.length], name: recs[i] ? recs[i].name : code });
    });
    var bench = idxSeriesCache ? pctSeries(idxSeriesCache, cmpDays) : null;
    if (!seriesList.length) {
      box.innerHTML = '<div class="cm-empty">所选基金的走势数据尚未就绪（正在后台补充）。</div>';
      return;
    }
    var t0 = Infinity, t1 = -Infinity, mn = Infinity, mx = -Infinity;
    var all = seriesList.map(function (s2) { return s2.pts; });
    if (bench) all.push(bench);
    all.forEach(function (pts) {
      if (pts[0][0] < t0) t0 = pts[0][0];
      if (pts[pts.length - 1][0] > t1) t1 = pts[pts.length - 1][0];
      pts.forEach(function (p) {
        if (p[1] < mn) mn = p[1];
        if (p[1] > mx) mx = p[1];
      });
    });
    var pad = (mx - mn) * 0.08 || 1;
    mn -= pad; mx += pad;
    var W = 660, H = 260, L = 52, R = 40, T = 10, B = 26;
    var iw = W - L - R, ih = H - T - B;
    var X = function (ts) { return L + iw * (ts - t0) / Math.max(1, t1 - t0); };
    var Y = function (v) { return T + ih * (1 - (v - mn) / Math.max(1e-9, mx - mn)); };
    var g = "";
    var k;
    for (k = 0; k <= 4; k++) {
      var v = mn + (mx - mn) * k / 4;
      var y = Y(v).toFixed(1);
      g += '<line x1="' + L + '" y1="' + y + '" x2="' + (W - R) + '" y2="' + y + '" stroke="var(--grid)"/>' +
        '<text x="' + (L - 8) + '" y="' + (+y + 4) + '" text-anchor="end" class="tick">' + v.toFixed(0) + "%</text>";
    }
    if (mn < 0 && mx > 0) {
      g += '<line x1="' + L + '" y1="' + Y(0).toFixed(1) + '" x2="' + (W - R) + '" y2="' + Y(0).toFixed(1) + '" stroke="var(--zero)" stroke-dasharray="4 3"/>';
    }
    for (var kx = 0; kx <= 4; kx++) {
      var tsx = t0 + (t1 - t0) * kx / 4;
      g += '<text x="' + X(tsx).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" class="tick">' + fmtDate(tsx) + "</text>";
    }
    function pathOf(pts2, dash) {
      var d = "";
      for (var i = 0; i < pts2.length; i++) {
        d += (i ? "L" : "M") + X(pts2[i][0]).toFixed(1) + " " + Y(pts2[i][1]).toFixed(1);
      }
      return '<path d="' + d + '" fill="none" stroke="' + dash + '" stroke-width="1.8"' +
        (dash.indexOf("9aa8c0") >= 0 ? ' stroke-dasharray="5 4"' : "") + "/>";
    }
    seriesList.forEach(function (s2, i) {
      g += pathOf(s2.pts, CMP_LINE[i % CMP_LINE.length]);
    });
    if (bench) g += pathOf(bench, "#9aa8c0");
    box.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" height="' + H + '">' +
      '<rect x="' + L + '" y="' + T + '" width="' + iw + '" height="' + ih + '" fill="none" stroke="var(--grid)"/>' +
      g + "</svg>";
    // 缺失提示：哪只基金没有曲线、基准是否可用——不让用户对着少一条线的图猜原因
    var missing = [];
    cmpSel.forEach(function (code, i) {
      if (!adjStore[code]) missing.push(esc((recs[i] ? recs[i].name : code) + "（" + code + "）"));
    });
    if (!bench && idxSeriesCache === null) missing.push("基准指数（K线接口暂不可用）");
    if (missing.length) {
      box.innerHTML += '<div class="cm-missing">未绘制：' + missing.join("、") + "</div>";
    }
  }
  function closeCompare() { $("cmpVeil").hidden = true; }

  /* ══════════ 11. 导出 ══════════ */
  function csvCell(v) {
    v = String(v);
    if (/[",\r\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
    return v;
  }
  function stamp() {
    var d = new Date();
    return "" + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + "_" + pad2(d.getHours()) + pad2(d.getMinutes());
  }
  function download(content, mime, filename) {
    var blob = new Blob(["" + content], { type: mime });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }
  function exportCSV() {
    var cols = visibleCols();
    var head = ["序号"].concat(cols.map(function (c) { return c.label; }));
    var lines = [head.map(csvCell).join(",")];
    filteredRows.forEach(function (f, i) {
      var row = [String(i + 1)].concat(cols.map(function (c) {
        var v = f[c.key];
        return (v === null || v === undefined) ? "--" : String(v);
      }));
      lines.push(row.map(csvCell).join(","));
    });
    download("\ufeff" + lines.join("\r\n"), "text/csv;charset=utf-8", "沪深300基金_" + stamp() + ".csv");
  }
  function exportExcel() {
    var cols = visibleCols();
    var ths = cols.map(function (c) {
      return '<th style="background:#f4f6fa;border:1px solid #d5dbe6;color:#3d4a66;font-weight:600">' + esc(c.label) + "</th>";
    }).join("");
    var rows = filteredRows.map(function (f, i) {
      var tds = cols.map(function (c) {
        var v = f[c.key];
        return "<td style=\"border:1px solid #e3e7ef;mso-number-format:'\\@'\">" +
          esc((v === null || v === undefined) ? "--" : v) + "</td>";
      }).join("");
      return "<tr><td style=\"border:1px solid #e3e7ef;color:#888\">" + (i + 1) + "</td>" + tds + "</tr>";
    }).join("");
    var doc = '<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8">' +
      "<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>" +
      "<x:Name>沪深300基金</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>" +
      "</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head><body>" +
      '<p style="font-weight:bold">宽基 - 沪深300指数基金　' + esc(modeText()) +
      "　来源：天天基金网　共 " + filteredRows.length + " 只</p>" +
      '<table border="0" cellspacing="0"><tr><th style="background:#f4f6fa;border:1px solid #d5dbe6">序号</th>' + ths + "</tr>" +
      rows + "</table></body></html>";
    download(doc, "application/vnd.ms-excel", "沪深300基金_" + stamp() + ".xls");
  }
  function modeText() {
    if (dataMode === "live") return "实时数据 " + fmtTime(liveUpdated);
    if (dataMode === "snapshot") return "快照数据 " + (snapshotMeta && snapshotMeta.collectedAt ? snapshotMeta.collectedAt : "");
    return "离线数据";
  }
  function fmtTime(d) {
    if (!d) return "--";
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
  }

  /* ══════════ 12. 时钟 / 页签 / 设置（时钟与主题已上移至 assets/core/shell.js） ══════════ */
  /* 顶部导航已由路由接管（assets/router.js）；宽基/债基/自选共用本筛选引擎，
     分组切换由 FundEngine.activateRoute 完成（见文件末尾桥接）。 */
  function applySettingsState() {
    /* 设置页组件（assets/pages/page-settings.js）负责输入绑定与持久化；
       引擎只消费设置状态，并在收到变更事件时重渲染。 */
    var st = Util.store.get(LS_SETTINGS, {});
    if (!st || typeof st !== "object") st = {};
    if (st.useCache === undefined) st.useCache = true;
    if (st.good === undefined) st.good = true;
    goodOn = !!st.good;
    document.body.classList.toggle("dense", !!st.dense);
    document.body.classList.toggle("colorize", !!st.colorize);
  }
  function setModeChip() {
    var chip = $("modeChip");
    chip.classList.toggle("loading", dataMode === "loading");
    if (dataMode === "live") {
      chip.classList.remove("offline");
      $("modeText").textContent = "实时数据 · " + activeTab.label + " · 更新 " + fmtTime(liveUpdated) + (liveFailed ? " · 失败 " + liveFailed : "");
      if (enrichState && enrichState.tab === activeTab.key) {
        $("modeText").textContent += " · 补充回撤/任期 " + enrichState.done + "/" + enrichState.total;
      }
      // 指数页签但基准行缺失（K线接口限流冷却中）——让用户知道缺了什么、为什么
      if (activeTab.kind === "index" && funds && funds.length && !funds.some(function (f) { return f.__isIndex; })) {
        $("modeText").textContent += " · 指数基准暂缺（接口限流冷却中，稍后刷新恢复）";
      }
    } else if (dataMode === "snapshot") {
      chip.classList.add("offline");
      $("modeText").textContent = "快照数据 · 更新 " + (snapshotMeta && snapshotMeta.collectedAt ? snapshotMeta.collectedAt : "--") + "（部署态）";
    } else if (dataMode === "offline") {
      chip.classList.add("offline");
      $("modeText").textContent = "离线数据（启动 server.py 可实时获取）";
    } else {
      chip.classList.remove("offline");
      $("modeText").textContent = fetchPaused
        ? "已挂起 · 点「▶ 继续获取」恢复排队"
        : "实时获取中 · " + activeTab.label + "…";
    }
  }

  /* ══════════ 13. 指数页签与启动流程 ══════════ */
  function useStatic() {
    // 离线快照 data.js 仅覆盖沪深300
    if (activeTab.key !== "hs300") return false;
    if (window.__FUND_DATA__ && window.__FUND_DATA__.funds && window.__FUND_DATA__.funds.length) {
      var rows = window.__FUND_DATA__.funds.slice();
      rows.forEach(function (f) { if (f.ftype === "指数基准") f.__isIndex = true; });
      tabData.hs300 = { funds: rows, updated: null, failed: 0 };
      dataMode = "offline";
      return true;
    }
    return false;
  }

  function renderIdxTabs() {
    var host = $("idxTabs");
    if (!allFundsList) { host.innerHTML = ""; return; }
    var html = "";
    activeGroup.tabs.forEach(function (tab) {
      var cnt = universeFor(tab).length;
      var tip = tab.kind === "index" ? tab.indexName : (tab.tip || tab.meta);
      var badge = (loadingTabKey === tab.key)
        ? '<span class="mini-spin"></span>'
        : '<span class="badge">' + cnt + "</span>";
      html += '<button class="idx-tab' + (tab.key === activeTab.key ? " active" : "") +
        '" data-idx="' + tab.key + '" title="' + esc(tip) + '">' + esc(tab.label) +
        badge + "</button>";
    });
    host.innerHTML = html;
  }

  function applyView() {
    try {
    var td = tabData[activeTab.key] || { funds: [], updated: null, failed: 0 };
    funds = td.funds;
    liveUpdated = td.updated;
    liveFailed = td.failed;
    $("btnPause").hidden = true;
    setBtnLoading(false);
    $("countTotal").textContent = funds.length || "-";
    $("metaTitle").textContent = activeGroup.navLabel + " - " + activeTab.meta;
    renderCoLegend();
    setModeChip();
    renderAll();
    } catch (e) { window.__applyErr = String(e.stack || e).replace(/\n/g, " | ").slice(0, 220); }
  }

  function companyCounts() {
    var counts = {};
    funds.forEach(function (f) {
      if (f.company && f.company !== "--") counts[f.company] = (counts[f.company] || 0) + 1;
    });
    return counts;
  }
  function coMatchKw(name) {
    var kw = $("coSearch").value.trim().toLowerCase();
    if (!kw) return true;
    if (name.toLowerCase().indexOf(kw) >= 0) return true;
    var ini = (CO_PINYIN[name] || "").toLowerCase();
    return !!ini && (ini.indexOf(kw) === 0 || kw.indexOf(ini) === 0);
  }
  function renderCoList() {
    var counts = companyCounts();
    var names = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
    var html = '<div class="co-item' + (coFilter ? "" : " on") + '" data-co="">全部公司</div>';
    names.forEach(function (n) {
      if (!coMatchKw(n)) return;
      html += '<div class="co-item' + (coFilter === n ? " on" : "") + '" data-co="' + esc(n) + '">' +
        '<span class="co-dot" style="background:' + coColor(n) + '"></span>' + esc(n) +
        '<span class="cl-n">' + counts[n] + "</span></div>";
    });
    var host = $("coList");
    if (!html) host.innerHTML = '<div class="co-empty">无匹配公司</div>';
    else host.innerHTML = html;
  }
  function setCoFilter(name) {
    coFilter = name || null;
    var b = $("coBtn");
    b.innerHTML = '<span class="co-dot cur" style="background:' +
      (coFilter ? coColor(coFilter) : "var(--teal)") + '"></span>公司：' +
      (coFilter ? esc(coFilter.replace(/基金$/, "")) : "全部") + '<span class="caret">▾</span>';
    renderAll({ resetScroll: true });
  }
  function renderCoLegend() {
    // 兼容保留：公司下拉的计数来源
    renderCoList();
  }

  function switchTab(key, force) {
    var tab = null;
    TAB_GROUPS.forEach(function (g) {
      var hit = g.tabs.find(function (x) { return x.key === key; });
      if (hit) { tab = hit; activeGroup = g; }
    });
    if (!tab) return;
    var switching = tab.key !== activeTab.key;
    activeTab = tab;
    groupTab[activeGroup.key] = tab.key;
    renderIdxTabs();
    $("metaTitle").textContent = activeGroup.navLabel + " - " + tab.meta;
    if (allFundsList) {
      $("countTotal").textContent = universeFor(tab).length + (tab.kind === "index" ? 1 : 0);
    }
    // 切换页签时重置筛选与排序
    if (switching) {
      $("kwInput").value = ""; keyword = "";
      sortState = null; filters = {};
    }
    if (key === "fav" && favDirty) { force = false; }
    if (!force && tabData[key] && tabData[key].funds.length && !(key === "fav" && favDirty)) {
      dataMode = "live";
      loadingTabKey = null;
      setBtnLoading(false);
      progressCb = null;
      $("loadOverlay").hidden = true;
      applyView();
      enrichTab(key, loadGen, syncedRecently(key));
      return;
    }
    // 走加载流程
    abortLoad = false;
    dataMode = "loading";
    loadingTabKey = key;
    $("btnPause").hidden = false;
    setPaused(false);
    setModeChip();
    renderIdxTabs();
    setBtnLoading(true);
    virtual = { start: 0, end: 0 };
    pendingAnim = false;
    filteredRows = [];
    renderHeader();
    renderBodySlice(false);
    var overlay = $("loadOverlay");
    overlay.hidden = false;
    $("loadSkip").hidden = switching || !useStaticPossible();
    $("loadFill").style.background = "";
    progressCb = function (pct, msg) {
      $("loadFill").style.width = Math.min(100, Math.round(pct)) + "%";
      $("loadStage").textContent = msg;
    };
    if (force) cacheClearAll();
    loadTabData(key, force, progressCb).then(function (out) {
      tabData[key] = { funds: out.rows, updated: new Date(), failed: out.failed };
      dataMode = "live";
      loadingTabKey = null;
      setBtnLoading(false);
      applyView();
      progressCb = null;
      overlay.hidden = true;
      enrichTab(key, loadGen, out.cached);   // 是否走月度缓存由 loadTabData 统一判定并回传
      favDirty = false;
    }).catch(function (e) {
      window.__lastLoadErr = (e && (e.stack || e.message)) || String(e);
      if (e && (e.message === "aborted" || abortLoad)) { progressCb = null; $("btnPause").hidden = true; overlay.hidden = true; return; }
      if (useStatic()) {
        applyView();
        progressCb = null;
        overlay.hidden = true;
        return;
      }
      $("loadStage").textContent = "获取" + tab.label + "数据失败：" + e.message + "（请确认 server.py 已启动）";
      $("loadFill").style.width = "100%";
      $("loadFill").style.background = "#B85C5C";
      progressCb = null;
      $("btnPause").hidden = true;
      loadingTabKey = null;
      setBtnLoading(false);
      renderIdxTabs();
      setTimeout(function () { overlay.hidden = true; $("loadFill").style.background = ""; }, 2600);
      applyView();
    });
  }
  function setBtnLoading(on) {
    var b = $("btnRefresh");
    b.classList.toggle("loading", !!on);
    b.disabled = !!on;
  }
  function useStaticPossible() {
    return activeTab.key === "hs300" &&
      !!(window.__FUND_DATA__ && window.__FUND_DATA__.funds && window.__FUND_DATA__.funds.length);
  }

  function defaultTabForGroup(groupKey) {
    var group = TAB_GROUPS.find(function (g) { return g.key === groupKey; }) || TAB_GROUPS[0];
    return groupTab[group.key] || group.tabs[0].key;
  }
  function boot(groupKey) {
    /* 先按路由分组设定 activeGroup/activeTab：快照模式（无中继）不经过 switchTab，
       applyView 也能渲染出正确分组 */
    var group0 = TAB_GROUPS.find(function (g) { return g.key === groupKey; }) || TAB_GROUPS[0];
    activeGroup = group0;
    activeTab = group0.tabs.find(function (t) { return t.key === defaultTabForGroup(group0.key); }) || group0.tabs[0];
    loadVisible();
    loadFav();
    loadSync();
    updateFavBadge();
    renderChecks();
    initPop();
    applySettingsState();
    /* 设置页组件修改设置后广播 hs300:settings，引擎刷新状态并重渲染 */
    document.addEventListener("hs300:settings", function () {
      applySettingsState();
      measuredRowH = 0;
      renderAll({ resetScroll: true });
    });

    var kwDebounced = debounce(function () { renderAll({ resetScroll: true }); }, 130);
    $("kwInput").addEventListener("input", function () {
      keyword = this.value;
      kwDebounced();
    });
    $("kwInput").addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        this.value = ""; keyword = "";
        renderAll({ resetScroll: true });
      }
    });
    $("clearFilter").addEventListener("click", function () {
      $("kwInput").value = ""; keyword = ""; sortState = null;
      filters = {}; coFilter = null;
      setCoFilter(null);
      renderAll({ resetScroll: true });
    });
    $("btnExportPage").addEventListener("click", exportCSV);
    $("btnExportExcel").addEventListener("click", exportExcel);
    $("btnRefresh").addEventListener("click", function () { switchTab(activeTab.key, true); });
    $("btnPause").addEventListener("click", function () {
      if (dataMode !== "loading") return;
      setPaused(!fetchPaused);
    });
    tbody.addEventListener("click", function (ev) {
      var sp = ev.target.closest(".spark");
      if (sp) { openChart(sp.getAttribute("data-code")); return; }
      var star = ev.target.closest(".fav-star");
      if (star) {
        var code = star.getAttribute("data-fav");
        var f = funds.find(function (x) { return x.code === code; });
        if (f) toggleFav(f);
        var on = isFav(code);
        star.classList.toggle("on", on);
        star.textContent = on ? "★" : "☆";
        star.title = on ? "移出自选" : "加入我的自选";
        if (activeTab.key === "fav") favDirty = true;
        return;
      }
    });
    tbody.addEventListener("change", function (ev) {
      var chk = ev.target.closest(".cmp-chk");
      if (chk) toggleCmp(chk.getAttribute("data-cmp"));
    });
    $("cmpGo").addEventListener("click", openCompare);
    $("cmpClear").addEventListener("click", function () {
      cmpSel = [];
      renderCmpBar();
      renderCmpBarNames();
      renderAll();
    });
    $("cmpNames").addEventListener("click", function (ev) {
      var x = ev.target.closest(".cmp-x");
      if (x) toggleCmp(x.getAttribute("data-x"));
    });
    $("cmpClose").addEventListener("click", closeCompare);
    $("cmpVeil").addEventListener("mousedown", function (ev) {
      if (ev.target === $("cmpVeil")) closeCompare();
    });
    $("cmpRange").addEventListener("click", function (ev) {
      var b = ev.target.closest("button");
      if (!b) return;
      cmpDays = +b.getAttribute("data-days");
      $("cmpRange").querySelectorAll("button").forEach(function (x) {
        x.classList.toggle("on", x === b);
      });
      renderCompareChart(cmpRecords());
    });
    $("btnCols").addEventListener("click", function (ev) {
      ev.stopPropagation();
      var popEl = $("colsPop");
      var open = popEl.hidden;
      popEl.hidden = !open;
      $("btnCols").classList.toggle("open", open);
    });
    $("cmRange").addEventListener("click", function (ev) {
      var b = ev.target.closest("button");
      if (!b) return;
      chartState.days = +b.getAttribute("data-days");
      $("cmRange").querySelectorAll("button").forEach(function (x) {
        x.classList.toggle("on", x === b);
      });
      renderChartStats();
      drawChart();
    });
    $("cmClose").addEventListener("click", closeChart);
    $("chartVeil").addEventListener("mousedown", function (ev) {
      if (ev.target === $("chartVeil")) closeChart();
    });
    $("btnCols").addEventListener("click", function (ev) {
      ev.stopPropagation();
      var popEl = $("colsPop");
      var open = popEl.hidden;
      popEl.hidden = !open;
      $("btnCols").classList.toggle("open", open);
    });
    $("colsPop").addEventListener("click", function (ev) { ev.stopPropagation(); });
    $("coBtn").addEventListener("click", function (ev) {
      ev.stopPropagation();
      var popEl = $("coPop");
      popEl.hidden = !popEl.hidden;
      if (!popEl.hidden) { $("coSearch").value = ""; renderCoList(); $("coSearch").focus(); }
    });
    $("coSearch").addEventListener("input", debounce(function () { renderCoList(); }, 150));
    $("coList").addEventListener("click", function (ev) {
      var item = ev.target.closest(".co-item");
      if (!item) return;
      setCoFilter(item.getAttribute("data-co") || null);
      $("coPop").hidden = true;
    });
    $("idxTabs").addEventListener("click", function (ev) {
      var b = ev.target.closest(".idx-tab");
      if (b) switchTab(b.getAttribute("data-idx"), false);
    });
    $("loadSkip").addEventListener("click", function () {
      abortLoad = true;
      loadGen++;  // 使进行中的加载全部作废
      $("btnPause").hidden = true;
      if (tabData[activeTab.key] && tabData[activeTab.key].funds.length) { applyView(); $("loadOverlay").hidden = true; return; }
      if (useStatic()) { applyView(); $("loadOverlay").hidden = true; return; }
      $("loadStage").textContent = "暂无可用数据，请启动 server.py 后刷新页面";
    });
    scrollBox.addEventListener("scroll", function () {
      scrollBox.classList.toggle("scrolled", scrollBox.scrollLeft > 4);
      if (!rafPending) {
        rafPending = true;
        requestAnimationFrame(function () {
          rafPending = false;
          updateVirtualWindow(false);
        });
      }
    });
    // resize 防抖 200ms：拖拽窗口时避免每帧重建表头与虚拟窗口
    window.addEventListener("resize", debounce(function () {
      renderHeader(); pendingAnim = false; updateVirtualWindow(true);
    }, 200));
    $("infoBubble").innerHTML =
      "<b>数据说明（实时模式）</b><br>" +
      "· 数据实时调取天天基金网公开接口，本地缓存 6 小时，可点「⟳ 刷新数据」强制更新<br>" +
      "· 阶段涨幅 / 年度涨幅(2018-2025)：天天基金官方口径<br>" +
      "· 年度涨幅(2015-2017)：按基金日增长率复权链计算（与原版口径一致）<br>" +
      "· 总规模(亿) = 同基金各类份额净资产合计；单支规模(亿) = 该份额最新净资产<br>" +
      "· 成立来平均年化 = (1+总涨幅)^(365.25/成立天数) − 1<br>" +
      "· 指数页签首行为对应指数的「指数基准行」（沪深300 / 科创50 / 创业板指 / 中证500 / 上证50 / 标普500 / 纳斯达克100 / 道琼斯）；债基页签按天天基金类型分类（短债 / 中长期纯债 / 利率债 / 信用债 / 一级债 / 二级债 / 偏债混合 / 债券ETF）<br>" +
      "· 债基无跟踪指数，跟踪误差类字段为 --；二级债/偏债混合可看「股票占比」判断弹性<br>" +
      "· 表头漏斗图标可按列筛选：前10项 / 高于平均 / 低于平均 / ≥≤ 范围 / 包含关键字<br>" +
      "· 表头悬浮 ? 图标：从第一性原理解释指标定义、计算方式、高低好坏及各自含义<br>" +
      "· 绿色高亮 = 指标达到市场通用优秀标准（夏普/卡玛 ≥ 1、回撤 ≤ 10%、费率 ≤ 0.5%、规模 ≥ 2 亿、任职 ≥ 3 年等）或位于列表前 25%（可在设置中关闭）<br>" +
      "· 金色 = 该列全表最优的唯一基金";

    var overlay = $("loadOverlay");
    overlay.hidden = false;

    progressCb = function (pct, msg) {
      $("loadFill").style.width = Math.min(100, Math.round(pct)) + "%";
      $("loadStage").textContent = msg;
    };

    var detect = (location.protocol === "file:")
      ? Promise.resolve(false)
      : fetch("/api/health", { cache: "no-store" }).then(function (r) { return r.ok; }).catch(function () { return false; });

    detect.then(function (hasProxy) {
      PROXY = hasProxy;
      // 先加载全量清单以渲染指数页签（script 直连，离线也可用）
      return loadAllFunds().then(function () {
        renderIdxTabs();
        if (PROXY) {
          switchTab(defaultTabForGroup(groupKey), false);
          return;
        }
        return Promise.reject(new Error("no-proxy"));
      });
    }).catch(function (e) {
      if (e && e.message === "no-proxy") {
        // 静态/GitHub Pages 模式：读取 data/all.json 快照（含全部页签）
        fetch("data/all.json", { cache: "no-store" }).then(function (r) {
          if (!r.ok) throw new Error("no all.json");
          return r.json();
        }).then(function (d) {
          Object.keys(d.tabs || {}).forEach(function (key) {
            var rows = d.tabs[key];
            rows.forEach(function (f) { if (f.ftype === "指数基准") f.__isIndex = true; });
            tabData[key] = { funds: rows, updated: d.meta ? new Date(d.meta.collectedAt) : null, failed: 0 };
          });
          snapshotMeta = d.meta || {};
          dataMode = "snapshot";
          renderIdxTabs();
          applyView();
          progressCb = null;
          overlay.hidden = true;
        }).catch(function () {
          if (useStatic()) {
            renderIdxTabs();
            applyView();
            progressCb = null;
            overlay.hidden = true;
            return;
          }
          $("loadStage").textContent = "无法获取数据：请先运行 python server.py（本地中继）";
          $("loadFill").style.width = "100%";
          $("loadFill").style.background = "#B85C5C";
          progressCb = null;
        });
        return;
      }
      // 清单加载失败
      if (useStatic()) { applyView(); overlay.hidden = true; return; }
      $("loadStage").textContent = "加载清单失败：" + e.message;
      progressCb = null;
    });
  }

  /* ══════════ 路由桥接：基金筛选组件服务于 #/broad #/bond #/fav 三条路由 ══════════
     首次激活才 boot（按路由分组初始化）；后续激活只做分组切换（已挂载页面保留状态）。 */
  var engineBooted = false;
  window.FundEngine = {
    activateRoute: function (groupKey) {
      $("pageFoot").hidden = groupKey !== "broad";
      if (!engineBooted) {
        engineBooted = true;
        try { boot(groupKey); } catch (e) { window.__bootErr = e.stack || String(e); }
        return;
      }
      var group = TAB_GROUPS.find(function (g) { return g.key === groupKey; });
      if (!group) return;
      if (group !== activeGroup || !tabData[groupTab[groupKey] || group.tabs[0].key]) {
        activeGroup = group;
        renderIdxTabs();
        switchTab(groupTab[groupKey] || group.tabs[0].key, false);
      }
    }
  };
})();
